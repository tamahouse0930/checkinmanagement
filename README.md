# TAMAHOUSE チェックイン管理システム

民泊 TAMAHOUSE の宿泊者名簿・本人確認・チェックイン／チェックアウトを管理するシステム。
Cloudflare Workers + D1（無料プラン）と、管理用の Google アカウント（Gmail・Google ドライブ）で動く。

- [要件定義書](docs/requirements.md)
- [設計書](docs/design.md)

## ローカルで動かす

```sh
npm install
cp .dev.vars.example .dev.vars   # 値を入れる（下の「Google Cloud の設定」）
npm run db:migrate:local
npm run admin:add -- --local <自分の Google アカウント>
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

## 本番へのデプロイ（最初に 1 回）

```sh
npx wrangler login
npx wrangler d1 create tamahouse-checkin   # 表示された database_id を wrangler.jsonc に書く
npm run db:migrate:remote
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENC_KEY
npm run admin:add -- --remote <管理者の Google アカウント>   # 3 名分
npm run deploy
```

デプロイ後、代表の管理者が管理画面の「設定」→「Google と連携」を押し、`tamahouse0930@gmail.com` で許可する。
「テストメールを送る」で通知メールが届けば連携は完了。
