import { describe, expect, it } from 'vitest';
import { allPeriodStats } from '../src/lib/stats';
import type { Entry } from '../src/lib/types';

let n = 0;
const E = (date: string, amount: number, category: string | null, source: Entry['source'] = 'manual'): Entry => ({
  id: `e${n++}`,
  updatedAt: 1,
  date,
  store: 's',
  memo: '',
  category,
  amount,
  user: null,
  payMethod: null,
  payDetail: null,
  source,
  createdAt: n,
});

describe('전체 기간 통계', () => {
  const today = '2026-10-30';
  const list = [
    E('2024-12-31', 1000, 'a'),
    E('2024-03-01', 3000, 'b'),
    E('2026-01-05', 500, 'a'),
    E('2026-10-02', 2500, null),
    E('2026-11-20', 700, 'a'), // 예정: 포함
    E('2026-12-01', 9999, 'a', 'fixed'), // 보류: 제외
  ];
  const r = allPeriodStats(list, today, ['a', 'b']);

  it('연도 범위는 내역이 있는 첫 해~마지막 해 (중간 해 포함)', () => {
    expect(r.years).toEqual([2024, 2025, 2026]);
    expect(r.yearTotals).toEqual([4000, 0, 3700]);
    expect(r.total).toBe(7700);
  });
  it('연도별 요약', () => {
    const y24 = r.yearRows[0];
    expect(y24).toMatchObject({ year: 2024, total: 4000, monthsCounted: 2, peakMonth: 3, peakAmount: 3000 });
    expect(y24.top).toEqual({ category: 'b', total: 3000 });
    expect(r.yearRows[1].top).toBeNull();
    expect(r.yearRows[1].peakMonth).toBe(0);
    expect(r.yearRows[2].top).toEqual({ category: null, total: 2500 });
  });
  it('분류 × 연 표: 분류 순서, 미분류는 맨 아래, 합계·연평균·비율', () => {
    expect(r.catRows.map((c) => c.category)).toEqual(['a', 'b', null]);
    const a = r.catRows[0];
    expect(a.byYear).toEqual([1000, 0, 1200]);
    expect(a.total).toBe(2200);
    expect(a.avg).toBeCloseTo(2200 / 3);
    expect(a.share).toBeCloseTo(2200 / 7700);
  });
  it('가장 많은 달·분류, 월평균', () => {
    expect(r.peak).toEqual({ ym: '2024-03', amount: 3000 });
    expect(r.top).toEqual({ category: 'b', total: 3000 });
    // 내역이 있는 달만: 2024 → 3·12월, 2025 → 없음, 2026 → 1·10월
    expect(r.monthsCounted).toBe(4);
    expect(r.avg).toBeCloseTo(7700 / 4);
  });
  it('내역이 없으면 빈 결과', () => {
    const e = allPeriodStats([], today, []);
    expect(e.years).toEqual([]);
    expect(e.total).toBe(0);
    expect(e.peak).toBeNull();
    expect(allPeriodStats([E('2026-12-01', 5, 'a', 'fixed')], today, ['a']).years).toEqual([]);
  });
});
