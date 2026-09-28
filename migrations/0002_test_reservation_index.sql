-- テスト予約の削除（作成から 7 日後）を、テスト予約だけの部分索引で探す（設計書 4.9、DB-01）
CREATE INDEX idx_reservations_test ON reservations (created_at) WHERE is_test = 1;
