/**
 * 계정 공유 (주인 쪽).
 * - 주인의 드라이브에 공유 폴더(가계부 공유/data, inbox)를 만들고, 손님 계정에 권한을 준다.
 * - data/mirror.json 하나에 가계부 내용을 통째로 올려 두면 손님이 읽기 전용으로 받아 본다.
 * - inbox는 손님이 제안 파일을 올리는 곳이다 (손님 쪽 기능은 이후 단계).
 * 설정은 이 기기(meta)와 드라이브 앱 전용 폴더(share.json)에 함께 저장해, 다른 기기에서도 이어 쓴다.
 * 공유 폴더 접근에는 드라이브 전체 범위가 필요해서, 공유를 켠 계정만 로그인할 때 그 범위를 요청한다.
 */
import { signal } from '@preact/signals';
import { db } from '../store/db';
import { categories, exportAll, payDetails, payMethods, save as saveRow, showToast, users } from '../store/store';
import { MAX_PENDING, MAX_PROPOSAL_BYTES, parseProposalFile } from '../lib/proposals';
import type { BackupFile } from '../store/store';
import { cachedShareToken, cachedToken, fetchUserInfo, forgetToken, loadAccount, requestToken, setShareScopeWanted, AuthFlowError } from './auth';
import { call, createFolder, createJson, getFile, listPermissions, readText, removePermission, share, trash, updateText, type LabCall } from './driveapi';
import { GoogleDriveClient } from './drive';

export const MAX_GUESTS = 5;
export const SHARE_FILE = 'share.json';
export const FOLDER_NAME = '가계부 공유';

export interface ShareGuest {
  email: string;
  addedAt: number;
}
export interface ShareConfig {
  v: 1;
  folderId: string;
  dataId: string;
  inboxId: string;
  mirrorId: string;
  guests: ShareGuest[];
  createdAt: number;
}
/** data/mirror.json: 손님이 읽는 파일 */
export interface MirrorFile {
  app: 'gagyeboo-mirror';
  v: 1;
  publishedAt: number;
  owner: { name: string; email: string };
  inboxId: string;
  firstUseYm: string | null;
  backup: BackupFile;
}

export const shareConfig = signal<ShareConfig | null>(null);
export const shareBusy = signal(false);
/** 바뀐 내용을 아직 손님에게 올리지 못한 상태 */
export const shareStale = signal(false);
export const sharePublishedAt = signal<number | null>(null);
export const shareError = signal<string | null>(null);
/** 손님 제안 확인 상태 */
export const proposalCheckedAt = signal<number | null>(null);
export const proposalBusy = signal(false);
export const proposalError = signal<string | null>(null);
/** 읽을 수 없어 건너뛴 제안 파일 수 (형식이 틀리거나 손님이 아닌 계정이 올린 것) */
export const proposalIgnored = signal(0);

export type ShareResult = { ok: true } | { ok: false; error: string; reconnect?: boolean };
const fail = (error: string, reconnect = false): ShareResult => ({ ok: false, error, reconnect });

/* ───────── 저장 ───────── */

async function saveLocal(cfg: ShareConfig | null) {
  if (cfg) await db().meta.put({ key: 'shareConfig', value: cfg });
  else await db().meta.delete('shareConfig');
  shareConfig.value = cfg;
}

async function driveFile(client: GoogleDriveClient) {
  return (await client.list()).find((f) => f.name === SHARE_FILE) ?? null;
}

async function saveRemote(cfg: ShareConfig): Promise<void> {
  const client = new GoogleDriveClient(() => cachedToken());
  const f = await driveFile(client);
  const body = JSON.stringify(cfg);
  if (f) await client.update(f.id, body);
  else await client.create(SHARE_FILE, body);
}

async function save(cfg: ShareConfig) {
  await saveLocal(cfg);
  await saveRemote(cfg);
}

export async function initShare(): Promise<void> {
  const row = await db().meta.get('shareConfig');
  const cfg = row?.value as ShareConfig | undefined;
  shareConfig.value = cfg && cfg.v === 1 ? cfg : null;
  const pub = (await db().meta.get('sharePublish'))?.value as { at: number; hash: string } | undefined;
  sharePublishedAt.value = pub?.at ?? null;
  if (shareConfig.value) setShareScopeWanted(true);
}

/** 로그인·동기화 뒤: 다른 기기에서 켠 공유 설정이 드라이브에 있으면 이 기기에도 가져온다 */
export async function restoreShareFromDrive(): Promise<void> {
  try {
    const client = new GoogleDriveClient(() => cachedToken());
    const f = await driveFile(client);
    if (!f) return;
    const cfg = JSON.parse(await client.read(f.id)) as ShareConfig;
    if (cfg?.v !== 1 || !cfg.folderId) return;
    // 이 기기에 있는 것과 다르면(손님 추가·해제 등) 드라이브 쪽을 따른다
    if (JSON.stringify(cfg) !== JSON.stringify(shareConfig.value)) await saveLocal(cfg);
    setShareScopeWanted(true);
  } catch {
    /* 공유 설정을 못 읽어도 동기화는 계속한다 */
  }
}

/** 로그아웃: 이 기기의 공유 설정만 지운다 (드라이브의 공유 폴더·설정은 그대로) */
export async function clearShareLocal(): Promise<void> {
  await db().meta.delete('shareConfig');
  await db().meta.delete('sharePublish');
  shareConfig.value = null;
  sharePublishedAt.value = null;
  shareStale.value = false;
  shareError.value = null;
  setShareScopeWanted(false);
}

/* ───────── 도우미 ───────── */

function explain(r: LabCall, what: string): string {
  const e = (r.data as { error?: { message?: string } } | null)?.error;
  if (r.status === 0) return `${what}: 인터넷에 연결할 수 없습니다`;
  if (r.status === 401) return `${what}: 구글 연결이 만료되었습니다`;
  return `${what}: ${e?.message ?? `오류 ${r.status}`}`;
}

/** 공유에 쓸 토큰. 없으면(만료·권한 없음) 사용자가 누른 직후에 한해 다시 허용받는다 */
async function shareToken(allowPrompt: boolean): Promise<string | null> {
  const t = cachedShareToken();
  if (t) return t;
  const acc = loadAccount();
  if (!allowPrompt || !acc) return null;
  try {
    const token = await requestToken({ prompt: '', hint: acc.email });
    const info = await fetchUserInfo(token);
    if (info.sub !== acc.sub) {
      showToast(`연결된 계정(${acc.email})이 아닌 ${info.email} 계정입니다. 같은 계정으로 다시 시도해 주세요`);
      return null;
    }
    return cachedShareToken();
  } catch (e) {
    if (!(e instanceof AuthFlowError && e.code === 'closed')) showToast(e instanceof Error ? e.message : String(e));
    return null;
  }
}

const NEED_RECONNECT = '구글 연결이 만료되었습니다. 「구글 다시 연결」을 누른 뒤 다시 시도해 주세요';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ───────── 미러(손님이 읽는 내용) ───────── */

/** 지운 기록(삭제 표시)을 빼고, 손님이 보면 되는 내용만 담는다 */
export async function buildMirror(cfg: ShareConfig, now = Date.now()): Promise<MirrorFile> {
  const b = await exportAll();
  const live = <T extends { deleted?: boolean }>(rows: T[] | undefined) => (rows ?? []).filter((r) => !r.deleted);
  const acc = loadAccount();
  const fu = (await db().meta.get('firstUseYm'))?.value;
  return {
    app: 'gagyeboo-mirror',
    v: 1,
    publishedAt: now,
    owner: { name: acc?.name ?? '', email: acc?.email ?? '' },
    inboxId: cfg.inboxId,
    firstUseYm: typeof fu === 'string' ? fu : null,
    backup: {
      ...b,
      entries: live(b.entries),
      categories: live(b.categories),
      users: live(b.users),
      payMethods: live(b.payMethods),
      payDetails: live(b.payDetails),
      fixedItems: live(b.fixedItems),
      fixedRuns: live(b.fixedRuns),
      fixedSkips: live(b.fixedSkips),
      assets: live(b.assets),
      assetLogs: live(b.assetLogs),
    },
  };
}

let publishing = false;
let publishAgain = false;
let publishTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 가계부 내용을 mirror.json에 올린다. 내용이 지난번과 같으면(force가 아니면) 올리지 않는다.
 * 로그인이 만료되어 올리지 못하면 '최신이 아님'으로 표시하고, 다시 연결한 뒤 올린다.
 */
export async function publishMirror(opts: { force?: boolean; allowPrompt?: boolean } = {}): Promise<ShareResult> {
  const cfg = shareConfig.value;
  if (!cfg) return fail('공유가 켜져 있지 않습니다');
  if (publishing) {
    publishAgain = true;
    return { ok: true };
  }
  const token = await shareToken(!!opts.allowPrompt);
  if (!token) {
    shareStale.value = true;
    return fail(NEED_RECONNECT, true);
  }
  publishing = true;
  try {
    const mirror = await buildMirror(cfg);
    const hash = await sha256(JSON.stringify({ ...mirror, publishedAt: 0, backup: { ...mirror.backup, exportedAt: '' } }));
    const prev = (await db().meta.get('sharePublish'))?.value as { at: number; hash: string } | undefined;
    if (!opts.force && prev?.hash === hash) {
      shareStale.value = false;
      return { ok: true };
    }
    const body = JSON.stringify(mirror);
    let r = await updateText(token, cfg.mirrorId, body);
    if (r.status === 404) {
      // 드라이브에서 mirror.json이 지워졌으면 다시 만든다
      const c = await createJson(token, 'mirror.json', cfg.dataId, body);
      const id = (c.data as { id?: string } | null)?.id;
      if (!c.ok || !id) return fail(explain(c, '공유 내용 올리기'));
      await save({ ...cfg, mirrorId: id });
      r = c;
    }
    if (r.status === 401) {
      forgetToken();
      shareStale.value = true;
      return fail(NEED_RECONNECT, true);
    }
    if (!r.ok) {
      shareStale.value = true;
      return fail(explain(r, '공유 내용 올리기'));
    }
    await db().meta.put({ key: 'sharePublish', value: { at: mirror.publishedAt, hash } });
    sharePublishedAt.value = mirror.publishedAt;
    shareStale.value = false;
    shareError.value = null;
    return { ok: true };
  } catch (e) {
    shareStale.value = true;
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    publishing = false;
    if (publishAgain) {
      publishAgain = false;
      schedulePublish(2000);
    }
  }
}

/** 내용이 바뀐 뒤 잠시 모았다가 올린다. 손님이 없으면 올리지 않는다 */
export function schedulePublish(delay = 20_000) {
  const cfg = shareConfig.value;
  if (!cfg || cfg.guests.length === 0) return;
  shareStale.value = true;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    void publishMirror().then((r) => {
      if (!r.ok && !r.reconnect) shareError.value = r.error;
    });
  }, delay);
}

/* ───────── 켜기·끄기 ───────── */

/** 공유 켜기: 권한을 넓게 다시 허용받고, 드라이브에 공유 폴더를 만든 뒤 첫 내용을 올린다. 누른 직후에 불러야 한다 */
export async function enableSharing(): Promise<ShareResult> {
  const acc = loadAccount();
  if (!acc) return fail('먼저 구글 계정으로 로그인해 주세요');
  if (shareConfig.value) return { ok: true };
  shareBusy.value = true;
  setShareScopeWanted(true);
  try {
    let token: string;
    try {
      token = await requestToken({ prompt: 'consent', hint: acc.email });
      const info = await fetchUserInfo(token);
      if (info.sub !== acc.sub) {
        setShareScopeWanted(false);
        return fail(`연결된 계정(${acc.email})이 아닌 ${info.email} 계정으로 허용했습니다. 같은 계정으로 다시 시도해 주세요`);
      }
    } catch (e) {
      setShareScopeWanted(false);
      if (e instanceof AuthFlowError && e.code === 'closed') return fail('허용 창이 닫혔습니다');
      return fail(e instanceof Error ? e.message : String(e));
    }
    const t = cachedShareToken();
    if (!t) {
      setShareScopeWanted(false);
      return fail('드라이브 전체 접근 권한이 허용되지 않았습니다');
    }
    const root = await createFolder(t, FOLDER_NAME);
    const rootId = (root.data as { id?: string } | null)?.id;
    if (!root.ok || !rootId) return fail(explain(root, '공유 폴더 만들기'));
    const data = await createFolder(t, 'data', rootId);
    const inbox = await createFolder(t, 'inbox', rootId);
    const dataId = (data.data as { id?: string } | null)?.id;
    const inboxId = (inbox.data as { id?: string } | null)?.id;
    if (!data.ok || !inbox.ok || !dataId || !inboxId) return fail(explain(data.ok ? inbox : data, '공유 폴더 만들기'));
    const draft: ShareConfig = { v: 1, folderId: rootId, dataId, inboxId, mirrorId: '', guests: [], createdAt: Date.now() };
    const mirror = await buildMirror(draft);
    const m = await createJson(t, 'mirror.json', dataId, JSON.stringify(mirror));
    const mirrorId = (m.data as { id?: string } | null)?.id;
    if (!m.ok || !mirrorId) return fail(explain(m, '공유 내용 만들기'));
    await save({ ...draft, mirrorId });
    const hash = await sha256(JSON.stringify({ ...mirror, publishedAt: 0, backup: { ...mirror.backup, exportedAt: '' } }));
    await db().meta.put({ key: 'sharePublish', value: { at: mirror.publishedAt, hash } });
    sharePublishedAt.value = mirror.publishedAt;
    shareStale.value = false;
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    shareBusy.value = false;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 손님 초대: 공유 폴더는 읽기, inbox는 쓰기 권한을 준다 */
export async function inviteGuest(rawEmail: string): Promise<ShareResult> {
  const cfg = shareConfig.value;
  if (!cfg) return fail('공유가 켜져 있지 않습니다');
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return fail('이메일 주소를 확인해 주세요');
  if (email === (loadAccount()?.email ?? '').toLowerCase()) return fail('내 계정은 손님으로 초대할 수 없습니다');
  if (cfg.guests.some((g) => g.email === email)) return fail('이미 초대한 손님입니다');
  if (cfg.guests.length >= MAX_GUESTS) return fail(`손님은 최대 ${MAX_GUESTS}명까지 초대할 수 있습니다`);
  shareBusy.value = true;
  try {
    const t = await shareToken(true);
    if (!t) return fail(NEED_RECONNECT, true);
    const a = await share(t, cfg.folderId, email, 'reader');
    if (!a.ok) return fail(a.status === 400 ? `${email}: 구글 계정이 아니거나 공유할 수 없는 주소입니다` : explain(a, '손님 초대'));
    const b = await share(t, cfg.inboxId, email, 'writer');
    if (!b.ok) {
      await removeEmailPermissions(t, [cfg.folderId], email);
      return fail(explain(b, '손님 초대'));
    }
    await save({ ...cfg, guests: [...cfg.guests, { email, addedAt: Date.now() }] });
    const p = await publishMirror({ force: true });
    if (!p.ok) shareError.value = p.error;
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    shareBusy.value = false;
  }
}

async function removeEmailPermissions(token: string, folderIds: string[], email: string): Promise<LabCall | null> {
  for (const id of folderIds) {
    const l = await listPermissions(token, id);
    if (!l.ok) return l;
    const ps = ((l.data as { permissions?: { id: string; emailAddress?: string }[] } | null)?.permissions ?? []).filter(
      (p) => p.emailAddress?.toLowerCase() === email,
    );
    for (const p of ps) {
      const d = await removePermission(token, id, p.id);
      if (!d.ok && d.status !== 404) return d;
    }
  }
  return null;
}

/** 손님 해제: 두 폴더의 권한을 지운다. 손님 기기에 이미 받은 사본은 손님 쪽에 남는다 */
export async function removeGuest(rawEmail: string): Promise<ShareResult> {
  const cfg = shareConfig.value;
  if (!cfg) return fail('공유가 켜져 있지 않습니다');
  const email = rawEmail.trim().toLowerCase();
  shareBusy.value = true;
  try {
    const t = await shareToken(true);
    if (!t) return fail(NEED_RECONNECT, true);
    const bad = await removeEmailPermissions(t, [cfg.folderId, cfg.inboxId], email);
    if (bad) return fail(explain(bad, '손님 해제'));
    await save({ ...cfg, guests: cfg.guests.filter((g) => g.email !== email) });
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    shareBusy.value = false;
  }
}

/** 공유 끄기: 모든 손님의 권한을 지우고 공유 폴더를 휴지통으로 옮긴다 */
export async function disableSharing(): Promise<ShareResult> {
  const cfg = shareConfig.value;
  if (!cfg) return { ok: true };
  shareBusy.value = true;
  try {
    const t = await shareToken(true);
    if (!t) return fail(NEED_RECONNECT, true);
    for (const g of cfg.guests) {
      const bad = await removeEmailPermissions(t, [cfg.folderId, cfg.inboxId], g.email);
      if (bad) return fail(explain(bad, '손님 해제'));
    }
    const tr = await trash(t, cfg.folderId);
    if (!tr.ok && tr.status !== 404) return fail(explain(tr, '공유 폴더 정리'));
    const client = new GoogleDriveClient(() => cachedToken());
    const f = await driveFile(client);
    if (f) await client.remove(f.id);
    clearTimeout(publishTimer);
    await db().meta.delete('sharePublish');
    sharePublishedAt.value = null;
    shareStale.value = false;
    shareError.value = null;
    await saveLocal(null);
    setShareScopeWanted(false);
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    shareBusy.value = false;
  }
}

/** 공유 폴더가 드라이브에 아직 있는지 확인 (설정 화면에서 안내용) */
export async function folderExists(): Promise<boolean | null> {
  const cfg = shareConfig.value;
  const t = cachedShareToken();
  if (!cfg || !t) return null;
  const r = await getFile(t, cfg.folderId);
  if (r.status === 404) return false;
  return r.ok ? !(r.data as { trashed?: boolean })?.trashed : null;
}

/* ───────── 손님 제안 받기 ───────── */

const INBOX_NAME = /^proposal-[A-Za-z0-9_-]{8,64}\.json$/;
const MAX_PER_RUN = 50;
const MAX_REJECTED = 500;

interface InboxFile {
  id: string;
  name: string;
  trashed?: boolean;
  size?: string;
  createdTime?: string;
  owners?: { emailAddress?: string; displayName?: string }[];
}

async function listInbox(token: string, inboxId: string): Promise<{ files: InboxFile[] } | LabCall> {
  const files: InboxFile[] = [];
  let page = '';
  for (let i = 0; i < 20; i++) {
    const r = await call(
      token,
      'https://www.googleapis.com/drive/v3/files?' +
        new URLSearchParams({
          q: `'${inboxId}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,name,trashed,size,createdTime,owners(emailAddress,displayName))',
          pageSize: '100',
          ...(page ? { pageToken: page } : {}),
        }),
    );
    if (!r.ok) return r;
    const d = r.data as { files?: InboxFile[]; nextPageToken?: string } | null;
    files.push(...(d?.files ?? []));
    if (!d?.nextPageToken) break;
    page = d.nextPageToken;
  }
  return { files };
}

/** 이 기기에서(또는 다른 기기에서 동기화된 기록으로) 이미 받았거나 처리한 제안 파일인가 */
async function alreadyHandled(fileId: string): Promise<boolean> {
  const d = db();
  if (await d.proposals.get(fileId)) return true;
  if (await d.entries.get(`pr_${fileId}`)) return true;
  const skip = await d.fixedSkips.get(`pr_${fileId}`);
  return !!skip && !skip.deleted;
}

type ImportResult = { ok: true; added: number } | { ok: false; error: string; reconnect?: boolean };
const bad = (error: string, reconnect = false): ImportResult => ({ ok: false, error, reconnect });
let importing = false;

/**
 * 손님이 inbox에 올린 제안 파일을 읽어 입력 대기에 넣는다.
 * - 제안자는 파일의 드라이브 소유자(구글이 정한 값)로 정하고, 현재 초대한 손님이 아닌 계정이 올린 파일은 무시한다.
 * - 내용은 검사하고 주인의 목록에 없는 항목은 비운다. 파일은 손님 것이라 주인이 지울 수 없으므로 처리한 기록은 이 기기·동기화 데이터에 남긴다.
 * 공유 권한 토큰이 없으면 아무것도 하지 않고 '다시 연결 필요'를 돌려준다.
 */
export async function importProposals(): Promise<ImportResult> {
  const cfg = shareConfig.value;
  if (!cfg) return bad('공유가 켜져 있지 않습니다');
  if (cfg.guests.length === 0) return { ok: true, added: 0 };
  if (importing) return { ok: true, added: 0 };
  const token = cachedShareToken();
  if (!token) return bad(NEED_RECONNECT, true);
  importing = true;
  proposalBusy.value = true;
  try {
    const l = await listInbox(token, cfg.inboxId);
    if (!('files' in l)) {
      if (l.status === 401) {
        forgetToken();
        return bad(NEED_RECONNECT, true);
      }
      const e = explain(l, '손님 제안 확인');
      proposalError.value = e;
      return bad(e);
    }
    const guests = new Set(cfg.guests.map((g) => g.email.toLowerCase()));
    const rejRow = (await db().meta.get('shareRejected'))?.value;
    const rejected = new Set<string>(Array.isArray(rejRow) ? (rejRow as string[]) : []);
    const seenSrc = new Set((await db().proposals.toArray()).map((p) => p.srcId).filter(Boolean) as string[]);
    let pending = (await db().proposals.toArray()).filter((p) => !p.deleted).length;
    let added = 0;
    let ignored = 0;
    let changedRejected = false;
    const reject = (id: string) => {
      rejected.add(id);
      changedRejected = true;
      ignored++;
    };
    for (const f of l.files) {
      if (added >= MAX_PER_RUN || pending >= MAX_PENDING) break;
      if (f.trashed || rejected.has(f.id)) {
        if (rejected.has(f.id)) ignored++;
        continue;
      }
      if (await alreadyHandled(f.id)) continue;
      const owner = f.owners?.[0];
      const email = (owner?.emailAddress ?? '').toLowerCase();
      if (!INBOX_NAME.test(f.name) || !guests.has(email) || Number(f.size ?? 0) > MAX_PROPOSAL_BYTES) {
        // 손님이 아닌 계정이 올렸거나 이름·크기가 이상한 파일. 손님이 아닌 경우는 나중에 초대될 수도 있으니 기록하지 않는다
        if (guests.has(email) || !email) reject(f.id);
        else ignored++;
        continue;
      }
      const r = await readText(token, f.id);
      if (r.status === 401) {
        forgetToken();
        return bad(NEED_RECONNECT, true);
      }
      if (!r.ok) continue;
      const parsed = parseProposalFile(r.data, { categories: categories.value, users: users.value, payMethods: payMethods.value, payDetails: payDetails.value });
      if (!parsed.ok) {
        reject(f.id);
        continue;
      }
      const src = parsed.value.srcId;
      if (src && seenSrc.has(src)) {
        reject(f.id);
        continue;
      }
      if (src) seenSrc.add(src);
      await saveRow('proposals', {
        ...parsed.value,
        id: f.id,
        updatedAt: 0,
        from: owner?.displayName || owner?.emailAddress || '손님',
        receivedAt: f.createdTime ? Date.parse(f.createdTime) || Date.now() : Date.now(),
      });
      added++;
      pending++;
    }
    if (changedRejected) await db().meta.put({ key: 'shareRejected', value: [...rejected].slice(-MAX_REJECTED) });
    proposalIgnored.value = ignored;
    proposalCheckedAt.value = Date.now();
    proposalError.value = null;
    if (added > 0) showToast(`손님 제안 ${added}건이 입력 대기에 들어왔습니다`);
    return { ok: true, added };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    proposalError.value = m;
    return bad(m);
  } finally {
    importing = false;
    proposalBusy.value = false;
  }
}

let watching = false;
/** 앱을 열었을 때·다시 볼 때·5분마다(보이는 동안) 손님 제안을 확인한다. 공유 권한이 없으면 조용히 건너뛴다 */
export function startProposalWatcher() {
  if (watching) return;
  watching = true;
  const tick = () => {
    if (document.hidden || !shareConfig.value || !cachedShareToken()) return;
    void importProposals();
  };
  setTimeout(tick, 4000);
  setInterval(tick, 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(tick, 500);
  });
}
