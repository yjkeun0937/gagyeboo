import { addMonths, addDays, daysInMonth, monthNum, pad, weekdayIndex, ymOf } from './dates';
import { isCounted } from './calc';
import type { Entry, ID } from './types';

/** 통계는 [보류]를 모두 제외하고 [예정]은 포함한다 (기획서 5.4). */
export function counted(entries: Entry[], today: string): Entry[] {
  return entries.filter((e) => isCounted(e, today));
}

export interface Slice {
  key: ID | null;
  total: number;
  count: number;
}

/** 키별 합계, 금액 큰 순 */
export function sumBy(entries: Entry[], pick: (e: Entry) => ID | null): Slice[] {
  const m = new Map<ID | null, Slice>();
  for (const e of entries) {
    const k = pick(e);
    const s = m.get(k) ?? { key: k, total: 0, count: 0 };
    s.total += e.amount;
    s.count++;
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

export interface StoreStat {
  store: string;
  count: number;
  total: number;
}

export function topStores(entries: Entry[], limit = 10): StoreStat[] {
  const m = new Map<string, StoreStat>();
  for (const e of entries) {
    const k = e.store.trim();
    if (!k) continue;
    const s = m.get(k) ?? { store: k, count: 0, total: 0 };
    s.count++;
    s.total += e.amount;
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.count - a.count).slice(0, limit);
}

export interface WeekdayStat {
  /** 0 = 일 … 6 = 토 */
  idx: number;
  total: number;
  /** 집계 기간 안에 그 요일이 몇 번 있었는가 */
  days: number;
  avg: number;
}

export interface CategoryDelta {
  key: ID | null;
  cur: number;
  prev: number;
  diff: number;
}

export interface MonthStats {
  ym: string;
  total: number;
  count: number;
  byCategory: Slice[];
  byUser: Slice[];
  byPayMethod: Slice[];
  /** 지불수단별 결제상세 합계 (키: 지불수단 ID, null = 지불수단 미지정) */
  byDetail: Map<ID | null, Slice[]>;
  /** 1일부터 말일까지의 일 합계 */
  daily: number[];
  /** 일 합계가 의미 있는 마지막 날(이번 달이면 오늘 또는 마지막 내역 날짜, 그 밖의 달은 말일) */
  lastDay: number;
  cumulative: number[];
  weekday: WeekdayStat[];
  topStores: StoreStat[];
  prevTotal: number;
  deltas: CategoryDelta[];
}

export function monthStats(all: Entry[], ym: string, today: string): MonthStats {
  const live = counted(all, today);
  const cur = live.filter((e) => ymOf(e.date) === ym);
  const prevYm = addMonths(ym, -1);
  const prev = live.filter((e) => ymOf(e.date) === prevYm);

  const dim = daysInMonth(ym);
  const daily = Array.from({ length: dim }, () => 0);
  let lastEntryDay = 0;
  for (const e of cur) {
    const d = Number(e.date.slice(8, 10));
    daily[d - 1] += e.amount;
    lastEntryDay = Math.max(lastEntryDay, d);
  }
  const isCurrent = ymOf(today) === ym;
  const lastDay = isCurrent ? Math.min(dim, Math.max(Number(today.slice(8, 10)), lastEntryDay)) : dim;
  const cumulative: number[] = [];
  let run = 0;
  for (let d = 1; d <= lastDay; d++) {
    run += daily[d - 1];
    cumulative.push(run);
  }

  const wk = Array.from({ length: 7 }, (_, idx) => ({ idx, total: 0, days: 0, avg: 0 }));
  for (let d = 1; d <= lastDay; d++) {
    const w = weekdayIndex(`${ym}-${pad(d)}`);
    wk[w].days++;
    wk[w].total += daily[d - 1];
  }
  for (const w of wk) w.avg = w.days ? w.total / w.days : 0;

  const byDetail = new Map<ID | null, Slice[]>();
  const methods = new Set(cur.map((e) => e.payMethod));
  for (const m of methods) {
    byDetail.set(
      m,
      sumBy(
        cur.filter((e) => e.payMethod === m),
        (e) => e.payDetail,
      ),
    );
  }

  const curCat = new Map(sumBy(cur, (e) => e.category).map((s) => [s.key, s.total]));
  const prevCat = new Map(sumBy(prev, (e) => e.category).map((s) => [s.key, s.total]));
  const keys = new Set([...curCat.keys(), ...prevCat.keys()]);
  const deltas: CategoryDelta[] = [...keys]
    .map((key) => {
      const c = curCat.get(key) ?? 0;
      const p = prevCat.get(key) ?? 0;
      return { key, cur: c, prev: p, diff: c - p };
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    ym,
    total: cur.reduce((a, e) => a + e.amount, 0),
    count: cur.length,
    byCategory: sumBy(cur, (e) => e.category),
    byUser: sumBy(cur, (e) => e.user),
    byPayMethod: sumBy(cur, (e) => e.payMethod),
    byDetail,
    daily,
    lastDay,
    cumulative,
    weekday: wk,
    topStores: topStores(cur, 10),
    prevTotal: prev.reduce((a, e) => a + e.amount, 0),
    deltas,
  };
}

export interface YearRow {
  category: ID | null;
  /** 1월 … 12월 */
  months: number[];
  total: number;
  avg: number;
  share: number;
}

export interface YearStats {
  year: number;
  rows: YearRow[];
  monthTotals: number[];
  total: number;
  /** 월평균의 기준이 되는 월 수 */
  monthsCounted: number;
  avg: number;
  /** 올해 가장 지출이 많은 달(1~12), 없으면 0 */
  peakMonth: number;
}

/**
 * 엑셀 `월별분류별` 시트에 해당하는 분류 × 월 표.
 * 월평균 = 연 합계 ÷ (지난 해는 12, 올해는 이번 달까지, 미래 해는 내역이 있는 마지막 달까지).
 * 행 순서는 categoryOrder(설정의 분류 순서)를 따르고, 미분류는 맨 아래.
 */
export function yearStats(all: Entry[], year: number, today: string, categoryOrder: ID[]): YearStats {
  const live = counted(all, today).filter((e) => e.date.startsWith(`${year}-`));
  const map = new Map<ID | null, number[]>();
  const monthTotals = Array.from({ length: 12 }, () => 0);
  let lastMonthWithData = 0;
  for (const e of live) {
    const m = monthNum(ymOf(e.date)) - 1;
    const arr = map.get(e.category) ?? Array.from({ length: 12 }, () => 0);
    arr[m] += e.amount;
    map.set(e.category, arr);
    monthTotals[m] += e.amount;
    lastMonthWithData = Math.max(lastMonthWithData, m + 1);
  }
  const ty = Number(today.slice(0, 4));
  const monthsCounted = year < ty ? 12 : year === ty ? monthNum(ymOf(today)) : Math.max(1, lastMonthWithData);
  const total = monthTotals.reduce((a, b) => a + b, 0);

  const order = new Map(categoryOrder.map((id, i) => [id, i]));
  const keys = [...map.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return (order.get(a) ?? 999) - (order.get(b) ?? 999);
  });
  const rows: YearRow[] = keys.map((category) => {
    const months = map.get(category)!;
    const t = months.reduce((a, b) => a + b, 0);
    return { category, months, total: t, avg: t / monthsCounted, share: total ? t / total : 0 };
  });
  const peak = monthTotals.reduce((best, v, i) => (v > monthTotals[best] ? i : best), 0);
  return {
    year,
    rows,
    monthTotals,
    total,
    monthsCounted,
    avg: total / monthsCounted,
    peakMonth: total > 0 ? peak + 1 : 0,
  };
}

export interface RangeFilter {
  category: ID | 'none' | null;
  user: ID | 'none' | null;
  payMethod: ID | 'none' | null;
}

export interface RangeStats {
  entries: Entry[];
  total: number;
  count: number;
  days: number;
  dailyAvg: number;
  byCategory: Slice[];
}

const match = (v: ID | null, f: ID | 'none' | null) => f === null || (f === 'none' ? v === null : v === f);

/** 시작일~종료일(양 끝 포함) 합계. 날짜가 거꾸로면 바꿔서 계산한다. */
export function rangeStats(
  all: Entry[],
  startIn: string,
  endIn: string,
  today: string,
  f: RangeFilter,
): RangeStats {
  const [start, end] = startIn <= endIn ? [startIn, endIn] : [endIn, startIn];
  const list = counted(all, today)
    .filter(
      (e) =>
        e.date >= start &&
        e.date <= end &&
        match(e.category, f.category) &&
        match(e.user, f.user) &&
        match(e.payMethod, f.payMethod),
    )
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.createdAt - a.createdAt));
  const total = list.reduce((a, e) => a + e.amount, 0);
  let days = 1;
  for (let d = start; d < end; d = addDays(d, 1)) days++;
  return {
    entries: list,
    total,
    count: list.length,
    days,
    dailyAvg: total / days,
    byCategory: sumBy(list, (e) => e.category),
  };
}
