/**
 * 계정 공유 시험용(2단계 시제품). 실제 앱의 로그인·동기화와 완전히 분리되어 있으며,
 * 주소 끝에 #share-lab 을 붙여 열었을 때만 쓰인다. 토큰은 메모리에만 두고 저장하지 않는다.
 * 목적: 드라이브 권한 범위(drive.file / drive)에서 공유 폴더 읽기·쓰기·삭제가 실제로 어떻게 동작하는지 확인.
 */
export type LabScope = 'drive.file' | 'drive';

export interface LabCall {
  status: number;
  ok: boolean;
  data: unknown;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER = 'application/vnd.google-apps.folder';

interface TokenResp {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisOauth {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResp) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): { requestAccessToken(o?: { prompt?: string }): void };
}
const g = () => (window as unknown as { google?: { accounts: { oauth2: GisOauth } } }).google;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트를 불러오지 못했습니다: ${src}`));
    document.head.appendChild(s);
  });
}

export interface LabSession {
  token: string;
  email: string;
  grantedScope: string;
}

/** 지정한 범위로 로그인한다. 사용자가 누른 직후에 호출해야 팝업이 막히지 않는다 */
export async function labSignIn(clientId: string, scope: LabScope): Promise<LabSession> {
  await loadScript('https://accounts.google.com/gsi/client');
  const oauth = g()?.accounts.oauth2;
  if (!oauth) throw new Error('구글 로그인 스크립트가 준비되지 않았습니다');
  const res = await new Promise<TokenResp>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: `openid email profile https://www.googleapis.com/auth/${scope}`,
      callback: (r) => (r.error || !r.access_token ? reject(new Error(r.error_description || r.error || '로그인 실패')) : resolve(r)),
      error_callback: (e) => reject(new Error(e.message || e.type || '로그인 창이 닫혔습니다')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
  const token = res.access_token!;
  const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  const info = (await u.json()) as { email?: string };
  return { token, email: info.email ?? '(이메일 없음)', grantedScope: res.scope ?? '' };
}

/** 오류도 던지지 않고 상태 코드와 본문을 그대로 돌려준다 (시험 결과를 기록하기 위해) */
export async function call(token: string, url: string, init: RequestInit = {}): Promise<LabCall> {
  try {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* 본문이 JSON이 아님 */
    }
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: (e as Error).message };
  }
}

const FILE_FIELDS =
  'id,name,mimeType,trashed,createdTime,modifiedTime,owners(emailAddress),lastModifyingUser(emailAddress),capabilities(canEdit,canDelete,canTrash,canAddChildren,canListChildren)';

export const getFile = (t: string, id: string) => call(t, `${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`);

export const listChildren = (t: string, folderId: string) =>
  call(
    t,
    `${API}/files?` +
      new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: `files(${FILE_FIELDS})`,
        pageSize: '100',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      }),
  );

export const sharedWithMe = (t: string) =>
  call(t, `${API}/files?` + new URLSearchParams({ q: 'sharedWithMe = true and trashed = false', fields: `files(${FILE_FIELDS})`, pageSize: '50' }));

export const readText = (t: string, id: string) => call(t, `${API}/files/${encodeURIComponent(id)}?alt=media`);

export const createFolder = (t: string, name: string, parent?: string) =>
  call(t, `${API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });

export async function createJson(t: string, name: string, parent: string, content: string): Promise<LabCall> {
  const b = `lab${Math.random().toString(36).slice(2)}`;
  const body =
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [parent], mimeType: 'application/json' }) +
    `\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`;
  return call(t, `${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  });
}

export const updateText = (t: string, id: string, content: string) =>
  call(t, `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  });

export const share = (t: string, id: string, email: string, role: 'reader' | 'writer') =>
  call(t, `${API}/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=false&fields=id,role,emailAddress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  });

export const listPermissions = (t: string, id: string) =>
  call(t, `${API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,role,type,emailAddress)`);

export const removePermission = (t: string, id: string, permId: string) =>
  call(t, `${API}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permId)}`, { method: 'DELETE' });

export const trash = (t: string, id: string) =>
  call(t, `${API}/files/${encodeURIComponent(id)}?fields=id,trashed`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });

export const remove = (t: string, id: string) => call(t, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** 구글 파일 선택 창(Picker)으로 폴더(또는 파일)를 고른다. 선택한 항목은 drive.file 범위에서도 접근할 수 있게 된다 */
export async function pick(token: string, apiKey: string, appId: string, kind: 'folder' | 'file'): Promise<{ id: string; name: string } | null> {
  await loadScript('https://apis.google.com/js/api.js');
  const gapi = (window as unknown as { gapi: { load(n: string, cb: () => void): void } }).gapi;
  await new Promise<void>((r) => gapi.load('picker', () => r()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gp = (window as any).google.picker;
  return new Promise((resolve) => {
    const view = new gp.DocsView(kind === 'folder' ? gp.ViewId.FOLDERS : gp.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(kind === 'folder')
      .setOwnedByMe(false);
    const builder = new gp.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === gp.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === gp.Action.CANCEL) resolve(null);
      });
    if (appId) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}
