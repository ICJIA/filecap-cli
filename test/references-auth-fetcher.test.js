import { describe, it, expect, vi } from "vitest";
import { createAuthFetcher } from "../src/references/auth-fetcher.js";

// 1.8.0-beta.6: the auth fetcher wraps the references command's underlying
// HTTP layer with Bearer-token injection and optional auto-refresh via a
// Strapi /auth/local-style login endpoint. Behavior matrix:
//   - With token, no error → token sent as Authorization header
//   - With token, 401 + bearerLogin configured → auto-refresh, persist
//   - With token, 401 + bearerLogin + still 401 after refresh → throw
//   - With token, 401 + no bearerLogin + TTY prompt → prompt, persist
//   - With token, 401 + no bearerLogin + no TTY → throw
//   - 403 → not retried (auth refusal, refresh won't help)
//   - Login request itself bypasses Bearer injection (skipAuth)

describe("createAuthFetcher", () => {
  it("injects Authorization: Bearer <token> on the underlying fetcher call", async () => {
    const calls = [];
    const base = async (url, init) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return { ok: 1 };
    };
    const fetcher = createAuthFetcher({
      initialToken: "JWT-A",
      baseFetcher: base,
      persistToken: async () => {},
    });
    await fetcher("https://intranet.example/test", { method: "GET" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer JWT-A");
  });

  it("on 401 with bearerLogin, posts identifier+password to login URL and retries with refreshed JWT", async () => {
    const calls = [];
    let persisted = null;
    const base = async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ?? null });
      if (url === "https://intranet.example/auth/local") {
        return { jwt: "JWT-B-fresh", user: { id: 1 } };
      }
      if (init?.headers?.Authorization === "Bearer JWT-A-expired") {
        throw new Error("HTTP 401 Unauthorized for " + url);
      }
      return { ok: 1 };
    };
    const fetcher = createAuthFetcher({
      initialToken: "JWT-A-expired",
      login: {
        url: "https://intranet.example/auth/local",
        identifier: "user@example.com",
        password: "pw",
      },
      baseFetcher: base,
      persistToken: async (tok) => { persisted = tok; },
    });
    const result = await fetcher("https://intranet.example/posts", { method: "GET" });
    expect(result).toEqual({ ok: 1 });
    // 3 calls: failed initial, login, successful retry
    expect(calls).toHaveLength(3);
    expect(calls[1].url).toBe("https://intranet.example/auth/local");
    expect(calls[1].method).toBe("POST");
    expect(JSON.parse(calls[1].body)).toEqual({
      identifier: "user@example.com",
      password: "pw",
    });
    expect(persisted).toBe("JWT-B-fresh");
  });

  it("does NOT attach Authorization header to the login request itself", async () => {
    const calls = [];
    const base = async (url, init) => {
      calls.push({ url, headers: init?.headers ?? {} });
      if (url.includes("/auth/local")) return { jwt: "JWT-NEW" };
      if (init?.headers?.Authorization === "Bearer expired") {
        throw new Error("HTTP 401 for " + url);
      }
      return {};
    };
    const fetcher = createAuthFetcher({
      initialToken: "expired",
      login: {
        url: "https://intranet.example/auth/local",
        identifier: "u",
        password: "p",
      },
      baseFetcher: base,
      persistToken: async () => {},
    });
    await fetcher("https://intranet.example/needs-auth");
    const loginCall = calls.find((c) => c.url.includes("/auth/local"));
    expect(loginCall).toBeDefined();
    expect(loginCall.headers.Authorization).toBeUndefined();
  });

  it("on 403 (permissions, not expiry), throws without attempting refresh", async () => {
    const calls = [];
    const base = async (url) => {
      calls.push(url);
      throw new Error("HTTP 403 Forbidden for " + url);
    };
    const fetcher = createAuthFetcher({
      initialToken: "JWT",
      login: { url: "https://x/auth/local", identifier: "u", password: "p" },
      baseFetcher: base,
      persistToken: async () => {},
    });
    await expect(fetcher("https://x/posts")).rejects.toThrow(/HTTP 403/);
    expect(calls).toHaveLength(1);
  });

  it("no bearerLogin + TTY prompt produces a fresh token, persists, retries", async () => {
    let promptedTimes = 0;
    const base = async (url, init) => {
      if (init?.headers?.Authorization === "Bearer expired") {
        throw new Error("HTTP 401 for " + url);
      }
      return { ok: 1 };
    };
    let persisted = null;
    const fetcher = createAuthFetcher({
      initialToken: "expired",
      // no login configured
      baseFetcher: base,
      persistToken: async (tok) => { persisted = tok; },
      promptForToken: async () => {
        promptedTimes++;
        return "JWT-FROM-PROMPT";
      },
    });
    const result = await fetcher("https://x/posts");
    expect(result).toEqual({ ok: 1 });
    expect(promptedTimes).toBe(1);
    expect(persisted).toBe("JWT-FROM-PROMPT");
  });

  it("no bearerLogin + no TTY prompt + 401 → throws (non-interactive)", async () => {
    const base = async (url, init) => {
      if (init?.headers?.Authorization === "Bearer expired") {
        throw new Error("HTTP 401 for " + url);
      }
      return { ok: 1 };
    };
    const fetcher = createAuthFetcher({
      initialToken: "expired",
      baseFetcher: base,
      persistToken: async () => {},
      // no promptForToken — non-interactive run
    });
    await expect(fetcher("https://x/posts")).rejects.toThrow(/HTTP 401/);
  });

  it("login response without a jwt field throws so the operator notices", async () => {
    const base = async (url, init) => {
      if (url.includes("/auth/local")) return { error: "Invalid credentials" };
      if (init?.headers?.Authorization === "Bearer expired") {
        throw new Error("HTTP 401 for " + url);
      }
      return { ok: 1 };
    };
    const fetcher = createAuthFetcher({
      initialToken: "expired",
      login: { url: "https://x/auth/local", identifier: "u", password: "wrong" },
      baseFetcher: base,
      persistToken: async () => {},
    });
    await expect(fetcher("https://x/posts")).rejects.toThrow(/HTTP 401/);
  });

  it("starts with no initial token + has bearerLogin → logs in on first call", async () => {
    const calls = [];
    let persisted = null;
    const base = async (url, init) => {
      calls.push({ url, method: init?.method });
      if (url.includes("/auth/local")) return { jwt: "JWT-INITIAL" };
      return { ok: 1 };
    };
    const fetcher = createAuthFetcher({
      // no initialToken
      login: { url: "https://x/auth/local", identifier: "u", password: "p" },
      baseFetcher: base,
      persistToken: async (tok) => { persisted = tok; },
    });
    const result = await fetcher("https://x/posts");
    expect(result).toEqual({ ok: 1 });
    // 2 calls: login + the actual request
    expect(calls.map((c) => c.url)).toEqual([
      "https://x/auth/local",
      "https://x/posts",
    ]);
    expect(persisted).toBe("JWT-INITIAL");
  });
});
