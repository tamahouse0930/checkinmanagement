import { useEffect, useState, type FormEvent } from "react";
import { LANG_NAME, LANGS, type Lang } from "../../shared/langs";
import { TEXT_KIND_LABEL, TEXT_KINDS, TEXT_PLACEHOLDERS, type TextKind } from "../../shared/templates";
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

interface IcalSourceRow {
  id: string;
  channel: "airbnb" | "booking";
  url: string;
  last_synced_at: string | null;
  last_error: string | null;
}

const ICAL_CHANNELS = [
  { channel: "airbnb", label: "Airbnb", help: "Airbnb のリスティングの「カレンダーの同期」→「カレンダーをエクスポート」で表示される URL" },
  { channel: "booking", label: "Booking.com", help: "Booking.com の「料金・在庫」→「カレンダーの同期」→「カレンダーをエクスポート」で表示される URL" },
] as const;

/** iCal の URL は予約の情報を読める鍵のようなものなので、一覧では一部だけを表示する */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}/…${url.slice(-6)}`;
  } catch {
    return "…";
  }
}

function IcalSection() {
  const [rows, setRows] = useState<IcalSourceRow[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const { message, run } = useMessage();
  const load = () => api<{ sources: IcalSourceRow[] }>("/api/admin/ical-sources").then((r) => setRows(r.sources));
  useEffect(() => {
    load();
  }, []);

  const save = (channel: "airbnb" | "booking", existing?: IcalSourceRow) => {
    const url = (inputs[channel] ?? "").trim();
    run(async () => {
      if (existing) await api(`/api/admin/ical-sources/${existing.id}`, { method: "PUT", body: { url } });
      else await api("/api/admin/ical-sources", { method: "POST", body: { channel, url } });
      setInputs({ ...inputs, [channel]: "" });
      await load();
    }, "保存しました。カレンダーの「最新化」で取り込めます");
  };

  return (
    <section className="card">
      <h2>予約の取り込み（iCal）</h2>
      <p className="note">毎朝 5 時に自動で取り込みます。カレンダーの「最新化」ですぐに取り込むこともできます。</p>
      {ICAL_CHANNELS.map(({ channel, label, help }) => {
        const existing = rows.find((r) => r.channel === channel);
        return (
          <div key={channel} className="ical-row">
            <h3>{label}</h3>
            {existing ? (
              <dl className="status">
                <dt>登録済みの URL</dt>
                <dd>{maskUrl(existing.url)}</dd>
                <dt>最後に取り込んだ日時</dt>
                <dd>{formatDate(existing.last_synced_at)}</dd>
                {existing.last_error && (
                  <>
                    <dt>エラー</dt>
                    <dd className="alert">{existing.last_error}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="note">未登録</p>
            )}
            <form
              className="form inline"
              onSubmit={(e) => {
                e.preventDefault();
                save(channel, existing);
              }}
            >
              <input
                type="url"
                placeholder={existing ? "新しい URL（変更する場合）" : "iCal の URL"}
                value={inputs[channel] ?? ""}
                onChange={(e) => setInputs({ ...inputs, [channel]: e.target.value })}
                required
              />
              <button className="button" type="submit">
                {existing ? "変更" : "登録"}
              </button>
            </form>
            <p className="note">{help}</p>
          </div>
        );
      })}
      <Message message={message} />
    </section>
  );
}

/** 案内文・ハウスルールなどの文面（言語ごと）。空にして保存すると既定の文面に戻る */
function TextsSection() {
  const [data, setData] = useState<{ texts: Record<string, string>; defaults: Record<string, Record<Lang, string>> } | null>(null);
  const [kind, setKind] = useState<TextKind>("invite");
  const [lang, setLang] = useState<Lang>("ja");
  const [body, setBody] = useState("");
  const { message, run } = useMessage();

  const load = () => api<NonNullable<typeof data>>("/api/admin/texts").then(setData);
  useEffect(() => {
    load();
  }, []);

  const current = data?.texts[`${kind}:${lang}`];
  const fallback = data?.defaults[kind]?.[lang] ?? "";
  useEffect(() => {
    setBody(current ?? fallback);
  }, [data, kind, lang]);

  const save = () =>
    run(async () => {
      await api("/api/admin/texts", { method: "PUT", body: { kind, lang, body: body === fallback ? "" : body } });
      await load();
    }, "保存しました");

  const reset = () =>
    run(async () => {
      await api("/api/admin/texts", { method: "PUT", body: { kind, lang, body: "" } });
      await load();
    }, "既定の文面に戻しました");

  return (
    <section className="card">
      <h2>文面</h2>
      <p className="note">案内文は予約詳細でコピーして使います。ハウスルールはゲストの同意画面に、連絡方法はタブレットに表示します。</p>
      <div className="form">
        <div className="row">
          <label>
            種類
            <select value={kind} onChange={(e) => setKind(e.target.value as TextKind)}>
              {TEXT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TEXT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            言語
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAME[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {TEXT_PLACEHOLDERS[kind] && <p className="note">差し込み: {TEXT_PLACEHOLDERS[kind]}</p>}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={3000} />
        <p className="note">
          {current ? "編集済みの文面です。" : fallback ? "既定の文面です。" : "未設定です（他の言語の文面がある場合は、英語・日本語の順に代わりに使います）。"}
        </p>
        <div className="actions">
          <button className="button primary" onClick={save}>
            保存
          </button>
          {current && (
            <button className="button" onClick={reset}>
              {fallback ? "既定の文面に戻す" : "削除"}
            </button>
          )}
        </div>
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
      <IcalSection />
      <BasicSection initial={settings.property} onSaved={load} />
      <TextsSection />
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
