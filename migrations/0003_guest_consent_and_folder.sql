-- 同行者が自分で入力した場合の本人の同意（要件定義書 G-18）
ALTER TABLE guests ADD COLUMN consent_at TEXT;
-- 宿泊ごとの Google ドライブのフォルダ（設計書 3.4）
ALTER TABLE reservations ADD COLUMN drive_folder_id TEXT;
