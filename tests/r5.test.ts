import { beforeEach, describe, expect, it } from 'vitest';
import { budgetState, filterEntries, isFilterActive, sortEntries } from '../src/lib/calc';
import { clearRecent, loadRecent, pushRecent, removeRecent } from '../src/lib/recent';
import { EMPTY_FILTER, type Entry } from '../src/lib/types';

let seq = 0;
function mk(p: Partial<Entry>): Entry {
  seq++;
  return {
    id: `e${seq}`,
    date: '2026-10-10',
    store: '',
    memo: '',
    category: null,
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

describe('금액·기간 필터', () => {
  const list = [
    mk({ store: 'a', amount: 500, date: '2026-01-05' }),
    mk({ store: 'b', amount: 10000, date: '2026-03-05' }),
    mk({ store: 'c', amount: 100000, date: '2026-06-05' }),
  ];
  const ids = (f: Partial<typeof EMPTY_FILTER>) => filterEntries(list, { ...EMPTY_FILTER, ...f }, new Map()).map((e) => e.store);
  it('최소·최대는 양끝을 포함한다', () => {
    expect(ids({ minAmount: 10000 })).toEqual(['b', 'c']);
    expect(ids({ maxAmount: 10000 })).toEqual(['a', 'b']);
    expect(ids({ minAmount: 10000, maxAmount: 10000 })).toEqual(['b']);
  });
  it('날짜 범위도 양끝을 포함한다', () => {
    expect(ids({ dateFrom: '2026-03-05' })).toEqual(['b', 'c']);
    expect(ids({ dateTo: '2026-03-05' })).toEqual(['a', 'b']);
    expect(ids({ dateFrom: '2026-02-01', dateTo: '2026-05-31' })).toEqual(['b']);
  });
  it('금액 0도 조건으로 인정된다', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, minAmount: 0 })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, dateTo: '2026-01-01' })).toBe(true);
  });
});

describe('열 정렬', () => {
  const order = new Map([
    ['food', 0],
    ['life', 1],
  ]);
  const list = [
    mk({ store: '나', amount: 300, category: 'life', date: '2026-10-01' }),
    mk({ store: '가', amount: 900, category: null, date: '2026-10-02' }),
    mk({ store: '다', amount: 300, category: 'food', date: '2026-10-03' }),
  ];
  it('금액 큰 순 — 같은 금액이면 최신 날짜 먼저', () => {
    expect(sortEntries(list, { key: 'amt', dir: 'desc' }, order).map((e) => e.store)).toEqual(['가', '다', '나']);
    expect(sortEntries(list, { key: 'amt', dir: 'asc' }, order).map((e) => e.store)).toEqual(['다', '나', '가']);
  });
  it('사용처 가나다순', () => {
    expect(sortEntries(list, { key: 'store', dir: 'asc' }, order).map((e) => e.store)).toEqual(['가', '나', '다']);
  });
  it('분류는 목록 순서, 분류 없음은 맨 뒤', () => {
    expect(sortEntries(list, { key: 'cat', dir: 'asc' }, order).map((e) => e.store)).toEqual(['다', '나', '가']);
  });
  it('원본을 바꾸지 않는다', () => {
    const before = list.map((e) => e.id).join();
    sortEntries(list, { key: 'amt', dir: 'desc' }, order);
    expect(list.map((e) => e.id).join()).toBe(before);
  });
});

describe('분류별 예산', () => {
  it('한도가 없으면 null', () => {
    expect(budgetState(5000, null)).toBeNull();
    expect(budgetState(5000, 0)).toBeNull();
    expect(budgetState(5000, undefined)).toBeNull();
  });
  it('80% 미만은 ok, 80% 이상은 warn, 한도 초과는 over', () => {
    expect(budgetState(7900, 10000)?.level).toBe('ok');
    expect(budgetState(8000, 10000)?.level).toBe('warn');
    expect(budgetState(10000, 10000)?.level).toBe('warn');
    const o = budgetState(12500, 10000)!;
    expect(o.level).toBe('over');
    expect(o.over).toBe(2500);
    expect(o.remaining).toBe(0);
    expect(Math.round(o.percent)).toBe(125);
  });
  it('남은 한도', () => {
    expect(budgetState(3000, 10000)?.remaining).toBe(7000);
  });
});

describe('최근 검색어', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  it('맨 앞에 쌓이고 같은 말은 앞으로 옮긴다', () => {
    pushRecent('마트');
    pushRecent('약국');
    expect(pushRecent('마트')).toEqual(['마트', '약국']);
  });
  it('빈 말은 저장하지 않고, 최대 8개까지만 둔다', () => {
    pushRecent('  ');
    expect(loadRecent()).toEqual([]);
    for (let i = 0; i < 12; i++) pushRecent(`w${i}`);
    expect(loadRecent()).toHaveLength(8);
    expect(loadRecent()[0]).toBe('w11');
  });
  it('하나 또는 전부 지운다', () => {
    pushRecent('a');
    pushRecent('b');
    expect(removeRecent('a')).toEqual(['b']);
    expect(clearRecent()).toEqual([]);
  });
});
