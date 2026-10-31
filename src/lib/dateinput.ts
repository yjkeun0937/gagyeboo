/**
 * 날짜 직접 입력 도우미 (YYYY-MM-DD).
 * - 숫자만 쳐도 하이픈이 알아서 들어간다: 2026 → "2026-", 12 → "2026-12-", 01 → "2026-12-01"
 * - 월·일이 1개 숫자로 끝날 수밖에 없으면(월 2~9, 일 4~9) 앞에 0을 붙이고 바로 다음으로 넘어간다
 * - 연도는 2자리만 치고 Tab을 눌러도 20xx로 바꾸고 월로 넘어간다 (completeOnTab)
 */

/** 입력창에 쓰인 글자를 날짜 모양으로 다듬는다. deleting이면 지우는 중이므로 끝의 하이픈을 새로 붙이지 않는다 */
export function typeDate(raw: string, deleting = false): string {
  // 붙여넣기: 월이 한 자리인 2026-1-5, 2026.1.5 (직접 치는 중에는 이런 모양이 나올 수 없다)
  const full = raw.match(/^\s*(\d{4})\D+(\d)\D+(\d{1,2})\s*$/);
  if (full) return `${full[1]}-0${full[2]}-${full[3].padStart(2, '0')}`;
  // 2026.12.31, 2026/12/31 처럼 구분 기호만 다른 완성형
  const done = raw.match(/^\s*(\d{4})\D(\d{2})\D(\d{2})\s*$/);
  if (done) return `${done[1]}-${done[2]}-${done[3]}`;

  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const y = digits.slice(0, 4);
  if (y.length < 4) return y;
  const rest = digits.slice(4);
  if (!rest) return deleting ? y : `${y}-`;

  let month: string;
  let used: number;
  if (rest[0] >= '2') {
    month = `0${rest[0]}`;
    used = 1;
  } else if (rest.length >= 2) {
    month = rest.slice(0, 2);
    used = 2;
  } else {
    return `${y}-${rest[0]}`;
  }
  const dd = rest.slice(used);
  const head = `${y}-${month}`;
  if (!dd) return deleting ? head : `${head}-`;
  if (dd[0] >= '4') return `${head}-0${dd[0]}`;
  return `${head}-${dd.slice(0, 2)}`;
}

/**
 * Tab(앞으로)을 눌렀을 때 마무리할 수 있는 입력이면 고친 글자를 돌려준다.
 * stay: true면 Tab으로 칸을 떠나지 않고 이 입력창 안에서 다음 부분(월/일)으로 넘어간 것이다.
 */
export function completeOnTab(text: string): { text: string; stay: boolean } | null {
  if (/^\d{2}$/.test(text)) return { text: `20${text}-`, stay: true };
  const m = text.match(/^(\d{4})-(\d)$/);
  if (m) return { text: `${m[1]}-0${m[2]}-`, stay: true };
  const d = text.match(/^(\d{4}-\d{2})-(\d)$/);
  if (d) return { text: `${d[1]}-0${d[2]}`, stay: false };
  return null;
}
