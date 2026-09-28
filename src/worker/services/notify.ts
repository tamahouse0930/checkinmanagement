import type { Env } from "../env";
import type { Db } from "../lib/db";
import { getSettings } from "../lib/settings";
import { sendMail } from "./google/gmail";

export interface HostNotice {
  subject: string;
  text: string;
  /** テスト予約の通知なら件名に「[テスト]」を付ける（設計書 4.9） */
  isTest?: boolean;
}

/**
 * 管理者への通知メール（要件定義書 5.5）。宛先は設定画面で登録したすべてのアドレス。
 * 失敗しても呼び出し元の処理は止めない（エラーは google_link.last_error に残り、要対応に出る）。
 */
export async function notifyHost(env: Env, db: Db, notice: HostNotice): Promise<void> {
  try {
    const { recipients, googleLink } = await getSettings(db);
    if (!googleLink || recipients.length === 0) return;
    await sendMail(env, db, {
      to: recipients,
      subject: `${notice.isTest ? "[テスト] " : ""}[TAMAHOUSE] ${notice.subject}`,
      text: notice.text,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "notify_failed", message: String(error) }));
  }
}
