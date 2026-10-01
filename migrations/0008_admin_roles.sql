-- 管理者の権限を、システム管理者と施設管理者に分ける（設計書 7.1）
-- システム管理者: 施設管理者の登録・案内メール、操作ログの閲覧。宿泊者の名簿・写真は見られない
-- 施設管理者: 予約・名簿・写真・設定（今までの管理画面）
-- 1 つのアカウントが両方の権限を持つこともできる。既存のアカウントは施設管理者のまま
ALTER TABLE admin_accounts ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1));
ALTER TABLE admin_accounts ADD COLUMN is_facility INTEGER NOT NULL DEFAULT 1 CHECK (is_facility IN (0, 1));

-- システム管理者（TAMAHOUSE の施設管理者も兼ねる）
INSERT INTO admin_accounts (email, name, created_at, is_system, is_facility)
VALUES ('kodan1231@gmail.com', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1)
ON CONFLICT (email) DO UPDATE SET is_system = 1, is_facility = 1;

-- 操作ログを新しい順に 50 件ずつ読むための索引（全件を読まないようにする）
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);
