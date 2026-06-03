export const meta = {
  name: 'fleet-rescan-v1.20.0',
  description: 'Top-to-bottom rescan of all 13 ICJIA sites with the new v1.20.0 page-count UI. Script-driven heavy lifting (scan + audit + references) wrapped in per-phase agents for observability and resume.',
  phases: [
    { title: 'Pre-flight' },
    { title: 'Rescan (scan + audit + references)' },
    { title: 'Verify page counts' },
    { title: 'Web-rollup with new page-count UI' },
    { title: 'Deploy to Netlify' },
    { title: 'Purge old runs' },
  ],
};

const PRE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ready: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['ready', 'blockers', 'summary'],
};

const RESCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { type: 'integer' },
    runtimeSeconds: { type: 'integer' },
    logPath: { type: 'string' },
    tail: { type: 'string' },
    sitesWithFreshInventory: { type: 'array', items: { type: 'string' } },
  },
  required: ['exitCode', 'logPath', 'tail', 'sitesWithFreshInventory'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    siteCount: { type: 'integer' },
    totalPdfPages: { type: 'integer' },
    sitesMissingPageCount: { type: 'array', items: { type: 'string' } },
    anomalies: { type: 'array', items: { type: 'string' } },
    perSite: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          site: { type: 'string' },
          pdfsWithPageCount: { type: 'integer' },
          pdfsWithoutPageCount: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
        required: ['site', 'pdfsWithPageCount', 'pdfsWithoutPageCount', 'totalPages'],
      },
    },
  },
  required: ['siteCount', 'totalPdfPages', 'sitesMissingPageCount', 'anomalies', 'perSite'],
};

const ROLLUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { type: 'integer' },
    bundlePath: { type: 'string' },
    fleetTotalFiles: { type: 'integer' },
    fleetRemediable: { type: 'integer' },
    fleetRemediablePages: { type: 'integer' },
    fleetPdfPagesMeasured: { type: 'integer' },
  },
  required: ['exitCode', 'bundlePath', 'fleetTotalFiles', 'fleetRemediable', 'fleetRemediablePages'],
};

const DEPLOY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { type: 'integer' },
    deployedUrl: { type: 'string' },
    deployId: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['exitCode', 'deployedUrl'],
};

const PURGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    perSiteRemoved: { type: 'integer' },
    rollupsRemoved: { type: 'integer' },
    freedHuman: { type: 'string' },
    kept: { type: 'array', items: { type: 'string' } },
  },
  required: ['perSiteRemoved', 'rollupsRemoved', 'freedHuman', 'kept'],
};

// ─────────────────────────────────────────────────────────────────────────────

phase('Pre-flight');
const pre = await agent(
  `Pre-flight check before a v1.20.0 fleet rescan.

WORKING DIR: /Volumes/satechi/webdev/filecap-cli

Run these checks (parallel via single bash block) and decide if we can proceed:

1. \`which expect\` — must return a path (the script uses expect to drive ssh prompts).
2. \`test -f ~/.filecap/sites.json && jq '.sites | length' ~/.filecap/sites.json\` — should print 13.
3. \`pgrep -fl 'audit-fleet|filecap.*scan' || echo NONE\` — must print NONE.
4. \`df -h ~ | tail -1\` — there must be more than 10 GB free.
5. \`node /Volumes/satechi/webdev/filecap-cli/bin/filecap.js --version\` — must run cleanly.
6. Verify the v1.20.0 page-estimate helper is present: \`test -f /Volumes/satechi/webdev/filecap-cli/src/web/page-estimate.js && echo OK\`.
7. \`grep -c "fleet-hero-pages" /Volumes/satechi/webdev/filecap-cli/src/web/index-page.js\` — should be at least 3 (CSS rules + render).

DO NOT block on uncommitted working-tree changes — that's expected (the user added the page-count UI without committing yet).

Return JSON with ready, blockers (list of failed-check descriptions, empty if ready), and summary (one short line).`,
  { phase: 'Pre-flight', schema: PRE_SCHEMA }
);

if (!pre.ready) {
  log('Pre-flight failed: ' + (pre.blockers || []).join('; '));
  return { aborted: true, stage: 'pre-flight', pre };
}
log(`Pre-flight OK — ${pre.summary}`);

// ─────────────────────────────────────────────────────────────────────────────

phase('Rescan (scan + audit + references)');
const rescan = await agent(
  `POST-MORTEM MODE — the rescan script ALREADY RAN to completion in a previous session (PID 27915, finished 2026-06-02T23:45:56Z, runtime ~17 minutes — much faster than estimated because the audit cache was warm). Your job is to read what's on disk and report it as if you ran the script yourself.

LOG: /tmp/fleet-rescan/log-20260602-232836Z.txt
START_TS: 1780442911 (Unix epoch seconds when the script started)

Step 1 — Tail the log (last 120 lines):
  tail -120 /tmp/fleet-rescan/log-20260602-232836Z.txt
Save these to put in your return JSON's "tail" field.

Step 2 — Compute exitCode:
  grep -cE 'ERROR|FAILED' /tmp/fleet-rescan/log-20260602-232836Z.txt
If 0, exitCode = 0. Else exitCode = 1.

Step 3 — Compute runtimeSeconds:
  END_TS=$(date -j -f '%Y-%m-%dT%H:%M:%SZ' '2026-06-02T23:45:56Z' +%s 2>/dev/null || gdate -d '2026-06-02T23:45:56Z' +%s)
  echo $((END_TS - 1780442911))
(Should be around 1020.)

Step 4 — List sites with fresh inventory. A "fresh" run dir is any dir under ~/filecap-audits/<site>/runs/ named 20260602-23*Z:
  ls -d ~/filecap-audits/*/runs/20260602-23*Z 2>/dev/null | awk -F/ '{print $(NF-2)}' | sort -u
This should print all 13 site nicknames.

Return JSON with exitCode, runtimeSeconds, logPath (= "/tmp/fleet-rescan/log-20260602-232836Z.txt"), tail (last 120 log lines as a single string), sitesWithFreshInventory (array of nicknames).

DO NOT re-run the rescan script. DO NOT use nohup. Just read what's there.`,
  { phase: 'Rescan (scan + audit + references)', schema: RESCAN_SCHEMA }
);

if (rescan.exitCode !== 0) {
  log(`Rescan finished with exit ${rescan.exitCode}. Tail:\n${rescan.tail}`);
  return { aborted: true, stage: 'rescan', pre, rescan };
}
log(`Rescan OK in ${Math.round((rescan.runtimeSeconds || 0) / 60)} min — ${rescan.sitesWithFreshInventory.length} sites with fresh inventory`);

// ─────────────────────────────────────────────────────────────────────────────

phase('Verify page counts');
const verify = await agent(
  `Verify the fresh inventories carry \`introspection.pageCount\` on the vast majority of PDFs (>= 99% per site is the baseline we expect from pdfjs-dist).

For each site in ~/.filecap/sites.json (use \`jq -r '.sites[].name'\`), find the newest run dir at ~/filecap-audits/<site>/runs/<timestamp>/ and read its \`inventory.cross-ref.ndjson\` if present, else \`inventory.audited.ndjson\` if present, else \`inventory.ndjson\`.

For each inventory, count PDFs:
  - pdfsWithPageCount: \`jq -c 'select(.category=="pdf" and (.introspection.pageCount|type=="number"))' <inv> | wc -l\`
  - pdfsWithoutPageCount: \`jq -c 'select(.category=="pdf" and (.introspection.pageCount|type!="number"))' <inv> | wc -l\`
  - totalPages: \`jq -c 'select(.category=="pdf") | .introspection.pageCount // 0' <inv> | awk '{s+=$1} END{print s+0}'\`

Aggregate fleet totalPdfPages = sum of all per-site totalPages.

Flag in \`anomalies\` any of:
  - A site whose pdfsWithoutPageCount > 5% of (with + without) → "pageCount coverage low on <site>: X/Y"
  - totalPdfPages < 70,000 OR > 130,000 → "totalPdfPages outside expected 80K–120K band: <n>"
  - Any site with 0 PDFs scanned at all (unless it's a known PDF-empty git-only site like ari-summit-2017/18/19/23 or sfs-git / vpp-git / ilheals-git) → "no PDFs in <site>"

Add to \`sitesMissingPageCount\` any site where pdfsWithoutPageCount > 0.

Return JSON matching the schema with perSite array of {site, pdfsWithPageCount, pdfsWithoutPageCount, totalPages}.`,
  { phase: 'Verify page counts', schema: VERIFY_SCHEMA }
);
log(`Verify: ${verify.siteCount} sites · ${verify.totalPdfPages.toLocaleString()} measured PDF pages · ${verify.anomalies.length} anomalies`);
if (verify.anomalies.length > 0) {
  log(`Anomalies: ${verify.anomalies.join('; ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────

phase('Web-rollup with new page-count UI');
const rollup = await agent(
  `Build the web-rollup bundle locally. The new page-count code in src/web/page-estimate.js, src/web/index-page.js, src/report/html.js, and src/commands/web-rollup.js must render \`fleet-hero-pages\` and per-site \`dp-sub\` markup. Do NOT deploy from this agent — the next phase handles deploy.

INVOCATION:
\`\`\`
cd /Volumes/satechi/webdev/filecap-cli
FILECAP_NO_DEPLOY=1 node bin/filecap.js web-rollup 2>&1 | tail -60
\`\`\`

Capture:
  - exitCode (from \`echo $?\` immediately after, or from "Bundle is in" / "ERROR" presence in tail)
  - bundlePath — grep for the line "Bundle is in /Users/.../filecap-audits/_web-rollup/<timestamp>" or the existence of "Open .../index.html to preview"
  - From the generated <bundlePath>/index.html:
    - fleetTotalFiles: \`grep -oE 'fleet-hero-context[^>]*>out of <strong>[0-9,]+</strong>' "<bundlePath>/index.html" | head -1 | grep -oE '[0-9,]+' | tr -d ','\`
    - fleetRemediable: \`grep -oE '<p class="fleet-hero-num">[0-9,]+</p>' "<bundlePath>/index.html" | head -1 | grep -oE '[0-9,]+' | tr -d ','\`
    - fleetRemediablePages: \`grep -oE 'class="fleet-hero-pages"[^>]+title="[^"]+"[^<]*<strong>[0-9,]+</strong>' "<bundlePath>/index.html" | head -1 | grep -oE '<strong>[0-9,]+</strong>' | grep -oE '[0-9,]+' | tr -d ','\`
    - fleetPdfPagesMeasured: from the tooltip text — \`grep -oE 'fleet-hero-pages" title="[^"]+"' "<bundlePath>/index.html" | head -1\` and pull out the "X measured PDF pages from pdfjs" integer.

If the \`fleet-hero-pages\` strong tag isn't found, that's a render bug — set exitCode to 99 and put a note in the tail. Do NOT proceed silently.

Return JSON.`,
  { phase: 'Web-rollup with new page-count UI', schema: ROLLUP_SCHEMA }
);

if (rollup.exitCode !== 0) {
  log(`Rollup failed (exit ${rollup.exitCode}). Stopping before deploy.`);
  return { aborted: true, stage: 'rollup', pre, rescan, verify, rollup };
}
log(`Rollup OK: ${rollup.bundlePath}`);
log(`  ${rollup.fleetTotalFiles.toLocaleString()} files · ${rollup.fleetRemediable.toLocaleString()} remediable · ≈${rollup.fleetRemediablePages.toLocaleString()} pages`);

// ─────────────────────────────────────────────────────────────────────────────

phase('Deploy to Netlify');
const deploy = await agent(
  `Deploy the bundle at ${rollup.bundlePath} to Netlify.

CRITICAL — Netlify CLI cwd lesson from v1.19.x: the CLI looks for netlify.toml and edge-functions RELATIVE TO THE CLI's working directory, NOT relative to --dir. So you MUST cd into the bundle dir before running deploy. Use \`--dir .\` from inside the bundle dir, not \`--dir <path>\` from elsewhere.

Site is gated by Netlify visitor access (server-side, dashboard-set). Do NOT add a client-side password gate — that was deliberately removed (memory: feedback_netlify_password).

INVOCATION:
\`\`\`
DEPLOY_SITE=$(jq -r '.webRollup.deploySite // empty' ~/.filecap/config.json)
test -n "$DEPLOY_SITE" || { echo "ERROR: no deploySite in ~/.filecap/config.json"; exit 2; }
cd "${rollup.bundlePath}"
netlify deploy --prod --dir . --site "$DEPLOY_SITE" 2>&1 | tee /tmp/fleet-rescan/deploy.log
\`\`\`

Capture:
  - exitCode (Netlify CLI exit)
  - deployedUrl from the line "Website URL: ..." or "Website draft URL: ..." (prefer "Website URL" for prod)
  - deployId from "Deploy ID: ..." line
  - error: a one-line summary if exitCode != 0

If Netlify reports unauthenticated, set exitCode=3 and error="netlify CLI not logged in — run \`netlify login\` and retry the Deploy phase". Do NOT attempt to auth.

Return JSON.`,
  { phase: 'Deploy to Netlify', schema: DEPLOY_SCHEMA }
);

if (deploy.exitCode !== 0) {
  log(`Deploy failed (exit ${deploy.exitCode}): ${deploy.error || ''}`);
  return { aborted: true, stage: 'deploy', pre, rescan, verify, rollup, deploy };
}
log(`Deployed: ${deploy.deployedUrl}`);

// ─────────────────────────────────────────────────────────────────────────────

phase('Purge old runs');
const purge = await agent(
  `Purge old per-site audit runs and old web-rollup bundles. CRITICAL RULES (memory: feedback_purge_old_audits):

KEEP:
  - The NEWEST run dir per site (~/filecap-audits/<site>/runs/<newest-timestamp>/)
  - The NEWEST bundle (~/filecap-audits/_web-rollup/<newest-timestamp>/)
  - EVERY \`latest/\` symlink or directory (do NOT delete, do NOT follow)
  - EVERY \`mirror/\` directory (those are rsync caches, not audit runs)

DELETE:
  - All older run dirs per site
  - All older _web-rollup bundles

PROCEDURE:
\`\`\`
# Pre-size for the report
PRE_SIZE=$(du -sh ~/filecap-audits 2>/dev/null | awk '{print $1}')

# Per-site runs: keep newest only
PER_SITE_REMOVED=0
KEPT_PATHS=""
for site_dir in ~/filecap-audits/*/runs; do
  test -d "$site_dir" || continue
  # List only timestamped subdirs (skip latest/, mirror/, etc.)
  newest=$(ls -1d "$site_dir"/*Z 2>/dev/null | sort | tail -1)
  test -n "$newest" || continue
  KEPT_PATHS="$KEPT_PATHS|$newest"
  for d in "$site_dir"/*Z; do
    test "$d" = "$newest" && continue
    rm -rf "$d" && PER_SITE_REMOVED=$((PER_SITE_REMOVED + 1))
  done
done

# Rollups: keep newest only
ROLLUPS_REMOVED=0
ROLLUP_DIR=~/filecap-audits/_web-rollup
if [ -d "$ROLLUP_DIR" ]; then
  newest_rollup=$(ls -1d "$ROLLUP_DIR"/*Z 2>/dev/null | sort | tail -1)
  KEPT_PATHS="$KEPT_PATHS|$newest_rollup"
  for d in "$ROLLUP_DIR"/*Z; do
    test "$d" = "$newest_rollup" && continue
    rm -rf "$d" && ROLLUPS_REMOVED=$((ROLLUPS_REMOVED + 1))
  done
fi

POST_SIZE=$(du -sh ~/filecap-audits 2>/dev/null | awk '{print $1}')
echo "PRE=$PRE_SIZE POST=$POST_SIZE PER_SITE_REMOVED=$PER_SITE_REMOVED ROLLUPS_REMOVED=$ROLLUPS_REMOVED"
echo "KEPT: $KEPT_PATHS"
\`\`\`

freedHuman should be a string like "12.4G freed (pre: 56G, post: 43.6G)" — compute as the literal pre/post strings; don't try to math them.

Return JSON. kept[] should be the newest path per site + the newest rollup path.`,
  { phase: 'Purge old runs', schema: PURGE_SCHEMA }
);
log(`Purge OK: ${purge.perSiteRemoved} per-site + ${purge.rollupsRemoved} rollups removed · ${purge.freedHuman}`);

// ─────────────────────────────────────────────────────────────────────────────

return {
  status: 'complete',
  deployedUrl: deploy.deployedUrl,
  fleetRemediablePages: rollup.fleetRemediablePages,
  fleetRemediable: rollup.fleetRemediable,
  fleetTotalFiles: rollup.fleetTotalFiles,
  totalPdfPagesMeasured: verify.totalPdfPages,
  runtimeMinutes: Math.round((rescan.runtimeSeconds || 0) / 60),
  anomalies: verify.anomalies,
  pre, rescan, verify, rollup, deploy, purge,
};
