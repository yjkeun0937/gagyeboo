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
