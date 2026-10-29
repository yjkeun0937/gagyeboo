const nf = new Intl.NumberFormat('ko-KR');

/** 천 단위 구분 숫자 (원 단위 정수) */
export function won(n: number): string {
  return nf.format(Math.round(n));
}

/** 입력 중인 문자열에서 숫자만 남긴다. */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, '');
}

/** 이름이 길 때 앞 n글자만 (태블릿 구간의 짧은 이름 표시용) */
export function shortName(name: string, n = 4): string {
  const chars = [...name];
  return chars.length > n ? chars.slice(0, n).join('') : name;
}

export function initialOf(name: string): string {
  const c = [...name.trim()][0];
  return c ?? '?';
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 축 눈금용 짧은 금액: 1,500 / 3.5만 / 120만 / 1.2억 */
export function compactWon(n: number): string {
  const a = Math.abs(n);
  const trim = (x: number) => String(Math.round(x * 10) / 10).replace(/\.0$/, '');
  if (a >= 100_000_000) return `${trim(n / 100_000_000)}억`;
  if (a >= 10_000) return `${trim(n / 10_000)}만`;
  return new Intl.NumberFormat('ko-KR').format(Math.round(n));
}

/** 눈금을 보기 좋은 숫자(1·2·5 × 10^k)로 맞춘 최대값과 간격 */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  return { max: Math.ceil(max / step) * step, step };
}
