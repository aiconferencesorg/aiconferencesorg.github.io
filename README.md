# AI Conference Deadlines

A static site with live countdowns to paper deadlines for 26 major AI venues (ML, computer vision, NLP, robotics, general AI), plus acceptance-rate and submission statistics. No build tools, no server — it runs on GitHub Pages as-is.

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

A GitHub Action (`.github/workflows/update-data.yml`) runs every Monday. It pulls the open [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) dataset (MIT License, community-maintained), rebuilds `data/data.js`, and commits it if anything changed. You can also run it any time from the **Actions** tab → *Refresh conference data* → *Run workflow*.

When a conference hasn't announced its next deadline, the site shows a **projected** date shifted from the last edition (one year, or two for biennial venues like ICCV and ECCV). Projected rows are hatched and labeled so nobody mistakes them for official dates.

## Add or remove conferences

Edit `scripts/conferences.yml`. Any key from ccfddl's `conference/AI/` folder works (e.g. `coling`, `icdar`, `gecco`). Then run the workflow or rebuild locally:

```bash
git clone --depth 1 https://github.com/ccfddl/ccf-deadlines.git /tmp/ccfddl
pip install pyyaml
python scripts/build_data.py /tmp/ccfddl
```

Bad data points can be dropped under `exclude_rates` in the same file (ECAI 2022 is excluded because it was the joint IJCAI-ECAI and the numbers are IJCAI's).

## Preview locally

Open `index.html` directly in a browser, or run `python -m http.server` in this folder and visit `http://localhost:8000`.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page |
| `assets/app.js` | Countdowns, filters, charts, sortable table |
| `assets/style.css` | Styles (light and dark mode) |
| `data/data.js` | Generated data — don't edit by hand |
| `scripts/build_data.py` | Builds `data/data.js` from the dataset |
| `scripts/conferences.yml` | Which conferences appear, and their area |

## Credits

Deadline and acceptance data: [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines), MIT License. Charts: [Chart.js](https://www.chartjs.org/). Fix a wrong date upstream with a PR to ccfddl and it flows here on the next weekly refresh.
