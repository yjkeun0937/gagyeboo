/** 날짜는 항상 Asia/Seoul 기준의 'YYYY-MM-DD' 문자열로 저장·비교한다. */

const kst = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const pad = (n: number) => String(n).padStart(2, '0');

export function todayKST(now: Date = new Date()): string {
  return kst.format(now);
}

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayKo(date: string): string {
  return WEEKDAYS_KO[weekdayIndex(date)];
}

export function dayOf(date: string): number {
  return Number(date.slice(8, 10));
}

export function monthNum(ym: string): number {
  return Number(ym.slice(5, 7));
}

export function yearNum(ym: string): number {
  return Number(ym.slice(0, 4));
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(`${y}-${pad(m)}`);
}

/** 'M/D' */
export function formatMD(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** '2026년 10월' */
export function formatYm(ym: string): string {
  return `${yearNum(ym)}년 ${monthNum(ym)}월`;
}

/** 해당 월에 없는 일자(31일 등)는 그 달 마지막 날로 보정한다. */
export function clampDay(ym: string, day: number): string {
  return `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
