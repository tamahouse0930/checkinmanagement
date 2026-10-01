import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * 画面の Content-Security-Policy（設計書 7.2）。開発サーバーはインラインのスクリプトとスタイルを使うため、
 * 本番のビルドの HTML にだけ埋め込む。埋め込みでは効かない frame-ancestors は public/_headers で指定する
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // 撮った写真のプレビューは blob: の URL で表示する
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), contentSecurityPolicy()],
});
