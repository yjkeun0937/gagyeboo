import { signal } from '@preact/signals';
import type { ListSort } from '../lib/calc';
import { EMPTY_FILTER, type AssetCategory, type DefaultView, type Entry, type EntryFilter } from '../lib/types';

export type Tab = 'history' | 'stats' | 'assets' | 'settings';
export type SettingsPage = 'fixed' | 'lists' | 'goal' | 'budget' | 'display' | 'account' | 'share' | 'data' | 'about';
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

export const tab = signal<Tab>(load('tab', ['history', 'stats', 'assets', 'settings'], 'history'));
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

/** 사용 내역을 날짜 그룹이 아닌 열 기준으로 한 줄씩 정렬할 때. null이면 날짜별 그룹(설정의 날짜 정렬) */
export const listSort = signal<ListSort | null>(null);
/** 이번에 연 화면에서 고른 보기. null이면 설정의 기본 보기를 따른다 */
export const historyView = signal<DefaultView | null>(null);
/** 캘린더에서 고른 날짜 */
export const calDate = signal<string | null>(null);

export type SheetState =
  | { mode: 'add'; date?: string }
  | { mode: 'edit'; entry: Entry }
  | { mode: 'copy'; entry: Entry };

export const sheet = signal<SheetState | null>(null);
export const openAdd = (date?: string) => {
  assetSheet.value = null;
  sheet.value = { mode: 'add', date };
};
export const openEdit = (entry: Entry) => (sheet.value = { mode: 'edit', entry });
export const openCopy = (entry: Entry) => (sheet.value = { mode: 'copy', entry });
export const closeSheet = () => (sheet.value = null);

/** 재산 항목 입력·상세 창. add는 새 항목(분류 미리 고르기 가능), edit는 항목 열기, copy는 복사해서 새로 */
export type AssetSheetState = { mode: 'add'; category?: AssetCategory } | { mode: 'edit' | 'copy'; id: string };
export const assetSheet = signal<AssetSheetState | null>(null);
export const openAssetAdd = (category?: AssetCategory) => (assetSheet.value = { mode: 'add', category });
export const openAssetEdit = (id: string) => (assetSheet.value = { mode: 'edit', id });
export const openAssetCopy = (id: string) => (assetSheet.value = { mode: 'copy', id });
export const closeAssetSheet = () => (assetSheet.value = null);

export function openSettings(page: SettingsPage, list?: ListsTab) {
  settingsPage.value = page;
  if (list) listsTab.value = list;
  setTab('settings');
}

/** 입력 대기 창이 열려 있는가 */
export const queueWindow = signal(false);
export const openQueue = () => (queueWindow.value = true);
export const closeQueue = () => (queueWindow.value = false);
/** 이번에 앱을 연 뒤 '입력 대기 N건' 알림을 이미 보여 줬는가 */
export const queueNotified = signal(false);

/** 사용 내역에서 「고정지출 등록」을 눌렀을 때 고정지출 등록 창에 미리 채울 값 (등록 화면이 읽고 비운다) */
export interface FixedDraft {
  name: string;
  memo: string;
  amount: number;
  day: number;
  category: string | null;
  user: string | null;
  payMethod: string | null;
  payDetail: string | null;
  /** 이미 고정지출에서 입력된 내역을 바탕으로 한 경우: 원래 고정지출의 id와 이름(이름은 못 찾으면 null) */
  fromFixed?: { id: string; name: string | null };
}
export const fixedDraft = signal<FixedDraft | null>(null);
export function openFixedFromEntry(d: FixedDraft) {
  fixedDraft.value = d;
  openSettings('fixed');
}

/** '건수만 표시' 설정에서 건수 칩을 눌러 오늘 이후 항목을 임시로 펼친 상태 */
export const revealFuture = signal(false);

/** 계정·동기화 창, 로그아웃 확인 창 */
export const accountModal = signal(false);
export const logoutDialog = signal(false);
