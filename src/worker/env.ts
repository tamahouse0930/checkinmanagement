import type { Db } from "./lib/db";
import type { SessionPayload } from "./lib/session";

export interface Env {
  DB: D1Database;
  /** 写真の保存とメールの送信に使う Google アカウント（wrangler.jsonc の vars） */
  GOOGLE_SERVICE_EMAIL: string;
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
  };
};
