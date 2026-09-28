-- 予約サイトから取り込んだ予約は参照のみにする。これまでアプリの中でブロック・キャンセルに変えた予約の固定を外し、
-- 次の取り込みで予約サイトの内容（iCal）どおりに戻す
UPDATE reservations SET status_locked = 0 WHERE source = 'ical';
