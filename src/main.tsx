import { render } from 'preact';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './app';
import { initStore, ready, refreshToday } from './store/store';
import { initSync } from './sync/controller';
import { guestMode } from './store/mode';
import { finishGuestExit, GUEST_DB, initGuest, shouldBootAsGuest } from './sync/guest';
import { installKeyboardScroll } from './ui/keyboard';
import { registerServiceWorker } from './pwa';

if (location.hash === '#share-lab') {
  // 계정 공유 시험 화면: 일반 앱·내 데이터와 분리되어 동작한다 (개발용)
  void import('./views/ShareLab').then(({ ShareLab }) => render(<ShareLab />, document.getElementById('app')!));
} else {
  installKeyboardScroll();
  registerServiceWorker();
  render(<App />, document.getElementById('app')!);
  // 손님 모드(다른 사람의 가계부 사본 보기)는 내 가계부와 다른 저장소를 열고, 구글 동기화는 켜지 않는다
  guestMode.value = shouldBootAsGuest();
  void initStore(guestMode.value ? GUEST_DB : undefined).then(async () => {
    if (!ready.value) return;
    if (guestMode.value) return initGuest();
    await finishGuestExit();
    return initSync();
  });
}

// 날짜가 바뀌거나 앱이 다시 보일 때 '오늘'을 갱신한다 (보류·예정 판정에 쓰임)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshToday();
});
setInterval(refreshToday, 30_000);
