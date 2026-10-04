-- 玄関のタブレットから登録を始めた予約の印（要件定義書 T-11）。
-- この印がある予約は、宿泊者が送信したときに自動で承認し、そのままタブレットでチェックインできるようにする。
-- 送信して承認したとき、管理者が URL を作り直したとき、差し戻したときに 0 に戻す
ALTER TABLE reservations ADD COLUMN kiosk_registration INTEGER NOT NULL DEFAULT 0;
