import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { confirmDialog } from "../lib/dialog";

/**
 * 全体メモ（要件定義書 H-34）。清掃のときに気づいた購入依頼などを書き、管理者同士で共有する。
 * 対応したら「対応済みにする」で下の一覧に移す（90 日後に自動で削除）
 */

interface Memo {
  id: string;
  body: string;
  createdBy: string;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
}

const MAX_LENGTH = 500;

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export function MemoPage({ onChanged }: { onChanged: () => void }) {
  const [memos, setMemos] = useState<{ open: Memo[]; done: Memo[] } | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setMemos(await api<{ open: Memo[]; done: Memo[] }>("/api/admin/memos"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await api("/api/admin/memos", { method: "POST", body: { body } });
      setBody("");
    });

  const remove = async (m: Memo) => {
    if (!(await confirmDialog(`このメモを削除しますか？\n\n${m.body}`, { okLabel: "削除する", danger: true }))) return;
    await run(() => api(`/api/admin/memos/${m.id}`, { method: "DELETE" }));
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>メモ</h2>
        <p className="note">清掃のときに気づいた購入してほしい物や、管理者同士の連絡を書きます。対応したら「対応済みにする」を押してください。</p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add();
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={MAX_LENGTH}
            placeholder="例: トイレットペーパーが残り 2 個"
            aria-label="メモ"
          />
          <div className="actions">
            <button className="button primary" type="submit" disabled={busy || !body.trim()}>
              書き込む
            </button>
          </div>
        </form>
        {error && <p className="alert">{error}</p>}
      </section>

      <section className="card">
        <h2>未対応{memos && memos.open.length > 0 && `（${memos.open.length} 件）`}</h2>
        {!memos ? (
          <p className="note">読み込み中…</p>
        ) : memos.open.length === 0 ? (
          <p className="note">未対応のメモはありません。</p>
        ) : (
          <ul className="memo-list">
            {memos.open.map((m) => (
              <li key={m.id}>
                <p className="pre memo-body">{m.body}</p>
                <small className="note">
                  {formatTime(m.createdAt)}・{m.createdBy}
                </small>
                <div className="memo-actions">
                  <button className="button primary" disabled={busy} onClick={() => run(() => api(`/api/admin/memos/${m.id}/done`, { method: "POST" }))}>
                    対応済みにする
                  </button>
                  <button className="button" disabled={busy} onClick={() => remove(m)}>
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {memos && memos.done.length > 0 && (
        <details className="card">
          <summary>
            <strong>対応済み（最近の {memos.done.length} 件）</strong>
          </summary>
          <p className="note">対応済みにしてから 90 日たつと自動で削除します。</p>
          <ul className="memo-list done">
            {memos.done.map((m) => (
              <li key={m.id}>
                <p className="pre memo-body">{m.body}</p>
                <small className="note">
                  {formatTime(m.createdAt)}・{m.createdBy} ／ 対応済み {m.doneAt && formatTime(m.doneAt)}・{m.doneBy}
                </small>
                <div className="memo-actions">
                  <button className="button" disabled={busy} onClick={() => run(() => api(`/api/admin/memos/${m.id}/reopen`, { method: "POST" }))}>
                    未対応に戻す
                  </button>
                  <button className="button" disabled={busy} onClick={() => remove(m)}>
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
