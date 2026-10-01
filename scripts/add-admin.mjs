// 管理画面にログインできる Google アカウントを登録する（設計書 7.1）
// 施設管理者は、以後はシステム管理の画面（/system）から追加できる。システム管理者はこのコマンドでだけ登録する
// 使い方: npm run admin:add -- --local  someone@gmail.com [名前]            施設管理者として登録
//        npm run admin:add -- --remote --system someone@gmail.com [名前]   システム管理者として登録（施設管理者の権限はそのまま）
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const target = args.find((a) => a === "--local" || a === "--remote");
const system = args.includes("--system");
const [email, name = ""] = args.filter((a) => !a.startsWith("--"));

if (!target || !email || !/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email) || /['"]/.test(name)) {
  console.error("使い方: npm run admin:add -- --local|--remote [--system] <メールアドレス> [名前]");
  process.exit(1);
}

// 新しく登録するときは、システム管理者は施設管理者の権限を持たない。登録済みなら、指定した権限を足すだけ
const sql =
  "INSERT INTO admin_accounts (email, name, created_at, is_system, is_facility) " +
  `VALUES ('${email.toLowerCase()}', ${name ? `'${name}'` : "NULL"}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ${system ? "1, 0" : "0, 1"}) ` +
  `ON CONFLICT (email) DO UPDATE SET name = COALESCE(excluded.name, admin_accounts.name), ${system ? "is_system = 1" : "is_facility = 1"}`;

// シェルを通すと Windows で SQL が空白で分割されるため、wrangler を node で直接起動する
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
execFileSync(process.execPath, [wrangler, "d1", "execute", "tamahouse-checkin", target, "--command", sql], { stdio: "inherit" });
console.log(`${email} を${system ? "システム管理者" : "施設管理者"}として登録しました`);
