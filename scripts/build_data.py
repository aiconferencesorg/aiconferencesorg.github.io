#!/usr/bin/env python3
"""Build data/data.js from the open ccfddl/ccf-deadlines dataset.

Usage:
    git clone --depth 1 https://github.com/ccfddl/ccf-deadlines.git /tmp/ccfddl
    python scripts/build_data.py /tmp/ccfddl

Deadlines come from ccfddl's conference/AI/*.yml and acceptance numbers from
accept_rates/AI/*.yml (MIT licensed). When a conference has not announced its
next deadline yet, we project one from the last edition and flag it as an
estimate so the site never shows a guess as fact.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime.now(timezone.utc)


def tzinfo_for(tz: str):
    tz = (tz or "AoE").strip()
    if tz.upper() in ("AOE", "UTC-12"):
        return timezone(timedelta(hours=-12))
    if tz.upper() == "PT":
        return ZoneInfo("America/Los_Angeles")
    if tz.upper().startswith("UTC"):
        off = tz[3:] or "0"
        return timezone(timedelta(hours=float(off)))
    return timezone(timedelta(hours=-12))


def to_utc(stamp: str, tz: str):
    if not stamp or str(stamp).upper().startswith("TBD"):
        return None
    try:
        local = datetime.strptime(str(stamp), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return local.replace(tzinfo=tzinfo_for(tz)).astimezone(timezone.utc)


def shift_years(dt: datetime, years: int) -> datetime:
    try:
        return dt.replace(year=dt.year + years)
    except ValueError:  # Feb 29
        return dt.replace(year=dt.year + years, day=28)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def edition_deadlines(ed):
    tz = ed.get("timezone", "AoE")
    out = []
    for item in ed.get("timeline") or []:
        note = str(item.get("comment") or "").strip()
        short = note if note and len(note) <= 28 else ""
        if "timezone not specified" in note:  # maintainer remark, not for readers
            note = ""
        for field, label in (("abstract_deadline", "Abstract"), ("deadline", "Paper")):
            utc = to_utc(item.get(field), tz)
            if utc:
                out.append({
                    "label": label + (f" · {short}" if short else ""),
                    "note": note if note and not short else "",
                    "utc": utc,
                    "local": f"{item[field][:16]} {tz}",
                })
    return out


def edition_decisions(ed):
    tz = ed.get("timezone", "AoE")
    out, seen = [], set()
    for item in ed.get("timeline") or []:
        utc = to_utc(item.get("decision_deadline"), tz)
        if utc and utc not in seen:
            seen.add(utc)
            note = str(item.get("comment") or "").strip()
            keep = note if re.search(r"round|cycle|phase|track", note, re.I) and len(note) <= 28 else ""
            out.append({"label": keep,
                        "utc": utc, "local": f"{item['decision_deadline'][:16]} {tz}"})
    return out


def build_conf(entry, src: Path, exclude):
    key, area = entry["key"], entry["area"]
    raw = yaml.safe_load((src / "conference" / "AI" / f"{key}.yml").read_text())[0]
    eds = sorted(raw.get("confs", []), key=lambda e: e["year"])

    editions = []
    for ed in eds:
        editions.append({
            "year": ed["year"], "link": ed.get("link"), "date": ed.get("date"),
            "place": ed.get("place"), "deadlines": edition_deadlines(ed),
            "decisions": edition_decisions(ed),
        })

    dated = [e for e in editions if e["deadlines"]]
    latest = editions[-1]
    upcoming_real = any(d["utc"] > NOW for d in latest["deadlines"])

    estimate = None
    if not upcoming_real and dated:
        base = dated[-1]
        years = [e["year"] for e in editions]
        cycle = (years[-1] - years[-2]) if len(years) > 1 else 1
        cycle = cycle if cycle in (1, 2) else 1
        target = latest["year"] if latest["year"] > base["year"] else base["year"] + cycle
        shift = target - base["year"]
        dls = [{**d, "utc": shift_years(d["utc"], shift),
                "local": f"~{shift_years(d['utc'], shift).strftime('%b %d, %Y')} (projected)"}
               for d in base["deadlines"]]
        while dls and max(d["utc"] for d in dls) < NOW:  # safety: roll forward
            target += cycle
            dls = [{**d, "utc": shift_years(d["utc"], cycle),
                    "local": f"~{shift_years(d['utc'], cycle).strftime('%b %d, %Y')} (projected)"}
                   for d in dls]
        estimate = {"year": target, "from_year": base["year"], "deadlines": dls,
                    "link": latest["link"] if latest["year"] == target else None}

    years_all = [e["year"] for e in editions]
    cyc = (years_all[-1] - years_all[-2]) if len(years_all) > 1 else 1
    cyc = cyc if cyc in (1, 2) else 1
    planning = []
    for e in editions:
        fut = [d for d in e["deadlines"] if d["utc"] > NOW]
        if fut:
            planning.append({"year": e["year"], "projected": False, "link": e["link"],
                             "date": e["date"], "deadlines": fut})
    if dated:
        base = dated[-1]
        real_years = {p["year"] for p in planning} | {e["year"] for e in dated}
        for k in (1, 2, 3):
            y = base["year"] + cyc * k
            if y in real_years:
                continue
            dls = [{**d, "utc": shift_years(d["utc"], y - base["year"])} for d in base["deadlines"]]
            if all(d["utc"] < NOW for d in dls):
                continue
            planning.append({"year": y, "projected": True, "from_year": base["year"],
                             "link": None, "date": None, "deadlines": dls})
            if len([p for p in planning if p["projected"]]) >= 2:
                break

    rates = []
    rate_file = src / "accept_rates" / "AI" / f"{key}.yml"
    if rate_file.exists():
        rr = yaml.safe_load(rate_file.read_text())[0].get("accept_rates") or []
        for r in rr:
            if r["year"] in exclude.get(key, []):
                continue
            if r.get("submitted") and r.get("accepted"):
                rates.append({"year": r["year"], "submitted": r["submitted"],
                              "accepted": r["accepted"],
                              "rate": round(r["accepted"] / r["submitted"], 4),
                              "source": r.get("source")})

    def ser(e):
        out = {**e, "deadlines": [{**d, "utc": iso(d["utc"])} for d in e["deadlines"]]}
        if "decisions" in e:
            out["decisions"] = [{**d, "utc": iso(d["utc"])} for d in e["decisions"]]
        return out

    rank = raw.get("rank") or {}
    return {
        "key": key, "title": raw["title"], "description": raw.get("description", ""),
        "area": area, "core": rank.get("core"), "ccf": rank.get("ccf"),
        "dblp": raw.get("dblp"),
        "editions": [ser(e) for e in editions[-2:]],
        "estimate": ser(estimate) if estimate else None,
        "rates": sorted(rates, key=lambda r: r["year"]),
        "cycle": cyc,
        "planning": [ser(p) for p in sorted(planning, key=lambda p: p["year"])],
    }


def ics_escape(t):
    return str(t).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def ics_fold(line):
    raw = line.encode("utf-8")
    if len(raw) <= 74:
        return line
    parts, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > 74:
            parts.append(cur.decode("utf-8"))
            cur = b" " + b
        else:
            cur += b
    parts.append(cur.decode("utf-8"))
    return "\r\n".join(parts)


def write_calendars(confs, outdir):
    """One feed with every venue plus one per area. Only official dates (no projections)."""
    outdir.mkdir(parents=True, exist_ok=True)
    stamp = NOW.strftime("%Y%m%dT%H%M%SZ")
    groups = {"all": ("AI conference deadlines", confs)}
    for area in sorted({c["area"] for c in confs}):
        slug = re.sub(r"[^a-z0-9]+", "-", area.lower()).strip("-")
        groups[slug] = (f"AI conference deadlines: {area}", [c for c in confs if c["area"] == area])
    for slug, (name, items) in groups.items():
        lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Conference Deadlines//EN",
                 "CALSCALE:GREGORIAN", "METHOD:PUBLISH", f"X-WR-CALNAME:{ics_escape(name)}",
                 "X-WR-CALDESC:Paper deadlines and decision dates. Refreshed daily.",
                 "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H"]
        for c in items:
            for e in c["editions"]:
                events = [(d, "deadline") for d in e["deadlines"]] + [(d, "decision") for d in e.get("decisions", [])]
                for d, kind in events:
                    utc = datetime.strptime(d["utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                    if utc < NOW - timedelta(days=30):
                        continue
                    label = d["label"] if kind == "deadline" else ("Decisions" + (f" · {d['label']}" if d["label"] else ""))
                    summary = f"{c['title']} {e['year']}: {label}" + (" deadline" if kind == "deadline" and "deadline" not in label.lower() else "")
                    uid_tail = re.sub(r"[^a-z0-9]+", "-", f"{label}-{d['utc']}".lower())
                    t = utc.strftime("%Y%m%dT%H%M%SZ")
                    desc = f"{c['description']}. Local time: {d['local']}. " + (f"Official site: {e['link']}" if e.get("link") else "")
                    lines += ["BEGIN:VEVENT", f"UID:{c['key']}-{e['year']}-{uid_tail}@ai-conference-deadlines",
                              f"DTSTAMP:{stamp}", f"DTSTART:{t}", f"DTEND:{t}",
                              f"SUMMARY:{ics_escape(summary)}", f"DESCRIPTION:{ics_escape(desc)}"]
                    if e.get("link"):
                        lines.append(f"URL:{e['link']}")
                    if kind == "deadline":
                        for trig, txt in (("-P7D", "in 7 days"), ("-P1D", "tomorrow")):
                            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"TRIGGER:{trig}",
                                      f"DESCRIPTION:{ics_escape(summary)} {txt}", "END:VALARM"]
                    lines.append("END:VEVENT")
        lines.append("END:VCALENDAR")
        (outdir / f"{slug}.ics").write_text("\r\n".join(ics_fold(l) for l in lines) + "\r\n")
    return list(groups)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ccfddl")
    cfg = yaml.safe_load((ROOT / "scripts" / "conferences.yml").read_text())
    exclude = cfg.get("exclude_rates") or {}
    confs = []
    for entry in cfg["conferences"]:
        try:
            confs.append(build_conf(entry, src, exclude))
        except FileNotFoundError:
            print(f"warning: {entry['key']} not found in dataset, skipped", file=sys.stderr)
    pol_file = ROOT / "scripts" / "policies.yml"
    policies = yaml.safe_load(pol_file.read_text()) if pol_file.exists() else []
    for pol in policies:
        if pol.get("checked"):
            pol["checked"] = str(pol["checked"])
    data = {"generated": iso(NOW), "conferences": confs, "policies": policies}
    out = ROOT / "data" / "data.js"
    out.parent.mkdir(exist_ok=True)
    out.write_text("window.CONF_DATA = " + json.dumps(data, indent=1) + ";\n")
    print(f"wrote {out} with {len(confs)} conferences")
    feeds = write_calendars(confs, ROOT / "data" / "calendar")
    print(f"wrote calendar feeds: {', '.join(feeds)}")


if __name__ == "__main__":
    main()
