// 管理画面にログインできる Google アカウントを登録する（初期登録用。以後は管理画面の設定から追加できる）
// 使い方: npm run admin:add -- --local  someone@gmail.com [名前]
//        npm run admin:add -- --remote someone@gmail.com [名前]
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const target = args.find((a) => a === "--local" || a === "--remote");
const [email, name = ""] = args.filter((a) => !a.startsWith("--"));

if (!target || !email || !/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email) || /['"]/.test(name)) {
  console.error("使い方: npm run admin:add -- --local|--remote <メールアドレス> [名前]");
  process.exit(1);
}

const sql =
  "INSERT INTO admin_accounts (email, name, created_at) " +
  `VALUES ('${email.toLowerCase()}', ${name ? `'${name}'` : "NULL"}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ` +
  "ON CONFLICT (email) DO UPDATE SET name = excluded.name";

execFileSync("npx", ["wrangler", "d1", "execute", "tamahouse-checkin", target, "--command", sql], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`${email} を登録しました`);
