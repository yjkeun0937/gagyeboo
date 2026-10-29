import { useEffect, useState } from 'preact/hooks';
import { bootBlocked, bootError, pendingFixed, ready, settings, staleTab } from './store/store';
import {
  closeSheet,
  fixedPromptShown,
  fixedWindow,
  openAdd,
  openFixedWindow,
  openSettings,
  setTab,
  sheet,
  tab,
  type Tab,
} from './ui/nav';
import { viewport } from './ui/viewport';
import { ConfirmLayer, PopoverLayer, ToastLayer, showPopover } from './ui/overlay';
import { Ui } from './ui/icons';
import { HistoryView } from './views/HistoryView';
import { EntrySheet } from './views/EntrySheet';
import { StatsView } from './views/StatsView';
import { SettingsView } from './views/SettingsView';
import { FixedMonthWindow } from './views/FixedMonthWindow';

const TABS: { id: Tab; label: string; icon: 'ReceiptText' | 'ChartColumn' | 'Settings' }[] = [
  { id: 'history', label: '사용 내역', icon: 'ReceiptText' },
  { id: 'stats', label: '통계', icon: 'ChartColumn' },
  { id: 'settings', label: '설정', icon: 'Settings' },
];

function useAppearance() {
  const s = settings.value;
  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
    root.style.fontSize = `${s.fontScale}%`;
  }, [s.theme, s.fontScale]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'n' || e.key === 'N') && !sheet.value && viewport.value !== 'mobile') {
        e.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

function AccountChip() {
  // 구글 로그인은 R3에서 제공된다. 지금은 이 기기에만 저장된다는 상태를 보여준다.
  return (
    <button
      type="button"
      class="account-chip"
      aria-label="저장 상태: 이 기기에만 저장 중"
      onClick={(e) =>
        showPopover(e.currentTarget, '이 기기에만 저장 중', [
          '구글 로그인으로 다른 기기와 동기화하는 기능은 다음 릴리스에서 제공됩니다.',
        ])
      }
    >
      <Ui name="CloudOff" size={16} />
      <span class="account-text">로컬 저장</span>
    </button>
  );
}

function TopPanel() {
  const vp = viewport.value;
  return (
    <header class="top">
      <div class="top-inner">
        <div class="brand" aria-hidden={vp === 'mobile'}>
          <span class="brand-mark" />
          가계부
        </div>
        <nav class="tabs" role="tablist" aria-label="화면 선택">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab.value === t.id}
              class="tab"
              onClick={() => {
                if (t.id === 'settings' && tab.value === 'settings') openSettings('lists');
                setTab(t.id);
                closeSheet();
              }}
            >
              <Ui name={t.icon} size={17} />
              <span>{vp === 'mobile' ? t.label.replace('사용 ', '') : t.label}</span>
            </button>
          ))}
        </nav>
        <div class="top-actions">
          {vp !== 'mobile' ? (
            <button type="button" class="btn primary add-btn" onClick={() => openAdd()}>
              <Ui name="Plus" size={18} />
              지출 입력
            </button>
          ) : null}
          <AccountChip />
        </div>
      </div>
    </header>
  );
}

/** 앱을 열 때, 이번 달(또는 지난 달)에 처리하지 않은 고정지출이 있으면 월초 입력 창을 자동으로 연다 */
function useFixedPrompt() {
  const isReady = ready.value;
  useEffect(() => {
    if (isReady && !fixedPromptShown.value && pendingFixed.value.length > 0) openFixedWindow();
    if (isReady) fixedPromptShown.value = true;
  }, [isReady]);
}

/** 시작 화면: 오래 걸리면 이유와 조치를 알려 준다 */
function BootScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const err = bootError.value;
  const blocked = bootBlocked.value;
  return (
    <div class="boot">
      <div class="boot-box" role="status">
        <p class="boot-title">{err ? '앱을 시작하지 못했습니다' : '불러오는 중…'}</p>
        {err ? (
          <>
            <p class="boot-msg">저장소를 여는 중 문제가 생겼습니다. 새로고침해도 같다면 아래 내용을 알려 주세요.</p>
            <code class="boot-code">{err}</code>
          </>
        ) : blocked ? (
          <p class="boot-msg">
            앱이 새 버전으로 업데이트되는 중인데, <b>이 사이트가 열려 있는 다른 탭·창·홈 화면 앱</b>이 저장소를 붙잡고
            있어 기다리고 있습니다. 그것들을 모두 닫으면 이 화면이 자동으로 이어집니다. (같은 기기의 브라우저 안에서만
            해당합니다. 백그라운드로 밀려난 탭도 포함입니다.)
          </p>
        ) : slow ? (
          <p class="boot-msg">
            평소보다 오래 걸립니다. 새로고침해 보고, 같은 화면이면 이 사이트가 열려 있는 다른 탭·창을 닫아 주세요.
          </p>
        ) : null}
        {err || blocked || slow ? (
          <button type="button" class="btn" onClick={() => location.reload()}>
            새로고침
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 다른 창에서 앱이 업데이트되어 이 창의 저장소 연결이 닫혔을 때 */
function StaleBanner() {
  if (!staleTab.value) return null;
  return (
    <div class="stale-banner" role="alert">
      <span>다른 창에서 앱이 새 버전으로 업데이트되었습니다. 이 창은 새로고침해야 계속 쓸 수 있습니다.</span>
      <button type="button" class="btn small primary" onClick={() => location.reload()}>
        새로고침
      </button>
    </div>
  );
}

export function App() {
  useAppearance();
  useShortcuts();
  useFixedPrompt();
  if (!ready.value) return <BootScreen />;
  const vp = viewport.value;
  const t = tab.value;
  return (
    <div class="app">
      <StaleBanner />
      <TopPanel />
      <main class="page" id="main">
        <div class="page-inner">
          {t === 'history' ? <HistoryView /> : t === 'stats' ? <StatsView /> : <SettingsView />}
        </div>
      </main>
      {vp === 'mobile' && t !== 'settings' && !sheet.value ? (
        <button type="button" class="fab" aria-label="지출 입력" onClick={() => openAdd()}>
          <Ui name="Plus" size={26} />
        </button>
      ) : null}
      {sheet.value ? <EntrySheet /> : null}
      {fixedWindow.value ? <FixedMonthWindow /> : null}
      <PopoverLayer />
      <ToastLayer />
      <ConfirmLayer />
    </div>
  );
}
