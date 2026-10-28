import { render } from 'preact';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './app';
import { initStore, refreshToday } from './store/store';

render(<App />, document.getElementById('app')!);

void initStore();

// 날짜가 바뀌거나 앱이 다시 보일 때 '오늘'을 갱신한다 (보류·예정 판정에 쓰임)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshToday();
});
setInterval(refreshToday, 30_000);
