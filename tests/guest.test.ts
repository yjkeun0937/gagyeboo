import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEntry, entries, exportAll, initStore, installCopy, settings, updateSettings } from '../src/store/store';
import { guestMode, ReadOnlyError } from '../src/store/mode';
import {
  flushOutbox,
  guestLink,
  guestOutbox,
  KEEP_SENT_DAYS,
  parseMirror,
  sendProposal,
  type GuestLink,
  type OutboxItem,
} from '../src/sync/guest';

let n = 0;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const link = (over: Partial<GuestLink> = {}): GuestLink => ({
  v: 1, ownerName: '주인', ownerEmail: 'o@x.com', guestEmail: 'g@x.com', guestName: '손님', mirrorId: 'mir1', inboxId: 'inbox1',
  linkedAt: 1, publishedAt: 1, modifiedTime: 't1', checkedAt: 1, state: 'active', ...over,
});

function mem() {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}
const withToken = () => localStorage.setItem('gagyeboo.guestToken', JSON.stringify({ token: 'gt', exp: Date.now() + 3_000_000 }));

beforeEach(async () => {
  mem();
  guestMode.value = false;
  await initStore(`guest-${++n}`);
  guestLink.value = null;
  guestOutbox.value = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  guestMode.value = false;
});

describe('손님 모드: 저장소 쓰기 차단', () => {
  it('내역 추가·공유 설정(목표) 변경은 막히고, 화면 설정은 된다', async () => {
    guestMode.value = true;
    await expect(addEntry({ date: '2026-03-01', amount: 1, store: 'a', memo: '', category: null, user: null, payMethod: null, payDetail: null })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(updateSettings({ monthlyGoal: 100 })).rejects.toBeInstanceOf(ReadOnlyError);
    await updateSettings({ theme: 'dark' });
    expect(settings.value.theme).toBe('dark');
  });

  it('사본 설치: 손님 모드에서만, 화면 취향은 손님 것을 유지하고 목표는 주인 것을 따른다', async () => {
    const owner = await exportAll();
    owner.entries = [{ id: 'e1', date: '2026-03-01', amount: 5000, store: '주인상점', memo: '', category: null, user: null, payMethod: null, payDetail: null, source: 'manual', createdAt: 1, updatedAt: 1 }];
    owner.settings = { ...owner.settings, monthlyGoal: 777, theme: 'light' };
    await expect(installCopy(owner, '2026-01')).rejects.toThrow();
    guestMode.value = true;
    await updateSettings({ theme: 'dark', fontScale: 120 });
    await installCopy(owner, '2026-01');
    expect(entries.value.map((e) => e.store)).toEqual(['주인상점']);
    expect(settings.value.monthlyGoal).toBe(777);
    expect(settings.value.theme).toBe('dark');
    expect(settings.value.fontScale).toBe(120);
  });
});

describe('미러 검사', () => {
  it('올바른 미러만 받아들인다', async () => {
    const backup = await exportAll();
    const ok = { app: 'gagyeboo-mirror', v: 1, publishedAt: 1, owner: { name: 'a', email: 'b' }, inboxId: 'i', firstUseYm: null, backup };
    expect(parseMirror(ok)).not.toBeNull();
    expect(parseMirror({ ...ok, app: 'x' })).toBeNull();
    expect(parseMirror({ ...ok, inboxId: '' })).toBeNull();
    expect(parseMirror({ ...ok, backup: { entries: 1 } })).toBeNull();
    expect(parseMirror(null)).toBeNull();
    expect(parseMirror('text')).toBeNull();
  });
});

describe('제안 보내기', () => {
  it('제안 파일을 주인의 inbox에 올리고 보낸 것으로 기록한다', async () => {
    guestMode.value = true;
    guestLink.value = link();
    withToken();
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return reply(200, { id: 'file1' });
    }));
    const r = await sendProposal({ date: '2026-03-02', store: '상점', memo: '', category: 'c1', amount: 3300, user: null, payMethod: null, payDetail: null });
    expect(r.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('uploadType=multipart');
    expect(calls[0].body).toContain('"parents":["inbox1"]');
    expect(calls[0].body).toContain('"app":"gagyeboo-proposal"');
    expect(calls[0].body).toContain('"amount":3300');
    expect(guestOutbox.value[0]).toMatchObject({ status: 'sent', fileId: 'file1' });
  });

  it('토큰이 없으면 보내지 않고 대기로 남긴다', async () => {
    guestMode.value = true;
    guestLink.value = link();
    const f = vi.fn(async () => reply(200, {}));
    vi.stubGlobal('fetch', f);
    const r = await sendProposal({ date: '2026-03-02', store: '상점', memo: '', category: null, amount: 100, user: null, payMethod: null, payDetail: null });
    expect(r.sent).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(guestOutbox.value).toHaveLength(1);
    expect(guestOutbox.value[0].status).toBe('pending');
  });

  it('연결이 끊긴 사본에는 제안을 보내지 않는다', async () => {
    guestLink.value = link({ state: 'disconnected' });
    withToken();
    const r = await sendProposal({ date: '2026-03-02', store: 's', memo: '', category: null, amount: 100, user: null, payMethod: null, payDetail: null });
    expect(r.sent).toBe(false);
    expect(guestOutbox.value).toHaveLength(0);
  });

  it('보내기가 404로 거절되면 실패로 표시하고 연결 끊김을 확인한다', async () => {
    guestMode.value = true;
    guestLink.value = link();
    withToken();
    vi.stubGlobal('fetch', vi.fn(async () =>
      reply(404, { error: { message: 'File not found', errors: [{ reason: 'notFound' }] } }),
    ));
    const r = await sendProposal({ date: '2026-03-02', store: 's', memo: '', category: null, amount: 100, user: null, payMethod: null, payDetail: null });
    expect(r.sent).toBe(false);
    expect(guestOutbox.value[0].status).toBe('failed');
    await vi.waitFor(() => expect(guestLink.value?.state).toBe('disconnected'));
  });

  it(`${KEEP_SENT_DAYS}일 지난 보낸 제안은 내가 올린 파일을 지우고 기록에서 뺀다`, async () => {
    guestMode.value = true;
    guestLink.value = link();
    withToken();
    const old: OutboxItem = {
      id: 'old', createdAt: 1, status: 'sent', fileId: 'fOld', sentAt: Date.now() - (KEEP_SENT_DAYS + 1) * 86_400_000,
      payload: { app: 'gagyeboo-proposal', v: 1, id: 'old', createdAt: 1, from: 'g', date: '2026-01-01', store: 'x', memo: '', category: null, amount: 1, user: null, payMethod: null, payDetail: null },
    };
    const fresh: OutboxItem = { ...old, id: 'fresh', fileId: 'fFresh', sentAt: Date.now() };
    guestOutbox.value = [fresh, old];
    const dels: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') dels.push(url);
      return new Response(null, { status: 204 });
    }));
    await flushOutbox();
    expect(dels).toHaveLength(1);
    expect(dels[0]).toContain('/files/fOld');
    expect(guestOutbox.value.map((x) => x.id)).toEqual(['fresh']);
  });
});
