-- 全体メモ（要件定義書 H-34）。清掃のときに気づいた購入依頼などを書き、管理者同士で共有する。
-- 対応済みにしたものは done_at を入れて一覧の下に移し、90 日後に毎日の処理で削除する
CREATE TABLE memos (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  done_at    TEXT,
  done_by    TEXT
);
CREATE INDEX idx_memos_done ON memos (done_at, created_at);
