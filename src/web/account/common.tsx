import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { confirmDialog } from "../lib/dialog";

/** 施設の管理画面とシステム管理の画面の両方で使う部品（設計書 7.1） */

export interface EmailRow {
  email: string;
  name: string | null;
}

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
}

export function useMessage() {
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return { message, run };
}

export function Message({ message }: { message: { kind: "ok" | "error"; text: string } | null }) {
  if (!message) return null;
  return <p className={message.kind === "ok" ? "notice" : "alert"}>{message.text}</p>;
}

export function EmailListSection(props: {
  title: string;
  description?: string;
  endpoint: string;
  listKey: string;
  onChanged?: () => void;
  /** 各行に「案内メールを送る」を出す（ログインできるアカウント。設計書 4.14） */
  invite?: boolean;
}) {
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const { message, run } = useMessage();

  const load = () => api<Record<string, EmailRow[]>>(props.endpoint).then((r) => setRows(r[props.listKey]));
  const reload = async () => {
    await load();
    props.onChanged?.();
  };
  useEffect(() => {
    load();
  }, []);

  const sendInvite = (target: string) =>
    api(`${props.endpoint}/${encodeURIComponent(target)}/invite`, { method: "POST" });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const target = email.trim();
    const withInvite =
      props.invite === true &&
      (await confirmDialog(`${target} に、管理画面の URL とログインの方法を書いた案内メールも送りますか？`, { okLabel: "送る" }));
    run(
      async () => {
        await api(props.endpoint, { method: "POST", body: { email, name } });
        setEmail("");
        setName("");
        await reload();
        if (withInvite) await sendInvite(target);
      },
      withInvite ? "追加して、案内メールを送りました" : "追加しました",
    );
  };

  const invite = async (target: string) => {
    if (!(await confirmDialog(`${target} に、管理画面の URL とログインの方法を書いた案内メールを送りますか？`, { okLabel: "送る" }))) return;
    run(() => sendInvite(target), `${target} に案内メールを送りました`);
  };

  const remove = async (target: string) => {
    if (!(await confirmDialog(`${target} を削除しますか？`, { okLabel: "削除する", danger: true }))) return;
    run(async () => {
      await api(`${props.endpoint}/${encodeURIComponent(target)}`, { method: "DELETE" });
      await reload();
    }, "削除しました");
  };

  return (
    <section className="card">
      <h2>{props.title}</h2>
      {props.description && <p className="note">{props.description}</p>}
      <ul className="list">
        {rows.map((r) => (
          <li key={r.email}>
            <span>
              {r.email}
              {r.name && <small>（{r.name}）</small>}
            </span>
            <span className="row-actions">
              {props.invite && (
                <button className="link" onClick={() => invite(r.email)}>
                  案内メールを送る
                </button>
              )}
              <button className="link danger" onClick={() => remove(r.email)}>
                削除
              </button>
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="note">登録されていません</li>}
      </ul>
      <form onSubmit={add} className="form inline">
        <input type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input placeholder="名前（任意）" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        <button className="button" type="submit">
          追加
        </button>
      </form>
      <Message message={message} />
    </section>
  );
}
