-- 暗証番号の初期値を、予約の電話番号の下 4 桁（Airbnb の iCal）にする（要件定義書 H-14）
-- 取り込み済みで、暗証番号がまだ空の今後の予約に入れる。管理者が入力した番号は変えない
UPDATE reservations SET keybox_code = phone_last4
WHERE keybox_code IS NULL AND phone_last4 IS NOT NULL AND check_out_date >= date('now', '+9 hours');
