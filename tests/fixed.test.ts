import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { entryStatus, filterEntries, goalWarning, groupByDate, summarize } from '../src/lib/calc';
import { describeSchedule, dueDate, fixedEntryId, nextDue, pendingMonths, planMonth } from '../src/lib/fixed';
import { clearSample, hasSample, loadSample } from '../src/lib/sample';
import { EMPTY_FILTER, type Entry, type FixedItem, type FixedSchedule } from '../src/lib/types';
import {
  addEntry,
  addFixedItem,
  addFixedEntries,
  canDelete,
  clearMonthRun,
  entries,
  exportAll,
  fixedItems,
  fixedRuns,
  importAll,
  initStore,
  markMonth,
  pendingFixed,
  removeEntry,
  today,
  validateBackup,
  firstUseYm,
  deleteFixedItem,
} from '../src/store/store';

const item = (over: Partial<FixedItem> = {}): FixedItem => ({
  id: 'f1',
  name: '관리비',
  memo: '',
  amount: 100000,
  amountMode: 'fixed',
  schedule: { kind: 'monthly', day: 25 },
  category: 'cat_11',
  user: null,
  payMethod: null,
  payDetail: null,
  active: true,
  order: 0,
  updatedAt: 0,
  ...over,
});

describe('고정지출 지정일 계산', () => {
  it('매월: 없는 일자는 그 달 마지막 날로 보정, 말일은 항상 마지막 날', () => {
    expect(dueDate({ kind: 'monthly', day: 31 }, '2026-02')).toBe('2026-02-28');
    expect(dueDate({ kind: 'monthly', day: 31 }, '2028-02')).toBe('2028-02-29');
    expect(dueDate({ kind: 'monthly', day: 'last' }, '2026-04')).toBe('2026-04-30');
    expect(dueDate({ kind: 'monthly', day: 15 }, '2026-11')).toBe('2026-11-15');
  });
  it('특정 월: 해당 월에만', () => {
    const s: FixedSchedule = { kind: 'months', months: [7, 9], day: 30 };
    expect(dueDate(s, '2026-07')).toBe('2026-07-30');
    expect(dueDate(s, '2026-08')).toBeNull();
    expect(dueDate(s, '2027-09')).toBe('2027-09-30');
  });
  it('N개월마다: 기준 월부터 주기로 (기준 이전 달도 같은 주기)', () => {
    const s: FixedSchedule = { kind: 'every', every: 2, baseYm: '2026-10', day: 'last' };
    expect(dueDate(s, '2026-10')).toBe('2026-10-31');
    expect(dueDate(s, '2026-11')).toBeNull();
    expect(dueDate(s, '2026-12')).toBe('2026-12-31');
    expect(dueDate(s, '2027-02')).toBe('2027-02-28');
    expect(dueDate(s, '2026-08')).toBe('2026-08-31');
    expect(dueDate(s, '2026-09')).toBeNull();
  });
  it('다음 지정일과 설명 문구', () => {
    const s: FixedSchedule = { kind: 'monthly', day: 5 };
    expect(nextDue(s, '2026-10-05')).toBe('2026-10-05');
    expect(nextDue(s, '2026-10-06')).toBe('2026-11-05');
    expect(nextDue({ kind: 'months', months: [1], day: 10 }, '2026-10-06')).toBe('2027-01-10');
    expect(describeSchedule({ kind: 'monthly', day: 'last' })).toBe('매월 말일');
    expect(describeSchedule({ kind: 'months', months: [9, 7], day: 30 })).toBe('7·9월 30일');
    expect(describeSchedule({ kind: 'every', every: 2, baseYm: '2026-10', day: 'last' })).toContain('2개월마다 말일');
  });
});

describe('월 계획·처리해야 할 달', () => {
  const e = (id: string): Entry => ({ id } as Entry);
  it('이번 달 해당 항목과 해당 없는 항목을 나누고, 사용 중이 아닌 항목은 뺀다', () => {
    const items = [
      item({ id: 'a' }),
      item({ id: 'b', schedule: { kind: 'months', months: [7], day: 1 }, order: 1 }),
      item({ id: 'c', active: false, order: 2 }),
    ];
    const plan = planMonth(items, [e(fixedEntryId('a', '2026-11'))], '2026-11');
    expect(plan.due.map((r) => [r.item.id, r.added])).toEqual([['a', true]]);
    expect(plan.others.map((i) => i.id)).toEqual(['b']);
  });
  it('시작 월부터 이번 달까지 미처리 달을 오래된 순으로, 처리·건너뜀·모두 추가된 달은 제외', () => {
    const items = [item()];
    const runs = [{ id: 'run_2026-09', ym: '2026-09', status: 'skipped', updatedAt: 0 }] as never;
    const have = [e(fixedEntryId('f1', '2026-10'))];
    expect(pendingMonths('2026-08', '2026-11', runs, items, have)).toEqual(['2026-08', '2026-11']);
    expect(pendingMonths('2026-12', '2026-11', [], items, [])).toEqual([]);
    expect(pendingMonths('2026-08', '2026-11', [], [], [])).toEqual([]);
  });
});

describe('정렬·필터·목표 경고', () => {
  const mk = (id: string, date: string, createdAt: number): Entry =>
    ({ id, date, createdAt, amount: 1000, source: 'manual' }) as Entry;
  it('내림차순은 날짜 그룹만 뒤집고 같은 날은 입력 순서를 유지한다', () => {
    const list = [mk('a', '2026-10-01', 1), mk('b', '2026-10-02', 2), mk('c', '2026-10-02', 3)];
    const asc = groupByDate(list, '2026-10-30', 'asc');
    expect(asc.map((g) => g.date)).toEqual(['2026-10-01', '2026-10-02']);
    const desc = groupByDate(list, '2026-10-30', 'desc');
    expect(desc.map((g) => g.date)).toEqual(['2026-10-02', '2026-10-01']);
    expect(desc[0].items.map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('[예상]만 모아 보기', () => {
    const list = [{ ...mk('a', '2026-10-01', 1), isEstimate: true }, mk('b', '2026-10-01', 2)];
    expect(filterEntries(list, { ...EMPTY_FILTER, estimateOnly: true }, new Map()).map((x) => x.id)).toEqual(['a']);
  });
  const sum = (total: number, ym: string, t: string) =>
    summarize([{ id: 'x', date: `${ym}-05`, createdAt: 1, amount: total, source: 'manual' } as Entry], ym, t);
  it('목표가 없거나 넘지 않으면 경고가 없다', () => {
    const s = sum(100000, '2026-10', '2026-10-10'); // 예상 310,000
    expect(goalWarning(s, '2026-10', '2026-10-10', null)).toBeNull();
    expect(goalWarning(s, '2026-10', '2026-10-10', 310000)).toBeNull();
    expect(goalWarning(s, '2026-10', '2026-10-10', 400000)).toBeNull();
  });
  it('이번 달: 예상만 넘으면 속도 기준, 합계가 이미 넘으면 이미 초과', () => {
    const s = sum(100000, '2026-10', '2026-10-10');
    const w1 = goalWarning(s, '2026-10', '2026-10-10', 200000)!;
    expect(w1.title).toBe('목표 초과가 예상됩니다');
    expect(w1.lines[0]).toContain('310,000원');
    expect(w1.lines[0]).toContain('110,000원 많습니다');
    const w2 = goalWarning(s, '2026-10', '2026-10-10', 50000)!;
    expect(w2.title).toBe('이미 목표를 넘었습니다');
  });
  it('지난 달은 합계 기준', () => {
    const s = sum(500000, '2026-09', '2026-10-10');
    const w = goalWarning(s, '2026-09', '2026-10-10', 400000)!;
    expect(w.title).toBe('목표 지출 초과');
    expect(w.lines[0]).toContain('100,000원 많습니다');
  });
});

let n = 0;
beforeEach(async () => {
  await initStore(`fx-test-${++n}`);
});

describe('고정지출 추가 (저장소)', () => {
  it('지정일 날짜의 내역을 만들고 그 달을 처리함으로 기록한다. 미래면 [보류]', async () => {
    const t = today.value;
    const ym = t.slice(0, 7);
    const a = await addFixedItem({ ...item(), schedule: { kind: 'monthly', day: 'last' }, amountMode: 'estimate' } as never);
    const ids = await addFixedEntries(ym, [{ itemId: a.id }]);
    expect(ids).toEqual([fixedEntryId(a.id, ym)]);
    const e = entries.value[0];
    expect(e.source).toBe('fixed');
    expect(e.isEstimate).toBe(true);
    expect(e.date.startsWith(ym)).toBe(true);
    expect(entryStatus(e, '2026-10-01')).toBe('pending');
    expect(fixedRuns.value.find((r) => r.ym === ym)?.status).toBe('done');
  });
  it('금액을 고쳐 추가하면 확정되고 [예상]이 붙지 않는다', async () => {
    const a = await addFixedItem({ ...item(), amountMode: 'estimate' } as never);
    await addFixedEntries('2026-10', [{ itemId: a.id, amount: 98765 }]);
    expect(entries.value[0].amount).toBe(98765);
    expect(entries.value[0].isEstimate).toBe(false);
  });
  it('같은 달에 두 번 추가해도 한 건이고, 삭제하면 다시 추가할 수 있다', async () => {
    const a = await addFixedItem(item() as never);
    await addFixedEntries('2026-10', [{ itemId: a.id }]);
    await addFixedEntries('2026-10', [{ itemId: a.id }]);
    expect(entries.value).toHaveLength(1);
    await removeEntry(fixedEntryId(a.id, '2026-10'));
    expect(entries.value).toHaveLength(0);
    await addFixedEntries('2026-10', [{ itemId: a.id }]);
    expect(entries.value).toHaveLength(1);
  });
  it('처리 상태가 없고 추가할 항목이 남은 달만 미처리로 계산된다', async () => {
    const a = await addFixedItem(item() as never);
    const ym = today.value.slice(0, 7);
    expect(firstUseYm.value).toBe(ym);
    expect(pendingFixed.value).toEqual([ym]);
    await markMonth(ym, 'skipped');
    expect(pendingFixed.value).toEqual([]);
    await clearMonthRun(ym);
    expect(pendingFixed.value).toEqual([ym]);
    await addFixedEntries(ym, [{ itemId: a.id }]);
    expect(pendingFixed.value).toEqual([]);
  });
  it('고정지출이 가리키는 분류·사용자는 삭제할 수 없다. 항목을 지우면 풀린다', async () => {
    const a = await addFixedItem({ ...item(), category: 'cat_11' } as never);
    expect(canDelete('categories', 'cat_11')).toBe(false);
    await deleteFixedItem(a.id);
    expect(canDelete('categories', 'cat_11')).toBe(true);
    expect(fixedItems.value).toHaveLength(0);
  });
  it('백업에 고정지출이 포함되고, v1 백업도 복원된다', async () => {
    const a = await addFixedItem(item() as never);
    await addFixedEntries('2026-10', [{ itemId: a.id }]);
    const b = await exportAll();
    expect(validateBackup(b)).toBe(true);
    expect(b.fixedItems).toHaveLength(1);
    const v1 = JSON.parse(JSON.stringify({ ...b, schemaVersion: 1 }));
    delete v1.fixedItems;
    delete v1.fixedRuns;
    expect(validateBackup(v1)).toBe(true);
    await importAll(v1);
    expect(fixedItems.value).toHaveLength(0);
    expect(entries.value.length).toBe(1);
    await importAll(JSON.parse(JSON.stringify(b)));
    expect(fixedItems.value).toHaveLength(1);
    expect(fixedRuns.value).toHaveLength(1);
  });
  it('가상 데이터에는 고정지출이 있고, 지우면 처리 기록까지 함께 사라진다', async () => {
    await loadSample();
    expect(fixedItems.value.length).toBeGreaterThan(2);
    expect(pendingFixed.value.length).toBe(1);
    const ids = await addFixedEntries(today.value.slice(0, 7), fixedItems.value.map((f) => ({ itemId: f.id })));
    expect(ids.length).toBeGreaterThan(0);
    await clearSample();
    expect(hasSample()).toBe(false);
    expect(entries.value).toHaveLength(0);
    expect(fixedItems.value).toHaveLength(0);
    expect(fixedRuns.value).toHaveLength(0);
  });
  it('내역을 직접 추가해도 고정지출과 섞이지 않는다', async () => {
    await addEntry({ date: '2026-10-10', store: 'x', memo: '', category: null, amount: 1, user: null, payMethod: null, payDetail: null });
    expect(entries.value[0].source).toBe('manual');
  });
});
