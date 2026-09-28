import { useEffect, useState } from "react";
import type { CalendarResponse, ReservationSummary, SyncResponse } from "../../shared/api-types";
import { addDays, addMonths, diffDays, monthRange, weekdayOf } from "../../shared/dates";
import { ATTENTION_KEYS, ATTENTION_LABEL, CHANNEL_LABEL, PROGRESS_LABEL, type ProgressKey } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

const WEEK_HEAD = ["月", "火", "水", "木", "金", "土", "日"];
const CHANNEL_SHORT = { airbnb: "Airbnb", booking: "Booking", other: "" } as const;

/** 月曜始まりの週の一覧 */
function weeksOf(month: string): string[][] {
  const { start, end } = monthRange(month);
  let cursor = addDays(start, -((weekdayOf(start) + 6) % 7));
  const weeks: string[][] = [];
  while (cursor <= end) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

interface Segment {
  r: ReservationSummary;
  col: number;
  span: number;
  lane: number;
}

/** 1 週間分の帯。宿泊する夜（チェックイン日〜チェックアウト日の前日）に表示し、重ならないように段を分ける */
function segmentsOf(week: string[], reservations: ReservationSummary[]): Segment[] {
  const weekStart = week[0];
  const weekEnd = week[6];
  const lanes: string[] = []; // 各段の最後の日
  const segments: Segment[] = [];
  for (const r of reservations) {
    const lastNight = addDays(r.checkOutDate, -1);
    const start = r.checkInDate > weekStart ? r.checkInDate : weekStart;
    const end = lastNight < weekEnd ? lastNight : weekEnd;
    if (start > end) continue;
    let lane = lanes.findIndex((last) => last < start);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(end);
    } else {
      lanes[lane] = end;
    }
    segments.push({ r, col: diffDays(weekStart, start) + 1, span: diffDays(start, end) + 1, lane });
  }
  return segments;
}

function barLabel(r: ReservationSummary): string {
  const name = r.label ?? r.reservationCode ?? "";
  const channel = CHANNEL_SHORT[r.channel];
  if (r.status === "blocked") return "ブロック";
  return [r.isTest ? "テスト" : channel, name].filter(Boolean).join(" ") || CHANNEL_LABEL[r.channel];
}

const LEGEND: ProgressKey[] = ["url_unsent", "in_progress", "pending", "approved", "in_house", "checked_out", "blocked"];

export function CalendarPage() {
  const [month, setMonth] = useState(() => new URLSearchParams(location.search).get("month") ?? "");
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = (m: string) =>
    api<CalendarResponse>(`/api/admin/calendar${m ? `?month=${m}` : ""}`)
      .then((d) => {
        setData(d);
        setMonth(d.month);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load(month);
  }, []);

  const changeMonth = (delta: number) => {
    const next = addMonths(month, delta);
    history.replaceState(null, "", `/admin?month=${next}`);
    load(next);
  };

  const sync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await api<SyncResponse>("/api/admin/reservations/sync", { method: "POST" });
      if (res.results.length === 0) {
        setSyncMessage("iCal の URL が登録されていません（設定画面から登録してください）");
      } else {
        setSyncMessage(
          res.results
            .map((r) =>
              r.error
                ? `${CHANNEL_LABEL[r.channel]}: ${r.error}`
                : `${CHANNEL_LABEL[r.channel]}: 追加 ${r.added}件・更新 ${r.updated}件・キャンセル ${r.cancelled}件`,
            )
            .join(" ／ "),
        );
      }
      await load(month);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (error) return <p className="alert">{error}</p>;
  if (!data) return <p className="note">読み込み中…</p>;

  // キャンセルもカレンダーに残し、取り消し線で表示する（気付けるように）
  const visible = data.reservations;
  const [y, m] = data.month.split("-");

  return (
    <div className="stack">
      {data.alerts.map((a) => (
        <p key={a} className="alert">
          {a}
        </p>
      ))}

      <div className="attention">
        {ATTENTION_KEYS.map((k) => (
          <span key={k} className={`chip${data.attention[k] > 0 ? " warn" : ""}`}>
            {ATTENTION_LABEL[k]} <strong>{data.attention[k]}</strong>
          </span>
        ))}
      </div>

      <div className="calendar-toolbar">
        <button className="button" onClick={() => changeMonth(-1)} aria-label="前の月">
          ◀
        </button>
        <strong className="month-title">
          {y}年{Number(m)}月
        </strong>
        <button className="button" onClick={() => changeMonth(1)} aria-label="次の月">
          ▶
        </button>
        <span className="spacer" />
        <button className="button" onClick={sync} disabled={syncing}>
          {syncing ? "取り込み中…" : "最新化"}
        </button>
        <button className="button" onClick={() => navigate("/admin/reservations/new?test=1")}>
          テスト予約
        </button>
        <button className="button primary" onClick={() => navigate("/admin/reservations/new")}>
          ＋ 宿泊を登録
        </button>
      </div>
      {syncMessage && <p className="notice">{syncMessage}</p>}

      <div className="calendar">
        <div className="calendar-head">
          {WEEK_HEAD.map((d, i) => (
            <div key={d} className={i === 5 ? "sat" : i === 6 ? "sun" : undefined}>
              {d}
            </div>
          ))}
        </div>
        {weeksOf(data.month).map((week) => {
          const segments = segmentsOf(week, visible);
          const lanes = segments.reduce((max, s) => Math.max(max, s.lane + 1), 0);
          return (
            <div key={week[0]} className="calendar-week" style={{ gridTemplateRows: `auto repeat(${lanes}, 26px) 8px` }}>
              {week.map((date, i) => (
                <button
                  key={date}
                  className={[
                    "day",
                    date.slice(0, 7) !== data.month ? "other-month" : "",
                    date === data.today ? "today" : "",
                    i === 5 ? "sat" : i === 6 ? "sun" : "",
                  ].join(" ")}
                  style={{ gridColumn: i + 1, gridRow: `1 / span ${lanes + 2}` }}
                  onClick={() => navigate(`/admin/reservations/new?date=${date}`)}
                  title={`${date} に宿泊を登録`}
                >
                  {Number(date.slice(8))}
                </button>
              ))}
              {segments.map((s) => (
                <a
                  key={`${s.r.id}-${week[0]}`}
                  href={`/admin/reservations/${s.r.id}`}
                  className={`bar p-${s.r.progress}${s.r.isTest ? " test" : ""}`}
                  style={{ gridColumn: `${s.col} / span ${s.span}`, gridRow: s.lane + 2 }}
                  title={`${barLabel(s.r)}（${PROGRESS_LABEL[s.r.progress]}）`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/admin/reservations/${s.r.id}`);
                  }}
                >
                  {barLabel(s.r)}
                </a>
              ))}
            </div>
          );
        })}
      </div>

      <div className="legend">
        {LEGEND.map((k) => (
          <span key={k}>
            <i className={`swatch p-${k}`} />
            {PROGRESS_LABEL[k]}
          </span>
        ))}
        <span>
          <i className="swatch test" />
          テスト
        </span>
      </div>
      <p className="note">
        日付を押すと、その日からの宿泊を登録できます。帯は宿泊する夜（チェックイン日〜チェックアウト日の前日）に表示しています。
      </p>
    </div>
  );
}
