# AI Conference Deadlines

A static site with live countdowns to paper deadlines for 26 major AI venues (ML, computer vision, NLP, robotics, general AI), acceptance-rate and submission statistics, a resubmission planner, a submission-rules cheat sheet, calendar feeds, a Code & datasets tab, and a Jobs tab with academic and industry openings. No build tools, no server — it runs on GitHub Pages as-is.

## Put it online (5 minutes)

1. Create a new public repo on GitHub, e.g. `ai-deadlines`.
2. Upload everything in this folder (keep the folder structure, including `.github/`).
3. **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)` → Save.
4. **Settings → Actions → General →** Workflow permissions: *Read and write* → Save.
5. Your site is live at `https://<your-username>.github.io/ai-deadlines/` within a minute or two.

From the command line instead:

```bash
cd ai-conference-deadlines
git init && git add . && git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/<your-username>/ai-deadlines.git
git push -u origin main
```

## How the data stays current

A GitHub Action (`.github/workflows/update-data.yml`) runs every day, and also right after you edit `scripts/jobs.yml` or `scripts/conferences.yml`. It:

- pulls the open [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) dataset (MIT License, community-maintained) and rebuilds `data/data.js` and the calendar feeds in `data/calendar/`;
- fetches each company's public job board and rebuilds `data/jobs.js`;
- searches GitHub for each conference's most-starred code and datasets and rebuilds `data/resources.js` (takes about 6 minutes);
- commits everything that changed.

Run it any time from the **Actions** tab → *Refresh site data* → *Run workflow*. **Run it once right after you upload**, so the Industry jobs list fills in.

When a conference hasn't announced its next deadline, the site shows a **projected** date shifted from the last edition (one year, or two for biennial venues like ICCV and ECCV). Projected rows are hatched and labeled so nobody mistakes them for official dates.

## Add or remove conferences

Edit `scripts/conferences.yml`. Any key from ccfddl's `conference/AI/` folder works (e.g. `coling`, `icdar`, `gecco`). Then run the workflow or rebuild locally:

```bash
git clone --depth 1 https://github.com/ccfddl/ccf-deadlines.git /tmp/ccfddl
pip install pyyaml
python scripts/build_data.py /tmp/ccfddl
```

Bad data points can be dropped under `exclude_rates` in the same file (ECAI 2022 is excluded because it was the joint IJCAI-ECAI and the numbers are IJCAI's).

## Resubmit planner

Pick the venue a paper is under review at (its decision date fills in automatically, or type any date) and how many days you need to revise. The planner lists every venue whose next deadline falls after that, sorted by date, with the days you'd have and each venue's latest acceptance rate. Venues whose next deadline is too close to your revision window are shown separately. Decision dates come from ccfddl; projected deadlines are estimated from each venue's last edition and labeled.

## Submission rules

`scripts/policies.yml` holds a short summary of each venue's rules from its own call for papers: page limit, AI/LLM policy, reviewing duty, preprint and anonymity rules, dual-submission policy, per-author submission cap, and a "watch out" line for the rule most likely to cause a desk rejection. Each entry links to its source and records when it was checked. When a new call comes out, edit the entry on GitHub; the site rebuilds automatically. Deadline rows show a **Rules** badge that jumps to the venue's card.

## Calendar feeds

`data/calendar/all.ics` plus one feed per area (`machine-learning`, `computer-vision`, `nlp`, `robotics`, `general-ai`). The Deadlines tab has buttons to subscribe in Google Calendar, Apple Calendar or Outlook. Feeds include official paper deadlines and decision dates (never projected ones) with reminders 7 days and 1 day before each deadline, and refresh daily.

## Jobs tab

Everything lives in `scripts/jobs.yml`. Edit it right on GitHub (open the file, click the pencil icon, commit). The site rebuilds within a couple of minutes.

**Industry** roles are pulled daily from public company job boards (Greenhouse, Lever, Ashby). Only research, AI, ML, robotics and autonomy roles are kept; sales, recruiting, finance and similar roles are filtered out. To add a company, find its careers page:

| If the job links look like | Add |
|---|---|
| `boards.greenhouse.io/<slug>` or `job-boards.greenhouse.io/<slug>` | `{name: Name, ats: greenhouse, slug: <slug>}` |
| `jobs.lever.co/<slug>` | `{name: Name, ats: lever, slug: <slug>}` |
| `jobs.ashbyhq.com/<slug>` | `{name: Name, ats: ashby, slug: <slug>}` |

Companies on Workday or their own systems (NVIDIA, Google, Meta, Amazon) can't be fetched automatically. Add their roles by hand under `listings` with `sector: industry`.

**Academic** positions are pulled daily from The Chronicle of Higher Education's job feeds (keywords listed under `academic_feeds` in `scripts/jobs.yml`). Only faculty, postdoc, PhD and research-staff postings about AI, ML, robotics or autonomy are kept, duplicates across keywords are merged, and postings older than 120 days drop off, so the list maintains itself. To widen or narrow it, add or remove a keyword line.

Optionally, you can also add verified postings by hand under `listings` (they expire on their own). Copy an existing entry and change the fields:

```yaml
  - sector: academic
    type: Faculty            # Faculty | Postdoc | PhD
    title: Assistant Professor in Robotics
    org: Example University
    dept: Electrical and Computer Engineering
    location: San Antonio, TX, USA
    rank: Assistant Professor
    deadline: 2026-12-15
    deadline_label: Review begins   # or "Apply by", "Full consideration by"
    rolling: true                    # "until filled": stays up 60 days past the date
    url: https://link-to-the-official-posting
```

Listings drop off automatically after their date passes (60 days after, for `rolling: true`), so the page never shows stale openings. For a listing with no deadline, set `open_until: YYYY-MM-DD`.

## Code & datasets tab

For each conference and each of the last three years, the tab lists the most-starred GitHub repositories tagged with that conference and year, such as `[CVPR 2025]` in the description or the `cvpr2025` topic. Each repo is labeled:

- **Code**, **Dataset / benchmark**, or **Paper list**, based on its own description;
- **Real-world** when it reports real-robot, sim-to-real, on-device or in-the-wild results;
- any award the authors mention (Best Paper, Oral, Spotlight...).

Short acronyms (ACL, RSS, KR, UAI) must appear exactly in uppercase so unrelated repos don't slip in. Venues where few authors tag their repos (COLT, KR) show a note instead of unrelated results. Tuning knobs (repos per year, minimum stars) sit at the top of `scripts/build_resources.py`.

## Preview locally

Open `index.html` directly in a browser, or run `python -m http.server` in this folder and visit `http://localhost:8000`.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page |
| `assets/app.js` | Countdowns, filters, charts, sortable table |
| `assets/style.css` | Styles (light and dark mode) |
| `data/data.js` | Generated conference data — don't edit by hand |
| `data/jobs.js` | Generated jobs data — don't edit by hand |
| `scripts/build_jobs.py` | Builds `data/jobs.js` from job boards + curated list |
| `scripts/jobs.yml` | Job boards to fetch, and hand-curated listings |
| `scripts/build_data.py` | Builds `data/data.js` from the dataset |
| `scripts/conferences.yml` | Which conferences appear, and their area |
| `scripts/policies.yml` | Submission rules per venue (hand-maintained) |
| `scripts/build_resources.py` | Builds `data/resources.js` from GitHub search |
| `data/resources.js` | Generated code & datasets data — don't edit by hand |
| `data/calendar/*.ics` | Generated calendar feeds — don't edit by hand |

## Credits

Deadline and acceptance data: [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines), MIT License. Charts: [Chart.js](https://www.chartjs.org/). Fix a wrong date upstream with a PR to ccfddl and it flows here on the next daily refresh.
