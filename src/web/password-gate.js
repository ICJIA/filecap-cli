import crypto from "node:crypto";

/**
 * Compute SHA-256 hex of a plaintext password.
 *
 * @param {string} plain
 * @returns {string} lowercase hex digest
 */
export function computeHash(plain) {
  return crypto.createHash("sha256").update(plain, "utf8").digest("hex");
}

/**
 * Inject a client-side password-gate <script> block right after the opening
 * <body> tag of the given HTML string.
 *
 * The gate uses sessionStorage so navigation within the same session does not
 * re-prompt. The password is never stored in cleartext — only the SHA-256 hex
 * is embedded in the HTML.
 *
 * CAVEAT: This is "ward off the curious" security only. Anyone with DevTools or
 * view-source can read the embedded hash. CSVs served at direct URLs are NOT
 * covered by this gate. For real protection use Netlify Visitor Access or
 * HTTP Basic Auth.
 *
 * @param {string} html   - full HTML document string
 * @param {string} hexHash - SHA-256 hex of the password
 * @returns {string} modified HTML with gate script injected after <body ...>
 */
export function injectPasswordGate(html, hexHash) {
  const gateScript = `<script>
(async function () {
  "use strict";
  const expected = "${hexHash}";
  const stored = sessionStorage.getItem("fc-pw");
  async function sha(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  if (stored === expected) return;
  while (true) {
    const pw = prompt("Password:");
    if (pw === null) {
      document.body.innerHTML = "<p style=\\"font-family:sans-serif;padding:2em;color:#e5e5e5;background:#0a0a0a;min-height:100vh\\">Authentication cancelled.</p>";
      return;
    }
    const h = await sha(pw);
    if (h === expected) {
      sessionStorage.setItem("fc-pw", h);
      return;
    }
    alert("Incorrect password.");
  }
})();
<\/script>`;
  return html.replace(/<body([^>]*)>/i, `<body$1>${gateScript}`);
}
