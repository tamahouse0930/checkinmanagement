import type { Db } from "./db";
import { parseRevoked, PROPERTY_ID, type RevokedSession } from "./settings";
import { nowIso } from "./time";

/**
 * セッションを取り消す SQL。取り消したセッション ID は設定の行に持ち、キャッシュと照合する（設計書 7.1）。
 * 有効期限を過ぎたものはここで取り除く。実行した後は invalidateSettings() を呼ぶ
 */
export function revokeSessionsStatement(db: Db, current: string, add: RevokedSession[]): D1PreparedStatement {
  const now = Date.now();
  const sids = new Set(add.map((r) => r.sid));
  const list = parseRevoked(current).filter((r) => r.exp > now && !sids.has(r.sid));
  list.push(...add);
  return db
    .prepare("UPDATE properties SET revoked_sessions = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(list), nowIso(), PROPERTY_ID);
}
