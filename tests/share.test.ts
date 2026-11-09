import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEntry, initStore, removeEntry, entries } from '../src/store/store';
import { buildMirror, inviteGuest, MAX_GUESTS, publishMirror, removeGuest, shareConfig, type ShareConfig } from '../src/sync/share';

let n = 0;
const cfg = (guests: ShareConfig['guests'] = []): ShareConfig => ({
  v: 1, folderId: 'root1', dataId: 'data1', inboxId: 'inbox1', mirrorId: 'mir1', guests, createdAt: 1,
});
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  await initStore(`share-${++n}`);
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  localStorage.setItem('gagyeboo.share', '1');
  localStorage.setItem('gagyeboo.token', JSON.stringify({ token: 'tk', exp: Date.now() + 3_000_000, scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  shareConfig.value = null;
});

describe('공유 미러', () => {
  it('지운 기록은 미러에 담지 않고 inbox ID와 주인 정보를 담는다', async () => {
    const keep = await addEntry({ date: '2026-03-01', amount: 1000, store: '남길곳' } as never);
    const gone = await addEntry({ date: '2026-03-02', amount: 2000, store: '지울곳' } as never);
    await removeEntry(gone.id);
    expect(entries.value.some((e) => e.id === gone.id)).toBe(false);
    const m = await buildMirror(cfg(), 123);
    expect(m.app).toBe('gagyeboo-mirror');
    expect(m.publishedAt).toBe(123);
    expect(m.inboxId).toBe('inbox1');
    expect(m.backup.entries.map((e) => e.id)).toContain(keep.id);
    expect(m.backup.entries.some((e) => e.id === gone.id)).toBe(false);
    expect(m.backup.entries.every((e) => !e.deleted)).toBe(true);
  });
});

describe('손님 초대·해제 호출', () => {
  it('초대는 공유 폴더 읽기 + inbox 쓰기, 알림 메일 없음, 이메일은 소문자', async () => {
    shareConfig.value = cfg();
    const calls: { url: string; body: unknown; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? safe(init.body as string) : null, method: init?.method ?? 'GET' });
      return reply(200, { id: 'x' });
    }));
    const r = await inviteGuest(' Bob@Example.com ');
    expect(r).toEqual({ ok: true });
    const perms = calls.filter((c) => c.url.includes('/permissions'));
    expect(perms).toHaveLength(2);
    expect(perms[0].url).toContain('/files/root1/permissions');
    expect(perms[0].body).toEqual({ type: 'user', role: 'reader', emailAddress: 'bob@example.com' });
    expect(perms[1].url).toContain('/files/inbox1/permissions');
    expect(perms[1].body).toEqual({ type: 'user', role: 'writer', emailAddress: 'bob@example.com' });
    expect(perms.every((p) => p.url.includes('sendNotificationEmail=false'))).toBe(true);
    expect(shareConfig.value?.guests.map((g) => g.email)).toEqual(['bob@example.com']);
  });

  it('잘못된 주소·중복·정원 초과는 호출 없이 거절', async () => {
    const f = vi.fn(async () => reply(200, {}));
    vi.stubGlobal('fetch', f);
    shareConfig.value = cfg([{ email: 'a@b.com', addedAt: 1 }]);
    expect((await inviteGuest('nope')).ok).toBe(false);
    expect((await inviteGuest('A@b.com')).ok).toBe(false);
    shareConfig.value = cfg(Array.from({ length: MAX_GUESTS }, (_, i) => ({ email: `g${i}@b.com`, addedAt: 1 })));
    const r = await inviteGuest('new@b.com');
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('읽기 권한 부여가 실패하면 손님이 늘지 않는다', async () => {
    shareConfig.value = cfg();
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: { message: 'bad' } })));
    const r = await inviteGuest('x@y.zz');
    expect(r.ok).toBe(false);
    expect(shareConfig.value?.guests).toHaveLength(0);
  });

  it('해제는 두 폴더의 해당 권한만 지운다', async () => {
    shareConfig.value = cfg([{ email: 'bob@example.com', addedAt: 1 }, { email: 'cat@example.com', addedAt: 1 }]);
    const deleted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { deleted.push(url); return new Response(null, { status: 204 }); }
      if (url.includes('/permissions')) {
        return reply(200, { permissions: [{ id: 'own', role: 'owner', emailAddress: 'me@x.com' }, { id: 'pb', emailAddress: 'bob@example.com' }, { id: 'pc', emailAddress: 'cat@example.com' }] });
      }
      return reply(200, { id: 'x' });
    }));
    const r = await removeGuest('Bob@example.com');
    expect(r.ok).toBe(true);
    expect(deleted.map((u) => u.replace(/\?.*/, '').replace(/^.*\/files\//, ''))).toEqual(['root1/permissions/pb', 'inbox1/permissions/pb']);
    expect(shareConfig.value?.guests.map((g) => g.email)).toEqual(['cat@example.com']);
  });
});

describe('미러 올리기', () => {
  it('내용이 같으면 두 번째는 올리지 않고, force면 올린다', async () => {
    shareConfig.value = cfg();
    const puts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') puts.push(url);
      return reply(200, { id: 'mir1' });
    }));
    expect((await publishMirror()).ok).toBe(true);
    expect(puts).toHaveLength(1);
    await publishMirror();
    expect(puts).toHaveLength(1);
    await publishMirror({ force: true });
    expect(puts).toHaveLength(2);
  });

  it('공유 권한 토큰이 없으면 올리지 않고 다시 연결 필요로 알린다', async () => {
    shareConfig.value = cfg();
    localStorage.removeItem('gagyeboo.token');
    const f = vi.fn(async () => reply(200, {}));
    vi.stubGlobal('fetch', f);
    const r = await publishMirror();
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

function safe(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
