import { signal } from '@preact/signals';

/** 새 버전을 받아 두었고, 새로고침하면 바뀌는 상태 */
export const updateReady = signal(false);

/** 크롬이 "앱으로 설치"를 허용했을 때 쓰는 이벤트 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export const installPrompt = signal<InstallPromptEvent | null>(null);
export const installed = signal(false);

export function isStandalone(): boolean {
  return (
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

let registration: ServiceWorkerRegistration | null = null;
let reloading = false;

export async function installApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const p = installPrompt.value;
  if (!p) return 'unavailable';
  await p.prompt();
  const { outcome } = await p.userChoice;
  installPrompt.value = null;
  return outcome;
}

/** 대기 중인 새 버전으로 바꾸고 화면을 다시 불러온다 */
export function applyUpdate(): void {
  reloading = true;
  const w = registration?.waiting;
  if (w) w.postMessage('SKIP_WAITING');
  else location.reload();
}

/** 앱 파일을 이 기기에 저장해 두는 서비스 워커를 등록한다. 배포본(빌드)에서만 켠다 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.value = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt.value = null;
    installed.value = true;
  });
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });

  const start = async () => {
    try {
      const base = import.meta.env.BASE_URL;
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' });
      registration = reg;
      const watch = (w: ServiceWorker) =>
        w.addEventListener('statechange', () => {
          // 처음 설치할 때(제어 중인 이전 버전이 없을 때)는 알리지 않는다
          if (w.state === 'installed' && navigator.serviceWorker.controller) updateReady.value = true;
        });
      if (reg.waiting && navigator.serviceWorker.controller) updateReady.value = true;
      if (reg.installing) watch(reg.installing);
      reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing));
      const check = () => void reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
      setInterval(check, 60 * 60 * 1000);
    } catch {
      /* 서비스 워커를 쓸 수 없는 환경(시크릿 창 등)에서는 일반 웹페이지처럼 동작한다 */
    }
  };
  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => void start());
}
