import type { Lang } from "../../shared/langs";
import { DEFAULT_TEXTS, type TextKind } from "../../shared/templates";
import type { Db } from "./db";

export interface PropertyRow {
  id: string;
  name: string;
  checkin_time: string;
  checkout_time: string;
  operator_name: string;
  operator_contact: string;
  drive_root_folder_id: string | null;
  revoked_sessions: string;
  settings_version: number;
  updated_at: string;
}

export interface GoogleLinkRow {
  account_email: string;
  scopes: string;
  refresh_token_enc: string;
  linked_at: string;
  last_error: string | null;
}

export interface RevokedSession {
  sid: string;
  /** セッションの有効期限（ミリ秒）。過ぎたものは一覧から取り除く */
  exp: number;
}

export interface Settings {
  property: PropertyRow;
  adminEmails: Set<string>;
  recipients: string[];
  revokedSids: Set<string>;
  googleLink: GoogleLinkRow | null;
  /** 管理者が編集した文面。キーは `種類:言語` */
  texts: Map<string, string>;
}

/**
 * 文面を取り出す。その言語の文面がなければ英語、既定の文面、日本語の順に探す（要件定義書 L-07）
 */
export function getText(settings: Settings, kind: TextKind, lang: Lang): string {
  const own = settings.texts.get(`${kind}:${lang}`);
  if (own) return own;
  if (kind === "invite" || kind === "code" || kind === "reject") return DEFAULT_TEXTS[kind][lang];
  return settings.texts.get(`${kind}:en`) ?? settings.texts.get(`${kind}:ja`) ?? "";
}

export const PROPERTY_ID = "main";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { value: Settings; expires: number } | null = null;

/**
 * 変更の少ない設定を 1 回の問い合わせでまとめて読み、Worker のメモリに 5 分間保存する（設計書 DB-04）。
 * 設定を変えた Worker は invalidateSettings() で即座に読み直す。他の Worker には最大 5 分で反映される。
 */
export async function getSettings(db: Db): Promise<Settings> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.value;

  const [property, accounts, recipients, link, texts] = await db.batch([
    db.prepare("SELECT * FROM properties WHERE id = ?").bind(PROPERTY_ID),
    db.prepare("SELECT email FROM admin_accounts LIMIT 50"),
    db.prepare("SELECT email FROM notify_recipients LIMIT 50"),
    db.prepare(
      "SELECT account_email, scopes, refresh_token_enc, linked_at, last_error FROM google_link WHERE id = 1",
    ),
    db.prepare("SELECT kind, lang, body FROM property_texts WHERE property_id = ? LIMIT 100").bind(PROPERTY_ID),
  ]);

  const propertyRow = property.results[0] as PropertyRow | undefined;
  if (!propertyRow) throw new Error("properties の初期データがありません（マイグレーションを確認してください）");

  const value: Settings = {
    property: propertyRow,
    adminEmails: new Set((accounts.results as { email: string }[]).map((r) => r.email.toLowerCase())),
    recipients: (recipients.results as { email: string }[]).map((r) => r.email),
    revokedSids: new Set(parseRevoked(propertyRow.revoked_sessions).map((r) => r.sid)),
    googleLink: (link.results[0] as GoogleLinkRow | undefined) ?? null,
    texts: new Map(
      (texts.results as { kind: string; lang: string; body: string }[]).map((r) => [`${r.kind}:${r.lang}`, r.body]),
    ),
  };
  cache = { value, expires: now + CACHE_TTL_MS };
  return value;
}

export function invalidateSettings(): void {
  cache = null;
}

export function parseRevoked(json: string): RevokedSession[] {
  try {
    const list = JSON.parse(json) as RevokedSession[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
