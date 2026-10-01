import { useEffect, useState } from "react";
import type { AccountMe } from "../../shared/api-types";
import { api, ApiError } from "../lib/api";
import { usePublicInfo } from "../public/usePublicInfo";

type AccountState = { state: "loading" | "login" | "error"; me: null } | { state: "ready"; me: AccountMe };

/** ログイン中の管理者と権限（/api/account/me）。施設の管理画面とシステム管理の画面で使う */
export function useAccount(): AccountState & { reload: () => void } {
  const [value, setValue] = useState<AccountState>({ state: "loading", me: null });
  const reload = () =>
    api<AccountMe>("/api/account/me")
      .then((me) => setValue({ state: "ready", me }))
      .catch((e: unknown) => setValue({ state: e instanceof ApiError && e.status === 401 ? "login" : "error", me: null }));
  useEffect(() => {
    reload();
  }, []);
  return { ...value, reload };
}

export async function logout(): Promise<void> {
  await api("/api/account/logout", { method: "POST" });
  location.href = location.pathname.startsWith("/system") ? "/system" : "/admin";
}

/** ログイン画面。ログイン後は今開いている画面に戻る（権限があれば） */
export function LoginScreen({ title }: { title?: string }) {
  const error = new URLSearchParams(location.search).get("error");
  const info = usePublicInfo();
  return (
    <main className="login">
      <h1>{title ?? `${info?.name ?? ""} 管理画面`}</h1>
      {error && <p className="alert">{error}</p>}
      <a className="button primary" href={`/auth/google/login?next=${encodeURIComponent(location.pathname)}`}>
        Google でログイン
      </a>
      <p className="note">登録済みの Google アカウントでログインしてください。</p>
    </main>
  );
}

/** ログイン中の管理者を読み込めていないときの表示 */
export function AccountPending({ state, title }: { state: "loading" | "login" | "error"; title?: string }) {
  if (state === "loading") return <main className="center">読み込み中…</main>;
  if (state === "login") return <LoginScreen title={title} />;
  return <main className="center">エラーが発生しました。ページを読み込み直してください。</main>;
}

/** 権限のない画面を開いたとき */
export function NoPermission({ other }: { other: { href: string; label: string } | null }) {
  return (
    <main className="login">
      <p className="alert">この画面を使う権限がありません。</p>
      {other && (
        <a className="button primary" href={other.href}>
          {other.label}
        </a>
      )}
      <button className="link" onClick={logout}>
        ログアウト
      </button>
    </main>
  );
}
