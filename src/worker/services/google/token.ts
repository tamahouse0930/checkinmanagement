import type { Env } from "../../env";
import type { Db } from "../../lib/db";
import { decryptText } from "../../lib/crypto";
import type { GoogleLinkView } from "../../../shared/api-types";
import { getSettings, invalidateSettings, type Settings } from "../../lib/settings";
import { type GooglePurpose, TOKEN_ENDPOINT } from "./oauth";

export class GoogleNotLinkedError extends Error {
  constructor(message = "Google ドライブ・Gmail と連携されていません") {
    super(message);
  }
}

/** アクセストークン（1 時間有効）は用途ごとに Worker のメモリで使い回す */
const cached = new Map<GooglePurpose, { token: string; expires: number }>();

const NOT_LINKED: Record<GooglePurpose, string> = {
  mail: "通知メールの送信用の Google アカウントと連携されていません",
  drive: "写真の保存用の Google アカウント（Google ドライブ）と連携されていません",
};

/** 用途（メールの送信／写真の保存）ごとの、連携したアカウントのアクセストークン */
export async function getGoogleAccessToken(env: Env, db: Db, purpose: GooglePurpose): Promise<string> {
  const now = Date.now();
  const hit = cached.get(purpose);
  if (hit && hit.expires > now + 60_000) return hit.token;

  const googleLink = (await getSettings(db)).googleLinks[purpose];
  if (!googleLink) throw new GoogleNotLinkedError(NOT_LINKED[purpose]);

  const refreshToken = await decryptText(env.TOKEN_ENC_KEY, googleLink.refresh_token_enc);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const label = purpose === "mail" ? "通知メールの送信" : "写真の保存";
    const message = detail.includes("invalid_grant")
      ? `${label}用の Google との連携が切れています。設定画面で連携し直してください`
      : `${label}用の Google のアクセストークンを取得できませんでした（HTTP ${res.status}）`;
    await recordGoogleError(db, purpose, message);
    throw new GoogleNotLinkedError(message);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached.set(purpose, { token: body.access_token, expires: now + body.expires_in * 1000 });
  return body.access_token;
}

export function clearGoogleAccessToken(purpose: GooglePurpose): void {
  cached.delete(purpose);
}

/** 連携のエラーを記録し、管理画面の「要対応」に出せるようにする */
export async function recordGoogleError(db: Db, purpose: GooglePurpose, message: string | null): Promise<void> {
  await db.run(db.prepare("UPDATE google_links SET last_error = ? WHERE purpose = ?").bind(message, purpose));
  invalidateSettings();
}

/** 画面に出す連携の状態（通知メールの送信用、写真の保存用の順） */
export function googleLinkViews(settings: Settings, env: Env): GoogleLinkView[] {
  return (["mail", "drive"] as const).map((purpose) => {
    const link = settings.googleLinks[purpose];
    return {
      purpose,
      expectedEmail: purpose === "mail" ? env.GOOGLE_SERVICE_EMAIL : env.GOOGLE_DRIVE_EMAIL,
      linked: link !== null,
      accountEmail: link?.account_email ?? null,
      linkedAt: link?.linked_at ?? null,
      lastError: link?.last_error ?? null,
    };
  });
}
