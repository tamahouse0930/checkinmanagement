-- 写真の照合で「不一致あり」とした宿泊者（要件定義書 H-20。駆けつけの担当者が対応する）
ALTER TABLE reservations ADD COLUMN photo_mismatch TEXT;
