import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { entryStatus, filterEntries, goalWarning, groupByDate, summarize } from '../src/lib/calc';
import { describeSchedule, dueDate, fixedEntryId, nextDue } from '../src/lib/fixed';
import { buildQueue } from '../src/lib/queue';
import { clearSample, hasSample, loadSample } from '../src/lib/sample';
import { EMPTY_FILTER, type Entry, type FixedItem, type FixedSchedule } from '../src/lib/types';
import {
  addEntry,
  addFixedItem,
  applyQueue,
  fixedHandled,
  fixedSkips,
  proposals,
  queue,
  save,
  undoQueue,
  canDelete,
  entries,
  exportAll,
  fixedItems,
  importAll,
  initStore,
  removeEntry,
  today,
  validateBackup,
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

describe('입력 대기 계산', () => {
  const base = { firstUseYm: '2026-08', todayYm: '2026-11', runs: [], handledIds: new Set<string>(), skippedIds: new Set<string>(), proposals: [] };
  it('해당 달의 활성 항목을 오래된 달부터 만들고, 사용 중이 아닌 항목·해당 없는 달은 뺀다', () => {
    const items = [
      item({ id: 'a' }),
      item({ id: 'b', schedule: { kind: 'months', months: [9], day: 1 }, order: 1 }),
      item({ id: 'c', active: false, order: 2 }),
    ];
    const q = buildQueue({ ...base, items });
    expect(q.map((x) => x.key)).toEqual([
      fixedEntryId('a', '2026-08'),
      fixedEntryId('b', '2026-09'),
      fixedEntryId('a', '2026-09'),
      fixedEntryId('a', '2026-10'),
      fixedEntryId('a', '2026-11'),
    ]);
    expect(q[0]).toMatchObject({ kind: 'fixed', ym: '2026-08', date: '2026-08-25', store: '관리비', amount: 100000 });
  });
  it('이미 내역이 있는 것(지운 것 포함)·입력하지 않음·옛 월초 창에서 처리한 달은 나오지 않는다', () => {
    const items = [item({ id: 'a' })];
    const q = buildQueue({
      ...base,
      items,
      handledIds: new Set([fixedEntryId('a', '2026-08')]),
      skippedIds: new Set([fixedEntryId('a', '2026-09')]),
      runs: [{ id: 'run_2026-10', ym: '2026-10', status: 'skipped', updatedAt: 0 }] as never,
    });
    expect(q.map((x) => x.ym)).toEqual(['2026-11']);
  });
  it('항목의 시작 월 이전은 소급하지 않는다. 시작 월이 없으면 앱 사용 시작 달부터', () => {
    expect(buildQueue({ ...base, items: [item({ startYm: '2026-11' })] }).map((x) => x.ym)).toEqual(['2026-11']);
    expect(buildQueue({ ...base, items: [item()] })).toHaveLength(4);
    expect(buildQueue({ ...base, firstUseYm: '2026-12', items: [item()] })).toEqual([]);
  });
  it('손님 제안은 입력되는 달·날짜 순으로 섞이고, 처리(삭제)된 제안은 빠진다', () => {
    const p = (id: string, date: string, deleted = false) =>
      ({ id, from: '손님', receivedAt: 1, date, store: '제안', memo: '', category: null, amount: 5, user: null, payMethod: null, payDetail: null, updatedAt: 0, deleted }) as never;
    const q = buildQueue({ ...base, items: [item({ startYm: '2026-11' })], proposals: [p('x', '2026-11-30'), p('y', '2026-11-25'), p('z', '2026-11-01', true)] });
    expect(q.map((x) => [x.kind, x.date])).toEqual([
      ['fixed', '2026-11-25'],
      ['proposal', '2026-11-25'],
      ['proposal', '2026-11-30'],
    ]);
    expect(q[1].from).toBe('손님');
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

describe('입력 대기 적용 (저장소)', () => {
  const ym = () => today.value.slice(0, 7);
  it('입력하면 지정일 날짜의 내역이 되고 대기에서 사라진다. 미래 날짜면 [보류], 예상 항목은 [예상]', async () => {
    const a = await addFixedItem({ ...item(), schedule: { kind: 'monthly', day: 'last' }, amountMode: 'estimate' } as never);
    expect(a.startYm).toBe(ym());
    expect(queue.value.map((q) => q.key)).toEqual([fixedEntryId(a.id, ym())]);
    await applyQueue([{ item: queue.value[0], action: 'enter' }]);
    const e = entries.value[0];
    expect(e).toMatchObject({ source: 'fixed', isEstimate: true, id: fixedEntryId(a.id, ym()), amount: 100000 });
    expect(e.date.startsWith(ym())).toBe(true);
    expect(entryStatus(e, `${ym()}-01`)).toBe('pending');
    expect(queue.value).toHaveLength(0);
  });
  it('입력하지 않음은 대기에서 사라지고 다시 나타나지 않는다. 내역도 만들지 않는다', async () => {
    const a = await addFixedItem(item() as never);
    await applyQueue([{ item: queue.value[0], action: 'skip' }]);
    expect(entries.value).toHaveLength(0);
    expect(fixedSkips.value.map((k) => k.id)).toEqual([fixedEntryId(a.id, ym())]);
    expect(queue.value).toHaveLength(0);
  });
  it('선택하지 않은 건은 그대로 남고, 같은 건을 두 번 적용해도 내역은 한 건', async () => {
    const a = await addFixedItem(item() as never);
    await addFixedItem(item({ id: 'f2', name: '통신비' }) as never);
    const first = queue.value[0];
    await applyQueue([{ item: first, action: 'enter' }]);
    await applyQueue([{ item: first, action: 'enter' }]);
    expect(entries.value).toHaveLength(1);
    expect(queue.value).toHaveLength(1);
    expect(queue.value[0].key).not.toBe(first.key);
    expect(a.id).toBeTruthy();
  });
  it('직접 지운 고정지출 내역은 대기로 돌아오지 않는다', async () => {
    const a = await addFixedItem(item() as never);
    await applyQueue([{ item: queue.value[0], action: 'enter' }]);
    await removeEntry(fixedEntryId(a.id, ym()));
    expect(entries.value).toHaveLength(0);
    expect(fixedHandled.value.has(fixedEntryId(a.id, ym()))).toBe(true);
    expect(queue.value).toHaveLength(0);
  });
  it('실행 취소하면 입력·입력하지 않음 모두 대기로 되돌아온다. 다시 입력할 수도 있다', async () => {
    await addFixedItem(item() as never);
    await addFixedItem(item({ id: 'f2', name: '통신비' }) as never);
    const [x, y] = queue.value;
    const undo = await applyQueue([
      { item: x, action: 'enter' },
      { item: y, action: 'skip' },
    ]);
    expect(queue.value).toHaveLength(0);
    await undoQueue(undo);
    expect(entries.value).toHaveLength(0);
    expect(fixedSkips.value).toHaveLength(0);
    expect(queue.value.map((q) => q.key).sort()).toEqual([x.key, y.key].sort());
    await applyQueue([{ item: queue.value[0], action: 'enter' }]);
    expect(entries.value).toHaveLength(1);
  });
  it('손님 제안: 입력하면 내역이 되고, 입력하지 않음이면 내역 없이 사라진다. 실행 취소로 되살아난다', async () => {
    const pr = (id: string) => ({ id, from: '손님', receivedAt: 1, date: `${ym()}-05`, store: '제안가게', memo: '명세', category: null, amount: 7000, user: null, payMethod: null, payDetail: null, updatedAt: 0 });
    await save('proposals', pr('p1') as never);
    await save('proposals', pr('p2') as never);
    expect(queue.value.map((q) => q.kind)).toEqual(['proposal', 'proposal']);
    const undo = await applyQueue([
      { item: queue.value[0], action: 'enter' },
      { item: queue.value[1], action: 'skip' },
    ]);
    expect(entries.value).toHaveLength(1);
    expect(entries.value[0]).toMatchObject({ store: '제안가게', amount: 7000, source: 'manual' });
    expect(proposals.value).toHaveLength(0);
    expect(queue.value).toHaveLength(0);
    await undoQueue(undo);
    expect(entries.value).toHaveLength(0);
    expect(proposals.value).toHaveLength(2);
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
    await save('fixedSkips', { id: fixedEntryId(a.id, '2026-10'), updatedAt: 0, itemId: a.id, ym: '2026-10' });
    const b = await exportAll();
    expect(validateBackup(b)).toBe(true);
    expect(b.fixedItems).toHaveLength(1);
    const v1 = JSON.parse(JSON.stringify({ ...b, schemaVersion: 1 }));
    delete v1.fixedItems;
    delete v1.fixedRuns;
    expect(validateBackup(v1)).toBe(true);
    await importAll(v1);
    expect(fixedItems.value).toHaveLength(0);
    expect(fixedSkips.value).toHaveLength(1); // 이전 백업은 '입력하지 않음' 기록을 건드리지 않는다
    await importAll(JSON.parse(JSON.stringify(b)));
    expect(fixedItems.value).toHaveLength(1);
    expect(fixedSkips.value).toHaveLength(1);
  });
  it('가상 데이터에는 고정지출이 있고 입력 대기에 올라온다. 지우면 대기·처리 기록까지 함께 사라진다', async () => {
    await loadSample();
    expect(fixedItems.value.length).toBeGreaterThan(2);
    expect(queue.value.length).toBeGreaterThan(0);
    await applyQueue([{ item: queue.value[0], action: 'skip' }]);
    expect(fixedSkips.value).toHaveLength(1);
    await clearSample();
    expect(hasSample()).toBe(false);
    expect(entries.value).toHaveLength(0);
    expect(fixedItems.value).toHaveLength(0);
    expect(fixedSkips.value).toHaveLength(0);
    expect(queue.value).toHaveLength(0);
  });
  it('내역을 직접 추가해도 고정지출과 섞이지 않는다', async () => {
    await addEntry({ date: '2026-10-10', store: 'x', memo: '', category: null, amount: 1, user: null, payMethod: null, payDetail: null });
    expect(entries.value[0].source).toBe('manual');
  });
});
