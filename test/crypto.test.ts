import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  decryptText,
  encryptText,
  randomToken,
  signValue,
  verifySignedValue,
} from "../src/worker/lib/crypto";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("crypto", () => {
  it("randomToken は 128 ビットで 22 文字になり、毎回異なる", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toHaveLength(22);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });

  it("Base64URL の変換は元に戻せる", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it("署名した値は検証でき、改ざんすると null になる", async () => {
    const signed = await signValue("secret", "hello");
    expect(await verifySignedValue("secret", signed)).toBe("hello");
    expect(await verifySignedValue("other", signed)).toBeNull();
    expect(await verifySignedValue("secret", signed.replace("hello", "hellp"))).toBeNull();
    expect(await verifySignedValue("secret", "no-signature")).toBeNull();
  });

  it("AES-GCM で暗号化した値は復号でき、同じ平文でも毎回異なる暗号文になる", async () => {
    const a = await encryptText(KEY, "refresh-token-日本語");
    const b = await encryptText(KEY, "refresh-token-日本語");
    expect(a).not.toBe(b);
    expect(await decryptText(KEY, a)).toBe("refresh-token-日本語");
  });
});
