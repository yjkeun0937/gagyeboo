import { signal } from '@preact/signals';
import { EMPTY_FILTER, type Entry, type EntryFilter } from '../lib/types';

export type Tab = 'history' | 'stats' | 'settings';
export type SettingsPage = 'fixed' | 'lists' | 'display' | 'account' | 'data' | 'about';
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
