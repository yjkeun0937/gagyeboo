/**
 * 「방금 전 / N분 전 / 오늘 / 어제 / M월 D일」 형태의 시각 표시.
 * 「오늘」은 24시간 이내가 아니라 오늘 날짜(이 기기의 시간대)를 뜻한다.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export function whenText(t: number | null | undefined, now = Date.now(), empty = '-'): string {
  if (!t) return empty;
  const sec = Math.round((now - t) / 1000);
  if (sec < 60) return '방금 전';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  const d = new Date(t);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round(
    (new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000,
  );
  if (days === 0) return `오늘 ${hm}`;
  if (days === 1) return `어제 ${hm}`;
  const y = d.getFullYear() === n.getFullYear() ? '' : `${d.getFullYear()}년 `;
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}
