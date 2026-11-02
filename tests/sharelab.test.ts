import { afterEach, describe, expect, it, vi } from 'vitest';
import * as L from '../src/sync/sharelab';

const reply = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('공유 시험 드라이브 호출', () => {
  it('오류 응답도 던지지 않고 상태와 본문을 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(403, { error: { message: 'denied' } })));
    const r = await L.call('tok', 'https://x');
    expect(r).toMatchObject({ status: 403, ok: false });
    expect((r.data as { error: { message: string } }).error.message).toBe('denied');
  });

  it('네트워크 오류는 status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await L.call('t', 'https://x')).toMatchObject({ status: 0, ok: false, data: 'offline' });
  });

  it('폴더 만들기·공유 요청 형태', async () => {
    const f = vi.fn(async () => reply(200, { id: 'a' }));
    vi.stubGlobal('fetch', f);
    await L.createFolder('t', 'data', 'root1');
    const [url1, init1] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toContain('/drive/v3/files');
    expect(JSON.parse(init1.body as string)).toEqual({ name: 'data', mimeType: L.FOLDER, parents: ['root1'] });
    await L.share('t', 'fid', 'a@b.c', 'writer');
    const [url2, init2] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toContain('/files/fid/permissions');
    expect(url2).toContain('sendNotificationEmail=false');
    expect(JSON.parse(init2.body as string)).toEqual({ type: 'user', role: 'writer', emailAddress: 'a@b.c' });
    expect((init2.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('하위 목록 질의는 휴지통 제외·소유자/수정자 필드 포함', async () => {
    const f = vi.fn(async () => reply(200, { files: [] }));
    vi.stubGlobal('fetch', f);
    await L.listChildren('t', 'inbox1');
    const url = decodeURIComponent((f.mock.calls[0] as unknown as [string])[0].replace(/\+/g, ' '));
    expect(url).toContain("'inbox1' in parents and trashed = false");
    expect(url).toContain('owners(emailAddress)');
    expect(url).toContain('lastModifyingUser(emailAddress)');
  });
});
