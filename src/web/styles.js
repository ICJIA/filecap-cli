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
 *   Text muted:          #666666
 *   Accent:              #60a5fa
 *   Accent hover:        #93c5fd
 *   Success:             #4ade80
 *   Warning amber:       #fbbf24
 *   Reference gray:      #71717a
 *   Danger:              #f87171
 */

export const DESIGN_TOKENS = {
  bgBase: "#0d1117",
  bgElevated: "#161b22",
  bgSunken: "#010409",
  borderSubtle: "#21262d",
  borderStrong: "#30363d",
  textPrimary: "#e5e5e5",
  textSecondary: "#999999",
  textMuted: "#666666",
  accent: "#60a5fa",
  accentHover: "#93c5fd",
  success: "#4ade80",
  warningAmber: "#fbbf24",
  referenceGray: "#71717a",
  danger: "#f87171",
};

/**
 * Return the shared dark-mode CSS string for the web-rollup assets/style.css.
 * This is a minimal stub for V1 — the full styles are inlined in each page.
 *
 * @returns {string}
 */
export function darkModeCss() {
  return `/* filecap web-rollup shared styles */
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
}
/* Individual pages inline their full CSS for self-contained delivery. */
`;
}
