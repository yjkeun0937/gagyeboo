import { describe, expect, it } from 'vitest';
import { compactWon, niceScale } from '../src/lib/format';
import { monthStats, rangeStats, sumBy, topStores, yearStats } from '../src/lib/stats';
import type { Entry } from '../src/lib/types';

let n = 0;
const e = (date: string, amount: number, over: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`,
  date,
  store: '가게',
  memo: '',
  category: 'c1',
  amount,
  user: null,
  payMethod: null,
  payDetail: null,
  source: 'manual',
  createdAt: n,
  updatedAt: 0,
  ...over,
});

const TODAY = '2026-10-20';

describe('통계 집계', () => {
  const all = [
    e('2026-10-01', 1000),
    e('2026-10-01', 2000, { category: 'c2', user: 'u1', payMethod: 'p1', payDetail: 'd1' }),
    e('2026-10-05', 3000, { category: 'c2', payMethod: 'p1' }),
    e('2026-10-25', 5000, { source: 'fixed' }), // 보류 → 제외
    e('2026-10-26', 700), // 예정 → 포함
    e('2026-09-10', 4000, { category: 'c2' }),
    e('2026-09-11', 1000),
  ];

  it('보류는 제외하고 예정은 포함한다', () => {
    const s = monthStats(all, '2026-10', TODAY);
    expect(s.total).toBe(1000 + 2000 + 3000 + 700);
    expect(s.count).toBe(4);
  });

  it('분류·사용자·지불수단·결제상세 합계', () => {
    const s = monthStats(all, '2026-10', TODAY);
    expect(s.byCategory.map((x) => [x.key, x.total])).toEqual([['c2', 5000], ['c1', 1700]]);
    expect(s.byUser.find((x) => x.key === 'u1')?.total).toBe(2000);
    expect(s.byUser.find((x) => x.key === null)?.total).toBe(4700);
    expect(s.byPayMethod.find((x) => x.key === 'p1')?.total).toBe(5000);
    expect(s.byDetail.get('p1')?.map((x) => [x.key, x.total])).toEqual([[null, 3000], ['d1', 2000]]);
    // 합계는 항상 전체와 같다
    expect(s.byCategory.reduce((a, x) => a + x.total, 0)).toBe(s.total);
  });

  it('일별·누적·요일 평균 (이번 달은 오늘 또는 마지막 내역 날짜까지)', () => {
    const s = monthStats(all, '2026-10', TODAY);
    expect(s.daily).toHaveLength(31);
    expect(s.daily[0]).toBe(3000);
    expect(s.daily[25]).toBe(700);
    expect(s.lastDay).toBe(26); // 예정 내역이 있는 26일까지
    expect(s.cumulative).toHaveLength(26);
    expect(s.cumulative[25]).toBe(s.total);
    // 2026-10-01은 목요일 → 목요일 합계 3000, 1~26일 사이 목요일은 4번(1·8·15·22)
    const thu = s.weekday[4];
    expect(thu.total).toBe(3000);
    expect(thu.days).toBe(4);
    expect(thu.avg).toBe(750);
  });

  it('지난 달은 말일까지, 전월 대비 증감은 변화가 큰 순', () => {
    const s = monthStats(all, '2026-10', TODAY);
    expect(s.prevTotal).toBe(5000);
    expect(s.deltas[0]).toEqual({ key: 'c2', cur: 5000, prev: 4000, diff: 1000 });
    const past = monthStats(all, '2026-09', TODAY);
    expect(past.lastDay).toBe(30);
    expect(past.cumulative).toHaveLength(30);
  });

  it('사용처 TOP: 금액 큰 순', () => {
    const list = [e('2026-10-01', 100, { store: 'A' }), e('2026-10-02', 900, { store: 'B' }), e('2026-10-03', 100, { store: 'A' })];
    expect(topStores(list).map((x) => [x.store, x.count, x.total])).toEqual([['B', 1, 900], ['A', 2, 200]]);
    expect(sumBy(list, (x) => x.store)[0].key).toBe('B');
  });
});

describe('연간 표', () => {
  const all = [
    e('2026-01-05', 1000, { category: 'c2' }),
    e('2026-01-07', 500),
    e('2026-03-02', 2500),
    e('2026-10-30', 9999, { source: 'fixed' }), // 보류
    e('2025-12-31', 700),
    e('2026-04-01', 300, { category: null }),
  ];
  it('분류 × 월 합계와 월평균·비율 (내역이 있는 달만 센다)', () => {
    const y = yearStats(all, 2026, TODAY, ['c1', 'c2']);
    expect(y.rows.map((r) => r.category)).toEqual(['c1', 'c2', null]);
    expect(y.rows[0].months.slice(0, 4)).toEqual([500, 0, 2500, 0]);
    expect(y.total).toBe(4300);
    expect(y.monthsCounted).toBe(3); // 1·3·4월
    expect(y.avg).toBeCloseTo(4300 / 3);
    expect(y.rows[1].share).toBeCloseTo(1000 / 4300);
    expect(y.peakMonth).toBe(3);
    expect(y.monthTotals.reduce((a, b) => a + b, 0)).toBe(y.total);
  });
  it('내역이 없는 달은 빼고 나눈다 (지난 해: 12월만 있으면 1개월)', () => {
    const y = yearStats(all, 2025, TODAY, ['c1']);
    expect(y.monthsCounted).toBe(1);
    expect(y.avg).toBe(700);
  });
  it('2·3월에 입력이 없는 해는 10으로 나눈다', () => {
    const rows = [1, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => e(`2025-${String(m).padStart(2, '0')}-10`, 1000));
    const y = yearStats(rows, 2025, TODAY, ['c1']);
    expect(y.monthsCounted).toBe(10);
    expect(y.avg).toBe(1000);
  });
  it('내역이 없는 해는 0개월·평균 0', () => {
    const y = yearStats(all, 2024, TODAY, ['c1']);
    expect(y.monthsCounted).toBe(0);
    expect(y.avg).toBe(0);
  });
});

describe('기간 지정', () => {
  const all = [
    e('2026-10-01', 1000),
    e('2026-10-03', 2000, { category: 'c2', user: 'u1' }),
    e('2026-10-05', 3000, { payMethod: 'p1' }),
  ];
  it('양 끝 날짜를 포함하고, 날짜가 거꾸로여도 계산된다', () => {
    const r = rangeStats(all, '2026-10-01', '2026-10-03', TODAY, { category: null, user: null, payMethod: null });
    expect(r.total).toBe(3000);
    expect(r.days).toBe(3);
    expect(r.dailyAvg).toBe(1000);
    expect(rangeStats(all, '2026-10-03', '2026-10-01', TODAY, { category: null, user: null, payMethod: null }).total).toBe(3000);
  });
  it('분류·사용자·지불수단 조합 필터, 미지정(none)', () => {
    const f = { category: null, user: null, payMethod: null };
    expect(rangeStats(all, '2026-10-01', '2026-10-31', TODAY, { ...f, category: 'c2' }).total).toBe(2000);
    expect(rangeStats(all, '2026-10-01', '2026-10-31', TODAY, { ...f, user: 'none' }).total).toBe(4000);
    expect(rangeStats(all, '2026-10-01', '2026-10-31', TODAY, { ...f, payMethod: 'p1', category: 'c1' }).total).toBe(3000);
  });
});

describe('금액 표기', () => {
  it('compactWon', () => {
    expect(compactWon(0)).toBe('0');
    expect(compactWon(1500)).toBe('1,500');
    expect(compactWon(35000)).toBe('3.5만');
    expect(compactWon(1200000)).toBe('120만');
    expect(compactWon(120000000)).toBe('1.2억');
  });
  it('niceScale은 최대값을 덮는 깔끔한 눈금을 만든다', () => {
    expect(niceScale(0).max).toBeGreaterThan(0);
    const s = niceScale(87_300, 4);
    expect(s.max).toBeGreaterThanOrEqual(87_300);
    expect(s.max % s.step).toBe(0);
    expect([10000, 20000, 25000, 50000].includes(s.step)).toBe(true);
  });
});
