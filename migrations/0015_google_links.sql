-- Google との連携を、通知メールの送信（mail）と写真の保存（drive）で別々のアカウントにできるようにする。
-- これまでの連携（1 つのアカウントで両方を許可したもの）は、両方の用途にそのまま引き継ぐ。
-- 写真の保存を別のアカウントで連携し直すと、保存先のフォルダは新しいアカウントで作り直す
CREATE TABLE google_links (
  purpose           TEXT PRIMARY KEY CHECK (purpose IN ('mail', 'drive')),
  account_email     TEXT NOT NULL,
  scopes            TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  linked_at         TEXT NOT NULL,
  last_error        TEXT
);
INSERT INTO google_links (purpose, account_email, scopes, refresh_token_enc, linked_at, last_error)
  SELECT 'mail', account_email, scopes, refresh_token_enc, linked_at, last_error FROM google_link;
INSERT INTO google_links (purpose, account_email, scopes, refresh_token_enc, linked_at, last_error)
  SELECT 'drive', account_email, scopes, refresh_token_enc, linked_at, last_error FROM google_link;
DROP TABLE google_link;
