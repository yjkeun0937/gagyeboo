/**
 * 구글 파일 선택 창(Picker). 손님이 주인의 공유 파일(mirror.json)을 한 번 골라 주면,
 * 이 앱은 좁은 권한(drive.file)만으로도 그 파일을 읽을 수 있다.
 * API 키와 프로젝트 번호는 공개되어도 되는 값이다 (배포 시 저장소 변수로 넣거나 설정에서 직접 입력).
 */
const LS_KEY = 'gagyeboo.pickerKey';
const LS_APP = 'gagyeboo.pickerApp';
const LS_LAB = 'gagyeboo.sharelab';

function get(k: string): string {
  try {
    return (localStorage.getItem(k) ?? '').trim();
  } catch {
    return '';
  }
}
function fromLab(f: 'apiKey' | 'appId'): string {
  try {
    return String(JSON.parse(localStorage.getItem(LS_LAB) ?? '{}')[f] ?? '').trim();
  } catch {
    return '';
  }
}

export interface PickerConfig {
  apiKey: string;
  appId: string;
}

/** 배포에 넣은 값 → 설정에서 직접 넣은 값 → (개발용) 시험 화면에 넣어 둔 값 순서로 찾는다 */
export function pickerConfig(): PickerConfig {
  return {
    apiKey: (import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim() || get(LS_KEY) || fromLab('apiKey'),
    appId: (import.meta.env.VITE_GOOGLE_APP_ID ?? '').trim() || get(LS_APP) || fromLab('appId'),
  };
}
export function setPickerConfig(c: Partial<PickerConfig>) {
  try {
    if (c.apiKey !== undefined) c.apiKey.trim() ? localStorage.setItem(LS_KEY, c.apiKey.trim()) : localStorage.removeItem(LS_KEY);
    if (c.appId !== undefined) c.appId.trim() ? localStorage.setItem(LS_APP, c.appId.trim()) : localStorage.removeItem(LS_APP);
  } catch {
    /* ignore */
  }
}
export const pickerReady = () => {
  const c = pickerConfig();
  return !!c.apiKey && !!c.appId;
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('파일 선택 창을 불러오지 못했습니다 (인터넷 연결을 확인해 주세요)'));
    document.head.appendChild(s);
  });
}

/** 나와 공유된 파일만 보이는 선택 창을 띄우고, 고른 파일의 ID와 이름을 돌려준다. 닫으면 null */
export async function pickSharedFile(token: string): Promise<{ id: string; name: string } | null> {
  const { apiKey, appId } = pickerConfig();
  if (!apiKey || !appId) throw new Error('파일 선택 창을 쓰려면 API 키와 프로젝트 번호가 필요합니다');
  await loadScript('https://apis.google.com/js/api.js');
  const gapi = (window as unknown as { gapi: { load(n: string, cb: () => void): void } }).gapi;
  await new Promise<void>((r) => gapi.load('picker', () => r()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gp = (window as any).google.picker;
  return new Promise((resolve) => {
    const view = new gp.DocsView(gp.ViewId.DOCS).setIncludeFolders(true).setOwnedByMe(false);
    new gp.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === gp.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === gp.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
