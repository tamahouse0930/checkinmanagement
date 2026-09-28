import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/worker/lib/time";
import { decodeSession, encodeSession, needsRenewal, newSessionPayload } from "../src/worker/lib/session";
import { verifyIdTokenClaims } from "../src/worker/services/google/oauth";
import { base64UrlEncode, utf8Encode } from "../src/worker/lib/crypto";

const SECRET = "test-secret-test-secret-test-secret";

describe("管理画面のセッション", () => {
  it("発行した Cookie を検証できる", async () => {
    const payload = newSessionPayload("sid1", "a@example.com");
    const cookie = await encodeSession(SECRET, payload);
    expect(await decodeSession(SECRET, cookie)).toEqual(payload);
  });

  it("有効期限を過ぎた Cookie は無効", async () => {
    const payload = newSessionPayload("sid1", "a@example.com", Date.now() - 31 * DAY_MS);
    expect(await decodeSession(SECRET, await encodeSession(SECRET, payload))).toBeNull();
  });

  it("別の鍵で署名された Cookie・空の Cookie は無効", async () => {
    const cookie = await encodeSession("another-secret", newSessionPayload("sid1", "a@example.com"));
    expect(await decodeSession(SECRET, cookie)).toBeNull();
    expect(await decodeSession(SECRET, undefined)).toBeNull();
  });

  it("発行から 1 日以上たったら有効期限を延ばす", () => {
    const now = Date.now();
    expect(needsRenewal(newSessionPayload("s", "a@example.com", now - DAY_MS + 1000), now)).toBe(false);
    expect(needsRenewal(newSessionPayload("s", "a@example.com", now - DAY_MS), now)).toBe(true);
  });
});

describe("Google の ID トークンの確認", () => {
  const clientId = "client-id";
  const makeToken = (claims: object) =>
    `header.${base64UrlEncode(utf8Encode(JSON.stringify(claims)))}.signature`;
  const valid = {
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "Someone@Gmail.com",
    email_verified: true,
    nonce: "n1",
  };

  it("正しいトークンからメールアドレスを小文字で取り出す", () => {
    expect(verifyIdTokenClaims(makeToken(valid), clientId, "n1").email).toBe("someone@gmail.com");
  });

  it("宛先・nonce・有効期限・メールの確認が不正なら拒否する", () => {
    expect(() => verifyIdTokenClaims(makeToken({ ...valid, aud: "x" }), clientId, "n1")).toThrow();
    expect(() => verifyIdTokenClaims(makeToken(valid), clientId, "n2")).toThrow();
    expect(() => verifyIdTokenClaims(makeToken({ ...valid, exp: 1 }), clientId, "n1")).toThrow();
    expect(() => verifyIdTokenClaims(makeToken({ ...valid, email_verified: false }), clientId, "n1")).toThrow();
  });
});
