import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";
import { KioskApp } from "./kiosk/KioskApp";
import { HomePage } from "./public/HomePage";
import { PrivacyPage } from "./public/PrivacyPage";
import { RegistrationApp } from "./registration/RegistrationApp";
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
  const reg = /^\/(r|g)\/([A-Za-z0-9_-]{16,64})$/.exec(path);
  if (reg) return <RegistrationApp role={reg[1] as "r" | "g"} token={reg[2]} />;
  if (path === "/kiosk") return <KioskApp />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/") return <HomePage />;
  return <Placeholder title="このページ" />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
