import { type ReactNode, useEffect, useState } from "react";
import type { SetupStatus, SetupStepKey } from "../../shared/api-types";
import { SETUP_STEPS } from "../../shared/setup";
import { api } from "../lib/api";
import { EmailListSection } from "../account/common";
import { BasicSection, DevicesSection, GoogleSection, IcalSection, type SettingsResponse } from "./SettingsPage";


/**
 * 初期設定（最初に 1 回行う設定）。上から順に設定してもらい、済んだ項目に印を付ける。
 * 後から変更するときもこの画面を使う
 */
export function SetupPage({ onPropertySaved }: { onPropertySaved: () => void }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const loadSettings = () => api<SettingsResponse>("/api/admin/settings").then(setSettings);
  const loadStatus = () => api<SetupStatus>("/api/admin/setup").then(setStatus);
  useEffect(() => {
    loadSettings();
    loadStatus();
  }, []);

  if (!settings || !status) return <p className="note">読み込み中…</p>;

  const step = (key: SetupStepKey, children: ReactNode) => {
    const index = SETUP_STEPS.findIndex((s) => s.key === key);
    return (
      <div id={`setup-${key}`} className="setup-step">
        <p className="setup-step-label">
          手順 {index + 1}
          <span className={status.steps[key] ? "setup-done" : "setup-todo"}>{status.steps[key] ? "設定済み" : "未設定"}</span>
        </p>
        {children}
      </div>
    );
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>初期設定</h2>
        <p className="note">上から順に設定してください。後から変更するときも、この画面を使います。</p>
        {status.pending.length === 0 ? (
          <p className="notice">必要な設定はすべて済んでいます。</p>
        ) : (
          <p className="alert">残り {status.pending.length} 項目です。設定が済むまで、宿泊者の受け付けを始めないでください。</p>
        )}
        <ol className="setup-progress">
          {SETUP_STEPS.map((s) => (
            <li key={s.key} className={status.steps[s.key] ? "done" : undefined}>
              <a href={`#setup-${s.key}`}>
                {s.label}
              </a>
              <span>{status.steps[s.key] ? "✓" : "—"}</span>
            </li>
          ))}
        </ol>
      </section>

      {step(
        "basic",
        <BasicSection
          initial={settings.property}
          onSaved={() => {
            loadSettings();
            loadStatus();
            onPropertySaved();
          }}
        />,
      )}
      {step(
        "recipients",
        <EmailListSection
          title="通知メールの宛先"
          description="予約の登録やチェックインがあったときに、登録したすべてのアドレスへ通知メールを 1 通で送ります。"
          endpoint="/api/admin/recipients"
          listKey="recipients"
          onChanged={loadStatus}
        />,
      )}
      {step("google", <GoogleSection google={settings.google} />)}
      {step("ical", <IcalSection onChanged={loadStatus} />)}
      {step("devices", <DevicesSection onChanged={loadStatus} />)}
    </div>
  );
}
