/**
 * 로그인·동기화 흐름과 화면용 상태.
 * 입력은 언제나 먼저 로컬에 저장되고, 동기화는 그 뒤에 따로 돈다. 로그인이 풀려도 입력은 막히지 않는다.
 */
import { signal } from '@preact/signals';
import { db } from '../store/db';
import { reloadFromDb, setChangeListener, showToast, wipeLocalOnly } from '../store/store';
import { accountModal } from '../ui/nav';
import { askConfirm } from '../ui/overlay';
import {
  AuthFlowError,
  cachedToken,
  fetchUserInfo,
  forgetToken,
  getClientId,
  loadAccount,
  requestToken,
  revokeToken,
  saveAccount,
  type Account,
} from './auth';
import { AuthError, GoogleDriveClient, OfflineError } from './drive';
import { emptySyncState, previewMerge, syncOnce, SyncError, type SyncState } from './engine';

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'reconnect' | 'error';

export const account = signal<Account | null>(loadAccount());
export const syncStatus = signal<SyncStatus>('local');
export const lastSyncAt = signal<number | null>(null);
export const syncError = signal<string | null>(null);
/** 로그인 창을 띄우거나 합치는 중 */
export const signingIn = signal(false);
/** 설정에서 클라이언트 ID를 바꾸면 화면이 다시 그려지도록 하는 값 */
export const clientIdTick = signal(0);

/* ───────── 저장된 동기화 상태 ───────── */

async function loadState(): Promise<SyncState> {
  const row = await db().meta.get('syncState');
  const v = row?.value as SyncState | undefined;
  return v && typeof v === 'object' && v.files ? v : emptySyncState();
}
async function saveState(s: SyncState) {
  await db().meta.put({ key: 'syncState', value: s });
}

/* ───────── 동기화 실행 ───────── */

export type SyncReason = 'start' | 'resume' | 'change' | 'manual' | 'login' | 'online' | 'timer';

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSync(delay = 3000) {
  if (!account.value) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow('change'), delay);
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function syncNow(reason: SyncReason = 'manual'): Promise<void> {
  const acc = account.value;
  if (!acc) return;
  if (running) {
    again = true;
    return;
  }
  let token = cachedToken();
  if (!token && reason === 'manual') {
    // 누른 직후라 로그인 창을 띄울 수 있다
    try {
      token = await requestToken({ prompt: '', hint: acc.email });
    } catch (e) {
      if (!(e instanceof AuthFlowError && e.code === 'closed')) showToast(describe(e));
    }
  }
  if (!token) {
    syncStatus.value = 'reconnect';
    return;
  }
  running = true;
  syncStatus.value = 'syncing';
  syncError.value = null;
  try {
    const client = new GoogleDriveClient(() => cachedToken());
    const prev = await loadState();
    const r = await syncOnce(db(), client, { ...prev, accountSub: acc.sub });
    await saveState(r.state);
    lastSyncAt.value = r.state.lastSyncAt ?? Date.now();
    if (r.pulled > 0 || r.changed) await reloadFromDb();
    syncStatus.value = 'idle';
  } catch (e) {
    if (e instanceof AuthError) {
      forgetToken();
      syncStatus.value = 'reconnect';
    } else if (e instanceof OfflineError || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      syncStatus.value = 'offline';
      setTimeout(() => void syncNow('online'), 30_000);
    } else if (e instanceof SyncError && e.code === 'conflict') {
      syncStatus.value = 'syncing';
      setTimeout(() => void syncNow('change'), 4000);
    } else {
      syncStatus.value = 'error';
      syncError.value = describe(e);
    }
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(1500);
    }
  }
}

/* ───────── 로그인·로그아웃 ───────── */

function authMessage(e: unknown): string {
  if (e instanceof AuthFlowError) return e.message;
  return describe(e);
}

/** 구글 로그인. 처음 합칠 때 양쪽에 내역이 있으면 건수를 보여 주고 확인받는다. */
export async function signIn(): Promise<boolean> {
  if (!getClientId()) return false;
  if (signingIn.value) return false;
  signingIn.value = true;
  try {
    const token = await requestToken({ prompt: 'select_account' });
    const info = await fetchUserInfo(token);
    // 합치기 확인 창과 겹치지 않도록 계정 창은 닫는다 (결과는 상단 칩과 알림으로 알려 준다)
    accountModal.value = false;
    const client = new GoogleDriveClient(() => cachedToken());
    const prior = await loadState();
    const same = prior.accountSub === info.sub;
    const differs = !!prior.accountSub && !same;
    const pv = await previewMerge(db(), client);
    if (!same && pv.local > 0 && (pv.remote > 0 || differs)) {
      const ok = await askConfirm({
        title: '이 기기의 데이터와 합칩니다',
        message:
          `이 기기 ${pv.local}건 · 드라이브 ${pv.remote}건 → 합계 ${pv.merged}건이 됩니다. ` +
          '같은 내역은 더 최근에 고친 쪽이 남고, 어느 쪽 내역도 지워지지 않습니다.' +
          (differs ? ' (이전에 연결했던 계정과 다른 계정입니다.)' : ''),
        confirmLabel: '합치고 로그인',
      });
      if (!ok) {
        revokeToken(token);
        return false;
      }
    }
    saveAccount(info);
    account.value = info;
    await saveState({ ...(same ? prior : emptySyncState()), accountSub: info.sub });
    showToast(`${info.email || info.name} 계정으로 로그인했습니다`);
    await syncNow('login');
    return true;
  } catch (e) {
    if (!(e instanceof AuthFlowError && e.code === 'closed')) showToast(authMessage(e));
    return false;
  } finally {
    signingIn.value = false;
  }
}

/** 토큰이 만료되어 '재연결 필요'일 때: 같은 계정으로 다시 허용받는다. */
export async function reconnect(): Promise<boolean> {
  const acc = account.value;
  if (!acc || signingIn.value) return false;
  signingIn.value = true;
  try {
    const token = await requestToken({ prompt: '', hint: acc.email });
    const info = await fetchUserInfo(token);
    if (info.sub !== acc.sub) {
      revokeToken(token);
      showToast(`연결된 계정(${acc.email})이 아닌 ${info.email} 계정으로 로그인했습니다. 같은 계정으로 다시 시도해 주세요`);
      return false;
    }
    await syncNow('login');
    return true;
  } catch (e) {
    if (!(e instanceof AuthFlowError && e.code === 'closed')) showToast(authMessage(e));
    return false;
  } finally {
    signingIn.value = false;
  }
}

/** 로그아웃. keepLocal이 false면 이 기기의 데이터도 지운다 (드라이브의 데이터는 그대로). */
export async function signOut(keepLocal: boolean): Promise<void> {
  clearTimeout(timer);
  revokeToken(cachedToken());
  saveAccount(null);
  account.value = null;
  syncStatus.value = 'local';
  syncError.value = null;
  lastSyncAt.value = null;
  await db().meta.delete('syncState');
  if (!keepLocal) await wipeLocalOnly();
  showToast(keepLocal ? '로그아웃했습니다. 이 기기의 데이터는 그대로 남아 있습니다' : '로그아웃하고 이 기기의 데이터를 지웠습니다');
}

/* ───────── 시작 ───────── */

let started = false;
let lastRun = 0;

/** 앱이 시작되고 저장소가 열린 뒤에 한 번 호출한다 */
export async function initSync(): Promise<void> {
  if (started) return;
  started = true;
  setChangeListener(scheduleSync);
  const acc = loadAccount();
  account.value = acc;
  if (acc) {
    lastSyncAt.value = (await loadState()).lastSyncAt ?? null;
    if (cachedToken()) void syncNow('start');
    else syncStatus.value = 'reconnect';
  }
  const tick = (reason: SyncReason, minGap: number) => {
    if (!account.value || document.hidden) return;
    if (Date.now() - lastRun < minGap) return;
    lastRun = Date.now();
    if (!cachedToken()) {
      syncStatus.value = 'reconnect';
      return;
    }
    void syncNow(reason);
  };
  // 앱이 다시 보일 때, 인터넷이 돌아왔을 때, 켜 둔 동안 가끔
  document.addEventListener('visibilitychange', () => tick('resume', 20_000));
  window.addEventListener('online', () => tick('online', 0));
  setInterval(() => tick('timer', 4 * 60_000), 60_000);
}
