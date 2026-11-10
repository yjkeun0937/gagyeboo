import { describe, expect, it } from 'vitest';
import { whenText } from '../src/lib/when';

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();

describe('whenText', () => {
  const now = at(2026, 11, 10, 18, 5);
  it('1분·1시간 안은 방금 전/N분 전', () => {
    expect(whenText(now - 20_000, now)).toBe('방금 전');
    expect(whenText(now - 5 * 60_000, now)).toBe('5분 전');
  });
  it('「오늘」은 오늘 날짜일 때만: 어제 22:41은 어제', () => {
    expect(whenText(at(2026, 11, 10, 9, 30), now)).toBe('오늘 09:30');
    expect(whenText(at(2026, 11, 9, 22, 41), now)).toBe('어제 22:41');
  });
  it('이틀 이상 전은 날짜, 다른 해는 연도 포함', () => {
    expect(whenText(at(2026, 11, 8, 7, 5), now)).toBe('11월 8일 07:05');
    expect(whenText(at(2025, 12, 31, 23, 59), now)).toBe('2025년 12월 31일 23:59');
  });
  it('값이 없으면 기본 문구', () => {
    expect(whenText(null, now)).toBe('-');
    expect(whenText(0, now, '아직 올린 적이 없습니다')).toBe('아직 올린 적이 없습니다');
  });
});
