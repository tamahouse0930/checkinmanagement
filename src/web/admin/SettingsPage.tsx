import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";

interface SettingsResponse {
  property: {
    name: string;
    checkinTime: string;
    checkoutTime: string;
    operatorName: string;
    operatorContact: string;
  };
  google: {
    serviceEmail: string;
    linked: boolean;
    accountEmail: string | null;
    linkedAt: string | null;
    lastError: string | null;
    driveFolderReady: boolean;
  };
}

interface EmailRow {
  email: string;
  name: string | null;
}

interface SessionRow {
  id: string;
  email: string;
  user_agent: string | null;
  last_seen_at: string;
  current: boolean;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
}

function useMessage() {
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

function Message({ message }: { message: { kind: "ok" | "error"; text: string } | null }) {
  if (!message) return null;
  return <p className={message.kind === "ok" ? "notice" : "alert"}>{message.text}</p>;
}

function BasicSection({ initial, onSaved }: { initial: SettingsResponse["property"]; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const { message, run } = useMessage();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/api/admin/settings", { method: "PUT", body: form });
      onSaved();
    }, "保存しました");
  };

  return (
    <section className="card">
      <h2>基本情報</h2>
      <form onSubmit={submit} className="form">
        <label>
          施設名
          <input value={form.name} onChange={set("name")} required maxLength={50} />
        </label>
        <div className="row">
          <label>
            チェックイン時刻
            <input type="time" value={form.checkinTime} onChange={set("checkinTime")} required />
          </label>
          <label>
            チェックアウト時刻
            <input type="time" value={form.checkoutTime} onChange={set("checkoutTime")} required />
          </label>
        </div>
        <label>
          事業者名（個人情報の取り扱いの文面に入ります）
          <input value={form.operatorName} onChange={set("operatorName")} maxLength={100} />
        </label>
        <label>
          問い合わせ先（同上）
          <input value={form.operatorContact} onChange={set("operatorContact")} maxLength={200} />
        </label>
        <button className="button primary" type="submit">
          保存
        </button>
      </form>
      <Message message={message} />
    </section>
  );
}

function EmailListSection(props: { title: string; description: string; endpoint: string; listKey: string }) {
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const { message, run } = useMessage();

  const load = () => api<Record<string, EmailRow[]>>(props.endpoint).then((r) => setRows(r[props.listKey]));
  useEffect(() => {
    load();
  }, []);

  const add = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api(props.endpoint, { method: "POST", body: { email, name } });
      setEmail("");
      setName("");
      await load();
    }, "追加しました");
  };

  const remove = (target: string) => {
    if (!confirm(`${target} を削除しますか？`)) return;
    run(async () => {
      await api(`${props.endpoint}/${encodeURIComponent(target)}`, { method: "DELETE" });
      await load();
    }, "削除しました");
  };

  return (
    <section className="card">
      <h2>{props.title}</h2>
      <p className="note">{props.description}</p>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.email}>
            <span>
              {r.email}
              {r.name && <small>（{r.name}）</small>}
            </span>
            <button className="link danger" onClick={() => remove(r.email)}>
              削除
            </button>
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

function GoogleSection({ google }: { google: SettingsResponse["google"] }) {
  const { message, run } = useMessage();
  const params = new URLSearchParams(location.search);
  const linkedNow = params.get("linked") === "1";
  const error = params.get("error");

  return (
    <section className="card">
      <h2>Google ドライブ・Gmail との連携</h2>
      <p className="note">
        写真の保存と通知メールの送信に <strong>{google.serviceEmail}</strong> を使います。代表の管理者が、自分のスマホで
        {google.serviceEmail} にログインして許可してください。
      </p>
      {linkedNow && <p className="notice">連携しました。</p>}
      {error && <p className="alert">{error}</p>}
      <dl className="status">
        <dt>状態</dt>
        <dd>{google.linked ? (google.lastError ? "エラー" : "連携済み") : "未連携"}</dd>
        <dt>アカウント</dt>
        <dd>{google.accountEmail ?? "—"}</dd>
        <dt>連携した日時</dt>
        <dd>{formatDate(google.linkedAt)}</dd>
        <dt>写真の保存先フォルダ</dt>
        <dd>{google.driveFolderReady ? "作成済み（TAMAHOUSE宿泊者写真）" : "未作成"}</dd>
      </dl>
      {google.lastError && <p className="alert">{google.lastError}</p>}
      <div className="actions">
        <a className="button primary" href="/auth/google/link">
          {google.linked ? "Google と連携し直す" : "Google と連携"}
        </a>
        {google.linked && (
          <button className="button" onClick={() => run(() => api("/api/admin/google/test-mail", { method: "POST" }), "テストメールを送りました")}>
            テストメールを送る
          </button>
        )}
      </div>
      <Message message={message} />
    </section>
  );
}

function SessionsSection() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const { message, run } = useMessage();
  const load = () => api<{ sessions: SessionRow[] }>("/api/admin/sessions").then((r) => setRows(r.sessions));
  useEffect(() => {
    load();
  }, []);

  const revoke = (id: string) => {
    if (!confirm("この端末をログアウトさせますか？")) return;
    run(async () => {
      await api(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    }, "ログアウトさせました");
  };

  return (
    <section className="card">
      <h2>ログイン中の端末</h2>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.id}>
            <span>
              {r.email}
              <small>
                {" "}
                {r.user_agent ?? "不明な端末"} ／ 最終利用 {formatDate(r.last_seen_at)}
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

export function SettingsPage({ me }: { me: { email: string } }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const load = () => api<SettingsResponse>("/api/admin/settings").then(setSettings);
  useEffect(() => {
    load();
  }, []);

  if (!settings) return <p className="note">読み込み中…</p>;
  return (
    <div className="stack">
      <p className="note">ログイン中: {me.email}</p>
      <GoogleSection google={settings.google} />
      <BasicSection initial={settings.property} onSaved={load} />
      <EmailListSection
        title="通知メールの宛先"
        description="登録したすべてのアドレスに、通知メールを 1 通で送ります。"
        endpoint="/api/admin/recipients"
        listKey="recipients"
      />
      <EmailListSection
        title="ログインできるアカウント"
        description="管理画面にログインできる Google アカウントです。最後の 1 件は削除できません。"
        endpoint="/api/admin/accounts"
        listKey="accounts"
      />
      <SessionsSection />
    </div>
  );
}
