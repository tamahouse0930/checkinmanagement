import { useCallback, useEffect, useState } from "react";
import type { AccountMe } from "../../shared/api-types";
import { AdminHeader } from "../account/AdminHeader";
import { AccountPending, NoPermission, useAccount } from "../account/useAccount";
import { api } from "../lib/api";
import { usePathname } from "../lib/router";
import { useDocumentTitle } from "../lib/title";
import { CalendarPage } from "./CalendarPage";
import { LedgerPage, LedgerStayPage } from "./LedgerPage";
import { MemoPage } from "./MemoPage";
import { RegisterPrintPage } from "./RegisterPrintPage";
import { ReservationForm } from "./ReservationForm";
import { ReservationPage } from "./ReservationPage";
import { SettingsPage } from "./SettingsPage";
import { SetupPage } from "./SetupPage";

const NAV = [
  { path: "/admin", label: "カレンダー" },
  { path: "/admin/photos", label: "名簿管理" },
  { path: "/admin/memos", label: "メモ" },
  { path: "/admin/settings", label: "設定" },
];

/** 初期設定は設定の一部として扱う */
function isActive(path: string, pathname: string): boolean {
  if (path === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/reservations");
  if (path === "/admin/settings" && pathname === "/admin/setup") return true;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function AdminRoute({
  pathname,
  me,
  onPropertySaved,
  onMemosChanged,
}: {
  pathname: string;
  me: AccountMe;
  onPropertySaved: () => void;
  onMemosChanged: () => void;
}) {
  if (pathname === "/admin/memos") return <MemoPage onChanged={onMemosChanged} />;
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
  /** 未対応のメモの件数（メニューに出す。メールは送らないので、ここで気づけるようにする） */
  const [openMemos, setOpenMemos] = useState(0);
  const facility = account.state === "ready" && account.me.roles.facility;
  const loadMemoCount = useCallback(() => {
    api<{ open: number }>("/api/admin/memos/count")
      .then((r) => setOpenMemos(r.open))
      .catch(() => undefined);
  }, []);
  // 画面を移るたびに数え直す（他の管理者が書いたメモにも気づけるように）
  useEffect(() => {
    if (facility) loadMemoCount();
  }, [facility, pathname, loadMemoCount]);

  if (account.state !== "ready") return <AccountPending state={account.state} />;
  const { me } = account;
  if (!me.roles.facility) return <NoPermission other={me.roles.system ? { href: "/system", label: "システム管理の画面へ" } : null} />;

  return (
    <div className="admin">
      <AdminHeader me={me} current="facility" title={me.propertyName} nav={NAV.map((item) => (item.path === "/admin/memos" ? { ...item, badge: openMemos } : item))} isActive={(path) => isActive(path, pathname)} />
      <main className="admin-main" key={pathname + location.search}>
        <AdminRoute pathname={pathname} me={me} onPropertySaved={account.reload} onMemosChanged={loadMemoCount} />
      </main>
    </div>
  );
}
