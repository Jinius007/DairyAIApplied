# AI Applications in Dairy Sector Repository

A live-tracked, function-by-function repository of AI and ML developments across the global dairy industry over the last 2 years — animal health, breeding & genetics, nutrition & feeding, engineering & automation, quality & food safety, product development, sustainability & traceability, and digital platforms.

Open `index.html` in a browser, or enable GitHub Pages on this repo to view it live. Filter the feed by day, week, month, year, or the last 2 years, by function, by country/region, or by company/co-op. Click any card to zoom into full details.

Sourced from research papers, industry press, and conference programs; each entry links back to its original source.

## Daily updates

A GitHub Action (`.github/workflows/daily-update.yml`) runs every day at **06:15 UTC** and:

1. Queries **arXiv** and **Crossref** for new dairy-related AI/ML/robotics/automation papers
2. Appends verified entries to the `DATA` array in `index.html`
3. Updates the `last-refresh` meta tag
4. Commits and pushes to `main`, which redeploys GitHub Pages

Run the refresh locally:

```bash
python scripts/daily_refresh.py
# or, if Python is unavailable:
node scripts/daily_refresh.mjs
```

Manual trigger: **Actions → Daily tracker refresh → Run workflow** on GitHub.
