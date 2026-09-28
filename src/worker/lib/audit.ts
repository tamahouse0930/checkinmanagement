import type { Db } from "./db";
import { nowIso } from "./time";

/** 操作ログの INSERT 文を返す。呼び出し側で他の SQL と一緒に db.batch() にまとめる */
export function auditStatement(db: Db, actor: string, action: string, target?: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actor, action, target ?? null, nowIso());
}
