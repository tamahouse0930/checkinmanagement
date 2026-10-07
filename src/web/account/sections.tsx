import { Fragment, type ReactNode, useEffect, useState } from "react";
import { GOOGLE_PURPOSE_LABEL, type SystemStatus } from "../../shared/api-types";
import { jstNow } from "../../shared/dates";
import { api } from "../lib/api";
import { confirmDialog } from "../lib/dialog";
import { describeUserAgent } from "../../shared/user-agent";
import { formatDate, Message, useMessage } from "./common";

/** 施設の管理画面とシステム管理の画面の両方に出すセクション（設計書 4.15） */

interface SessionRow {
  id: string;
  email: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export function SessionsSection() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const { message, run } = useMessage();
  const load = () => api<{ sessions: SessionRow[] }>("/api/account/sessions").then((r) => setRows(r.sessions));
  useEffect(() => {
    load();
  }, []);

  const revoke = async (id: string) => {
    if (!(await confirmDialog("この端末をログアウトさせますか？", { okLabel: "ログアウトさせる", danger: true }))) return;
    run(async () => {
      await api(`/api/account/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    }, "ログアウトさせました");
  };

  return (
    <section className="card">
      <h2>ログイン中の端末</h2>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.id}>
            <span title={r.user_agent ?? undefined}>
              {r.email}
              <small>
                {" "}
                {describeUserAgent(r.user_agent)} ／ ログイン {formatDate(r.created_at)} ／ 最終利用 {formatDate(r.last_seen_at)}
              </small>
            </span>
            {r.current ? (
              <small>この端末</small>
            ) : (
              <button className="link danger" onClick={() => revoke(r.id)}>
                ログアウトさせる
              </button>
            )}
          </li>
        ))}
      </ul>
      <Message message={message} />
    </section>
  );
}

/** 毎日の定期処理（scheduled.ts）。実行してよい時刻を過ぎても今日の実行がなければ「未実行」と表示する */
const JOBS = [
  { job: "daily_morning", label: "予約の取り込み・テスト予約の削除", hour: 5 },
  { job: "daily_cleanup", label: "保存期間を過ぎたデータの削除", hour: 6 },
  { job: "daily_reconcile", label: "写真の突き合わせ", hour: 7 },
  { job: "evening_unregistered", label: "前日未登録の通知", hour: 18 },
];

const CHANNEL_LABEL = { airbnb: "Airbnb", booking: "Booking.com" } as const;

function Ok({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={ok ? "setup-done" : "setup-todo"}>{children}</span>;
}

/** システムの状態（定期処理、Google 連携、予約の取り込み、タブレット）。宿泊者の個人情報は表示しない */
export function SystemStatusSection() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<SystemStatus>("/api/account/status")
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);

  const now = jstNow();
  return (
    <section className="card">
      <h2>システムの状態</h2>
      {error && <p className="alert">{error}</p>}
      {!status && !error && <p className="note">読み込み中…</p>}
      {status && (
        <>
          <h3 className="sub-heading">毎日の定期処理</h3>
          <ul className="list">
            {JOBS.map(({ job, label, hour }) => {
              const last = status.jobs.find((j) => j.job === job)?.last_run ?? null;
              const ok = last === now.date || now.hour < hour;
              return (
                <li key={job}>
                  <span>
                    {label}
                    <small>（毎日 {hour} 時以降。最後の実行: {last ?? "なし"}）</small>
                  </span>
                  <Ok ok={ok}>{ok ? "正常" : "今日は未実行"}</Ok>
                </li>
              );
            })}
          </ul>

          <h3 className="sub-heading">Google との連携</h3>
          <ul className="list">
            {status.google.map((g) => (
              <Fragment key={g.purpose}>
                <li>
                  <span>
                    {GOOGLE_PURPOSE_LABEL[g.purpose]}: {g.accountEmail ?? "未連携"}
                    {g.linkedAt && <small>（連携 {formatDate(g.linkedAt)}）</small>}
                  </span>
                  <Ok ok={g.linked && !g.lastError}>{!g.linked ? "未連携" : g.lastError ? "エラー" : "正常"}</Ok>
                </li>
                {g.lastError && <li className="alert">{g.lastError}</li>}
              </Fragment>
            ))}
            <li>
              <span>Google ドライブで見つからない写真</span>
              <Ok ok={status.missingPhotoCount === 0}>{status.missingPhotoCount} 件</Ok>
            </li>
          </ul>

          <h3 className="sub-heading">予約の取り込み（iCal）</h3>
          <ul className="list">
            {status.icalSources.map((s) => (
              <li key={s.channel}>
                <span>
                  {CHANNEL_LABEL[s.channel]}
                  <small>（最後の取り込み {formatDate(s.last_synced_at)}）</small>
                  {s.last_error && <small className="alert-text"> {s.last_error}</small>}
                </span>
                <Ok ok={!s.last_error}>{s.last_error ? "エラー" : "正常"}</Ok>
              </li>
            ))}
            {status.icalSources.length === 0 && <li className="note">登録されていません</li>}
          </ul>

          <h3 className="sub-heading">チェックイン用タブレット</h3>
          <ul className="list">
            {status.devices.map((d, i) => (
              <li key={i}>
                <span>{d.name}</span>
                <small>最終利用 {formatDate(d.last_seen_at)}</small>
              </li>
            ))}
            {status.devices.length === 0 && <li className="note">登録されていません</li>}
          </ul>
          <div className="actions">
            <button className="button" onClick={load}>
              最新の状態に更新
            </button>
          </div>
        </>
      )}
    </section>
  );
}
