import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveAuditToken,
  describeAuditTier,
  AUDIT_TOKEN_ENV_VAR,
} from "../src/config/audit-token.js";

// ---------------------------------------------------------------------------
// Privileged-tier credential resolution for audit.icjia.app.
//
// Added after 2026-08-12, when a fleet run appeared to take audit.icjia.app
// offline. It had not: the run carried no token, sat in the anonymous tier
// (500/hour), and was throttled. Nothing in the output said so.
// ---------------------------------------------------------------------------

function writeSecrets(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-secrets-"));
  const file = path.join(dir, "secrets.json");
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

describe("resolveAuditToken", () => {
  it("prefers the environment variable so cron/CI needs no home directory", () => {
    const secretsPath = writeSecrets({
      credentials: { "audit-icjia-app": { bearerToken: "from-file" } },
    });
    const token = resolveAuditToken({
      env: { [AUDIT_TOKEN_ENV_VAR]: "from-env" },
      secretsPath,
    });
    expect(token).toBe("from-env");
  });

  it("falls back to secrets.json when the env var is absent", () => {
    const secretsPath = writeSecrets({
      credentials: { "audit-icjia-app": { bearerToken: "from-file" } },
    });
    expect(resolveAuditToken({ env: {}, secretsPath })).toBe("from-file");
  });

  it("trims surrounding whitespace (a trailing newline is the classic paste bug)", () => {
    expect(
      resolveAuditToken({ env: { [AUDIT_TOKEN_ENV_VAR]: "  padded-token\n" }, secretsPath: "/nope" }),
    ).toBe("padded-token");
  });

  it("treats an empty or whitespace-only env var as absent", () => {
    const secretsPath = writeSecrets({
      credentials: { "audit-icjia-app": { bearerToken: "from-file" } },
    });
    expect(resolveAuditToken({ env: { [AUDIT_TOKEN_ENV_VAR]: "   " }, secretsPath })).toBe(
      "from-file",
    );
  });

  it("returns undefined — not a throw — when nothing supplies a token", () => {
    expect(resolveAuditToken({ env: {}, secretsPath: "/does/not/exist.json" })).toBeUndefined();
  });

  it("survives a malformed secrets file rather than failing the run", () => {
    const secretsPath = writeSecrets("{ not valid json");
    expect(resolveAuditToken({ env: {}, secretsPath })).toBeUndefined();
  });

  it("ignores an unrelated credential key (the intranet JWT is not the audit token)", () => {
    const secretsPath = writeSecrets({
      credentials: { "intranet-api-prod": { bearerToken: "jwt-for-a-different-service" } },
    });
    expect(resolveAuditToken({ env: {}, secretsPath })).toBeUndefined();
  });
});

describe("describeAuditTier", () => {
  it("names the anonymous tier and how to fix it when no token is present", () => {
    const line = describeAuditTier(undefined);
    expect(line).toContain("ANONYMOUS");
    expect(line).toContain("500/hour");
    expect(line).toContain(AUDIT_TOKEN_ENV_VAR);
  });

  it("names the privileged tier when a token is present, and never prints it", () => {
    const line = describeAuditTier("super-secret-value");
    expect(line).toContain("PRIVILEGED");
    expect(line).toContain("5000/hour");
    expect(line).not.toContain("super-secret-value");
  });
});
