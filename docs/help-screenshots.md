# Re-shooting the `/help` screenshots

`src/web/help-page.js` embeds three cropped PNGs from `assets/help/`. They are
committed to the repo and copied verbatim into the bundle by `web-rollup`
(driven by `HELP_SCREENSHOTS`, so a rename in one place cannot leave a dead
`<img>` in the other).

| File | Size | Shows |
|---|---|---|
| `step-find-site.png` | 420 × 660 | A site card on the fleet index, cropped to its identity: image, short code, name, URL, description, and the two number tiles. |
| `step-download-card.png` | 420 × 206 | The bottom of a site card — the `View detailed report` and `Download spreadsheet` buttons with the `Last audit` caption. |
| `step-download-report.png` | 900 × 583 | The top of a per-site report — headline count, the green `Download spreadsheet (XLSX)` button, and the File accessibility card. |

They were shot against **ARI** (the card) and **DVFR** (the report) from the
2026-08-18 rollup. The prose in `help-page.js` names those two sites, and the
captions quote their numbers (569 / 430 files, 74 files, score 84) — so if you
re-shoot against different sites, update the captions and the alt text with
them, and re-run `npx vitest run test/help-page.test.js`.

## When to re-shoot

Only when the thing pictured is redesigned: the site card's layout, its action
buttons, or the per-site report's hero. A palette tweak is not worth 235 KB of
churn. Everything else on `/help` — the column map, the decision cards, the
example grid — is live HTML and updates itself.

## How they were made

Element screenshots of the live page pick up the sticky header and clip to the
viewport. Instead, build a harness page that carries the bundle's own
stylesheet and only the fragment you want, then screenshot it at an exact
viewport size.

1. **Serve a bundle.** Any recent rollup works:

   ```bash
   cd ~/filecap-audits/_web-rollup/<timestamp>/
   python3 -m http.server 8912 --bind 127.0.0.1
   ```

2. **Extract the fragment and wrap it in a harness.** Pull the `<style>` block
   and the element you want out of the generated HTML, and write a minimal page
   containing just those, with the wrapper pinned to the target width:

   ```html
   <!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
   <style>/* the bundle page's own <style> contents, verbatim */</style>
   <style>
     html,body { margin:0; padding:0; background:#0d1117; }
     .shot-wrap { width:420px; }
     * { animation:none !important; transition:none !important; }
     .card-stretched-link { display:none; }
     .site-card { margin:0; min-height:0 !important; height:auto !important; }
     .actions { margin-top:0 !important; }
     /* hide the parts of the fragment this shot is not about */
   </style></head>
   <body><div class="shot-wrap"><!-- the extracted element --></div></body></html>
   ```

   Two details that matter: `.site-card` is a flex column with `.actions`
   pinned to the bottom, so without the `height:auto` override a cropped card
   screenshots as a tall block of empty space; and `.card-stretched-link` is an
   invisible full-card overlay that has no business in a still.

3. **Screenshot at the exact size.** Use the `viewcap` MCP server with
   `fullPage: false` and the width/height you want — that crops precisely and
   avoids the tiling that full-page capture applies:

   ```
   take_screenshot url=http://127.0.0.1:8912/<harness>.html
                   fullPage=false width=420 height=660
                   directory=<somewhere>
   ```

4. **Drop it in and update the metadata.** Copy the PNG to `assets/help/` under
   its existing name, then set `width`/`height` in the `SHOTS` table in
   `src/web/help-page.js` to the real pixel dimensions (`sips -g pixelWidth -g
   pixelHeight <file>`). Those attributes are what stop the page reflowing as
   the images load, so a stale number is a visible bug.

5. **Re-write the alt text.** It describes what is *in* the picture for someone
   who cannot see it — the buttons, the numbers, the labels. The test asserts
   every screenshot has at least 40 characters of it, which catches an empty
   `alt` but not a lazy one.

6. **Verify.**

   ```bash
   npx vitest run test/help-page.test.js test/web-rollup.test.js
   ```
