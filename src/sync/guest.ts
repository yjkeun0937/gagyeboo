/**
 * 계정 공유 — 손님 쪽.
 * - 손님은 주인이 공유한 data/mirror.json을 구글 파일 선택 창으로 한 번 고르면(drive.file 권한), 그 파일을 읽을 수 있다.
 * - 받은 사본은 내 가계부와 **따로 된 저장소**(gagyeboo-guest)에 두고 읽기 전용으로만 보여 준다. 내 가계부는 그대로 보관된다.
 * - 새 지출은 '제안'으로 주인의 inbox 폴더에 파일로 올린다. 실제로 가계부에 넣는 것은 주인만 한다.
 * - 주인이 공유를 끄거나 손님을 해제하면 사본은 '연결이 끊긴 사본'이 되어 읽기만 된다.
 * 손님 모드는 앱을 시작할 때 localStorage의 연결 정보로 정해지고, 바뀌면 새로고침해서 저장소를 갈아 끼운다.
 */
import { signal } from '@preact/signals';
import Dexie from 'dexie';
import { db, LedgerDB } from '../store/db';
import { guestMode } from '../store/mode';
import { exportAll, firstUseYm, importAll, installCopy, showToast, validateBackup, writeCopy } from '../store/store';
import type { BackupFile } from '../store/store';
import { uid } from '../lib/format';
import { todayKST } from '../lib/dates';
import { askConfirm } from '../ui/overlay';
import { downloadFile } from '../ui/download';
import { AuthFlowError, cachedGuestToken, fetchUserInfo, forgetGuestToken, requestGuestToken } from './auth';
import { createJson, getFile, readText, remove, type LabCall } from './driveapi';
import { pickerReady, pickSharedFile } from './picker';
import type { MirrorFile } from './share';

export const GUEST_DB = 'gagyeboo-guest';
const LS_LINK = 'gagyeboo.guest';
const LS_EXIT = 'gagyeboo.guestExit';
/** 보낸 제안 기록을 남겨 두는 기간. 지나면 손님 앱이 자기가 올린 제안 파일을 지운다 */
export const KEEP_SENT_DAYS = 30;

export interface GuestLink {
  v: 1;
  ownerName: string;
  ownerEmail: string;
  guestEmail: string;
  guestName: string;
  mirrorId: string;
  inboxId: string;
  linkedAt: number;
  /** 사본에 담긴 미러의 게시 시각 (주인이 올린 시각) */
  publishedAt: number | null;
  /** 마지막으로 받아 온 mirror.json의 수정 시각(드라이브 기준). 같으면 다시 받지 않는다 */
  modifiedTime: string | null;
  checkedAt: number | null;
  state: 'active' | 'disconnected';
  disconnectedAt?: number;
}

export type GuestStatus = 'ok' | 'syncing' | 'reconnect' | 'offline' | 'disconnected' | 'error';
export type GuestResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): GuestResult => ({ ok: false, error });

export interface OutboxItem {
  id: string;
  createdAt: number;
  payload: ProposalFile;
  status: 'pending' | 'sent' | 'failed';
  fileId?: string;
  sentAt?: number;
  error?: string;
}

/** 주인의 inbox에 올리는 제안 파일 내용 */
export interface ProposalFile {
  app: 'gagyeboo-proposal';
  v: 1;
  id: string;
  createdAt: number;
  /** 제안자가 적은 이름 표시용 힌트. 주인 앱은 이 값 대신 드라이브 파일 소유자를 제안자로 쓴다 */
  from: string;
  date: string;
  store: string;
  memo: string;
  category: string | null;
  amount: number;
  user: string | null;
  payMethod: string | null;
  payDetail: string | null;
  isEstimate?: boolean;
}

export type ProposalInput = Omit<ProposalFile, 'app' | 'v' | 'id' | 'createdAt' | 'from'>;

export const guestLink = signal<GuestLink | null>(null);
export const guestStatus = signal<GuestStatus>('ok');
export const guestBusy = signal(false);
export const guestError = signal<string | null>(null);
export const guestOutbox = signal<OutboxItem[]>([]);

/* ───────── 저장된 연결 정보 ───────── */

export function loadGuestLink(): GuestLink | null {
  try {
    const l = JSON.parse(localStorage.getItem(LS_LINK) ?? 'null');
    return l && l.v === 1 && typeof l.mirrorId === 'string' && typeof l.inboxId === 'string' ? (l as GuestLink) : null;
  } catch {
    return null;
  }
}
function putLink(l: GuestLink | null) {
  try {
    if (l) localStorage.setItem(LS_LINK, JSON.stringify(l));
    else localStorage.removeItem(LS_LINK);
  } catch {
    /* ignore */
  }
  guestLink.value = l;
}
function pendingExit(): 'discard' | 'convert' | null {
  try {
    const v = localStorage.getItem(LS_EXIT);
    return v === 'discard' || v === 'convert' ? v : null;
  } catch {
    return null;
  }
}

/** 앱을 시작할 때: 손님 모드로 열어야 하는가 (연결 정보가 있고, 나가는 중이 아닐 때) */
export function shouldBootAsGuest(): boolean {
  return !!loadGuestLink() && !pendingExit();
}

/* ───────── 미러 읽기 ───────── */

export function parseMirror(data: unknown): MirrorFile | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Partial<MirrorFile>;
  if (m.app !== 'gagyeboo-mirror' || m.v !== 1) return null;
  if (typeof m.inboxId !== 'string' || !m.inboxId) return null;
  if (!validateBackup(m.backup)) return null;
  return m as MirrorFile;
}

const errMsg = (r: LabCall) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? (typeof r.data === 'string' ? r.data : '');
const reasonOf = (r: LabCall) => (r.data as { error?: { errors?: { reason?: string }[] } } | null)?.error?.errors?.[0]?.reason ?? '';
/** 접근 권한이 없어졌다는 뜻의 응답인가 (제한·일시 오류는 제외) */
const lostAccess = (r: LabCall) => (r.status === 404 || r.status === 403) && !/rateLimit|dailyLimit|quota/i.test(reasonOf(r));

const NEED_CONNECT = '구글에 연결해야 새 내용을 받을 수 있습니다';

function authMessage(e: unknown): string {
  return e instanceof AuthFlowError || e instanceof Error ? e.message : String(e);
}

/* ───────── 초대 수락 (내 가계부 모드에서 실행) ───────── */

/**
 * 주인이 알려 준 초대를 받는다: 구글 로그인 → 공유 파일(mirror.json) 고르기 → 확인 → 손님용 저장소에 사본 저장 → 새로고침.
 * 사용자가 누른 직후에 호출해야 로그인 창이 막히지 않는다.
 */
export async function acceptInvite(): Promise<GuestResult> {
  if (guestMode.value) return fail('이미 손님 모드입니다');
  if (!pickerReady()) {
    return fail('이 앱에는 파일 선택 창용 설정(API 키·프로젝트 번호)이 아직 들어 있지 않습니다. 설정이 끝나면 쓸 수 있습니다');
  }
  guestBusy.value = true;
  try {
    let token: string;
    try {
      token = await requestGuestToken({ prompt: 'select_account' });
    } catch (e) {
      return fail(authMessage(e));
    }
    const who = await fetchUserInfo(token);
    let picked: { id: string; name: string } | null;
    try {
      picked = await pickSharedFile(token);
    } catch (e) {
      return fail(authMessage(e));
    }
    if (!picked) return fail('파일을 고르지 않아 취소했습니다');
    const r = await readText(token, picked.id);
    if (r.status === 0) return fail('인터넷에 연결되어 있지 않습니다');
    if (!r.ok) return fail(lostAccess(r) ? '선택한 파일을 열 수 없습니다. 주인이 이 계정으로 초대했는지 확인해 주세요' : `파일을 읽지 못했습니다 (${r.status})`);
    const mirror = parseMirror(r.data);
    if (!mirror) return fail('가계부 공유 파일이 아닙니다. 「가계부 공유」 폴더 안의 data 폴더에 있는 mirror.json을 골라 주세요');
    const info = await getFile(token, picked.id);
    const modifiedTime = (info.data as { modifiedTime?: string } | null)?.modifiedTime ?? null;
    const ownerName = mirror.owner.name || mirror.owner.email || '주인';
    const ok = await askConfirm({
      title: `${ownerName}님의 가계부를 열까요?`,
      message: `${who.email} 계정으로 ${ownerName}님이 공유한 가계부를 읽기 전용으로 엽니다. 내 가계부는 이 기기에 그대로 보관되고, 언제든 손님 모드를 닫고 돌아올 수 있습니다. 새 지출은 '제안'으로만 보낼 수 있습니다.`,
      confirmLabel: '열기',
    });
    if (!ok) return fail('취소했습니다');
    const g = new LedgerDB(GUEST_DB);
    try {
      await writeCopy(g, mirror.backup, mirror.firstUseYm);
      await g.meta.put({ key: 'guestOutbox', value: [] });
    } finally {
      g.close();
    }
    putLink({
      v: 1,
      ownerName,
      ownerEmail: mirror.owner.email,
      guestEmail: who.email,
      guestName: who.name,
      mirrorId: picked.id,
      inboxId: mirror.inboxId,
      linkedAt: Date.now(),
      publishedAt: mirror.publishedAt,
      modifiedTime,
      checkedAt: Date.now(),
      state: 'active',
    });
    location.reload();
    return { ok: true };
  } catch (e) {
    return fail(authMessage(e));
  } finally {
    guestBusy.value = false;
  }
}

/* ───────── 손님 모드 시작·새로 받기 ───────── */

let refreshing = false;
let started = false;

export async function initGuest(): Promise<void> {
  guestLink.value = loadGuestLink();
  const row = await db().meta.get('guestOutbox');
  guestOutbox.value = Array.isArray(row?.value) ? (row!.value as OutboxItem[]) : [];
  const l = guestLink.value;
  if (!l) return;
  guestStatus.value = l.state === 'disconnected' ? 'disconnected' : cachedGuestToken() ? 'ok' : 'reconnect';
  if (started) return;
  started = true;
  if (l.state === 'active') void refreshCopy();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && guestLink.value?.state === 'active') void refreshCopy();
  });
  setInterval(() => {
    if (!document.hidden && guestLink.value?.state === 'active') void refreshCopy();
  }, 5 * 60_000);
}

async function saveOutbox(list: OutboxItem[]) {
  guestOutbox.value = list;
  await db().meta.put({ key: 'guestOutbox', value: list });
}

function patchLink(p: Partial<GuestLink>) {
  const l = guestLink.value;
  if (l) putLink({ ...l, ...p });
}

async function markDisconnected() {
  patchLink({ state: 'disconnected', disconnectedAt: Date.now() });
  guestStatus.value = 'disconnected';
}

/**
 * 주인이 올린 최신 사본이 있으면 받아서 바꾼다. 연결이 끊긴 사본에서 부르면(다시 확인) 되살아나는지 확인한다.
 * force: 수정 시각이 같아도 다시 받는다
 */
export async function refreshCopy(force = false): Promise<GuestResult> {
  const l = guestLink.value;
  if (!l) return fail('연결된 가계부가 없습니다');
  if (refreshing) return { ok: true };
  const token = cachedGuestToken();
  if (!token) {
    if (l.state === 'active') guestStatus.value = 'reconnect';
    return fail(NEED_CONNECT);
  }
  refreshing = true;
  guestStatus.value = 'syncing';
  try {
    const info = await getFile(token, l.mirrorId);
    if (info.status === 0) {
      guestStatus.value = 'offline';
      return fail('인터넷에 연결되어 있지 않습니다');
    }
    if (info.status === 401) {
      forgetGuestToken();
      guestStatus.value = l.state === 'disconnected' ? 'disconnected' : 'reconnect';
      return fail(NEED_CONNECT);
    }
    const meta = info.data as { trashed?: boolean; modifiedTime?: string } | null;
    if (lostAccess(info) || (info.ok && meta?.trashed)) {
      await markDisconnected();
      return fail('주인이 공유를 끄거나 이 계정을 해제해서 더 이상 받을 수 없습니다');
    }
    if (!info.ok) {
      guestStatus.value = 'error';
      guestError.value = `공유 내용을 확인하지 못했습니다 (${info.status} ${errMsg(info)})`;
      return fail(guestError.value);
    }
    const revived = l.state === 'disconnected';
    if (!force && !revived && meta?.modifiedTime && meta.modifiedTime === l.modifiedTime) {
      patchLink({ checkedAt: Date.now() });
      guestStatus.value = 'ok';
      guestError.value = null;
      void flushOutbox();
      return { ok: true };
    }
    const r = await readText(token, l.mirrorId);
    if (r.status === 0) {
      guestStatus.value = 'offline';
      return fail('인터넷에 연결되어 있지 않습니다');
    }
    if (!r.ok) {
      if (lostAccess(r)) {
        await markDisconnected();
        return fail('주인이 공유를 끄거나 이 계정을 해제해서 더 이상 받을 수 없습니다');
      }
      guestStatus.value = 'error';
      guestError.value = `공유 내용을 받지 못했습니다 (${r.status})`;
      return fail(guestError.value);
    }
    const mirror = parseMirror(r.data);
    if (!mirror) {
      guestStatus.value = 'error';
      guestError.value = '받은 파일이 올바른 가계부 공유 파일이 아닙니다';
      return fail(guestError.value);
    }
    await installCopy(mirror.backup, mirror.firstUseYm);
    patchLink({
      ownerName: mirror.owner.name || mirror.owner.email || l.ownerName,
      ownerEmail: mirror.owner.email || l.ownerEmail,
      inboxId: mirror.inboxId,
      publishedAt: mirror.publishedAt,
      modifiedTime: meta?.modifiedTime ?? null,
      checkedAt: Date.now(),
      state: 'active',
      disconnectedAt: undefined,
    });
    guestStatus.value = 'ok';
    guestError.value = null;
    if (revived) showToast('다시 연결되었습니다');
    void flushOutbox();
    return { ok: true };
  } catch (e) {
    guestStatus.value = 'error';
    guestError.value = e instanceof Error ? e.message : String(e);
    return fail(guestError.value);
  } finally {
    refreshing = false;
  }
}

/** 사용자가 누른 직후에 호출: 구글에 다시 연결한 뒤 새 내용을 받고 못 보낸 제안을 보낸다 */
export async function reconnectGuest(): Promise<GuestResult> {
  const l = guestLink.value;
  if (!l) return fail('연결된 가계부가 없습니다');
  guestBusy.value = true;
  try {
    try {
      await requestGuestToken({ hint: l.guestEmail });
    } catch (e) {
      return fail(authMessage(e));
    }
    return await refreshCopy(true);
  } finally {
    guestBusy.value = false;
  }
}

/* ───────── 제안 보내기 ───────── */

let flushing = false;

/** 제안을 기기에 먼저 저장하고, 바로 보낸다. 연결이 없으면 구글 연결을 시도하고, 안 되면 보낼 목록에 남긴다 */
export async function sendProposal(input: ProposalInput): Promise<{ sent: boolean; error?: string }> {
  const l = guestLink.value;
  if (!l) return { sent: false, error: '연결된 가계부가 없습니다' };
  if (l.state !== 'active') return { sent: false, error: '연결이 끊겨 제안을 보낼 수 없습니다' };
  // 로그인 창은 사용자가 누른 직후에만 열 수 있으므로 다른 일보다 먼저 시도한다
  if (!cachedGuestToken()) {
    try {
      await requestGuestToken({ hint: l.guestEmail });
    } catch {
      /* 못 하면 아래에서 보낼 목록에 남긴다 */
    }
  }
  const item: OutboxItem = {
    id: uid(),
    createdAt: Date.now(),
    status: 'pending',
    payload: { app: 'gagyeboo-proposal', v: 1, id: '', createdAt: Date.now(), from: l.guestName, ...input },
  };
  item.payload.id = item.id;
  await saveOutbox([item, ...guestOutbox.value]);
  await flushOutbox();
  const cur = guestOutbox.value.find((x) => x.id === item.id);
  return cur?.status === 'sent' ? { sent: true } : { sent: false, error: cur?.error };
}

/** 못 보낸 제안을 보내고, 오래된 보낸 기록은 정리한다 */
export async function flushOutbox(): Promise<void> {
  const l = guestLink.value;
  const token = cachedGuestToken();
  if (!l || !token || flushing || l.state !== 'active') return;
  flushing = true;
  try {
    let list = [...guestOutbox.value];
    let lost = false;
    for (const it of list) {
      if (it.status !== 'pending') continue;
      const r = await createJson(token, `proposal-${it.id}.json`, l.inboxId, JSON.stringify(it.payload));
      if (r.ok) {
        const fileId = (r.data as { id?: string } | null)?.id;
        list = list.map((x) => (x.id === it.id ? { ...x, status: 'sent', fileId, sentAt: Date.now(), error: undefined } : x));
      } else if (r.status === 401) {
        forgetGuestToken();
        guestStatus.value = 'reconnect';
        break;
      } else if (r.status === 0) {
        guestStatus.value = 'offline';
        break;
      } else {
        const gone = lostAccess(r);
        lost ||= gone;
        list = list.map((x) =>
          x.id === it.id
            ? { ...x, status: 'failed', error: gone ? '보내지 못했습니다. 주인이 공유를 끄거나 이 계정을 해제했을 수 있습니다' : `보내지 못했습니다 (${r.status})` }
            : x,
        );
      }
    }
    // 보낸 지 오래된 제안: 내가 올린 파일을 지우고 기록에서도 뺀다
    const limit = Date.now() - KEEP_SENT_DAYS * 86_400_000;
    const keep: OutboxItem[] = [];
    for (const it of list) {
      if (it.status === 'sent' && (it.sentAt ?? 0) < limit) {
        if (it.fileId) {
          const d = await remove(token, it.fileId);
          if (!d.ok && d.status !== 404) {
            keep.push(it);
            continue;
          }
        }
        continue;
      }
      keep.push(it);
    }
    await saveOutbox(keep);
    if (lost) void refreshCopy(true);
  } finally {
    flushing = false;
  }
}

/** 실패한 제안을 다시 보낼 목록으로 되돌린다 */
export async function retryFailed(): Promise<void> {
  await saveOutbox(guestOutbox.value.map((x) => (x.status === 'failed' ? { ...x, status: 'pending', error: undefined } : x)));
  await flushOutbox();
}

/** 보내지 않은(대기·실패) 제안을 없앤다 */
export async function dropOutboxItem(id: string): Promise<void> {
  await saveOutbox(guestOutbox.value.filter((x) => x.id !== id || x.status === 'sent'));
}

/* ───────── 손님 모드 나가기 ───────── */

function leave(kind: 'discard' | 'convert') {
  try {
    localStorage.setItem(LS_EXIT, kind);
  } catch {
    /* ignore */
  }
  location.reload();
}

/** 사본을 지우고 내 가계부로 돌아간다 (초대 자체는 그대로이므로 주인이 해제하지 않았다면 다시 열 수 있다) */
export async function discardCopy(): Promise<void> {
  const ok = await askConfirm({
    title: '손님 모드를 닫을까요?',
    message: '이 기기에 받아 둔 사본과 보내지 않은 제안이 지워지고 내 가계부로 돌아갑니다. 내 가계부 내용은 그대로입니다.',
    confirmLabel: '사본 지우고 돌아가기',
    danger: true,
  });
  if (ok) leave('discard');
}

/** 연결이 끊긴 사본을 내 가계부로 삼는다: 지금의 내 가계부를 백업 파일로 내려받은 뒤 사본 내용으로 바꾼다 */
export async function convertCopyToOwn(): Promise<void> {
  let own: LedgerDB | null = null;
  try {
    own = new LedgerDB('gagyeboo');
    const count = await own.entries.filter((e) => !e.deleted).count();
    const ok = await askConfirm({
      title: '이 사본을 내 가계부로 바꿀까요?',
      message:
        count > 0
          ? `이 기기의 내 가계부(내역 ${count}건)는 사본 내용으로 바뀝니다. 바꾸기 전에 내 가계부의 백업 파일을 먼저 내려받습니다. 구글 로그인으로 동기화 중이라면 다른 기기에도 바뀐 내용이 전달됩니다. 이후에는 직접 편집할 수 있고, 주인과는 더 이상 연결되지 않습니다.`
          : '사본 내용이 내 가계부가 되어 직접 편집할 수 있게 됩니다. 주인과는 더 이상 연결되지 않습니다.',
      confirmLabel: '내 가계부로 바꾸기',
      danger: count > 0,
    });
    if (!ok) return;
    if (count > 0) {
      const b = await exportAll(own);
      downloadFile(`gagyeboo-backup-before-copy-${todayKST()}.json`, JSON.stringify(b), 'application/json');
    }
  } finally {
    own?.close();
  }
  leave('convert');
}

/**
 * 내 가계부 모드로 시작했는데 손님 모드에서 나가는 중이면 마무리한다.
 * convert: 사본으로 내 가계부를 바꾼다. discard: 사본 저장소를 지운다. 둘 다 연결 정보를 지운다.
 */
export async function finishGuestExit(): Promise<void> {
  const kind = pendingExit();
  if (!kind) return;
  try {
    if (kind === 'convert') {
      const g = new LedgerDB(GUEST_DB);
      let backup: BackupFile;
      let firstUse: unknown;
      try {
        backup = await exportAll(g);
        firstUse = (await g.meta.get('firstUseYm'))?.value;
      } finally {
        g.close();
      }
      if (validateBackup(backup)) {
        await importAll(backup);
        if (typeof firstUse === 'string') {
          await db().meta.put({ key: 'firstUseYm', value: firstUse });
          firstUseYm.value = firstUse;
        }
        showToast('사본을 내 가계부로 가져왔습니다');
      }
    }
    await Dexie.delete(GUEST_DB);
    forgetGuestToken();
    putLink(null);
  } catch (e) {
    console.error('손님 모드 정리 실패', e);
    showToast('손님 모드를 정리하지 못했습니다. 새로고침해 주세요');
    return;
  } finally {
    try {
      localStorage.removeItem(LS_EXIT);
    } catch {
      /* ignore */
    }
  }
}
