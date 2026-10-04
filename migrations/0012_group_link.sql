-- 同行者の皆さんに送る共通のリンク（要件定義書 G-11）。LINE のグループなどに 1 つのリンクを送れば、
-- 開いた人ごとに空いている枠を 1 つ割り当て、その人専用の入力画面（guests.entry_token）を開く。
-- 送信したとき、管理者が URL を作り直したとき、差し戻したときに NULL に戻す
ALTER TABLE reservations ADD COLUMN group_token TEXT;
CREATE UNIQUE INDEX idx_reservations_group_token ON reservations (group_token);
