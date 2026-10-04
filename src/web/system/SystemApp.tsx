import { useEffect, useState } from "react";
import type { AuditLogRow } from "../../shared/api-types";
import { EmailListSection, formatDate } from "../account/common";
import { SessionsSection, SystemStatusSection } from "../account/sections";
import { AdminHeader } from "../account/AdminHeader";
import { AccountPending, NoPermission, useAccount } from "../account/useAccount";
import { api } from "../lib/api";
import { usePathname } from "../lib/router";
import { useDocumentTitle } from "../lib/title";

/**
 * システム管理者の画面（設計書 4.15）。施設管理者の登録・案内メール、操作ログ、システムの状態。
 * 宿泊者の名簿・写真・予約は表示しない
 */

const NAV = [
  { path: "/system", label: "施設管理者" },
  { path: "/system/logs", label: "操作ログ" },
  { path: "/system/status", label: "状態・端末" },
];

/** 操作ログの種類（auditStatement の action） */
const ACTION_LABEL: Record<string, string> = {
  login: "ログイン",
  revoke_session: "端末をログアウトさせた",
  add_admin_account: "施設管理者を追加",
  delete_admin_account: "施設管理者を削除",
  send_admin_invite: "案内メールを送信",
  google_link: "Google と連携",
  update_settings: "基本情報を変更",
  update_text: "文面を変更",
  create_device_pairing: "タブレットの登録コードを発行",
  pair_device: "タブレットを登録",
  revoke_device: "タブレットの登録を取り消し",
  add_ical_source: "iCal を登録",
  update_ical_source: "iCal を変更",
  delete_ical_source: "iCal を削除",
  create_reservation: "予約を登録",
  create_test_reservation: "テスト予約を登録",
  update_reservation: "予約を変更",
  delete_reservation: "予約を削除",
  delete_test_reservation: "テスト予約を削除",
  regenerate_guest_token: "入力用 URL を作り直し",
  approve: "承認",
  reject: "差し戻し",
  set_keybox_code: "暗証番号を登録",
  verify_photos: "写真を照合（一致）",
  photo_mismatch: "写真を照合（不一致）",
  admin_checkout: "チェックアウト（管理画面）",
  undo_checkout: "チェックアウトを取り消し",
  add_guest: "宿泊者を追加",
  update_guest: "宿泊者を修正",
  delete_guest: "宿泊者を削除",
  replace_guest_photo: "身分証の写真を差し替え",
  view_photo: "写真を表示",
  view_register: "名簿を表示",
  export_csv: "名簿の CSV を出力",
  kiosk_checkin: "チェックイン（タブレット）",
  kiosk_checkout: "チェックアウト（タブレット）",
  kiosk_registration_start: "タブレットで登録を開始",
  kiosk_registration: "タブレットで登録（自動承認）",
  purge_expired: "保存期間（3 年）を過ぎた名簿を削除",
  purge_cancelled: "キャンセルされた予約の名簿を削除",
  purge_no_show: "泊まらなかった予約の名簿を削除",
  purge_photos: "削除予定日を過ぎた写真を削除",
};

function actorLabel(actor: string): string {
  if (actor.startsWith("admin:")) return actor.slice("admin:".length);
  if (actor.startsWith("kiosk:")) return "タブレット";
  if (actor === "system") return "自動処理";
  return actor;
}

/** 施設管理者の登録・削除と案内メール */
function AccountsPage() {
  return (
    <div className="stack">
      <EmailListSection
        title="施設管理者"
        endpoint="/api/system/accounts"
        listKey="accounts"
        invite
      />
    </div>
  );
}

/** 操作ログ（新しい順に 50 件ずつ） */
function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [next, setNext] = useState<{ before: string; beforeId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (cursor: typeof next) => {
    setLoading(true);
    try {
      const query = cursor ? `?${new URLSearchParams(cursor)}` : "";
      const res = await api<{ logs: AuditLogRow[]; next: typeof next }>(`/api/system/audit-logs${query}`);
      setLogs((prev) => (cursor ? [...prev, ...res.logs] : res.logs));
      setNext(res.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load(null);
  }, []);

  return (
    <section className="card">
      <h2>操作ログ</h2>
      {error && <p className="alert">{error}</p>}
      <div className="table-wrap">
        <table className="stay-table">
          <thead>
            <tr>
              <th>日時</th>
              <th>操作した人</th>
              <th>操作</th>
              <th>対象</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{formatDate(l.created_at)}</td>
                <td>{actorLabel(l.actor)}</td>
                <td>{ACTION_LABEL[l.action] ?? l.action}</td>
                <td>{l.target ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {logs.length === 0 && !loading && <p className="note">記録がありません</p>}
      {next && (
        <div className="actions">
          <button className="button" onClick={() => load(next)} disabled={loading}>
            {loading ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      )}
    </section>
  );
}

function SystemRoute({ pathname }: { pathname: string }) {
  if (pathname === "/system/logs") return <AuditLogPage />;
  if (pathname === "/system/status") {
    return (
      <div className="stack">
        <SystemStatusSection />
        <SessionsSection />
      </div>
    );
  }
  return <AccountsPage />;
}

export function SystemApp() {
  const pathname = usePathname();
  const account = useAccount();
  useDocumentTitle("システム管理");

  if (account.state !== "ready") return <AccountPending state={account.state} title="システム管理" />;
  const { me } = account;
  if (!me.roles.system) return <NoPermission other={me.roles.facility ? { href: "/admin", label: "施設の管理画面へ" } : null} />;

  return (
    <div className="admin">
      <AdminHeader me={me} current="system" title="システム管理" nav={NAV} isActive={(path) => path === pathname} />
      <main className="admin-main" key={pathname}>
        <SystemRoute pathname={pathname} />
      </main>
    </div>
  );
}
