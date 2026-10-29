import { useEffect } from 'preact/hooks';
import { pendingFixed, ready, settings } from './store/store';
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
        showPopover(
          e.currentTarget,
          '이 기기에만 저장 중',
          ['구글 로그인으로 다른 기기와 동기화하는 기능은 다음 릴리스에서 제공됩니다.'],
        )
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

export function App() {
  useAppearance();
  useShortcuts();
  useFixedPrompt();
  if (!ready.value) return <div class="boot">불러오는 중…</div>;
  const vp = viewport.value;
  const t = tab.value;
  return (
    <div class="app">
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
