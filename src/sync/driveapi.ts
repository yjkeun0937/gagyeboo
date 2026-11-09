/**
 * 구글 드라이브 v3 REST 호출 모음 (넓은 범위가 필요한 공유 기능과 시험 화면이 함께 쓴다).
 * 오류를 던지지 않고 상태 코드와 본문을 그대로 돌려주며, 호출하는 쪽에서 판단한다.
 */
export interface LabCall {
  status: number;
  ok: boolean;
  data: unknown;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER = 'application/vnd.google-apps.folder';

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

