/**
 * 구글 로그인 (Google Identity Services 토큰 방식).
 * 브라우저만으로 동작하므로 접근 토큰은 약 1시간 뒤 만료되고, 만료되면 사용자가 한 번 눌러 다시 연결한다.
 */
const GIS_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPES = `openid email profile ${DRIVE_SCOPE}`;

const LS_CLIENT_ID = 'gagyeboo.clientId';
const LS_TOKEN = 'gagyeboo.token';
const LS_ACCOUNT = 'gagyeboo.account';

export interface Account {
  sub: string;
  name: string;
  email: string;
  picture?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string }): void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

/** 로그인 과정의 오류. code로 안내 문구를 고른다 */
export class AuthFlowError extends Error {
  constructor(
    public code: 'no-script' | 'closed' | 'denied' | 'scope' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

/* ───────── 저장된 값 ───────── */

const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** 배포에 넣은 클라이언트 ID, 없으면 설정 화면에서 직접 붙여 넣은 값 */
export function getClientId(): string {
  return (ls.get(LS_CLIENT_ID) || import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}
export function setClientId(id: string) {
  if (id.trim()) ls.set(LS_CLIENT_ID, id.trim());
  else ls.del(LS_CLIENT_ID);
  tokenClient = null;
}
export function builtInClientId(): boolean {
  return !!(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
}

export function loadAccount(): Account | null {
  try {
    const a = JSON.parse(ls.get(LS_ACCOUNT) ?? 'null');
    return a && typeof a.sub === 'string' ? (a as Account) : null;
  } catch {
    return null;
  }
}
export function saveAccount(a: Account | null) {
  if (a) ls.set(LS_ACCOUNT, JSON.stringify(a));
  else ls.del(LS_ACCOUNT);
}

/** 아직 유효한 접근 토큰 (만료 1분 전까지) */
export function cachedToken(): string | null {
  try {
    const t = JSON.parse(ls.get(LS_TOKEN) ?? 'null');
    if (t && typeof t.token === 'string' && t.exp - 60_000 > Date.now()) return t.token;
  } catch {
    /* ignore */
  }
  return null;
}
function storeToken(token: string, expiresInSec: number) {
  ls.set(LS_TOKEN, JSON.stringify({ token, exp: Date.now() + expiresInSec * 1000 }));
}
export function forgetToken() {
  ls.del(LS_TOKEN);
}

/* ───────── 구글 스크립트·토큰 ───────── */

let scriptPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new AuthFlowError('no-script', '구글 로그인 스크립트를 불러오지 못했습니다 (인터넷 연결을 확인해 주세요)'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** 로그인 버튼을 누르기 전에 스크립트를 미리 받아 두면, 누른 직후 팝업이 막히지 않는다 */
export function preloadGis() {
  if (getClientId()) void loadGis().catch(() => undefined);
}

let tokenClient: TokenClient | null = null;
let pending: { resolve: (r: TokenResponse) => void; reject: (e: AuthFlowError) => void } | null = null;

async function ensureClient(): Promise<TokenClient> {
  await loadGis();
  const cid = getClientId();
  if (!cid) throw new AuthFlowError('failed', '구글 클라이언트 ID가 설정되지 않았습니다');
  tokenClient ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: cid,
    scope: SCOPES,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (r.error || !r.access_token) {
        p.reject(new AuthFlowError(r.error === 'access_denied' ? 'denied' : 'failed', r.error_description || r.error || '로그인에 실패했습니다'));
      } else p.resolve(r);
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      if (!p) return;
      p.reject(
        new AuthFlowError(
          e.type === 'popup_closed' || e.type === 'popup_failed_to_open' ? 'closed' : 'failed',
          e.type === 'popup_failed_to_open' ? '로그인 창을 열지 못했습니다 (팝업 차단을 확인해 주세요)' : e.message || '로그인 창이 닫혔습니다',
        ),
      );
    },
  });
  return tokenClient;
}

/** 사용자가 누른 직후에 호출해야 팝업이 막히지 않는다. 드라이브 권한까지 허용했는지도 확인한다 */
export async function requestToken(opts: { prompt?: '' | 'select_account' | 'consent'; hint?: string } = {}): Promise<string> {
  const client = await ensureClient();
  const res = await new Promise<TokenResponse>((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: opts.prompt ?? '', ...(opts.hint ? { hint: opts.hint } : {}) });
  });
  if (res.scope && !res.scope.split(' ').includes(DRIVE_SCOPE)) {
    throw new AuthFlowError('scope', '드라이브 저장 권한을 허용해야 동기화할 수 있습니다. 다시 로그인하면서 모든 항목을 체크해 주세요');
  }
  storeToken(res.access_token!, Number(res.expires_in ?? 3600));
  return res.access_token!;
}

export async function fetchUserInfo(token: string): Promise<Account> {
  let res: Response;
  try {
    res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new AuthFlowError('failed', '계정 정보를 가져오지 못했습니다 (네트워크 오류)');
  }
  if (!res.ok) throw new AuthFlowError('failed', `계정 정보를 가져오지 못했습니다 (${res.status})`);
  const u = (await res.json()) as { sub: string; name?: string; email?: string; picture?: string };
  return { sub: u.sub, name: u.name ?? u.email ?? '구글 계정', email: u.email ?? '', picture: u.picture };
}

export function revokeToken(token: string | null) {
  forgetToken();
  try {
    if (token) window.google?.accounts.oauth2.revoke(token);
  } catch {
    /* ignore */
  }
}
