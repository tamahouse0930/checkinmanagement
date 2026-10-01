import { useEffect, useState } from "react";

/** その年・月の日数 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 生年月日の入力（年・月・日の 3 つの選択欄）。スマホでは選択欄がロール（回して選ぶ形）になり、
 * カレンダーで何十年も前まで戻るより入れやすい。3 つそろったときだけ YYYY-MM-DD を返し、それまでは空文字を返す。
 * 年はチェックイン日の年から 120 年前まで（入力チェックの範囲と同じ）を新しい順に並べる
 */
export function BirthDateSelect(props: {
  value: string;
  checkInDate: string;
  labels: { year: string; month: string; day: string };
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const parse = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : null;
  };
  // 途中まで選んだ状態（年だけ、など）は画面の中だけで持つ
  const [parts, setParts] = useState(() => parse(props.value) ?? { y: "", m: "", d: "" });
  useEffect(() => {
    const p = parse(props.value);
    if (p) setParts(p);
  }, [props.value]);

  const lastYear = Number(props.checkInDate.slice(0, 4));
  const years = Array.from({ length: 121 }, (_, i) => lastYear - i);
  const days = parts.y && parts.m ? daysInMonth(Number(parts.y), Number(parts.m)) : 31;

  const update = (next: { y: string; m: string; d: string }) => {
    // 月を変えて日がその月にない日（2 月 30 日など）になったら、日を選び直してもらう
    const fixed = next.y && next.m && next.d && Number(next.d) > daysInMonth(Number(next.y), Number(next.m)) ? { ...next, d: "" } : next;
    setParts(fixed);
    props.onChange(fixed.y && fixed.m && fixed.d ? `${fixed.y}-${pad(Number(fixed.m))}-${pad(Number(fixed.d))}` : "");
  };

  return (
    <div className="birth-date">
      <select value={parts.y} onChange={(e) => update({ ...parts, y: e.target.value })} disabled={props.disabled} aria-label={props.labels.year}>
        <option value="">{props.labels.year}</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select value={parts.m} onChange={(e) => update({ ...parts, m: e.target.value })} disabled={props.disabled} aria-label={props.labels.month}>
        <option value="">{props.labels.month}</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select value={parts.d} onChange={(e) => update({ ...parts, d: e.target.value })} disabled={props.disabled} aria-label={props.labels.day}>
        <option value="">{props.labels.day}</option>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}
