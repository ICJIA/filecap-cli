// Plausible visit tracking for the DEPLOYED BUNDLE (v1.60.0).
//
// Self-hosted instance at plausible.icjia.cloud, site id fleet.icjia.app —
// cookieless, anonymous visit counts. Two rules govern this module:
//
//   1. Bundle pages only. Standalone vendor reports (writeHtml without
//      backHref) are emailed and opened offline; they must never phone
//      home. Every bundle page generator interpolates PLAUSIBLE_SNIPPET
//      into its <head>; report/html.js gates it on backHref.
//
//   2. No ids or timestamps in recorded URLs. Plausible's auto script
//      records location.href as-is, so we load the MANUAL extension
//      (script.manual.js) and send the pageview ourselves with a
//      sanitized URL:
//        - any path under /page-audit/ or /page-report/ collapses to the
//          bare prefix, so a shareable id like /page-audit/<uuid> can
//          never land in the analytics as a distinct page;
//        - per-site report pages drop their scan-timestamp suffix
//          (/sfs-20260818-004852z → /sfs) — the analytics question is
//          "which site's report page gets hits", and every rollup would
//          otherwise mint a brand-new page per site (v1.60.1).
//      plausibleSanitizePath is embedded into the inline call via
//      .toString() — the unit-tested function IS the shipped code.
//
// CSP: script-src AND connect-src in netlify-config.js allowlist
// https://plausible.icjia.cloud (script load + /api/event beacons) — one
// without the other loads a tracker that silently drops every event.
// No SRI hash on purpose: the operator controls the Plausible instance,
// and its script changes on every Plausible upgrade — an integrity pin
// would silently kill tracking at the first upgrade.

export function plausibleSanitizePath(pathname) {
  return pathname
    .replace(/^(\/page-(?:audit|report))\/.*$/, "$1")
    .replace(/^(\/[a-z0-9-]+)-\d{8}-\d{6}z(?:\.html)?\/?$/i, "$1");
}

export const PLAUSIBLE_SNIPPET =
  `<script defer data-domain="fleet.icjia.app" src="https://plausible.icjia.cloud/js/script.manual.js"></script>\n` +
  `<script>window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};(function(){var sanitize=${plausibleSanitizePath.toString()};window.plausible("pageview",{u:location.origin+sanitize(location.pathname)})})();</script>`;
