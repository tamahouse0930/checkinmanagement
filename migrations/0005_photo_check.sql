-- 写真の突き合わせ（設計書 4.13）: Google ドライブで見つからなくなった写真に印を付ける
ALTER TABLE photos ADD COLUMN missing_at TEXT;
-- 見つからない写真の件数（要対応に表示するため。毎朝の突き合わせで更新する）
ALTER TABLE properties ADD COLUMN missing_photo_count INTEGER NOT NULL DEFAULT 0;
-- 予約ごとの修正・削除の記録を索引で探す（予約詳細の表示と、3 年後の削除で使う）
CREATE INDEX idx_guest_revisions_reservation ON guest_revisions (reservation_id);
