# TAMAHOUSE チェックイン管理システム

民泊 TAMAHOUSE の宿泊者名簿・本人確認・チェックイン／チェックアウトを管理するシステム。
Cloudflare Workers + D1（無料プラン）と、管理用の Google アカウント（Gmail・Google ドライブ）で動く。

- [要件定義書](docs/requirements.md)
- [設計書](docs/design.md)
- [試験運用の確認表](docs/trial-run.md)

## ローカルで動かす

```sh
npm install
cp .dev.vars.example .dev.vars   # 値を入れる（下の「Google Cloud の設定」）
npm run db:migrate:local
npm run admin:add -- --local --system <自分の Google アカウント>   # システム管理者
npm run admin:add -- --local <自分の Google アカウント>            # 施設管理者
npm run dev                      # http://localhost:5173/admin
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（画面と Worker） |
| `npm run typecheck` | 型チェック |
| `npm test` | 単体テスト |
| `npm run build` | 本番用のビルド |

## Google Cloud の設定（最初に 1 回）

`tamahouse0930@gmail.com` で [Google Cloud Console](https://console.cloud.google.com/) にログインして行う。クレジットカードの登録は不要。

1. プロジェクトを作る
2. 「API とサービス」→「ライブラリ」で **Gmail API** と **Google Drive API** を有効にする
3. 「OAuth 同意画面」を作る（ユーザーの種類は「外部」）。作成後、公開ステータスを「**本番環境**」にする（「テスト」のままだとリフレッシュトークンが 7 日で失効する）
4. 「認証情報」→「OAuth クライアント ID」（種類は「ウェブ アプリケーション」）を作り、承認済みのリダイレクト URI に次を登録する
   - `http://localhost:5173/auth/google/callback`（ローカル）
   - `https://<本番のドメイン>/auth/google/callback`（本番）
5. クライアント ID とクライアント シークレットを `.dev.vars`（本番は `wrangler secret put`）に登録する

## 本番へのデプロイ

GitHub の main に push すると、Cloudflare が自動でビルドしてデプロイする（Workers Builds）。

### 最初に 1 回だけ行う設定（Cloudflare のダッシュボード）

1. **D1 のデータベースを作る**: 「ストレージとデータベース」→「D1」→「作成」。名前は `tamahouse-checkin`。表示された「データベース ID」を `wrangler.jsonc` の `database_id` に書いて push する
2. **ビルドの設定**: Worker の「設定」→「ビルド」で次のようにする

   | 項目 | 値 |
   |---|---|
   | ビルド コマンド | `npm run build` |
   | デプロイ コマンド | `npx wrangler d1 migrations apply tamahouse-checkin --remote && npx wrangler deploy` |

   デプロイのたびに、未適用のマイグレーション（テーブルの変更）が自動で適用される
3. **秘密情報**: Worker の「設定」→「変数とシークレット」に、種類「シークレット」で次の 4 つを登録する

   | 名前 | 値 |
   |---|---|
   | `GOOGLE_CLIENT_ID` | Google Cloud の OAuth クライアント ID |
   | `GOOGLE_CLIENT_SECRET` | 同じくクライアント シークレット |
   | `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` で作った値 |
   | `TOKEN_ENC_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` で作った値 |

4. **Google 側**: ホームページ（`/`）とプライバシーポリシー（`/privacy`）の URL を「ブランディング」に登録する。デプロイ後の URL（`https://checkinmanagement.<サブドメイン>.workers.dev`）について、OAuth クライアントの「承認済みのリダイレクト URI」に `…/auth/google/callback` を、「ブランディング」の「承認済みドメイン」にドメインを追加する

### デプロイ後

1. `tamahouse0930@gmail.com` で管理画面（`/admin`）にログインする（マイグレーションで最初から登録済み）
2. 「設定」→「初期設定を開く」（`/admin/setup`）で、上から順に設定する。済んだ項目には「設定済み」と表示される
   - 通知メールの宛先を登録してから、代表の管理者が「Google と連携」を押し、`tamahouse0930@gmail.com` で許可する。「テストメールを送る」で届けば連携は完了
   - 管理者 3 名の Google アカウントは、システム管理者（`kodan1231@gmail.com`）がシステム管理の画面（`/system`）の「施設管理者」に追加し、「案内メールを送る」で知らせる
3. 必要な設定が済むと、カレンダーの「初期設定が済んでいません」の表示が消える
