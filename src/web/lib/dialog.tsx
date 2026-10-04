import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * 画面の中に出す確認・入力のダイアログ。ブラウザの confirm / prompt は、端末の設定（Safari で「このサイトのダイアログを
 * 表示しない」を選んだ場合など）によっては何も表示されずに「キャンセル」扱いになり、ボタンを押しても何も起きなくなるため使わない
 */

let root: Root | null = null;

function render(node: React.ReactNode): void {
  if (!root) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root.render(node);
}

interface DialogOptions {
  /** 実行するボタンの文言（既定: OK） */
  okLabel?: string;
  /** 削除など、取り消せない操作は赤いボタンにする */
  danger?: boolean;
}

function Dialog(props: {
  message: string;
  options: DialogOptions;
  input?: { placeholder?: string; required: boolean };
  onClose: (value: string | null) => void;
}) {
  const [text, setText] = useState("");
  const ok = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (props.input ? field.current : ok.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const disabled = props.input?.required === true && !text.trim();
  return (
    <div className="dialog-backdrop" onClick={() => props.onClose(null)}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="dialog-message">{props.message}</p>
        {props.input && (
          <textarea ref={field} value={text} onChange={(e) => setText(e.target.value)} placeholder={props.input.placeholder} rows={3} maxLength={500} />
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => props.onClose(null)}>
            キャンセル
          </button>
          <button
            type="button"
            ref={ok}
            className={`button ${props.options.danger ? "danger-fill" : "primary"}`}
            disabled={disabled}
            onClick={() => props.onClose(props.input ? text.trim() : "ok")}
          >
            {props.options.okLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 確認のダイアログ。実行するなら true、キャンセルなら false */
export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    render(
      <Dialog
        message={message}
        options={options}
        onClose={(value) => {
          render(null);
          resolve(value !== null);
        }}
      />,
    );
  });
}

/** 文字を入力してもらうダイアログ（削除の理由など）。キャンセルなら null。required なら空では実行できない */
export function promptDialog(message: string, options: DialogOptions & { placeholder?: string; required?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    render(
      <Dialog
        message={message}
        options={options}
        input={{ placeholder: options.placeholder, required: options.required ?? true }}
        onClose={(value) => {
          render(null);
          resolve(value);
        }}
      />,
    );
  });
}
