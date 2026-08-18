/**
 * Design-system tokens and shared CSS for the web-rollup bundle.
 *
 * The index page inlines its own CSS for V1, and per-site reports use their
 * own inline CSS from src/report/html.js. This module centralises the design
 * tokens so they can be shared or externalised in future without another
 * search-and-replace across files.
 *
 * Color palette:
 *   Background base:     #0d1117
 *   Background elevated: #161b22
 *   Background sunken:   #010409
 *   Border subtle:       #21262d
 *   Border strong:       #30363d
 *   Text primary:        #e5e5e5
 *   Text secondary:      #999999
 *   Text muted:          #9aa5b1   (bumped from #666666 in v1.7.0 for WCAG AA on card backgrounds — ≈ 5.5:1 against #18202b)
 *   Accent:              #60a5fa
 *   Accent hover:        #93c5fd
 *   Success:             #4ade80
 *   Warning amber:       #fbbf24
 *   Reference gray:      #71717a
 *   Danger:              #f87171
 *
 * v1.7.0 manager-friendly rollup tokens (decisions D2, D5, D6, D7):
 *   Total (blue):        #4dabf7   (scope / total-files hero)
 *   Audit (amber):       #ffa84d   (workload / files-need-audit hero)
 *   Total tile bg:       rgba(77, 171, 247, 0.10)
 *   Audit tile bg:       rgba(255, 168, 77, 0.13)
 *   Nickname:            #c0cdda   (≥ 7:1 on card bg — WCAG AAA at small sizes)
 *   Card bg top:         #18202b
 *   Card bg bottom:      #141a23
 *   CTA bg / fg:         #4dabf7 on #0c1219
 */

export const DESIGN_TOKENS = {
  bgBase: "#0d1117",
  bgElevated: "#161b22",
  bgSunken: "#010409",
  borderSubtle: "#21262d",
  borderStrong: "#30363d",
  textPrimary: "#e5e5e5",
  textSecondary: "#999999",
  textMuted: "#9aa5b1",
  accent: "#60a5fa",
  accentHover: "#93c5fd",
  success: "#4ade80",
  warningAmber: "#fbbf24",
  referenceGray: "#71717a",
  danger: "#f87171",
  // v1.7.0 — manager-friendly rollup redesign (decisions D2, D5, D6, D7)
  total:         "#4dabf7",   // blue — "scope" / total-files hero
  audit:         "#ffa84d",   // amber — "workload" / files-need-audit hero
  totalTileBg:   "rgba(77, 171, 247, 0.10)",
  auditTileBg:   "rgba(255, 168, 77, 0.13)",
  nickname:      "#c0cdda",   // ≥ 7:1 on card bg — WCAG AAA at small sizes
  cardBgTop:     "#18202b",
  cardBgBot:     "#141a23",
  ctaBg:         "#4dabf7",
  ctaFg:         "#0c1219",
};

/**
 * Return the shared dark-mode CSS string for the web-rollup assets/style.css.
 * This is a minimal stub for V1 — the full styles are inlined in each page.
 *
 * @returns {string}
 */
export function darkModeCss() {
  return `/* ICJIA Fleet Audit web-rollup shared styles */
/* Design tokens — see src/web/styles.js for the full palette */
:root {
  --fc-bg-base:        ${DESIGN_TOKENS.bgBase};
  --fc-bg-elevated:    ${DESIGN_TOKENS.bgElevated};
  --fc-bg-sunken:      ${DESIGN_TOKENS.bgSunken};
  --fc-border-subtle:  ${DESIGN_TOKENS.borderSubtle};
  --fc-border-strong:  ${DESIGN_TOKENS.borderStrong};
  --fc-text-primary:   ${DESIGN_TOKENS.textPrimary};
  --fc-text-secondary: ${DESIGN_TOKENS.textSecondary};
  --fc-text-muted:     ${DESIGN_TOKENS.textMuted};
  --fc-accent:         ${DESIGN_TOKENS.accent};
  --fc-accent-hover:   ${DESIGN_TOKENS.accentHover};
  --fc-success:        ${DESIGN_TOKENS.success};
  --fc-warning:        ${DESIGN_TOKENS.warningAmber};
  --fc-ref-gray:       ${DESIGN_TOKENS.referenceGray};
  --fc-danger:         ${DESIGN_TOKENS.danger};
  --fc-total:           ${DESIGN_TOKENS.total};
  --fc-audit:           ${DESIGN_TOKENS.audit};
  --fc-total-tile-bg:   ${DESIGN_TOKENS.totalTileBg};
  --fc-audit-tile-bg:   ${DESIGN_TOKENS.auditTileBg};
  --fc-nickname:        ${DESIGN_TOKENS.nickname};
  --fc-card-bg-top:     ${DESIGN_TOKENS.cardBgTop};
  --fc-card-bg-bot:     ${DESIGN_TOKENS.cardBgBot};
  --fc-cta-bg:          ${DESIGN_TOKENS.ctaBg};
  --fc-cta-fg:          ${DESIGN_TOKENS.ctaFg};
}
/* Individual pages inline their full CSS for self-contained delivery. */
`;
}
