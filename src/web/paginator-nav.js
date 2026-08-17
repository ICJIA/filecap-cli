/**
 * v1.55.0 — shared paginator <nav> markup for every paginated table (report
 * file view, report page view, index duplicates table, orphans table).
 *
 * Every table renders this control TWICE — once directly above the table and
 * once directly below it — so the controls are reachable from both ends of a
 * long table. With a top-only paginator, a reader who scrolls to the end of a
 * 25-row page finds nothing telling them more pages exist and concludes the
 * list ends there.
 *
 * The two copies are kept in sync by each page's inline script:
 *   - the bottom copy's element ids carry a "-b" suffix (duplicate ids are
 *     invalid HTML and getElementById would only ever find the first);
 *   - only the top copy may be an aria-live region — a second live region
 *     would make screen readers announce every page change twice, so `live`
 *     is ignored on the bottom copy;
 *   - the copies get distinct aria-labels ("… (bottom)") so the two nav
 *     landmarks are distinguishable in a screen reader's landmark list.
 *
 * @param {object} [opts]
 * @param {string} [opts.idPrefix=""]   - id namespace ("pv-", "dup-", …)
 * @param {string} [opts.ariaLabel="Table pagination"]
 * @param {boolean} [opts.live=false]   - top copy announces page changes
 * @param {boolean} [opts.bottom=false] - render the below-the-table copy
 * @returns {string} nav markup
 */
export function paginatorNav({
  idPrefix = "",
  ariaLabel = "Table pagination",
  live = false,
  bottom = false,
} = {}) {
  const suffix = bottom ? "-b" : "";
  const id = (name) => `${idPrefix}${name}${suffix}`;
  const liveAttrs = live && !bottom ? ' role="status" aria-live="polite"' : "";
  return `<nav class="paginator${bottom ? " paginator-bottom" : ""}" aria-label="${ariaLabel}${bottom ? " (bottom)" : ""}">
  <span class="pag-info" id="${id("page-info")}"${liveAttrs}></span>
  <span class="pag-controls">
    <label class="pag-size">Rows per page
      <select id="${id("page-size")}">
        <option value="25" selected>25</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </label>
    <button type="button" id="${id("pag-prev")}" class="pag-btn">&larr; Prev</button>
    <span class="pag-pages" id="${id("pag-pages")}"></span>
    <button type="button" id="${id("pag-next")}" class="pag-btn">Next &rarr;</button>
  </span>
</nav>`;
}
