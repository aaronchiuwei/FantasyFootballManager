import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YahooReauthRequired } from "./yahoo-auth";

const getAccessToken = vi.hoisted(() => vi.fn());

vi.mock("./yahoo-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./yahoo-auth")>()),
  getAccessToken,
}));

const { YahooAccessDenied, yahooGet } = await import("./yahoo");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// `normalize` turns Yahoo's array-shaped payloads into plain objects.
const OK = json({ fantasy_content: { users: [] } });

beforeEach(() => {
  getAccessToken.mockReset();
  getAccessToken.mockResolvedValue("token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("yahooGet", () => {
  it("refreshes once and retries when the access token died early", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(OK);
    vi.stubGlobal("fetch", fetchMock);

    await expect(yahooGet("user", "users")).resolves.toEqual({ users: {} });
    expect(getAccessToken).toHaveBeenLastCalledWith("user", {
      forceRefresh: true,
    });
  });

  it("asks for a re-link when Yahoo will not renew the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    getAccessToken.mockResolvedValueOnce("token");
    getAccessToken.mockRejectedValueOnce(new YahooReauthRequired());

    await expect(yahooGet("user", "users")).rejects.toBeInstanceOf(
      YahooReauthRequired,
    );
  });

  // The loop this guards: reconnecting mints a working token, so a 401 behind
  // one is a permission the consent screen cannot grant again.
  it("does not call the link expired when a freshly minted token is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Please provide valid credentials", { status: 401 })),
    );

    const failure = await yahooGet("user", "users").catch((cause) => cause);

    expect(failure).toBeInstanceOf(YahooAccessDenied);
    expect(failure).not.toBeInstanceOf(YahooReauthRequired);
    expect(failure.message).toMatch(/Fantasy Sports read/);
    expect(failure.message).toMatch(/Please provide valid credentials/);
  });
});
