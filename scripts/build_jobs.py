#!/usr/bin/env python3
"""Build data/jobs.js for the Jobs tab.

Usage:
    python scripts/build_jobs.py

Reads scripts/jobs.yml. Fetches each company board from the public
Greenhouse, Lever and Ashby job-board APIs (the same feeds those companies use
on their own careers pages), keeps AI / research / robotics roles, and merges
the hand-curated listings. Expired curated listings are dropped automatically.

A board that fails to load is skipped with a warning; the rest still build.
If every board fails, the previous jobs.js is kept so the site never goes blank.
"""
import json
import re
import sys
import html
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "jobs.js"
NOW = datetime.now(timezone.utc)
TODAY = NOW.date()
PER_COMPANY = 60          # most recent N matching roles per company
MAX_AGE_DAYS = 180        # ignore board postings older than this
UA = "ai-conference-deadlines-site (+https://github.com)"

KEEP = re.compile(
    r"research|scientist|machine learning|deep learning|artificial intelligence|"
    r"\bML\b|\bAI\b|\bRL\b|LLM|language model|foundation model|computer vision|"
    r"perception|robot|autonom|reinforcement|inference|pre-?training|post-?training|"
    r"alignment|interpretability|safety research|multimodal|\bvision\b|motion planning|"
    r"\bplanning\b|controls?\b|GNC|guidance|navigation|SLAM|sensor fusion|simulation|"
    r"model (behavior|evaluation)|evals?\b|post-?doc|PhD|resident|fellow|technical staff",
    re.I,
)
DROP = re.compile(
    r"recruit|sales|account (executive|manager)|business development|finance|"
    r"accountant|accounting|legal|counsel|attorney|paralegal|marketing|"
    r"communications|people partner|\bHR\b|human resources|payroll|facilities|"
    r"executive assistant|tax\b|procurement|workplace|office manager|"
    r"customer success|support specialist|go-to-market|\bGTM\b|partnerships",
    re.I,
)


def classify(title: str) -> str:
    t = title.lower()
    if re.search(r"\bintern(ship)?\b|co-?op\b", t):
        return "Internship"
    if re.search(r"post-?doc", t):
        return "Postdoc"
    if re.search(r"research|scientist|resident|fellow", t):
        return "Research"
    return "Engineering"


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def iso_day(value):
    """Accept ISO strings or epoch milliseconds; return YYYY-MM-DD or None."""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, timezone.utc).date().isoformat()
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def from_greenhouse(board, payload):
    for j in payload.get("jobs", []):
        yield {
            "title": j.get("title", "").strip(),
            "location": (j.get("location") or {}).get("name", ""),
            "url": j.get("absolute_url"),
            "posted": iso_day(j.get("first_published") or j.get("updated_at")),
        }


def from_lever(board, payload):
    for j in payload if isinstance(payload, list) else []:
        cats = j.get("categories") or {}
        loc = cats.get("location") or ", ".join(cats.get("allLocations") or [])
        if j.get("workplaceType") == "remote" and "remote" not in loc.lower():
            loc = (loc + " · Remote").strip(" ·")
        yield {
            "title": (j.get("text") or "").strip(),
            "location": loc,
            "url": j.get("hostedUrl"),
            "posted": iso_day(j.get("createdAt")),
        }


def from_ashby(board, payload):
    for j in payload.get("jobs", []):
        if j.get("isListed") is False:
            continue
        loc = j.get("location") or ""
        if j.get("isRemote") and "remote" not in loc.lower():
            loc = (loc + " · Remote").strip(" ·")
        yield {
            "title": (j.get("title") or "").strip(),
            "location": loc,
            "url": j.get("jobUrl"),
            "posted": iso_day(j.get("publishedAt")),
        }



# ---------- Big-company career sites with public JSON search ----------
def post_json(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "User-Agent": UA, "Accept": "application/json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def amazon_items(board, fetch=get_json):
    """amazon.jobs search.json, one call per query (newest first)."""
    for q in board.get("queries") or ["research scientist"]:
        url = ("https://www.amazon.jobs/en/search.json?" +
               urllib.parse.urlencode({"base_query": q, "result_limit": 100, "sort": "recent"}))
        for j in fetch(url).get("jobs", []):
            posted = None
            try:
                posted = datetime.strptime(j.get("posted_date", ""), "%B %d, %Y").date().isoformat()
            except ValueError:
                pass
            yield {"title": (j.get("title") or "").strip(),
                   "location": j.get("normalized_location") or j.get("location") or "",
                   "url": "https://www.amazon.jobs" + j["job_path"] if j.get("job_path") else None,
                   "posted": posted}


def _workday_posted(text):
    t = (text or "").lower()
    if "today" in t:
        return TODAY.isoformat()
    if "yesterday" in t:
        return (TODAY - timedelta(days=1)).isoformat()
    m = re.search(r"(\d+)\+?\s*days?", t)
    return (TODAY - timedelta(days=int(m.group(1)))).isoformat() if m else None


def workday_items(board, fetch=None, post=post_json):
    """Workday career sites (the same JSON the public career page uses)."""
    base = f"https://{board['host']}"
    api = f"{base}/wday/cxs/{board['tenant']}/{board['site']}/jobs"
    for q in board.get("queries") or ["research"]:
        for offset in (0, 20, 40):
            res = post(api, {"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": q})
            posts = res.get("jobPostings") or []
            for j in posts:
                yield {"title": (j.get("title") or "").strip(), "location": j.get("locationsText") or "",
                       "url": f"{base}/en-US/{board['site']}{j['externalPath']}" if j.get("externalPath") else None,
                       "posted": _workday_posted(j.get("postedOn"))}
            if len(posts) < 20:
                break


ATS = {
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", from_greenhouse),
    "lever": ("https://api.lever.co/v0/postings/{slug}?mode=json", from_lever),
    "ashby": ("https://api.ashbyhq.com/posting-api/job-board/{slug}", from_ashby),
}


def board_jobs(board, fetch=get_json, post=None):
    if board["ats"] == "amazon":
        items = list(amazon_items(board, fetch))
    elif board["ats"] == "workday":
        items = list(workday_items(board, post=post or post_json))
    else:
        url_tpl, parse = ATS[board["ats"]]
        items = list(parse(board, fetch(url_tpl.format(slug=board["slug"]))))
    cutoff = (TODAY - timedelta(days=MAX_AGE_DAYS)).isoformat()
    seen, out = set(), []
    for j in items:
        title = j["title"]
        if not title or not j["url"] or not KEEP.search(title) or DROP.search(title):
            continue
        if j["posted"] and j["posted"] < cutoff:
            continue
        key = (title.lower(), j["location"].lower())
        if key in seen:  # same role posted in many cities: keep one
            continue
        seen.add(key)
        out.append({**j, "org": board["name"], "sector": "industry",
                    "type": classify(title), "source": board["ats"]})
    out.sort(key=lambda j: j["posted"] or "", reverse=True)
    return out[:PER_COMPANY]


def curated(listings):
    out = []
    for l in listings or []:
        dl = l.get("deadline")
        dl = dl if isinstance(dl, date) else (date.fromisoformat(str(dl)) if dl else None)
        until = l.get("open_until")
        until = until if isinstance(until, date) else (date.fromisoformat(str(until)) if until else None)
        if until is None and dl is not None:
            until = dl + timedelta(days=60 if l.get("rolling") else 0)
        if until is not None and until < TODAY:
            continue  # expired
        out.append({
            "title": l["title"], "org": l["org"], "dept": l.get("dept"),
            "location": l.get("location", ""), "url": l["url"],
            "sector": l.get("sector", "academic"), "type": l.get("type", "Faculty"),
            "rank": l.get("rank"), "areas": l.get("areas"),
            "deadline": dl.isoformat() if dl else None,
            "deadline_label": l.get("deadline_label") or ("Apply by" if dl else None),
            "rolling": bool(l.get("rolling")),
            "posted": str(l["posted"]) if l.get("posted") else None,
            "curated": True,
        })
    return out



# ---------- Academic job feeds (RSS) ----------
ACAD_TYPE = [
    ("Postdoc", re.compile(r"post-?doc|postdoctoral|post-doctoral", re.I)),
    ("PhD", re.compile(r"\bph\.?d\.? (student|position|studentship|candidate)|doctoral (student|candidate|researcher|position)|graduate research assistant", re.I)),
    ("Faculty", re.compile(r"professor|lecturer|faculty|tenure|\bchair\b|instructor|reader in", re.I)),
    ("Research staff", re.compile(r"research (scientist|engineer|associate|fellow)|scientist", re.I)),
]
ACAD_TOPIC = re.compile(r"robot|machine learning|artificial intelligence|\bAI\b|computer vision|autonom|deep learning|"
                        r"data science|natural language|\bNLP\b|intelligent systems|\bcontrols?\b|unmanned|\bUAV|drone|"
                        r"perception|reinforcement learning|computing", re.I)
ACAD_MAX_AGE = 120


def get_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def strip_html(t):
    t = re.sub(r"<br\s*/?>|</p>|</div>|</li>", "\n", t or "", flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return [ln.strip() for ln in html.unescape(t).splitlines() if ln.strip()]


def clean_link(u):
    return re.sub(r"[?&](TrackID|utm_[a-z]+)=[^&]*", "", u or "").rstrip("?&")


def parse_feed(xml_text, source):
    root = ET.fromstring(xml_text)
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = clean_link((it.findtext("link") or "").strip())
        lines = strip_html(it.findtext("description") or "")
        org, _, role = title.partition(": ")
        if not role:
            org, role = "", title
        loc = ""
        for ln in reversed(lines):
            if "," in ln and len(ln) < 90 and not ln.endswith("."):
                loc = ln
                break
        posted = None
        try:
            posted = parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
        except Exception:  # noqa: BLE001
            pass
        out.append({"title": role.strip(), "org": org.strip() or source, "location": loc,
                    "url": link, "posted": posted, "text": " ".join(lines)})
    return out


def academic_feeds(feeds, fetch=get_text):
    cutoff = (TODAY - timedelta(days=ACAD_MAX_AGE)).isoformat()
    seen, jobs, ok, failed = set(), [], [], []
    for f in feeds or []:
        try:
            items = parse_feed(fetch(f["url"]), f["name"])
        except Exception as e:  # noqa: BLE001
            failed.append(f["url"])
            print(f"warning: feed {f['url']} failed: {e}", file=sys.stderr)
            continue
        ok.append(f["url"])
        for j in items:
            key = re.sub(r"\D", "", j["url"].split("/job/")[-1].split("/")[0]) or j["url"]
            if key in seen or not j["title"] or not j["url"]:
                continue
            if j["posted"] and j["posted"] < cutoff:
                continue
            kind = next((k for k, rx in ACAD_TYPE if rx.search(j["title"])), None)
            if not kind or not ACAD_TOPIC.search(j["title"] + " " + j["text"]):
                continue
            seen.add(key)
            jobs.append({"title": j["title"], "org": j["org"], "location": j["location"], "url": j["url"],
                         "sector": "academic", "type": kind, "posted": j["posted"],
                         "source": f.get("source", f["name"])})
    jobs.sort(key=lambda j: j["posted"] or "", reverse=True)
    return jobs, ok, failed


def build(cfg, fetch=get_json, fetch_text=get_text):
    jobs, ok, failed = [], [], []
    for b in cfg.get("boards") or []:
        try:
            found = board_jobs(b, fetch)
            jobs.extend(found)
            ok.append({"name": b["name"], "count": len(found)})
        except Exception as e:  # noqa: BLE001 - one bad board must not stop the build
            failed.append(b["name"])
            print(f"warning: {b['name']} ({b['ats']}/{b['slug']}) failed: {e}", file=sys.stderr)
    acad, feeds_ok, feeds_failed = academic_feeds(cfg.get("academic_feeds"), fetch_text)
    cur = curated(cfg.get("listings"))
    have = {j["url"] for j in acad}
    jobs.extend(acad + [j for j in cur if j["url"] not in have])
    return {
        "generated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "boards": ok, "failed": failed,
        "more_academic": cfg.get("more_academic") or [],
        "more_industry": cfg.get("more_industry") or [],
        "academic_sources": sorted({f.get("source", f["name"]) for f in (cfg.get("academic_feeds") or []) if f["url"] in feeds_ok}),
        "academic_feed_count": len(acad),
        "jobs": jobs,
    }, ok


def main():
    cfg = yaml.safe_load((ROOT / "scripts" / "jobs.yml").read_text())
    data, ok = build(cfg)
    if cfg.get("boards") and not ok and OUT.exists():
        print("error: every board failed; keeping the previous jobs.js", file=sys.stderr)
        sys.exit(0)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("window.JOBS_DATA = " + json.dumps(data, indent=1) + ";\n")
    print(f"wrote {OUT}: {len(data['jobs'])} jobs from {len(ok)} boards "
          f"+ curated listings ({len(data['failed'])} boards failed)")


if __name__ == "__main__":
    main()
