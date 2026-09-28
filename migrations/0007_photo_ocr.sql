-- パスポートの写真を Google ドライブで読み取った日時（要件定義書 G-16）。1 枚の写真につき読み取りは 1 回だけにし、
-- 同じ写真で何度も読み取りを依頼されて、Google ドライブと Worker の無料枠を無駄に使わないようにする
ALTER TABLE photos ADD COLUMN ocr_at TEXT;
