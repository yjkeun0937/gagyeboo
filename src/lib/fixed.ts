import { addMonths, clampDay, monthNum, pad, yearNum } from './dates';
import type { Entry, FixedItem, FixedMonthRun, FixedSchedule } from './types';

const monthIndex = (ym: string) => yearNum(ym) * 12 + (monthNum(ym) - 1);

/** 이 달에 해당하면 지정일(YYYY-MM-DD), 아니면 null. 31일처럼 없는 일자는 그 달 마지막 날로 보정 */
export function dueDate(s: FixedSchedule, ym: string): string | null {
  const day = s.day === 'last' ? 31 : s.day;
  switch (s.kind) {
    case 'monthly':
      return clampDay(ym, day);
    case 'months':
      return s.months.includes(monthNum(ym)) ? clampDay(ym, day) : null;
    case 'every': {
      const every = Math.max(1, Math.floor(s.every));
      const diff = monthIndex(ym) - monthIndex(s.baseYm);
      return ((diff % every) + every) % every === 0 ? clampDay(ym, day) : null;
    }
  }
}

/** 지정일 이후(당일 포함) 가장 가까운 다음 지정일. 3년 안에 없으면 null */
export function nextDue(s: FixedSchedule, from: string): string | null {
  let ym = from.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const d = dueDate(s, ym);
    if (d && d >= from) return d;
    ym = addMonths(ym, 1);
  }
  return null;
}

const dayText = (d: number | 'last') => (d === 'last' ? '말일' : `${d}일`);

export function describeSchedule(s: FixedSchedule): string {
  switch (s.kind) {
    case 'monthly':
      return `매월 ${dayText(s.day)}`;
    case 'months':
      return `${[...s.months].sort((a, b) => a - b).join('·')}월 ${dayText(s.day)}`;
    case 'every':
      return `${s.every}개월마다 ${dayText(s.day)} (기준 ${yearNum(s.baseYm)}년 ${monthNum(s.baseYm)}월)`;
  }
}

/** 고정지출에서 만든 내역의 ID. 두 기기에서 같은 달에 추가해도 한 건으로 합쳐진다. */
export function fixedEntryId(fixedId: string, ym: string): string {
  return `fx_${fixedId}_${ym.replace('-', '')}`;
}

export function runId(ym: string): string {
  return `run_${ym}`;
}

export interface PlanRow {
  item: FixedItem;
  date: string;
  /** 이미 이 달 내역이 만들어져 있음 */
  added: boolean;
}

export interface MonthPlan {
  ym: string;
  /** 이 달에 해당하는 사용 중 항목 (순서대로) */
  due: PlanRow[];
  /** 사용 중이지만 이 달에는 해당 없는 항목 */
  others: FixedItem[];
}

export function planMonth(items: FixedItem[], entries: Entry[], ym: string): MonthPlan {
  const live = new Set(entries.map((e) => e.id));
  const active = items.filter((i) => i.active).sort((a, b) => a.order - b.order);
  const due: PlanRow[] = [];
  const others: FixedItem[] = [];
  for (const item of active) {
    const date = dueDate(item.schedule, ym);
    if (date) due.push({ item, date, added: live.has(fixedEntryId(item.id, ym)) });
    else others.push(item);
  }
  return { ym, due, others };
}

/** 월 범위(양 끝 포함), 오래된 순 */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ym = from; ym <= to; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

/**
 * 월초 입력 창에서 처리해야 하는 달(오래된 순).
 * 앱 사용 시작 월부터 이번 달까지, 처리 기록이 없고 아직 추가하지 않은 해당 항목이 남아 있는 달만 포함한다.
 */
export function pendingMonths(
  firstUseYm: string,
  todayYm: string,
  runs: FixedMonthRun[],
  items: FixedItem[],
  entries: Entry[],
): string[] {
  if (firstUseYm > todayYm) return [];
  const done = new Set(runs.map((r) => r.ym));
  return monthsBetween(firstUseYm, todayYm).filter(
    (ym) => !done.has(ym) && planMonth(items, entries, ym).due.some((r) => !r.added),
  );
}

export const emptyScheduleFor = (kind: FixedSchedule['kind'], ym: string): FixedSchedule => {
  switch (kind) {
    case 'monthly':
      return { kind, day: 1 };
    case 'months':
      return { kind, months: [monthNum(ym)], day: 1 };
    case 'every':
      return { kind, every: 2, baseYm: ym, day: 'last' };
  }
};

export const ymLabel = (ym: string) => `${yearNum(ym)}-${pad(monthNum(ym))}`;
