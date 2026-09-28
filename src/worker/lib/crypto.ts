const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64Decode(text: string): Uint8Array {
  return base64UrlDecode(text.replace(/\+/g, "-").replace(/\//g, "_"));
}

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** 推測できないランダムな文字列（既定は 16 バイト = 128 ビット、Base64URL で 22 文字） */
export function randomToken(bytes = 16): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(text)));
}

export async function sha256Base64Url(text: string): Promise<string> {
  return base64UrlEncode(await sha256(text));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8Encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** `data.署名` の形式で署名する */
export async function signValue(secret: string, data: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8Encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** signValue で署名した値を検証し、元の data を返す。改ざんされていれば null */
export async function verifySignedValue(secret: string, signed: string): Promise<string | null> {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = signed.slice(0, dot);
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(signed.slice(dot + 1));
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, utf8Encode(data));
  return ok ? data : null;
}

async function aesKey(keyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64Decode(keyBase64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM で暗号化し、`IV + 暗号文` を Base64URL で返す */
export async function encryptText(keyBase64: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyBase64), utf8Encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return base64UrlEncode(out);
}

export async function decryptText(keyBase64: string, encrypted: string): Promise<string> {
  const bytes = base64UrlDecode(encrypted);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await aesKey(keyBase64),
    bytes.slice(12),
  );
  return utf8Decode(new Uint8Array(plain));
}
