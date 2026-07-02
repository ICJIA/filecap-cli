import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// 1.8.0-beta.6: per-site credentials with optional auto-refresh login.
// `bearerLogin` lets the references command auto-renew an expired JWT by
// POSTing identifier+password to the Strapi `/auth/local` endpoint. Mode
// 0600 + same-UID trust model already governs this file; adding the
// password here trades JWT rotation for operational convenience.
const bearerLoginSchema = z
  .object({
    url: z.string().refine(
      (s) => {
        try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
        catch { return false; }
      },
      { message: "bearerLogin.url must be an http(s) URL" },
    ),
    identifier: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

const credentialSchema = z
  .object({
    bearerToken: z.string().optional(),
    bearerLogin: bearerLoginSchema.optional(),
  })
  .strict();

const secretsSchema = z
  .object({
    version: z.number().optional(),
    tokens: z.record(z.string(), z.string()).default({}),
    credentials: z.record(z.string(), credentialSchema).default({}),
  })
  .strict();

const DEFAULT_SECRETS_PATH = path.join(
  os.homedir(),
  ".filecap",
  "secrets.json",
);

export function loadSecrets({
  secretsPath = DEFAULT_SECRETS_PATH,
  warn = (msg) => process.stderr.write(msg),
} = {}) {
  if (!fs.existsSync(secretsPath)) {
    return { tokens: {}, credentials: {} };
  }

  // 1.7.36 — Warn if the file is group- or world-readable. The bearer
  // tokens this file carries should sit at mode 0600 (owner-only);
  // anything else means other users on the same workstation could
  // siphon the credentials. Don't refuse to load — single-user
  // workstations are the common case and a warning is enough.
  // Fixes 2026-05-13 audit finding #4.
  try {
    const stat = fs.statSync(secretsPath);
    if ((stat.mode & 0o077) !== 0) {
      const modeStr = (stat.mode & 0o777).toString(8).padStart(3, "0");
      warn(
        `WARN: filecap secrets file at ${secretsPath} is group- or world-readable (mode 0${modeStr}); ` +
          `recommended mode is 0600. Fix with: chmod 600 ${secretsPath}\n`,
      );
    }
  } catch {
    // Stat failure is non-fatal — the readFileSync below will surface
    // any real I/O issue with a more specific error.
  }

  let raw;
  try {
    raw = fs.readFileSync(secretsPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read filecap secrets at ${secretsPath} (${err.code ?? "io error"})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in filecap secrets at ${secretsPath}`);
  }

  const result = secretsSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const fieldPath = issue.path.length ? issue.path.join(".") : "(root)";
    throw new Error(
      `Invalid filecap secrets at ${secretsPath}: ${fieldPath}: ${issue.message}`,
    );
  }
  return result.data;
}

/**
 * Convert a server-name (e.g. "infonet-strapi-prod") into the env-var name
 * that takes precedence over secrets.json (e.g. "FILECAP_BEARER_TOKEN_INFONET_STRAPI_PROD").
 */
export function tokenEnvVarName(serverName) {
  return `FILECAP_BEARER_TOKEN_${serverName.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Resolve the bearer token for a server. Env var wins; then
 * credentials.<serverName>.bearerToken; then legacy tokens.<serverName>.
 * Returns null when no token is set.
 */
export function getSiteToken(secrets, serverName, env = process.env) {
  const envName = tokenEnvVarName(serverName);
  const fromEnv = env[envName];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  const fromCredentials = secrets?.credentials?.[serverName]?.bearerToken;
  if (typeof fromCredentials === "string" && fromCredentials.length > 0) {
    return fromCredentials;
  }
  const fromFile = secrets?.tokens?.[serverName];
  if (typeof fromFile === "string" && fromFile.length > 0) {
    return fromFile;
  }
  return null;
}

/**
 * Return the bearerLogin (auto-refresh credentials) for a server, or null
 * if none configured. Env-var override path isn't supported for login —
 * passwords belong in a mode-0600 file or not at all.
 */
export function getSiteLogin(secrets, serverName) {
  const login = secrets?.credentials?.[serverName]?.bearerLogin;
  if (!login) return null;
  return login;
}

/**
 * 1.8.0-beta.6: persist a refreshed bearer token to secrets.json. Reads
 * the current file, splices in the new token under
 * credentials.<serverName>.bearerToken, writes back atomically. Preserves
 * unrelated entries (other sites' creds + legacy tokens map).
 *
 * Mode 0600 is enforced on write — the file may have been created by the
 * user with a wider mode; we tighten it on every write.
 */
export function persistSiteToken({
  secretsPath = DEFAULT_SECRETS_PATH,
  serverName,
  newToken,
}) {
  if (typeof serverName !== "string" || serverName.length === 0) {
    throw new Error("persistSiteToken: serverName required");
  }
  if (typeof newToken !== "string" || newToken.length === 0) {
    throw new Error("persistSiteToken: newToken required");
  }
  let current = { version: 1, tokens: {}, credentials: {} };
  if (fs.existsSync(secretsPath)) {
    const raw = fs.readFileSync(secretsPath, "utf-8");
    try {
      current = JSON.parse(raw);
    } catch {
      // v1.39.0: refuse to clobber. "Starting fresh" here would silently
      // drop every other site's tokens on the atomic rewrite below. The
      // caller typically ran loadSecrets first (which throws on bad JSON),
      // so this only fires when the file was corrupted mid-run.
      throw new Error(
        `Cannot parse ${secretsPath} — fix or remove it before saving new tokens`,
      );
    }
  }
  current.tokens = current.tokens ?? {};
  current.credentials = current.credentials ?? {};
  current.credentials[serverName] = {
    ...(current.credentials[serverName] ?? {}),
    bearerToken: newToken,
  };
  // Atomic write: tmp file + rename
  const dir = path.dirname(secretsPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${secretsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, secretsPath);
  try { fs.chmodSync(secretsPath, 0o600); } catch { /* best effort */ }
}
