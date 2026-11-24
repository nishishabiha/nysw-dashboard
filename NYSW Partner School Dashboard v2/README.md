# NYSW Partner School Dashboard v2

Open `NYSW_Partner_School_Dashboard.html` in Chrome/Edge. No server or install needed.
Notes, snoozes, AM reassignments and rubric versions save in that browser. Use **Backup** (top right) to export/import them.

## Refresh with new exports
Edit the data folder path (`D`) at the top of `pipeline/gstsched.py`, then from `pipeline/`:
    python build.py      # parses Accelo exports + schedule -> schools_raw.json
    python make_data.py  # -> data.js
    python asm.py        # inlines data.js into the dashboard HTML (writes to the output folder path set inside asm.py)
Scoring, alerts and the rubric live in the HTML (`template.html`), so they re-run live in the browser.

## Hosted version (shared notes + login)
See `hosted/DEPLOY.md`. The single-file `NYSW_Partner_School_Dashboard.html` still works standalone (per-browser storage).
To rebuild the hosted client after editing `pipeline/template.html`: `python pipeline/build_hosted.py` (paths at the top of that file).
