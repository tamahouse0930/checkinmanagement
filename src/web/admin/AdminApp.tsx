import type { AccountMe } from "../../shared/api-types";
import { AccountPending, logout, NoPermission, useAccount } from "../account/useAccount";
import { navigate, usePathname } from "../lib/router";
import { useDocumentTitle } from "../lib/title";
import { CalendarPage } from "./CalendarPage";
import { LedgerPage, LedgerStayPage } from "./LedgerPage";
import { RegisterPrintPage } from "./RegisterPrintPage";
import { ReservationForm } from "./ReservationForm";
import { ReservationPage } from "./ReservationPage";
import { SettingsPage } from "./SettingsPage";
import { SetupPage } from "./SetupPage";

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

function AdminRoute({ pathname, me, onPropertySaved }: { pathname: string; me: AccountMe; onPropertySaved: () => void }) {
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

/** 施設管理者の画面（予約・名簿・写真・設定。設計書 7.1） */
export function AdminApp() {
  const pathname = usePathname();
  const account = useAccount();
  useDocumentTitle(account.me?.propertyName);

  if (account.state !== "ready") return <AccountPending state={account.state} />;
  const { me } = account;
  if (!me.roles.facility) return <NoPermission other={me.roles.system ? { href: "/system", label: "システム管理の画面へ" } : null} />;

  return (
    <div className="admin">
      <header className="admin-header">
        <strong>{me.propertyName}</strong>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={isActive(item.path, pathname) ? "active" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
          {me.roles.system && <a href="/system">システム管理</a>}
        </nav>
        <button className="link" onClick={logout} title={me.email}>
          ログアウト
        </button>
      </header>
      <main className="admin-main" key={pathname + location.search}>
        <AdminRoute pathname={pathname} me={me} onPropertySaved={account.reload} />
      </main>
    </div>
  );
}
