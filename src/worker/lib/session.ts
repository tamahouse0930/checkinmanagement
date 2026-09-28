import { base64UrlDecode, base64UrlEncode, signValue, utf8Decode, utf8Encode, verifySignedValue } from "./crypto";
import { DAY_MS } from "./time";

/** 管理画面のセッション。署名付き Cookie だけで検証し、D1 は読まない（設計書 7.1、DB-03） */
export interface SessionPayload {
  sid: string;
  email: string;
  /** 発行日時（ミリ秒） */
  iat: number;
  /** 有効期限（ミリ秒） */
  exp: number;
}

export const SESSION_COOKIE = "th_admin";
export const SESSION_TTL_MS = 30 * DAY_MS;
/** 最後の発行から 1 日以上たっていたら、有効期限を延ばして発行し直す */
export const SESSION_RENEW_AFTER_MS = DAY_MS;

export function newSessionPayload(sid: string, email: string, now = Date.now()): SessionPayload {
  return { sid, email, iat: now, exp: now + SESSION_TTL_MS };
}

export async function encodeSession(secret: string, payload: SessionPayload): Promise<string> {
  return signValue(secret, base64UrlEncode(utf8Encode(JSON.stringify(payload))));
}

export async function decodeSession(
  secret: string,
  cookie: string | undefined,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!cookie) return null;
  const data = await verifySignedValue(secret, cookie);
  if (!data) return null;
  try {
    const payload = JSON.parse(utf8Decode(base64UrlDecode(data))) as SessionPayload;
    if (typeof payload.sid !== "string" || typeof payload.email !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function needsRenewal(payload: SessionPayload, now = Date.now()): boolean {
  return now - payload.iat >= SESSION_RENEW_AFTER_MS;
}
