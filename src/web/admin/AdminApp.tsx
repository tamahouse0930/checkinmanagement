import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { navigate, usePathname } from "../lib/router";
import { SettingsPage } from "./SettingsPage";

interface Me {
  email: string;
  serviceEmail: string;
}

const NAV = [
  { path: "/admin", label: "カレンダー" },
  { path: "/admin/photos", label: "写真台帳" },
  { path: "/admin/settings", label: "設定" },
];

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
              className={pathname === item.path ? "active" : undefined}
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
      <main className="admin-main">
        {pathname === "/admin/settings" ? (
          <SettingsPage me={me} />
        ) : pathname === "/admin/photos" ? (
          <p className="note">写真台帳は段階 5 で作ります。</p>
        ) : (
          <p className="note">カレンダーは段階 2 で作ります。</p>
        )}
      </main>
    </div>
  );
}
