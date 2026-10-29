import { signal } from '@preact/signals';
import { EMPTY_FILTER, type Entry, type EntryFilter } from '../lib/types';

export type Tab = 'history' | 'stats' | 'settings';
export type SettingsPage = 'fixed' | 'lists' | 'goal' | 'display' | 'account' | 'data' | 'about';
export type ListsTab = 'users' | 'payMethods' | 'payDetails' | 'categories';

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = sessionStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return fallback;
}

function persist(key: string, v: string) {
  try {
    sessionStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export const tab = signal<Tab>(load('tab', ['history', 'stats', 'settings'], 'history'));
export function setTab(t: Tab) {
  tab.value = t;
  persist('tab', t);
}

/** 모바일에서는 null이면 설정 메뉴 목록, 값이 있으면 상세 화면 */
export const settingsPage = signal<SettingsPage | null>(null);
export const listsTab = signal<ListsTab>('users');

export const filter = signal<EntryFilter>({ ...EMPTY_FILTER });
export const searchOpen = signal(false);
export const searchAllPeriod = signal(false);
export const chipsOpen = signal(false);

export type SheetState =
  | { mode: 'add'; date?: string }
  | { mode: 'edit'; entry: Entry }
  | { mode: 'copy'; entry: Entry };

export const sheet = signal<SheetState | null>(null);
export const openAdd = (date?: string) => (sheet.value = { mode: 'add', date });
export const openEdit = (entry: Entry) => (sheet.value = { mode: 'edit', entry });
export const openCopy = (entry: Entry) => (sheet.value = { mode: 'copy', entry });
export const closeSheet = () => (sheet.value = null);

export function openSettings(page: SettingsPage, list?: ListsTab) {
  settingsPage.value = page;
  if (list) listsTab.value = list;
  setTab('settings');
}

/** 고정지출 월초 입력 창. ym은 처음 보여줄 달(없으면 가장 오래된 미처리 달) */
export const fixedWindow = signal<{ ym?: string } | null>(null);
export const openFixedWindow = (ym?: string) => (fixedWindow.value = { ym });
/** 이번 세션에서 월초 입력 창을 이미 닫았는가 (닫은 뒤 다시 자동으로 뜨지 않게) */
export const fixedPromptShown = signal(false);

/** '건수만 표시' 설정에서 건수 칩을 눌러 오늘 이후 항목을 임시로 펼친 상태 */
export const revealFuture = signal(false);

/** 계정·동기화 창, 로그아웃 확인 창 */
export const accountModal = signal(false);
export const logoutDialog = signal(false);
