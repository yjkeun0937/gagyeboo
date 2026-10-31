import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  amountDelta,
  buildTrend,
  diffAsset,
  fieldsFor,
  formatValue,
  groupByState,
  maturityInfo,
  normalizeAsset,
  summarize,
} from '../src/lib/assets';
import type { Asset } from '../src/lib/types';
import {
  addAsset,
  assetLogs,
  assets,
  assetsUpdatedAt,
  exportAll,
  importAll,
  initStore,
  purgeAsset,
  setAssetState,
  undoAssetChange,
  updateAsset,
  save,
  users,
  usageOf,
  resetAll,
} from '../src/store/store';

const A = (p: Partial<Asset>): Asset => ({
  id: 'x',
  updatedAt: 0,
  category: 'deposit',
  name: '은행',
  kind: '정기예금',
  owner: null,
  amount: 1000,
  payStatus: '',
  coverage: '',
  term: '',
  rate: null,
  maturity: null,
  tax: null,
  memo: '',
  inCash: true,
  state: 'active',
  endReason: null,
  endedOn: null,
  createdAt: 1,
  ...p,
});

describe('합계', () => {
  it('금액 미정은 합계에서 빠지고 건수로 알려 준다. 현금은 현금 포함 항목만', () => {
    const s = summarize([A({ amount: 100 }), A({ amount: 200, inCash: false }), A({ amount: null })]);
    expect(s).toEqual({ count: 3, total: 300, cash: 100, unknown: 1 });
  });

  it('상태별·분류별로 묶고 상태는 보유-종료-휴지통 순', () => {
    const list = [
      A({ id: '1', state: 'trash', amount: 5 }),
      A({ id: '2', state: 'active', category: 'realestate', amount: 1000, inCash: false }),
      A({ id: '3', state: 'ended', amount: 7 }),
      A({ id: '4', state: 'active', amount: 20 }),
    ];
    const g = groupByState(list, ['trash', 'active', 'ended']);
    expect(g.map((x) => x.state)).toEqual(['active', 'ended', 'trash']);
    expect(g[0].byCategory.map((c) => c.category)).toEqual(['realestate', 'deposit']);
    expect(g[0].summary).toMatchObject({ total: 1020, cash: 20 });
    expect(groupByState(list, ['ended']).map((x) => x.state)).toEqual(['ended']);
  });
});

describe('분류별 입력 항목', () => {
  it('기간·이율·만기는 정기예금·적금에서만', () => {
    expect(fieldsFor('deposit', '정기예금')).toEqual(['term', 'rate', 'maturity', 'tax']);
    expect(fieldsFor('deposit', '입출금')).toEqual(['tax']);
    expect(fieldsFor('insurance', '종신')).toEqual(['payStatus', 'coverage']);
    expect(fieldsFor('other', '')).toEqual([]);
    const n = normalizeAsset(A({ kind: '입출금', term: '1년', rate: 3, maturity: '2027-01-01' }));
    expect([n.term, n.rate, n.maturity]).toEqual(['', null, null]);
  });
});

describe('만기 표시', () => {
  const m = (maturity: string | null, state: Asset['state'] = 'active') => maturityInfo(A({ maturity, state }), '2026-10-31');
  it('30일 이내는 임박, 지나면 경과', () => {
    expect(m('2026-11-30')).toEqual({ level: 'soon', days: 30 });
    expect(m('2026-10-31')).toEqual({ level: 'soon', days: 0 });
    expect(m('2026-12-01')).toBeNull();
    expect(m('2026-10-30')).toEqual({ level: 'over', days: 1 });
  });
  it('보유가 아니거나 만기가 없거나 예금이 아니면 표시 없음', () => {
    expect(m('2026-10-30', 'ended')).toBeNull();
    expect(m(null)).toBeNull();
    expect(maturityInfo(A({ category: 'insurance', maturity: '2026-10-30' }), '2026-10-31')).toBeNull();
  });
});

describe('변경 이력 비교', () => {
  it('바뀐 항목만, 빈 값끼리는 같은 값으로 본다', () => {
    const prev = A({ amount: 30_000_000, memo: '' });
    const next = A({ amount: 33_000_000, memo: null as never, name: '새 은행' });
    const ch = diffAsset(prev, next);
    expect(ch.map((c) => c.field)).toEqual(['name', 'amount']);
    expect(amountDelta(ch[1])).toBe('+3,000,000원');
    expect(amountDelta({ field: 'amount', from: 500, to: 100 })).toBe('−400원');
    expect(amountDelta({ field: 'amount', from: null, to: 100 })).toBeNull();
  });
  it('등록은 값이 있는 항목을 모두 담는다', () => {
    const ch = diffAsset(null, A({ amount: 1, memo: '' }));
    expect(ch.map((c) => c.field)).toEqual(['category', 'name', 'kind', 'amount', 'inCash', 'state']);
  });
  it('값 표시', () => {
    const ctx = { userName: (id: string) => `u:${id}` };
    expect(formatValue('amount', 1234567, ctx)).toBe('1,234,567원');
    expect(formatValue('state', 'ended', ctx)).toBe('종료');
    expect(formatValue('owner', 'k', ctx)).toBe('u:k');
    expect(formatValue('memo', null, ctx)).toBe('없음');
    expect(formatValue('inCash', false, ctx)).toBe('제외');
  });
});

describe('총액 추이', () => {
  const kst = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00+09:00`);
  const log = (id: string, assetId: string, at: number, changes: { field: string; from: unknown; to: unknown }[]) => ({ id, assetId, at, changes });
  it('하루가 끝났을 때의 보유 합계를 날짜별로', () => {
    const pts = buildTrend([
      log('1', 'a', kst('2026-01-10'), [{ field: 'amount', from: null, to: 100 }, { field: 'inCash', from: null, to: true }, { field: 'state', from: null, to: 'active' }]),
      log('2', 'b', kst('2026-01-10', 15), [{ field: 'amount', from: null, to: 1000 }, { field: 'inCash', from: null, to: false }, { field: 'state', from: null, to: 'active' }]),
      log('3', 'a', kst('2026-02-01'), [{ field: 'amount', from: 100, to: 150 }]),
      log('4', 'b', kst('2026-03-01'), [{ field: 'state', from: 'active', to: 'ended' }]),
      log('5', 'b', kst('2026-04-01'), [{ field: 'state', from: 'ended', to: 'active' }]),
    ]);
    expect(pts).toEqual([
      { date: '2026-01-10', total: 1100, cash: 100 },
      { date: '2026-02-01', total: 1150, cash: 150 },
      { date: '2026-03-01', total: 150, cash: 150 },
      { date: '2026-04-01', total: 1150, cash: 150 },
    ]);
    expect(buildTrend([])).toEqual([]);
  });
});

describe('저장소', () => {
  let n = 0;
  const input = (o: Partial<Parameters<typeof addAsset>[0]> = {}) => ({
    category: 'deposit' as const,
    name: '가상은행',
    kind: '정기예금',
    owner: null,
    amount: 1_000_000,
    payStatus: '',
    coverage: '',
    term: '1년',
    rate: 3.1,
    maturity: '2027-01-01',
    tax: 'taxable' as const,
    memo: '',
    inCash: true,
    ...o,
  });
  beforeEach(async () => {
    await initStore(`assets-${++n}`);
  });

  it('등록하면 이력 한 줄이 생기고 최종 업데이트가 갱신된다', async () => {
    expect(assetsUpdatedAt.value).toBe(0);
    const a = await addAsset(input(), '신규 가입');
    expect(a.state).toBe('active');
    expect(assets.value).toHaveLength(1);
    const logs = assetLogs.value.filter((l) => l.assetId === a.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'create', note: '신규 가입' });
    expect(logs[0].at).toBe(assetsUpdatedAt.value);
  });

  it('수정은 바뀐 것만 이력에 남기고, 안 바뀌면 이력이 없다', async () => {
    const a = await addAsset(input());
    expect(await updateAsset(a.id, { amount: 1_000_000 })).toBeNull();
    const u = await updateAsset(a.id, { amount: 1_200_000, memo: '이자 입금' }, '갱신');
    expect(u).not.toBeNull();
    const last = assetLogs.value.filter((l) => l.assetId === a.id && l.kind === 'edit')[0];
    expect(last.changes.map((c) => c.field)).toEqual(['amount', 'memo']);
    expect(last.changes[0]).toMatchObject({ from: 1_000_000, to: 1_200_000 });
    await undoAssetChange(u!);
    expect(assets.value[0].amount).toBe(1_000_000);
    expect(assetLogs.value.filter((l) => l.assetId === a.id)).toHaveLength(1);
  });

  it('상태는 어디로든 바꿀 수 있고 종료일·사유는 종료일 때만', async () => {
    const a = await addAsset(input());
    await setAssetState(a.id, 'ended', { reason: 'matured', endedOn: '2027-01-01' });
    expect(assets.value[0]).toMatchObject({ state: 'ended', endReason: 'matured', endedOn: '2027-01-01' });
    await setAssetState(a.id, 'trash');
    expect(assets.value[0]).toMatchObject({ state: 'trash', endReason: null, endedOn: null });
    const back = await setAssetState(a.id, 'active');
    expect(assets.value[0].state).toBe('active');
    expect(await setAssetState(a.id, 'active')).toBeNull();
    expect(assetLogs.value.filter((l) => l.kind === 'state')).toHaveLength(3);
    await undoAssetChange(back!);
    expect(assets.value[0].state).toBe('trash');
  });

  it('완전 삭제는 이력까지 지우고, 사용 중인 소유자는 목록에서 못 지운다', async () => {
    await save('users', { id: 'u1', updatedAt: 0, name: '하늘', type: 'person', memberIds: [], icon: null, color: '#000', order: 0 });
    const a = await addAsset(input({ owner: 'u1' }));
    expect(usageOf('users', 'u1')).toBe(1);
    await setAssetState(a.id, 'trash');
    await purgeAsset(a.id);
    expect(assets.value).toHaveLength(0);
    expect(assetLogs.value).toHaveLength(0);
    expect(usageOf('users', 'u1')).toBe(0);
    expect(users.value).toHaveLength(1);
  });

  it('백업에 포함되고, 재산상황이 없는 이전 백업은 지금 재산상황을 건드리지 않는다', async () => {
    await addAsset(input());
    const b = await exportAll();
    expect(b.assets).toHaveLength(1);
    expect(b.assetLogs).toHaveLength(1);
    const old = { ...b, assets: undefined, assetLogs: undefined, schemaVersion: 2 };
    await importAll(old as never);
    expect(assets.value).toHaveLength(1);
    await purgeAsset(assets.value[0].id);
    await importAll(b);
    expect(assets.value).toHaveLength(1);
    expect(assetLogs.value).toHaveLength(1);
    await resetAll();
    expect(assets.value).toHaveLength(0);
  });
});
