#!/usr/bin/env python3
"""Build data/resources.js: open-source code and datasets from each conference,
grouped by year, for the Resources tab.

Usage (what the GitHub Action runs):
    GITHUB_TOKEN=... python scripts/build_resources.py /tmp/ccfddl

For every conference in scripts/conferences.yml and each of the last three
years, it searches GitHub for repositories whose name or description is tagged
with the conference and year (e.g. "[CVPR 2025]") or that carry the matching
topic (e.g. "cvpr2025"), keeps the most-starred ones, and labels each as code,
dataset/benchmark, or paper list. Repos that report real-robot or real-world
results get a "Real-world" badge, and award mentions (Best Paper, Oral, ...)
are shown too.

If more than half the searches fail (rate limit, outage), the previous
resources.js is kept so the tab never goes blank.

    python scripts/build_resources.py /tmp/ccfddl --seed DIR
builds from saved search results instead of the live API (used for previews).
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "resources.js"
NOW = datetime.now(timezone.utc)
YEARS = [NOW.year, NOW.year - 1, NOW.year - 2]
PER_CELL = 12          # repos shown per conference-year
MAX_LISTS = 2          # at most this many paper lists per cell
MIN_STARS = 5
API = "https://api.github.com/search/repositories"

LIST_RE = re.compile(r"awesome|paper[\s_-]*list|papers?[\s_-]*(with|and)[\s_-]*code|"
                     r"论文|collection of papers|curated list|\bsurvey\b|reading list", re.I)
DATA_RE = re.compile(r"dataset|benchmark|\bbench\b|corpus|leaderboard|test suite|"
                     r"\bgym\b|arena|evaluation (platform|suite|framework)|simulation suite|"
                     r"simulator|data bank", re.I)
REAL_RE = re.compile(r"real[\s-]world|real robot|sim[\s-]?(to|2)[\s-]?real|real[\s-]?(to|2)[\s-]?sim|"
                     r"in the wild|on[\s-]device|hardware|field (test|trial|robot)|deploy", re.I)
AWARD_RE = re.compile(r"(best (student |systems )?paper( award)?( candidate| finalist| nomination)?|"
                      r"outstanding paper( award)?( finalist)?|oral|spotlight|highlight)", re.I)
SKIP_RE = re.compile(r"latex|template|website for|homepage|summer school|tutorial|meetup|"
                     r"slides|proceedings of|anonymous repository|course", re.I)


def tag_regex(title, year):
    yy = str(year)[2:]
    flags = 0 if len(title) <= 3 else re.I
    t = re.escape(title)
    return re.compile(rf"(?<![A-Za-z]){t}[\s'’_,-]*(?:20{yy}|{yy})(?![0-9])", flags)


def gh_search(q, token, per_page=30):
    url = f"{API}?{urllib.parse.urlencode({'q': q, 'sort': 'stars', 'order': 'desc', 'per_page': per_page})}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "ai-conference-deadlines"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return json.loads(r.read().decode("utf-8")).get("items", [])


def norm(item):
    return {
        "repo": item["full_name"], "stars": item.get("stargazers_count", 0),
        "created": (item.get("created_at") or "")[:10],
        "desc": (item.get("description") or "").strip(),
        "topics": item.get("topics") or [], "fork": item.get("fork", False),
    }


def load_seed(seed_dir):
    """Parse saved results: '## <key> <year|*>' headers, then 'owner/repo | stars | created | desc' lines."""
    cells = {}
    for f in sorted(Path(seed_dir).glob("*.txt")):
        key = None
        for line in f.read_text().splitlines():
            if line.startswith("## "):
                key = tuple(line[3:].split())
                cells.setdefault(key, [])
                continue
            parts = [p.strip() for p in line.split("|", 3)]
            if key and len(parts) == 4 and "/" in parts[0] and parts[1].isdigit():
                cells[key].append({"repo": parts[0], "stars": int(parts[1]), "created": parts[2][:10],
                                   "desc": parts[3], "topics": [], "fork": False})
    return cells


def classify(r):
    text = f"{r['repo'].split('/')[-1]} {r['desc']}"
    kind = "list" if LIST_RE.search(text) else "data" if DATA_RE.search(text) else "code"
    award = AWARD_RE.search(r["desc"])
    return {
        "repo": r["repo"], "stars": r["stars"], "desc": r["desc"][:240],
        "kind": kind, "real": bool(REAL_RE.search(text)),
        "award": award.group(0).title().replace("Of", "of") if award else None,
    }


def pick(candidates, title, year):
    rx = tag_regex(title, year)
    topic = re.sub(r"[^a-z0-9]", "", title.lower()) + str(year)
    seen, keep = set(), []
    for r in sorted(candidates, key=lambda r: -r["stars"]):
        if r["repo"] in seen or r["fork"] or r["stars"] < MIN_STARS:
            continue
        name = r["repo"].split("/")[-1]
        tagged = rx.search(r["desc"]) or rx.search(name) or topic in r["topics"]
        if not tagged or SKIP_RE.search(f"{name} {r['desc']}"):
            continue
        if r["created"] and int(r["created"][:4]) < year - 3:
            # very old repos are usually multi-year lists; keep only if they are lists
            if not LIST_RE.search(f"{name} {r['desc']}"):
                continue
        seen.add(r["repo"])
        keep.append(classify(r))
    lists = [k for k in keep if k["kind"] == "list"][:MAX_LISTS]
    others = [k for k in keep if k["kind"] != "list"]
    return (others[: PER_CELL - len(lists)] + lists)


def edition_links(src, key):
    try:
        raw = yaml.safe_load((Path(src) / "conference" / "AI" / f"{key}.yml").read_text())[0]
    except FileNotFoundError:
        return {}, key.upper(), ""
    return ({e["year"]: e.get("link") for e in raw.get("confs", [])},
            raw["title"], raw.get("description", ""))


def main():
    args = sys.argv[1:]
    seed = None
    if "--seed" in args:
        seed = args[args.index("--seed") + 1]
        args = [a for a in args if a not in ("--seed", seed)]
    src = args[0] if args else "/tmp/ccfddl"
    token = os.environ.get("GITHUB_TOKEN")
    cfg = yaml.safe_load((ROOT / "scripts" / "conferences.yml").read_text())
    seeded = load_seed(seed) if seed else None

    out, calls, failures = [], 0, 0
    for entry in cfg["conferences"]:
        key = entry["key"]
        links, title, desc = edition_links(src, key)
        years = {}
        for y in YEARS:
            if seeded is not None:
                cands = seeded.get((key, str(y)), []) + seeded.get((key, "*"), [])
            else:
                cands = []
                topic = re.sub(r"[^a-z0-9]", "", title.lower()) + str(y)
                for q in (f'"{title} {y}" in:name,description', f"topic:{topic}"):
                    calls += 1
                    try:
                        cands += [norm(i) for i in gh_search(q, token)]
                    except Exception as e:  # noqa: BLE001
                        failures += 1
                        print(f"warning: search failed for {q!r}: {e}", file=sys.stderr)
                    time.sleep(2.2 if token else 6.5)  # stay under the search rate limit
            items = pick(cands, title, y)
            if items or links.get(y):
                years[str(y)] = {"link": links.get(y), "items": items}
        out.append({"key": key, "title": title, "description": desc, "area": entry["area"], "years": years})
        print(f"{title}: " + ", ".join(f"{y}={len(v['items'])}" for y, v in years.items()))

    if calls and failures > calls / 2 and OUT.exists():
        print(f"error: {failures}/{calls} searches failed; keeping the previous resources.js", file=sys.stderr)
        return
    data = {"generated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "years": [str(y) for y in YEARS],
            "source": "seed" if seeded is not None else "github", "conferences": out}
    OUT.write_text("window.RESOURCES_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
