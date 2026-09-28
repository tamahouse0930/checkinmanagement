import type { Db } from "./lib/db";
import type { SessionPayload } from "./lib/session";
import type { ReservationRow } from "./services/guests";

export interface Env {
  DB: D1Database;
  /** 写真の保存とメールの送信に使う Google アカウント（wrangler.jsonc の vars） */
  GOOGLE_SERVICE_EMAIL: string;
  /** 定期処理の通知メールに載せる管理画面の URL の起点（wrangler.jsonc の vars） */
  PUBLIC_ORIGIN?: string;
  /** 以下はシークレット（.dev.vars / wrangler secret put） */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  TOKEN_ENC_KEY: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    admin: SessionPayload;
    /** 宿泊者入力画面の URL のトークンから引いた予約 */
    reservation: ReservationRow;
    /** 同行者用の URL の場合、その同行者の番号 */
    companionSeq: number | null;
  };
};
