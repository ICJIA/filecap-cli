import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { persistSiteToken } from "../src/config/secrets.js";

// v1.39.0 (F3): persistSiteToken on an unparseable secrets.json used to
// "start fresh" — silently clobbering every other site's tokens on the next
// write. It must throw instead and leave the file untouched.

describe("persistSiteToken", () => {
  let tmpDir;
  let secretsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-secrets-persist-"));
    secretsPath = path.join(tmpDir, "secrets.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws on an unparseable secrets.json and leaves the file untouched", () => {
    const garbage = "{ not-json";
    fs.writeFileSync(secretsPath, garbage);
    expect(() =>
      persistSiteToken({ secretsPath, serverName: "site-a", newToken: "tok-1" }),
    ).toThrow(/Cannot parse .*secrets\.json.*fix or remove/);
    expect(fs.readFileSync(secretsPath, "utf-8")).toBe(garbage);
  });

  it("merges a new token into a valid file, preserving unrelated entries", () => {
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({
        version: 1,
        tokens: { "legacy-site": "legacy-token" },
        credentials: { "other-site": { bearerToken: "other-token" } },
      }),
    );
    persistSiteToken({ secretsPath, serverName: "site-a", newToken: "tok-1" });
    const after = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
    expect(after.credentials["site-a"].bearerToken).toBe("tok-1");
    expect(after.credentials["other-site"].bearerToken).toBe("other-token");
    expect(after.tokens["legacy-site"]).toBe("legacy-token");
  });

  it("creates a fresh mode-0600 file when none exists", () => {
    persistSiteToken({ secretsPath, serverName: "site-a", newToken: "tok-1" });
    const after = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
    expect(after.credentials["site-a"].bearerToken).toBe("tok-1");
    if (process.platform !== "win32") {
      const mode = fs.statSync(secretsPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("preserves an existing bearerLogin when refreshing the same site's token", () => {
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({
        credentials: {
          "site-a": {
            bearerToken: "stale",
            bearerLogin: {
              url: "https://api.example.com/auth/local",
              identifier: "svc",
              password: "pw",
            },
          },
        },
      }),
    );
    persistSiteToken({ secretsPath, serverName: "site-a", newToken: "fresh" });
    const after = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
    expect(after.credentials["site-a"].bearerToken).toBe("fresh");
    expect(after.credentials["site-a"].bearerLogin.identifier).toBe("svc");
  });
});
