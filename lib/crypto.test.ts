import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  signPayload,
  verifySignature,
} from "./crypto";

describe("token encryption", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a token", () => {
    const token = "AQABAAAAA_yahoo_refresh_token_value";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("produces different ciphertext each time", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("stores nothing in the clear", () => {
    expect(encryptSecret("supersecret")).not.toContain("supersecret");
  });

  it("rejects tampered ciphertext", () => {
    const payload = encryptSecret("token");
    const [version, iv, tag, ciphertext] = payload.split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 0xff;

    expect(() =>
      decryptSecret([version, iv, tag, flipped.toString("base64url")].join(".")),
    ).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-payload")).toThrow(/Malformed/);
  });

  it("refuses a key that is not 32 bytes", () => {
    const original = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(() => encryptSecret("token")).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = original;
  });
});

describe("run-token signatures", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("verifies a signature it produced", () => {
    const payload = "sync:8f1d0d4e-0000-4000-8000-000000000000";
    expect(verifySignature(payload, signPayload(payload))).toBe(true);
  });

  it("is deterministic, so any stage of a run can re-derive it", () => {
    expect(signPayload("sync:a")).toBe(signPayload("sync:a"));
  });

  it("rejects a signature made for a different run", () => {
    expect(verifySignature("sync:a", signPayload("sync:b"))).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(verifySignature("sync:a", "short")).toBe(false);
    expect(verifySignature("sync:a", "")).toBe(false);
  });
});
