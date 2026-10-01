import { useEffect, useRef, useState } from "react";

/** ドラムロールの 1 行の高さ（px）。CSS の .wheel-item と合わせる */
const ITEM_H = 40;

/** その年・月の日数 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * ドラムロールの 1 列。指で回すと、止まった位置の行を選ぶ（scroll-snap で行の中央に止める）。
 * 行を押すと、その行まで回る
 */
function Wheel(props: { values: number[]; index: number; onChange: (index: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  // 選んでいる行が変わったとき（開いたとき、日の数が変わったとき）は、その行まで回しておく
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - props.index * ITEM_H) > 1) el.scrollTop = props.index * ITEM_H;
  }, [props.index, props.values.length]);

  // 回し終わってから選ぶ（回している途中の値では選ばない）
  const onScroll = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(props.values.length - 1, Math.round(el.scrollTop / ITEM_H)));
      if (i !== props.index) props.onChange(i);
    }, 120);
  };

  return (
    <div className="wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={props.label}>
      {props.values.map((v, i) => (
        <div
          key={v}
          role="option"
          aria-selected={i === props.index}
          className={i === props.index ? "wheel-item on" : "wheel-item"}
          onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" })}
        >
          {v}
        </div>
      ))}
    </div>
  );
}

/**
 * 生年月日の入力（ドラムロール）。欄を押すと画面の下に年・月・日の 3 列のドラムロールを出し、「決定」で確定する。
 * 確定するまでは未入力（空文字）のまま。年はチェックイン日の年から 120 年前まで（入力チェックの範囲と同じ）
 */
export function BirthDateSelect(props: {
  value: string;
  checkInDate: string;
  lang: string;
  labels: { year: string; month: string; day: string; placeholder: string; ok: string; cancel: string };
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const lastYear = Number(props.checkInDate.slice(0, 4));
  const years = range(lastYear - 120, lastYear);
  const months = range(1, 12);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ y: lastYear - 30, m: 1, d: 1 });

  const start = () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(props.value);
    // 未入力のときは 30 歳くらいの年から回し始める
    setDraft(m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : { y: lastYear - 30, m: 1, d: 1 });
    setOpen(true);
  };

  const days = range(1, daysInMonth(draft.y, draft.m));
  // 年・月を変えて、選んでいた日がその月にない（2 月 30 日など）ときは月末にする。
  // 複数の列を続けて回しても上書きし合わないよう、直前の値から計算する
  type Draft = { y: number; m: number; d: number };
  const set = (change: (prev: Draft) => Partial<Draft>) =>
    setDraft((prev) => {
      const next = { ...prev, ...change(prev) };
      return { ...next, d: Math.min(next.d, daysInMonth(next.y, next.m)) };
    });

  const confirm = () => {
    props.onChange(`${draft.y}-${pad(draft.m)}-${pad(draft.d)}`);
    setOpen(false);
  };

  const shown = /^\d{4}-\d{2}-\d{2}$/.test(props.value)
    ? new Intl.DateTimeFormat(props.lang, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${props.value}T00:00:00Z`))
    : null;

  return (
    <>
      <button type="button" className="birth-date-field" onClick={start} disabled={props.disabled}>
        {shown ?? <span className="placeholder">{props.labels.placeholder}</span>}
      </button>
      {open && (
        <div className="picker-backdrop" onClick={() => setOpen(false)}>
          <div className="picker-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="picker-actions">
              <button type="button" className="link" onClick={() => setOpen(false)}>
                {props.labels.cancel}
              </button>
              <button type="button" className="link strong" onClick={confirm}>
                {props.labels.ok}
              </button>
            </div>
            <div className="picker-heads">
              <span>{props.labels.year}</span>
              <span>{props.labels.month}</span>
              <span>{props.labels.day}</span>
            </div>
            <div className="picker-wheels">
              <Wheel values={years} index={years.indexOf(draft.y)} onChange={(i) => set(() => ({ y: years[i] }))} label={props.labels.year} />
              <Wheel values={months} index={draft.m - 1} onChange={(i) => set(() => ({ m: i + 1 }))} label={props.labels.month} />
              <Wheel values={days} index={draft.d - 1} onChange={(i) => set(() => ({ d: i + 1 }))} label={props.labels.day} />
              <div className="picker-band" aria-hidden="true" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
