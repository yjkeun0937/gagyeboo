import type { DriveClient, RemoteFile } from './engine';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,version';

/** 토큰이 없거나 만료·거부됨 → 다시 연결해야 한다 */
export class AuthError extends Error {}
/** 네트워크에 닿지 못함 (오프라인 등) */
export class OfflineError extends Error {}

interface DriveFileInfo {
  id: string;
  name: string;
  version?: string;
}
const info = (f: DriveFileInfo): RemoteFile => ({ id: f.id, name: f.name, version: String(f.version ?? '') });

/** 구글 드라이브 v3 REST로 앱 전용 폴더(appDataFolder)를 읽고 쓴다 */
export class GoogleDriveClient implements DriveClient {
  constructor(private getToken: () => string | null) {}

  private async req(url: string, init: RequestInit = {}, allow404 = false): Promise<Response> {
    const token = this.getToken();
    if (!token) throw new AuthError('로그인이 필요합니다');
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new OfflineError('네트워크에 연결할 수 없습니다');
    }
    if (res.status === 401) throw new AuthError('구글 로그인이 만료되었습니다');
    if (res.status === 404 && allow404) return res;
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message ?? '';
        const reason = body?.error?.errors?.[0]?.reason ?? '';
        if (res.status === 403 && /insufficient|auth/i.test(reason)) throw new AuthError('드라이브 저장 권한이 없습니다');
        if (res.status === 403 && /storageQuota|quota/i.test(reason)) throw new Error('구글 드라이브 저장 공간이 부족합니다');
      } catch (e) {
        if (e instanceof AuthError || (e instanceof Error && /공간/.test(e.message))) throw e;
      }
      throw new Error(`드라이브 오류 ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return res;
  }

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    let page = '';
    do {
      const q = new URLSearchParams({
        spaces: 'appDataFolder',
        pageSize: '200',
        fields: `nextPageToken,files(${FIELDS})`,
      });
      if (page) q.set('pageToken', page);
      const body = (await (await this.req(`${API}/files?${q}`)).json()) as { files?: DriveFileInfo[]; nextPageToken?: string };
      for (const f of body.files ?? []) out.push(info(f));
      page = body.nextPageToken ?? '';
    } while (page);
    return out;
  }

  async read(id: string): Promise<string> {
    return (await this.req(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
  }

  async create(name: string, content: string): Promise<RemoteFile> {
    const boundary = `gagyeboo${Math.random().toString(36).slice(2)}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' }) +
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.req(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return info((await res.json()) as DriveFileInfo);
  }

  async update(id: string, content: string): Promise<RemoteFile> {
    const res = await this.req(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: content,
    });
    return info((await res.json()) as DriveFileInfo);
  }

  async remove(id: string): Promise<void> {
    await this.req(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' }, true);
  }

  async stat(id: string): Promise<RemoteFile | null> {
    const res = await this.req(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`, {}, true);
    if (res.status === 404) return null;
    return info((await res.json()) as DriveFileInfo);
  }
}
