import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAuthorizeUrl, yahooRedirectUri } from "./yahoo-auth";

const ENV_KEYS = [
  "YAHOO_CLIENT_ID",
  "YAHOO_CLIENT_SECRET",
  "YAHOO_REDIRECT_URI",
  "NEXT_PUBLIC_SITE_URL",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.YAHOO_CLIENT_ID = "test-client-id";
  process.env.YAHOO_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_SITE_URL = "https://ffm.example.com";
  delete process.env.YAHOO_REDIRECT_URI;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("yahooRedirectUri", () => {
  it("derives from the site url", () => {
    expect(yahooRedirectUri()).toBe(
      "https://ffm.example.com/api/yahoo/callback",
    );
  });

  it("lets a tunnel override it, since Yahoo rejects http://localhost", () => {
    process.env.YAHOO_REDIRECT_URI = "https://tunnel.test/api/yahoo/callback";
    expect(yahooRedirectUri()).toBe("https://tunnel.test/api/yahoo/callback");
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds the Yahoo consent url with state", () => {
    const url = new URL(buildAuthorizeUrl("state-token"));

    expect(url.origin + url.pathname).toBe(
      "https://api.login.yahoo.com/oauth2/request_auth",
    );
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://ffm.example.com/api/yahoo/callback",
    );
  });

  it("never leaks the client secret into the url", () => {
    expect(buildAuthorizeUrl("s")).not.toContain("test-client-secret");
  });

  it("explains itself when the app is not registered", () => {
    delete process.env.YAHOO_CLIENT_ID;
    expect(() => buildAuthorizeUrl("s")).toThrow(/developer.yahoo.com/);
  });
});
