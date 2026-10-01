import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { navigate, usePathname } from "../lib/router";
import { useDocumentTitle } from "../lib/title";
import { usePublicInfo } from "../public/usePublicInfo";
import { CalendarPage } from "./CalendarPage";
import { LedgerPage, LedgerStayPage } from "./LedgerPage";
import { RegisterPrintPage } from "./RegisterPrintPage";
import { ReservationForm } from "./ReservationForm";
import { ReservationPage } from "./ReservationPage";
import { SettingsPage } from "./SettingsPage";
import { SetupPage } from "./SetupPage";

interface Me {
  email: string;
  serviceEmail: string;
  propertyName: string;
}

const NAV = [
  { path: "/admin", label: "カレンダー" },
  { path: "/admin/photos", label: "名簿管理" },
  { path: "/admin/settings", label: "設定" },
];

/** 初期設定は設定の一部として扱う */
function isActive(path: string, pathname: string): boolean {
  if (path === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/reservations");
  if (path === "/admin/settings" && pathname === "/admin/setup") return true;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function AdminRoute({ pathname, me, onPropertySaved }: { pathname: string; me: Me; onPropertySaved: () => void }) {
  if (pathname === "/admin/settings") return <SettingsPage me={me} />;
  if (pathname === "/admin/setup") return <SetupPage onPropertySaved={onPropertySaved} />;
  if (pathname === "/admin/photos") return <LedgerPage />;
  if (pathname === "/admin/photos/print") return <RegisterPrintPage />;
  const stay = /^\/admin\/photos\/([^/]+)$/.exec(pathname);
  if (stay) return <LedgerStayPage id={stay[1]} />;
  if (pathname === "/admin/reservations/new") return <ReservationForm />;
  const edit = /^\/admin\/reservations\/([^/]+)\/edit$/.exec(pathname);
  if (edit) return <ReservationForm editId={edit[1]} />;
  const detail = /^\/admin\/reservations\/([^/]+)$/.exec(pathname);
  if (detail) return <ReservationPage id={detail[1]} />;
  return <CalendarPage />;
}

function urlError(): string | null {
  return new URLSearchParams(location.search).get("error");
}

function LoginScreen() {
  const error = urlError();
  const info = usePublicInfo();
  return (
    <main className="login">
      <h1>{info?.name} 管理画面</h1>
      {error && <p className="alert">{error}</p>}
      <a
        className="button primary"
        href={location.pathname === "/admin" ? "/auth/google/login" : `/auth/google/login?next=${encodeURIComponent(location.pathname)}`}
      >
        Google でログイン
      </a>
      <p className="note">登録済みの Google アカウントでログインしてください。</p>
    </main>
  );
}

export function AdminApp() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">("loading");

  const loadMe = () =>
    api<Me>("/api/admin/me")
      .then((m) => {
        setMe(m);
        setState("ready");
      })
      .catch((e: unknown) => setState(e instanceof ApiError && e.status === 401 ? "login" : "error"));
  useEffect(() => {
    loadMe();
  }, []);
  useDocumentTitle(me?.propertyName);

  if (state === "loading") return <main className="center">読み込み中…</main>;
  if (state === "login") return <LoginScreen />;
  if (state === "error" || !me) return <main className="center">エラーが発生しました。ページを読み込み直してください。</main>;

  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" });
    location.href = "/admin";
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <strong>{me.propertyName}</strong>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={
                isActive(item.path, pathname)
                  ? "active"
                  : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button className="link" onClick={logout} title={me.email}>
          ログアウト
        </button>
      </header>
      <main className="admin-main" key={pathname + location.search}>
        <AdminRoute pathname={pathname} me={me} onPropertySaved={loadMe} />
      </main>
    </div>
  );
}
