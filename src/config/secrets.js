import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const secretsSchema = z
  .object({
    version: z.number().optional(),
    tokens: z.record(z.string(), z.string()).default({}),
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
    return { tokens: {} };
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
 * Resolve the bearer token for a server. Env var wins over secrets.json.
 * Returns null when no token is set.
 *
 * @param {object} secrets       loaded secrets object
 * @param {string} serverName    e.g. "infonet-strapi-prod"
 * @param {object} [env]         process.env stand-in for tests
 * @returns {string|null}
 */
export function getSiteToken(secrets, serverName, env = process.env) {
  const envName = tokenEnvVarName(serverName);
  const fromEnv = env[envName];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  const fromFile = secrets?.tokens?.[serverName];
  if (typeof fromFile === "string" && fromFile.length > 0) {
    return fromFile;
  }
  return null;
}
