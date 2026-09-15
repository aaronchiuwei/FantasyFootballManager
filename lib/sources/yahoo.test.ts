import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YahooReauthRequired } from "./yahoo-auth";

const getAccessToken = vi.hoisted(() => vi.fn());

vi.mock("./yahoo-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./yahoo-auth")>()),
  getAccessToken,
}));

const { YahooAccessDenied, YahooAppNotApproved, yahooGet } = await import(
  "./yahoo",
);

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

  // Yahoo answers 403 for a public resource and a private one alike, which is
  // what marks it out as the app being turned away rather than the grant.
  it("names the approval program when Yahoo refuses the app itself", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("This application is not authorized to perform this action.", {
          status: 403,
        }),
      ),
    );

    const failure = await yahooGet("user", "game/nfl").catch((cause) => cause);

    expect(failure).toBeInstanceOf(YahooAppNotApproved);
    expect(failure.status).toBe(403);
    expect(failure.message).toMatch(/sports\.yahoo\.com\/developer\/access/);
    expect(failure.message).toMatch(/not authorized to perform this action/);
  });

  // Reconnecting is the one thing that cannot help, so the copy must not send
  // the user back round the consent screen.
  it("does not tell the user to reconnect over a 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));

    const failure = await yahooGet("user", "game/nfl").catch((cause) => cause);

    // Not "never mentions reconnecting" — it must mention it, to rule it out.
    expect(failure.message).not.toMatch(/connect again/i);
    expect(failure.message).toMatch(/reconnecting will not shift it/i);
    // A refused app is not a stale token: nothing here should burn a refresh.
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalledWith("user", {
      forceRefresh: true,
    });
  });
});
