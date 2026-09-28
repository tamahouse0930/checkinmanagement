import { useEffect, useState, type FormEvent } from "react";
import type { ReservationDetail } from "../../shared/api-types";
import { addDays, jstNow } from "../../shared/dates";
import type { Channel } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

interface FormState {
  checkInDate: string;
  checkOutDate: string;
  channel: Channel;
  bookerName: string;
  note: string;
}

/** 宿泊の手動登録・テスト予約の作成・手動登録の予約の編集（要件定義書 R-06、H-32） */
export function ReservationForm({ editId }: { editId?: string }) {
  const params = new URLSearchParams(location.search);
  const initialDate = params.get("date") ?? jstNow().date;
  const [isTest, setIsTest] = useState(false);
  const [form, setForm] = useState<FormState>({
    checkInDate: initialDate,
    checkOutDate: addDays(initialDate, 1),
    channel: "other",
    bookerName: "",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) return;
    api<ReservationDetail>(`/api/admin/reservations/${editId}`).then((r) => {
      setIsTest(r.isTest);
      setForm({
        checkInDate: r.checkInDate,
        checkOutDate: r.checkOutDate,
        channel: r.channel,
        bookerName: r.bookerName ?? "",
        note: r.note ?? "",
      });
    });
  }, [editId]);

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      // チェックイン日を後ろにずらしたら、チェックアウト日も合わせる
      if (key === "checkInDate" && next.checkOutDate <= value) next.checkOutDate = addDays(value, 1);
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editId) {
        await api(`/api/admin/reservations/${editId}`, { method: "PATCH", body: form });
        navigate(`/admin/reservations/${editId}`);
      } else {
        const res = await api<{ id: string }>("/api/admin/reservations", { method: "POST", body: { ...form, isTest } });
        navigate(`/admin/reservations/${res.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2>{editId ? "宿泊の編集" : isTest ? "テスト予約の作成" : "宿泊の登録"}</h2>
      <form onSubmit={submit} className="form">
        <div className="row">
          <label>
            チェックイン日
            <input type="date" value={form.checkInDate} onChange={set("checkInDate")} required />
          </label>
          <label>
            チェックアウト日
            <input type="date" value={form.checkOutDate} onChange={set("checkOutDate")} min={addDays(form.checkInDate, 1)} required />
          </label>
        </div>
        <label>
          予約経路
          <select value={form.channel} onChange={set("channel")}>
            <option value="other">その他（直接の予約など）</option>
            <option value="airbnb">Airbnb</option>
            <option value="booking">Booking.com</option>
          </select>
        </label>
        <label>
          代表者名（カレンダーに表示します）
          <input value={form.bookerName} onChange={set("bookerName")} maxLength={50} />
        </label>
        <label>
          メモ
          <textarea value={form.note} onChange={set("note")} maxLength={500} rows={3} />
        </label>
        {error && <p className="alert">{error}</p>}
        <div className="actions">
          <button className="button primary" type="submit" disabled={saving}>
            {editId ? "保存" : "登録"}
          </button>
          <button className="button" type="button" onClick={() => history.back()}>
            キャンセル
          </button>
          {!editId && (
            <label className="check inline">
              <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
              テスト予約にする
            </label>
          )}
        </div>
        {!editId && isTest && (
          <p className="note">テスト予約は、本番のタブレットや名簿に出さず、作成から 7 日後に自動で削除します。</p>
        )}
      </form>
    </section>
  );
}
