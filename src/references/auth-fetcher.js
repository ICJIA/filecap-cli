// Authenticated-fetcher wrapper for the references step.
//
// Strapi v3 sites that gate content behind authentication (the ICJIA
// intranet) issue JWTs via POST /auth/local with { identifier, password }
// that expire on a rolling 30-day cycle. This module wraps the underlying
// fetcher so the references command can:
//   1. Inject `Authorization: Bearer <token>` on every request
//   2. Detect 401 (expired/invalid token) and auto-refresh by POSTing to
//      the configured /auth/local endpoint, capturing the fresh JWT,
//      persisting it back to ~/.filecap/secrets.json, and retrying once
//   3. Fall back to a TTY prompt when no `bearerLogin` is configured but
//      the user is running interactively (paste-a-fresh-token UX)
//   4. Bail loudly on non-interactive runs (CI, scripted) with a clear
//      "configure bearerLogin or re-run interactively" message
//
// 403 is NOT retried — it indicates the operator's account lacks
// permission to read the content type, not that the token is expired.
// Retrying with the same identity won't help.
//
// The login request itself bypasses the Bearer-injection path (a request
// that already needs a token can't fetch a new one).

export function createAuthFetcher({
  initialToken = null,
  login = null,
  baseFetcher,
  persistToken,
  promptForToken = null,
  log = () => {},
}) {
  if (typeof baseFetcher !== "function") {
    throw new Error("createAuthFetcher: baseFetcher is required");
  }
  if (typeof persistToken !== "function") {
    throw new Error("createAuthFetcher: persistToken is required");
  }

  let currentToken = initialToken;

  function callWithToken(url, init, token) {
    const headers = { ...(init?.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    // FC-2026-040: don't follow redirects on a credentialed request — a 3xx to
    // another origin must not carry the bearer token there (we don't rely on
    // undici's cross-origin header stripping). The Strapi API endpoints don't
    // redirect; a 3xx surfaces as a non-ok response the caller reports.
    return baseFetcher(url, { ...(init ?? {}), redirect: "manual", headers });
  }

  async function tryLoginRefresh() {
    if (!login) return null;
    log(
      `[references] bearer token expired/missing — attempting auto-refresh via ${login.url}`,
    );
    let response;
    try {
      response = await baseFetcher(login.url, {
        method: "POST",
        // FC-2026-041: never follow a redirect on the login POST — undici
        // strips headers on a cross-origin redirect but NOT the request body,
        // so a 307/308 could carry the cleartext identifier+password to an
        // attacker origin. Refuse the redirect instead.
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: login.identifier,
          password: login.password,
        }),
      });
    } catch (err) {
      log(`[references] auto-refresh request failed: ${err.message}`);
      return null;
    }
    const jwt =
      response?.jwt ??
      response?.data?.jwt ??
      response?.access_token ??
      null;
    if (typeof jwt !== "string" || jwt.length === 0) {
      log(
        `[references] auto-refresh response had no jwt field; ` +
          `check the bearerLogin.identifier/password in ~/.filecap/secrets.json`,
      );
      return null;
    }
    try {
      await persistToken(jwt);
      log(`[references] auto-refresh succeeded; new token persisted`);
    } catch (err) {
      log(
        `[references] auto-refresh succeeded but persisting the new token failed: ${err.message}. ` +
          `Token will be used for this run but you'll be prompted again next time.`,
      );
    }
    return jwt;
  }

  async function tryInteractivePrompt() {
    if (typeof promptForToken !== "function") return null;
    const fresh = await promptForToken();
    if (typeof fresh !== "string" || fresh.length === 0) return null;
    try {
      await persistToken(fresh);
    } catch (err) {
      log(
        `[references] persisting prompted token failed: ${err.message}. ` +
          `Token will be used for this run but won't survive.`,
      );
    }
    return fresh;
  }

  async function refreshToken() {
    let refreshed = await tryLoginRefresh();
    if (refreshed) {
      currentToken = refreshed;
      return refreshed;
    }
    refreshed = await tryInteractivePrompt();
    if (refreshed) {
      currentToken = refreshed;
      return refreshed;
    }
    return null;
  }

  return async function authFetcher(url, init = {}) {
    // If we have no token but we DO have a login, fetch one before the
    // first request so we don't waste a guaranteed-401 round-trip.
    if (!currentToken && login) {
      await refreshToken();
    }

    try {
      return await callWithToken(url, init, currentToken);
    } catch (err) {
      if (!/HTTP 401/.test(err.message)) throw err;
      const fresh = await refreshToken();
      if (!fresh) throw err;
      return callWithToken(url, init, fresh);
    }
  };
}
