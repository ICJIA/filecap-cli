import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSecrets,
  tokenEnvVarName,
  getSiteToken,
} from "../src/config/secrets.js";

describe("loadSecrets", () => {
  let tmpDir;
  let secretsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-secrets-"));
    secretsPath = path.join(tmpDir, "secrets.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty tokens/credentials when file is absent", () => {
    // 1.8.0-beta.6 added the credentials map for auto-refresh logins.
    expect(loadSecrets({ secretsPath })).toEqual({ tokens: {}, credentials: {} });
  });

  it("reads a valid secrets file", () => {
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({
        version: 1,
        tokens: { "infonet-strapi-prod": "eyJhbGc.token.sig" },
      }),
    );
    const s = loadSecrets({ secretsPath });
    expect(s.tokens["infonet-strapi-prod"]).toBe("eyJhbGc.token.sig");
  });

  it("defaults tokens and credentials to empty objects when missing", () => {
    fs.writeFileSync(secretsPath, JSON.stringify({ version: 1 }));
    expect(loadSecrets({ secretsPath })).toEqual({
      version: 1,
      tokens: {},
      credentials: {},
    });
  });

  it("throws on invalid JSON", () => {
    fs.writeFileSync(secretsPath, "{ not-json");
    expect(() => loadSecrets({ secretsPath })).toThrow(/Invalid JSON/);
  });

  it("throws on unexpected top-level field (catches typos)", () => {
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({ tokens: {}, password: "x" }),
    );
    expect(() => loadSecrets({ secretsPath })).toThrow(/Invalid filecap secrets/);
  });

  it("throws on wrong type for token value (must be string)", () => {
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({ tokens: { "site-a": 123 } }),
    );
    expect(() => loadSecrets({ secretsPath })).toThrow(/Invalid filecap secrets/);
  });
});

describe("tokenEnvVarName", () => {
  it("converts server-name to upper-snake env var", () => {
    expect(tokenEnvVarName("infonet-strapi-prod")).toBe(
      "FILECAP_BEARER_TOKEN_INFONET_STRAPI_PROD",
    );
  });

  it("handles single-word server names", () => {
    expect(tokenEnvVarName("archive")).toBe("FILECAP_BEARER_TOKEN_ARCHIVE");
  });

  it("preserves digits in names", () => {
    expect(tokenEnvVarName("r3-strapi-prod")).toBe(
      "FILECAP_BEARER_TOKEN_R3_STRAPI_PROD",
    );
  });
});

describe("getSiteToken", () => {
  const secrets = {
    tokens: {
      "infonet-strapi-prod": "from-file",
      "archive-prod": "archive-from-file",
    },
  };

  it("returns env-var token when set, ignoring file", () => {
    const env = { FILECAP_BEARER_TOKEN_INFONET_STRAPI_PROD: "from-env" };
    expect(getSiteToken(secrets, "infonet-strapi-prod", env)).toBe("from-env");
  });

  it("falls back to file when env var is unset", () => {
    expect(getSiteToken(secrets, "infonet-strapi-prod", {})).toBe("from-file");
  });

  it("falls back to file when env var is empty string (not set in shell)", () => {
    const env = { FILECAP_BEARER_TOKEN_INFONET_STRAPI_PROD: "" };
    expect(getSiteToken(secrets, "infonet-strapi-prod", env)).toBe("from-file");
  });

  it("returns null when neither env nor file has a token", () => {
    expect(getSiteToken(secrets, "no-such-site", {})).toBeNull();
  });

  it("tolerates secrets={} (no tokens key)", () => {
    expect(getSiteToken({}, "infonet-strapi-prod", {})).toBeNull();
  });

  it("tolerates secrets=null/undefined", () => {
    expect(getSiteToken(null, "infonet-strapi-prod", {})).toBeNull();
    expect(getSiteToken(undefined, "infonet-strapi-prod", {})).toBeNull();
  });
});
