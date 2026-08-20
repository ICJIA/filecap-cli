# The social card (`og:image`) and README banner

One artwork serves three surfaces, so there is one source and one render:

| Path | What uses it |
|---|---|
| `assets/icjia-fleet-audit-og.svg` | **The source.** Hand-authored SVG, 1200 × 630. |
| `assets/icjia-fleet-audit-og.png` | The banner at the top of `README.md`. |
| `assets/og-overrides/icjia-fleet-audit.png` | The bundle's own `og:image` (absolute URL in the `<head>` of the landing and `/sites` pages) **and** the fleet-audit tooling card's thumbnail on `/sites`. |

The last two are byte-identical copies of the same render. Keep them that way —
a social preview that disagrees with the README is the kind of drift nobody
notices until someone pastes the link into Teams.

## Why it looks like this

It is the app's own visual language, not a generic title card:

- **The amber rule above a mark** is the section device used on every banner page
  (`/help`, `/search`, `/sites`).
- **Green = files, blue = website.** The house hue rule (see the v1.56–v1.59
  entries in `CHANGELOG.md`): green is the file-accessibility scope, blue is the
  website scope, and band colours stay inside cells and gauges. The two panels
  reuse the exact scope lockups the per-site reports lead with — same document
  glyph, same globe glyph, same wording — so the card previews the real page.
- **No numbers anywhere.** Deliberate. A score or a file count baked into a PNG
  is stale the next time the fleet is audited, and a social preview is exactly
  where a stale number does the most damage.

## Re-rendering after an edit to the SVG

`viewcap` caps captures at 1072 px, so the 1200 px render goes through headless
Chrome directly. Serve the SVG inside a wrapper page pinned to the exact size
(an `<img>` at `width:1200px; height:630px` on a zero-margin body), then:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=2000 \
  --screenshot=og.png http://127.0.0.1:8913/og.html

pngquant --quality=82-98 --speed 1 --force --output og-opt.png og.png
cp og-opt.png assets/icjia-fleet-audit-og.png
cp og-opt.png assets/og-overrides/icjia-fleet-audit.png
```

Chrome rather than `rsvg-convert`: the SVG uses a system font stack, and
librsvg resolves it through fontconfig to something different from what a
browser picks. `pngquant` is not optional — the raw Chrome PNG is ~447 KB
against ~114 KB quantised, with no visible banding in the gradients.

Check the result at feed size before committing (`--force-device-scale-factor=0.42`
gives 600 × 315). Everything except the small agency credit line has to stay
legible there; that is the size most people will actually see it at.
