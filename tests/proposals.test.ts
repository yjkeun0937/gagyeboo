import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProposalFile, type Lists } from '../src/lib/proposals';
import { applyQueue, entries, initStore, proposals, queue } from '../src/store/store';
import { db } from '../src/store/db';
import { importProposals, shareConfig, type ShareConfig } from '../src/sync/share';

const lists: Lists = {
  categories: [{ id: 'c1' }],
  users: [{ id: 'u1' }],
  payMethods: [{ id: 'm1' }, { id: 'm2' }],
  payDetails: [{ id: 'd1', payMethodId: 'm1' }, { id: 'dAny', payMethodId: null }],
};
const base = { app: 'gagyeboo-proposal', v: 1, id: 'p-1', date: '2026-03-02', store: '상점', memo: '', amount: 1200 };

describe('제안 파일 검사', () => {
  it('정상 파일은 받는다', () => {
    const r = parseProposalFile({ ...base, category: 'c1', user: 'u1', payMethod: 'm1', payDetail: 'd1', isEstimate: true }, lists);
    expect(r).toMatchObject({ ok: true, value: { category: 'c1', user: 'u1', payMethod: 'm1', payDetail: 'd1', isEstimate: true, srcId: 'p-1' } });
  });
  it('목록에 없는 값은 비우고, 지불수단과 맞지 않는 결제상세도 비운다', () => {
    const r = parseProposalFile({ ...base, category: 'zz', user: 'zz', payMethod: 'm2', payDetail: 'd1' }, lists);
    expect(r).toMatchObject({ ok: true, value: { category: null, user: null, payMethod: 'm2', payDetail: null } });
    const any = parseProposalFile({ ...base, payMethod: 'm2', payDetail: 'dAny' }, lists);
    expect(any).toMatchObject({ ok: true, value: { payDetail: 'dAny' } });
    const noMethod = parseProposalFile({ ...base, payMethod: null, payDetail: 'd1' }, lists);
    expect(noMethod).toMatchObject({ ok: true, value: { payDetail: null } });
  });
  it('긴 글은 잘라 받고 금액은 반올림한다', () => {
    const r = parseProposalFile({ ...base, store: 'a'.repeat(200), memo: 'b'.repeat(200), amount: 99.6 }, lists);
    expect(r.ok && r.value.store.length).toBe(60);
    expect(r.ok && r.value.memo.length).toBe(100);
    expect(r.ok && r.value.amount).toBe(100);
  });
  it.each([
    ['다른 앱', { ...base, app: 'x' }],
    ['버전', { ...base, v: 2 }],
    ['날짜 형식', { ...base, date: '2026-13-01' }],
    ['날짜 범위', { ...base, date: '1999-01-01' }],
    ['금액 음수', { ...base, amount: -1 }],
    ['금액 0', { ...base, amount: 0 }],
    ['금액 문자', { ...base, amount: '100' }],
    ['금액 무한', { ...base, amount: Infinity }],
    ['너무 큰 금액', { ...base, amount: 1e12 }],
    ['내용 없음', { ...base, store: ' ', memo: '' }],
    ['객체 아님', 'text'],
    ['null', null],
  ])('거절: %s', (_n, data) => {
    expect(parseProposalFile(data, lists).ok).toBe(false);
  });
});

describe('입력 대기로 받기', () => {
  let n = 0;
  const cfg = (guests: string[]): ShareConfig => ({ v: 1, folderId: 'root1', dataId: 'data1', inboxId: 'inbox1', mirrorId: 'mir1', guests: guests.map((email) => ({ email, addedAt: 1 })), createdAt: 1 });
  const file = (id: string, owner: string, payload: unknown, name = `proposal-${id}abcdefgh.json`) => ({
    meta: { id, name, size: '100', createdTime: '2026-03-02T00:00:00Z', owners: [{ emailAddress: owner, displayName: '밥' }] },
    payload,
  });
  const serve = (files: ReturnType<typeof file>[]) =>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('alt=media')) {
        const id = decodeURIComponent(u.split('/files/')[1].split('?')[0]);
        const f = files.find((x) => x.meta.id === id);
        return new Response(JSON.stringify(f?.payload ?? {}), { status: 200 });
      }
      return new Response(JSON.stringify({ files: files.map((f) => f.meta) }), { status: 200 });
    }));

  beforeEach(async () => {
    const m = new Map<string, string>([['gagyeboo.token', JSON.stringify({ token: 'tk', exp: Date.now() + 3_000_000, scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive' })]]);
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0,
    } as Storage;
    await initStore(`prop-${++n}`);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    shareConfig.value = null;
  });

  it('손님 파일만 받아 제안자를 드라이브 소유자 이름으로 정하고, 같은 파일은 다시 받지 않는다', async () => {
    shareConfig.value = cfg(['bob@x.com']);
    serve([
      file('f1', 'bob@x.com', { ...base, id: 'a', store: '받을것' }),
      file('f2', 'eve@x.com', { ...base, id: 'b', store: '남의것' }),
      file('f3', 'bob@x.com', { app: 'x' }),
    ]);
    const r = await importProposals();
    expect(r).toEqual({ ok: true, added: 1 });
    expect(proposals.value.map((p) => [p.id, p.store, p.from])).toEqual([['f1', '받을것', '밥']]);
    expect(queue.value.filter((q) => q.kind === 'proposal')).toHaveLength(1);
    expect(await importProposals()).toEqual({ ok: true, added: 0 });
    expect(proposals.value).toHaveLength(1);
  });

  it('같은 제안 ID가 두 파일로 올라오면 하나만 받는다', async () => {
    shareConfig.value = cfg(['bob@x.com']);
    serve([file('f1', 'bob@x.com', { ...base, id: 'same' }), file('f2', 'bob@x.com', { ...base, id: 'same' })]);
    expect(await importProposals()).toEqual({ ok: true, added: 1 });
  });

  it('입력하면 내역 pr_ID가 생기고, 입력하지 않음은 동기화되는 기록을 남겨 다시 받지 않는다', async () => {
    shareConfig.value = cfg(['bob@x.com']);
    serve([file('f1', 'bob@x.com', { ...base, id: 'a' }), file('f2', 'bob@x.com', { ...base, id: 'b', store: '제외할것' })]);
    await importProposals();
    const items = queue.value.filter((q) => q.kind === 'proposal');
    await applyQueue([{ item: items[0], action: 'enter' }, { item: items[1], action: 'skip' }]);
    expect(entries.value.some((e) => e.id === 'pr_f1')).toBe(true);
    expect((await db().fixedSkips.get('pr_f2'))?.deleted).toBeFalsy();
    // 다른 기기처럼 제안 표를 비운 상태에서도 다시 받지 않는다
    await db().proposals.clear();
    proposals.value = [];
    expect(await importProposals()).toEqual({ ok: true, added: 0 });
    expect(proposals.value).toHaveLength(0);
  });

  it('공유 권한 토큰이 없으면 요청하지 않고 다시 연결을 안내한다', async () => {
    shareConfig.value = cfg(['bob@x.com']);
    localStorage.removeItem('gagyeboo.token');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await importProposals();
    expect(r).toMatchObject({ ok: false, reconnect: true });
    expect(f).not.toHaveBeenCalled();
  });
});
