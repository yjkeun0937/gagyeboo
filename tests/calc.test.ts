import { describe, expect, it } from 'vitest';
import {
  buildStoreIndex,
  entryStatus,
  filterEntries,
  groupByDate,
  summarize,
  suggestStores,
} from '../src/lib/calc';
import { addMonths, clampDay, daysInMonth, isValidYmd, todayKST, weekdayKo } from '../src/lib/dates';
import { EMPTY_FILTER, type Entry, type User } from '../src/lib/types';

let seq = 0;
function mk(p: Partial<Entry>): Entry {
  seq++;
  return {
    id: `e${seq}`,
    date: '2026-10-10',
    store: '',
    memo: '',
    category: 'c1',
    amount: 1000,
    user: null,
    payMethod: null,
    payDetail: null,
    source: 'manual',
    createdAt: seq,
    updatedAt: 0,
    ...p,
  };
}

describe('dates', () => {
  it('오늘은 Asia/Seoul 기준이다 (UTC 15시 이후는 다음 날)', () => {
    expect(todayKST(new Date('2026-10-27T14:59:00Z'))).toBe('2026-10-27');
    expect(todayKST(new Date('2026-10-27T15:00:00Z'))).toBe('2026-10-28');
  });
  it('월 계산', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -14)).toBe('2025-08');
  });
  it('31일 지정은 해당 월 마지막 날로 보정', () => {
    expect(clampDay('2026-02', 31)).toBe('2026-02-28');
    expect(clampDay('2026-04', 31)).toBe('2026-04-30');
    expect(clampDay('2026-05', 15)).toBe('2026-05-15');
  });
  it('날짜 검증·요일', () => {
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2028-02-29')).toBe(true);
    expect(weekdayKo('2026-10-23')).toBe('금');
  });
});

describe('보류·예정 판정', () => {
  const today = '2026-10-28';
  it('고정지출의 미래 날짜는 보류, 직접 입력의 미래 날짜는 예정', () => {
    expect(entryStatus({ date: '2026-10-30', source: 'fixed' }, today)).toBe('pending');
    expect(entryStatus({ date: '2026-10-30', source: 'manual' }, today)).toBe('scheduled');
    expect(entryStatus({ date: '2026-10-30', source: 'import' }, today)).toBe('scheduled');
  });
  it('당일은 보류·예정이 아니다 (지정일이 되면 자동 해제)', () => {
    expect(entryStatus({ date: today, source: 'fixed' }, today)).toBe('normal');
    expect(entryStatus({ date: '2026-10-27', source: 'fixed' }, today)).toBe('normal');
  });
});

describe('월 요약', () => {
  const ym = '2026-10';
  it('보류는 모든 집계에서 제외, 예정은 포함', () => {
    const list = [
      mk({ date: '2026-10-05', amount: 10000, user: 'u1', payMethod: 'p1', category: 'c1' }),
      mk({ date: '2026-10-20', amount: 5000, user: 'u1', payMethod: 'p2', category: 'c2' }),
      mk({ date: '2026-10-30', amount: 7000, user: 'g1', payMethod: 'p1', category: 'c2' }), // 예정
      mk({ date: '2026-10-31', amount: 500000, user: 'g1', payMethod: 'p1', source: 'fixed' }), // 보류
    ];
    const s = summarize(list, ym, '2026-10-28');
    expect(s.total).toBe(22000);
    expect(s.count).toBe(3);
    expect(s.pendingCount).toBe(1);
    expect(s.pendingTotal).toBe(500000);
    expect(s.scheduledCount).toBe(1);
    expect(s.scheduledTotal).toBe(7000);
    expect(s.byUser.get('u1')).toBe(15000);
    expect(s.byUser.get('g1')).toBe(7000);
  });
  it('사용자별·지불수단별·분류별 합계는 전체 합계와 같다', () => {
    const list = [
      mk({ amount: 1200, user: 'u1', payMethod: 'p1', category: 'c1' }),
      mk({ amount: 3400, user: null, payMethod: null, category: null }),
      mk({ amount: 560, user: 'g1', payMethod: 'p2', category: 'c2' }),
    ];
    const s = summarize(list, ym, '2026-10-28');
    const sum = (m: Map<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(sum(s.byUser)).toBe(s.total);
    expect(sum(s.byPayMethod)).toBe(s.total);
    expect(sum(s.byCategory)).toBe(s.total);
    expect(s.byUser.get(null)).toBe(3400);
  });
  it('하루평균: 이번 달은 오늘 일수, 지난 달은 월 일수로 나눈다', () => {
    const list = [mk({ date: '2026-10-02', amount: 280000 })];
    const cur = summarize(list, '2026-10', '2026-10-28');
    expect(cur.dailyAvg).toBe(10000); // 280000 ÷ 28
    expect(cur.projected).toBe(310000); // 10000 × 31
    const past = summarize([mk({ date: '2026-09-02', amount: 300000 })], '2026-09', '2026-10-28');
    expect(past.dailyAvg).toBe(10000); // 300000 ÷ 30
    expect(past.projected).toBe(300000);
  });
});

describe('날짜별 묶음', () => {
  it('날짜 순·입력 순으로 묶고 하루 합계에서 보류를 뺀다', () => {
    const list = [
      mk({ date: '2026-10-10', amount: 100, createdAt: 3 }),
      mk({ date: '2026-10-09', amount: 50, createdAt: 9 }),
      mk({ date: '2026-10-10', amount: 200, createdAt: 1 }),
      mk({ date: '2026-10-30', amount: 900, source: 'fixed', createdAt: 4 }),
    ];
    const g = groupByDate(list, '2026-10-28');
    expect(g.map((x) => x.date)).toEqual(['2026-10-09', '2026-10-10', '2026-10-30']);
    expect(g[1].items.map((e) => e.amount)).toEqual([200, 100]);
    expect(g[1].total).toBe(300);
    expect(g[2].total).toBe(0);
  });
});

describe('필터', () => {
  const persons: User[] = [
    { id: 'u1', name: 'A', type: 'person', memberIds: [], icon: null, color: '#000', order: 0, updatedAt: 0 },
    { id: 'u2', name: 'B', type: 'person', memberIds: [], icon: null, color: '#000', order: 1, updatedAt: 0 },
    { id: 'g1', name: 'G', type: 'group', memberIds: ['u1', 'u2'], icon: null, color: '#000', order: 2, updatedAt: 0 },
  ];
  const usersById = new Map(persons.map((u) => [u.id, u]));
  const list = [
    mk({ store: '마트', user: 'u1' }),
    mk({ store: '식당', user: 'g1' }),
    mk({ store: '약국', user: 'u2' }),
    mk({ store: '카페', user: null }),
  ];
  it('개인을 고르면 기본은 그 개인으로 기록된 내역만', () => {
    const r = filterEntries(list, { ...EMPTY_FILTER, userId: 'u1' }, usersById);
    expect(r.map((e) => e.store)).toEqual(['마트']);
  });
  it('속한 그룹 내역 포함을 켜면 그룹 내역도 나온다', () => {
    const r = filterEntries(list, { ...EMPTY_FILTER, userId: 'u1', includeGroups: true }, usersById);
    expect(r.map((e) => e.store)).toEqual(['마트', '식당']);
  });
  it('미지정과 텍스트 검색', () => {
    expect(filterEntries(list, { ...EMPTY_FILTER, userId: 'none' }, usersById).map((e) => e.store)).toEqual(['카페']);
    expect(filterEntries(list, { ...EMPTY_FILTER, text: '약' }, usersById).map((e) => e.store)).toEqual(['약국']);
  });
});

describe('사용처 자동완성', () => {
  const list = [
    mk({ store: '롯데마트', date: '2026-10-01', category: 'c1' }),
    mk({ store: '롯데마트', date: '2026-10-05', category: 'c2' }),
    mk({ store: '롯데마트', date: '2026-10-03', category: 'c3' }),
    mk({ store: '로손', date: '2026-10-06' }),
    mk({ store: '하늘약국', date: '2026-10-07' }),
  ];
  const idx = buildStoreIndex(list);
  it('많이 쓴 순, 같은 사용처의 마지막 내역을 기억한다', () => {
    expect(idx[0].store).toBe('롯데마트');
    expect(idx[0].count).toBe(3);
    expect(idx[0].last.category).toBe('c2'); // 날짜가 가장 늦은 내역
  });
  it('앞부분 일치를 먼저, 포함 일치를 그 뒤에 제안', () => {
    expect(suggestStores(idx, '롯').map((s) => s.store)).toEqual(['롯데마트']);
    expect(suggestStores(idx, '로').map((s) => s.store)).toEqual(['로손']);
    // '마트'는 앞부분이 아니라 중간에 포함 → 포함 일치로 제안
    expect(suggestStores(idx, '마트').map((s) => s.store)).toEqual(['롯데마트']);
    expect(suggestStores(idx, '약국').map((s) => s.store)).toEqual(['하늘약국']);
    expect(suggestStores(idx, '롯데마트')).toEqual([]);
  });
});
