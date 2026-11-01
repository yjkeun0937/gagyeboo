import { addMonths, clampDay, monthNum, pad, yearNum } from './dates';
import type { FixedSchedule } from './types';

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

/** 월 범위(양 끝 포함), 오래된 순 */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ym = from; ym <= to; ym = addMonths(ym, 1)) out.push(ym);
  return out;
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
