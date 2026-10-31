import { describe, expect, it } from 'vitest';
import { completeOnTab, typeDate } from '../src/lib/dateinput';

describe('날짜 입력', () => {
  it('숫자를 치면 하이픈이 자동으로 들어간다 (연도 4자리 → 월로)', () => {
    expect(typeDate('2')).toBe('2');
    expect(typeDate('202')).toBe('202');
    expect(typeDate('2026')).toBe('2026-');
    expect(typeDate('2026-1')).toBe('2026-1');
    expect(typeDate('2026-12')).toBe('2026-12-');
    expect(typeDate('2026-120')).toBe('2026-12-0');
    expect(typeDate('2026-1201')).toBe('2026-12-01');
  });
  it('월·일이 한 자리로 끝날 수밖에 없으면 0을 붙여 넘어간다', () => {
    expect(typeDate('20263')).toBe('2026-03-');
    expect(typeDate('2026-35')).toBe('2026-03-05');
    expect(typeDate('2026-0512')).toBe('2026-05-12');
    expect(typeDate('2026-0'  )).toBe('2026-0');
  });
  it('숫자 아닌 글자는 버리고 8자리까지만', () => {
    expect(typeDate('20a26')).toBe('2026-');
    expect(typeDate('2026-12-0199')).toBe('2026-12-01');
  });
  it('지우는 중에는 하이픈을 다시 붙이지 않는다', () => {
    expect(typeDate('2026-', true)).toBe('2026');
    expect(typeDate('2026-12-', true)).toBe('2026-12');
  });
  it('붙여넣기·한 번에 채우기', () => {
    expect(typeDate('2026-1-5')).toBe('2026-01-05');
    expect(typeDate('2026.12.31')).toBe('2026-12-31');
    expect(typeDate('2026-12-01')).toBe('2026-12-01');
    // 직접 치는 중의 '2026-12-0'을 00으로 채우면 안 된다
    expect(typeDate('2026-12-0')).toBe('2026-12-0');
    expect(typeDate('2026-12-3')).toBe('2026-12-3');
  });
  it('Tab: 연도 2자리 → 20xx 로 바꾸고 월로, 한 자리 월·일은 0을 채운다', () => {
    expect(completeOnTab('26')).toEqual({ text: '2026-', stay: true });
    expect(completeOnTab('2026-3')).toEqual({ text: '2026-03-', stay: true });
    expect(completeOnTab('2026-03-4')).toEqual({ text: '2026-03-04', stay: false });
    expect(completeOnTab('2026-03-04')).toBeNull();
    expect(completeOnTab('')).toBeNull();
    expect(completeOnTab('2')).toBeNull();
  });
});
