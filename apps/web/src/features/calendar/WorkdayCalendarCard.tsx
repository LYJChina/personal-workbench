import { useCallback, useEffect, useMemo, useState } from "react";
import type { HolidayDay } from "@workbench/contracts";
import { api as sharedApi } from "../../lib/api";

export interface WorkdayCalendarApi {
  getCalendar(from: string, to: string): Promise<{ days: HolidayDay[]; coverage: Array<{ year: number; synchronizedAt: string }> }>;
  syncCalendar(years: number[]): Promise<{ updatedYears: number[]; unavailableYears: number[] }>;
}

function monthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(year, monthNumber, 0).getDate();
  return { year, monthNumber, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, last };
}

export function WorkdayCalendarCard({ api = sharedApi, initialMonth }: {
  api?: WorkdayCalendarApi;
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth ?? monthValue(new Date()));
  const [days, setDays] = useState<HolidayDay[]>([]);
  const [coverage, setCoverage] = useState<Array<{ year: number; synchronizedAt: string }>>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const bounds = useMemo(() => monthBounds(month), [month]);
  const load = useCallback(async () => {
    const result = await api.getCalendar(bounds.from, bounds.to);
    setDays(result.days);
    setCoverage(result.coverage);
  }, [api, bounds.from, bounds.to]);

  useEffect(() => { void load().catch(() => setFeedback("日历加载失败")); }, [load]);

  function move(offset: number) {
    setMonth(monthValue(new Date(bounds.year, bounds.monthNumber - 1 + offset, 1)));
  }

  async function synchronize() {
    setSyncing(true);
    try {
      const result = await api.syncCalendar([bounds.year, bounds.year + 1]);
      setFeedback(result.unavailableYears.length ? `已更新 ${result.updatedYears.join("、")}，${result.unavailableYears.join("、")} 年尚未发布` : "节假日已更新");
      await load();
    } catch {
      setFeedback("节假日更新失败，已保留本地数据");
    } finally {
      setSyncing(false);
    }
  }

  const overrideMap = new Map(days.map((day) => [day.localDate, day]));
  const firstWeekday = (new Date(Date.UTC(bounds.year, bounds.monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: firstWeekday + bounds.last }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const known = coverage.some((item) => item.year === bounds.year);

  return <section className="dashboard-card workday-calendar-card" aria-label="中国工作日日历">
    <header><div><span className="eyebrow">WORKDAY CALENDAR</span><h3>中国工作日日历</h3></div><button type="button" className="button-ghost" disabled={syncing} onClick={() => void synchronize()}>{syncing ? "更新中…" : "更新节假日"}</button></header>
    <div className="calendar-toolbar"><button type="button" aria-label="上个月" onClick={() => move(-1)}>‹</button><strong>{bounds.year} 年 {bounds.monthNumber} 月</strong><button type="button" aria-label="下个月" onClick={() => move(1)}>›</button><button type="button" onClick={() => setMonth(monthValue(new Date()))}>今天</button></div>
    <div className="calendar-weekdays">{["一","二","三","四","五","六","日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{cells.map((day, index) => {
      if (day === null) return <span key={`blank-${index}`} />;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const override = overrideMap.get(date);
      return <span key={date} className={override?.dayType ?? ""} aria-label={override ? `${date} ${override.name}` : date}><b>{day}</b>{override && <small>{override.dayType === "holiday" ? "休" : "班"}</small>}</span>;
    })}</div>
    <footer><span className={`status-chip ${known ? "" : "neutral"}`}>{known ? "本地数据已覆盖" : "本年度数据待更新"}</span>{feedback && <p role="status">{feedback}</p>}</footer>
  </section>;
}
