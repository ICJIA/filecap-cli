// Resolves the privileged-tier credential for audit.icjia.app.
//
// Why this matters: audit.icjia.app runs two rate-limit tiers. Without a token
// a caller is anonymous — 500 requests/hour and 100/minute per IP. A fleet-sized
// pass (~5,000 PDFs plus the referenced pages) blows through that in minutes and
// then spends the rest of the run honoring Retry-After. From the outside that is
// indistinguishable from the audit server being down, which is precisely how the
// 2026-08-12 "the audit server is offline" report started: the server was
// healthy the whole time and the run was simply throttled.
//
// Two sources, env first so a cron/CI run can supply the token without touching
// the home directory:
//
//   1. AUDIT_ICJIA_TOKEN environment variable
//   2. ~/.filecap/secrets.json → credentials["audit-icjia-app"].bearerToken
//
// The token is a SERVICE credential. It buys higher rate limits and the
// non-ICJIA URL allowlist bypass — nothing else. It never bypasses the
// SSRF/private-IP block, the upload size caps, or the server's 2-at-a-time
// concurrency semaphores.
//
// Returns undefined when neither source has one, which keeps the caller in the
// anonymous tier rather than failing the run.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const AUDIT_TOKEN_ENV_VAR = "AUDIT_ICJIA_TOKEN";
export const AUDIT_TOKEN_SECRETS_KEY = "audit-icjia-app";

/**
 * @param {object} [deps] test seams
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {string} [deps.secretsPath]
 * @returns {string|undefined}
 */
export function resolveAuditToken({ env = process.env, secretsPath } = {}) {
  const fromEnv = env[AUDIT_TOKEN_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const file = secretsPath ?? path.join(os.homedir(), ".filecap", "secrets.json");
  try {
    const secrets = JSON.parse(fs.readFileSync(file, "utf8"));
    const fromFile = secrets?.credentials?.[AUDIT_TOKEN_SECRETS_KEY]?.bearerToken;
    if (typeof fromFile === "string" && fromFile.trim().length > 0) {
      return fromFile.trim();
    }
  } catch {
    // Missing or malformed secrets file — anonymous mode is a valid state.
  }
  return undefined;
}

/**
 * One line at run start naming the tier, so a run that silently fell back to
 * anonymous is visible immediately instead of being inferred from throttling
 * an hour later.
 * @param {string|undefined} token
 */
export function describeAuditTier(token) {
  return token
    ? "[audits] audit.icjia.app: PRIVILEGED tier (token found — 5000/hour, 1000/min)"
    : `[audits] audit.icjia.app: ANONYMOUS tier (no token — 500/hour, 100/min). ` +
        `Set ${AUDIT_TOKEN_ENV_VAR} to raise the ceiling 10x.`;
}
