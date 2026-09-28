import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";
import { HomePage } from "./public/HomePage";
import { PrivacyPage } from "./public/PrivacyPage";
import "./styles.css";

function Placeholder({ title }: { title: string }) {
  return (
    <main className="placeholder">
      <h1>TAMAHOUSE</h1>
      <p>{title}は準備中です。</p>
    </main>
  );
}

function Root() {
  const path = location.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) return <AdminApp />;
  if (path.startsWith("/r/") || path.startsWith("/g/")) return <Placeholder title="宿泊者入力画面" />;
  if (path.startsWith("/kiosk")) return <Placeholder title="チェックイン・チェックアウト画面" />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/") return <HomePage />;
  return <Placeholder title="このページ" />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
