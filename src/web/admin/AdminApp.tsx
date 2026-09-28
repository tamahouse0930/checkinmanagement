import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { navigate, usePathname } from "../lib/router";
import { CalendarPage } from "./CalendarPage";
import { LedgerPage, LedgerStayPage } from "./LedgerPage";
import { RegisterPrintPage } from "./RegisterPrintPage";
import { ReservationForm } from "./ReservationForm";
import { ReservationPage } from "./ReservationPage";
import { SettingsPage } from "./SettingsPage";

interface Me {
  email: string;
  serviceEmail: string;
}

const NAV = [
  { path: "/admin", label: "カレンダー" },
  { path: "/admin/photos", label: "名簿・写真台帳" },
  { path: "/admin/settings", label: "設定" },
];

function AdminRoute({ pathname, me }: { pathname: string; me: Me }) {
  if (pathname === "/admin/settings") return <SettingsPage me={me} />;
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
  return (
    <main className="login">
      <h1>TAMAHOUSE 管理画面</h1>
      {error && <p className="alert">{error}</p>}
      <a className="button primary" href="/auth/google/login">
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

  useEffect(() => {
    api<Me>("/api/admin/me")
      .then((m) => {
        setMe(m);
        setState("ready");
      })
      .catch((e: unknown) => setState(e instanceof ApiError && e.status === 401 ? "login" : "error"));
  }, []);

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
        <strong>TAMAHOUSE</strong>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={
                (item.path === "/admin" ? pathname === "/admin" || pathname.startsWith("/admin/reservations") : pathname === item.path || pathname.startsWith(`${item.path}/`))
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
        <AdminRoute pathname={pathname} me={me} />
      </main>
    </div>
  );
}
