#!/usr/bin/env python3
"""Build fleet PDF page-count chart as SVG."""

sites = [
    ("archive-prod",        51010, 42.5),
    ("icjia-agency-prod",   17219, 19.6),
    ("researchhub-prod",     8502, 37.3),
    ("spac-prod",            4125,  9.7),
    ("ari-api-prod",         2365,  7.9),
    ("ilfvcc-api-prod",      1496, 17.2),
    ("intranet-api-prod",    1300,  5.3),
    ("r3-strapi-prod",       1257, 14.6),
    ("dvfr-strapi-prod",      484,  7.7),
    ("infonet-strapi-prod",   319, 39.9),
    ("vpp-git",                69, 34.5),
    ("i2i-strapi-prod",        37, 37.0),
    ("sfs-git",                28, 28.0),
]

W, H = 760, 1190
LEFT = 36

# Headline section
HEAD_BAR_MAX = 540  # px for 88,211
HEAD_PER_PAGE = HEAD_BAR_MAX / 88211

# Per-site section
ROW_BAR_X = 200
ROW_BAR_W = 340
ROW_BAR_PER_PAGE = ROW_BAR_W / 51010

ROW_Y_START = 340
ROW_H = 26
N_ROWS = len(sites)

# Columns
COL_PAGES_X = 580
COL_AVG_X = 695

def esc(s): return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")

out = []
out.append(f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-title chart-desc">')
out.append('<title id="chart-title">Fleet PDF page count — 88,211 pages across 13 sites (May 22, 2026)</title>')
out.append('<desc id="chart-desc">As-is snapshot of every PDF currently in the ICJIA fleet. Measured page count is 88,211, approximately 5.9 times the prior estimated ceiling of 15,000. archive-prod alone holds 51,010 pages (58% of the total) across 1,200 PDFs averaging 42.5 pages each. After culling agendas, old meeting minutes, and superseded R&amp;A publications, the remediation target is roughly 55,000 to 65,000 pages. PDF-only count; excludes 421 DOCX, 17 PPTX, and 777 XLSX. Coverage is 99.7% (3,528 of 3,537 PDFs introspected). A text-equivalent version with all per-site numbers is at assets/fleet-pdf-pages-2026-05-22.md.</desc>')
out.append('''<style>
.title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 24px; fill: #0f172a; }
.subtitle { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13px; fill: #64748b; }
.sect { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 13px; fill: #0f172a; letter-spacing: 0.7px; }
.label { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 600; font-size: 14px; fill: #334155; }
.num-in { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 16px; fill: #ffffff; }
.num-out { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 16px; fill: #0f172a; }
.delta { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 14px; fill: #b45309; }
.colhead { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 10px; fill: #64748b; letter-spacing: 0.6px; }
.site { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 500; font-size: 12px; fill: #1e293b; }
.pages { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 13px; fill: #0f172a; }
.avg { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 500; font-size: 12px; fill: #475569; }
.threshlbl { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 10px; fill: #b45309; letter-spacing: 0.4px; }
.bannerhead { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 800; font-size: 13px; fill: #92400e; letter-spacing: 0.6px; }
.bannertext { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12.5px; fill: #1e293b; }
.bannerguess { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 12.5px; fill: #92400e; }
.cavhead { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 13px; fill: #0f172a; letter-spacing: 0.7px; }
.cavlbl { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; font-size: 12px; fill: #b45309; }
.cavtext { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12px; fill: #334155; }
.foot { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 11px; fill: #64748b; }
</style>''')

# Background
out.append(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')

# Header
out.append(f'<text x="{LEFT}" y="44" class="title">Fleet PDF page count</text>')
out.append(f'<text x="{LEFT}" y="64" class="subtitle">filecap fleet audit — May 22, 2026 · 3,528 of 3,537 PDFs introspected (99.7% coverage)</text>')

# As-is snapshot banner
banner_y = 80
banner_h = 96
out.append(f'<rect x="{LEFT}" y="{banner_y}" width="{W - 2*LEFT}" height="{banner_h}" fill="#fef3c7" stroke="#f59e0b" stroke-width="1.5" rx="4"/>')
out.append(f'<text x="{LEFT + 16}" y="{banner_y + 22}" class="bannerhead">AS-IS SNAPSHOT — PAGES THAT EXIST NOW</text>')
out.append(f'<text x="{LEFT + 16}" y="{banner_y + 42}" class="bannertext">These are the pages currently in the fleet (May 22, 2026). After culling agendas,</text>')
out.append(f'<text x="{LEFT + 16}" y="{banner_y + 58}" class="bannertext">old meeting minutes, and superseded R&amp;A publications, the remediation target drops:</text>')
out.append(f'<text x="{LEFT + 16}" y="{banner_y + 82}" class="bannerguess">Rough guess: ~55,000–65,000 pages (pending triage)</text>')

# Y-offset for everything below the banner
S = banner_h + 24  # banner height + spacing

# Section: headline comparison
out.append(f'<text x="{LEFT}" y="{100+S}" class="sect">ESTIMATE vs MEASURED</text>')

# Estimate
estimate_w = 15000 * HEAD_PER_PAGE
out.append(f'<text x="{LEFT}" y="{124+S}" class="label">Estimated ceiling</text>')
out.append(f'<rect x="{LEFT}" y="{132+S}" width="{estimate_w:.1f}" height="34" fill="#cbd5e1"/>')
out.append(f'<text x="{LEFT + estimate_w + 12:.1f}" y="{155+S}" class="num-out">15,000 pages</text>')

# Measured
out.append(f'<text x="{LEFT}" y="{194+S}" class="label">Measured (PDFs only)</text>')
out.append(f'<rect x="{LEFT}" y="{202+S}" width="{HEAD_BAR_MAX}" height="34" fill="#0f766e"/>')
out.append(f'<text x="{LEFT + 12}" y="{225+S}" class="num-in">88,211 pages</text>')
out.append(f'<text x="{LEFT + HEAD_BAR_MAX + 14}" y="{225+S}" class="delta">≈5.9× higher</text>')

# Divider
out.append(f'<line x1="{LEFT}" y1="{265+S}" x2="{W-LEFT}" y2="{265+S}" stroke="#e2e8f0" stroke-width="1"/>')

# Section: per-site breakdown
out.append(f'<text x="{LEFT}" y="{295+S}" class="sect">PER-SITE BREAKDOWN</text>')

# Column headers
out.append(f'<text x="{LEFT}" y="{320+S}" class="colhead">SITE</text>')
out.append(f'<text x="{ROW_BAR_X}" y="{320+S}" class="colhead">PAGES (bar)</text>')
out.append(f'<text x="{COL_PAGES_X}" y="{320+S}" class="colhead" text-anchor="end">TOTAL</text>')
out.append(f'<text x="{COL_AVG_X}" y="{320+S}" class="colhead" text-anchor="end">AVG PAGES/PDF</text>')

# Apply the same offset to the per-site rows section
ROW_Y_START = ROW_Y_START + S

# 15K reference line — span all rows
thresh_x = ROW_BAR_X + 15000 * ROW_BAR_PER_PAGE
line_top = ROW_Y_START - 8
line_bot = ROW_Y_START + N_ROWS * ROW_H + 2
out.append(f'<line x1="{thresh_x:.1f}" y1="{line_top}" x2="{thresh_x:.1f}" y2="{line_bot}" stroke="#b45309" stroke-width="1" stroke-dasharray="3 3"/>')
out.append(f'<text x="{thresh_x + 4:.1f}" y="{line_top - 2}" class="threshlbl">15K LINE</text>')

# Rows
for i, (name, pages, avg) in enumerate(sites):
    y_top = ROW_Y_START + i * ROW_H
    y_center = y_top + ROW_H / 2
    bar_w = max(2.0, pages * ROW_BAR_PER_PAGE)
    bar_y = y_top + 5
    bar_h = ROW_H - 10
    text_y = y_center + 4  # baseline
    # site label
    out.append(f'<text x="{LEFT}" y="{text_y:.1f}" class="site">{esc(name)}</text>')
    # bar
    out.append(f'<rect x="{ROW_BAR_X}" y="{bar_y:.1f}" width="{bar_w:.1f}" height="{bar_h}" fill="#0f766e"/>')
    # total pages
    out.append(f'<text x="{COL_PAGES_X}" y="{text_y:.1f}" class="pages" text-anchor="end">{pages:,}</text>')
    # avg
    out.append(f'<text x="{COL_AVG_X}" y="{text_y:.1f}" class="avg" text-anchor="end">{avg:.1f}</text>')

# Fleet total row
total_y = ROW_Y_START + N_ROWS * ROW_H + 8
out.append(f'<line x1="{LEFT}" y1="{total_y}" x2="{W-LEFT}" y2="{total_y}" stroke="#cbd5e1" stroke-width="1"/>')
out.append(f'<text x="{LEFT}" y="{total_y + 22}" class="label">FLEET TOTAL</text>')
out.append(f'<text x="{COL_PAGES_X}" y="{total_y + 22}" class="num-out" text-anchor="end">88,211</text>')
out.append(f'<text x="{COL_AVG_X}" y="{total_y + 22}" class="avg" text-anchor="end">25.0</text>')

# Caveats panel — label stacked above body to avoid text-width guessing
cav_y = total_y + 56
panel_pad_x = 18
panel_pad_top = 16
header_h = 22
block_h = 38   # label line (16) + body line (16) + 6 spacer
panel_h = panel_pad_top + header_h + 4 * block_h + 14
out.append(f'<rect x="{LEFT}" y="{cav_y}" width="{W - 2*LEFT}" height="{panel_h}" fill="#fffbeb" stroke="#fde68a" stroke-width="1" rx="4"/>')
out.append(f'<text x="{LEFT + panel_pad_x}" y="{cav_y + panel_pad_top + 14}" class="cavhead">CAVEATS</text>')

caveats = [
    ("PDFs only.",
     "Excludes 421 DOCX, 17 PPTX, and 777 XLSX. Rough estimates (~7 pages/DOCX, ~20 slides/PPTX) push the true total to ~92,000+."),
    ("99.7% PDF coverage.",
     "9 of 3,537 PDFs failed introspection (encrypted or corrupt). Their page counts are not in the 88,211 figure."),
    ("Pages = volume, not work effort.",
     "PDFs already tagged with a text layer need less remediation than image-only or scanned PDFs."),
    ("Skewed distribution.",
     "archive-prod alone is 58% of pages — 51,010 across 1,200 reports averaging 42.5 pages each."),
]
cav_text_x = LEFT + panel_pad_x
cav_line_y = cav_y + panel_pad_top + header_h + 18
for lbl, body in caveats:
    out.append(f'<text x="{cav_text_x}" y="{cav_line_y}" class="cavlbl">{esc(lbl)}</text>')
    out.append(f'<text x="{cav_text_x}" y="{cav_line_y + 16}" class="cavtext">{esc(body)}</text>')
    cav_line_y += block_h

# Footer
foot_y = cav_y + panel_h + 22
out.append(f'<text x="{LEFT}" y="{foot_y}" class="foot">Source: ~/filecap-audits/_web-rollup/2026-05-22T13-34-09Z/audit-fleet.ndjson · filecap v1.19.1</text>')

out.append('</svg>')

with open("/tmp/fleet-pages.svg", "w") as f:
    f.write("\n".join(out))
print("SVG written. Total height used:", foot_y + 30)
