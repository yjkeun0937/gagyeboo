import { computed, signal, type Signal } from '@preact/signals';
import { buildStoreIndex, compareEntries } from '../lib/calc';
import { todayKST, ymOf } from '../lib/dates';
import { uid } from '../lib/format';
import { seedCategories, seedPayMethods } from '../lib/seed';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Base,
  type Category,
  type Entry,
  type ID,
  type PayDetail,
  type PayMethod,
  type TableName,
  type User,
} from '../lib/types';
import { SCHEMA_VERSION, db, openDb } from './db';

/* ───────── 상태 ───────── */

export const ready = signal(false);
export const entries = signal<Entry[]>([]);
export const categories = signal<Category[]>([]);
export const users = signal<User[]>([]);
export const payMethods = signal<PayMethod[]>([]);
export const payDetails = signal<PayDetail[]>([]);
export const settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });

export const today = signal(todayKST());
export const viewMonth = signal(ymOf(today.value));

interface Rows {
  entries: Entry;
  categories: Category;
  users: User;
  payMethods: PayMethod;
  payDetails: PayDetail;
}

const sigs: { [K in TableName]: Signal<Rows[K][]> } = {
  entries,
  categories,
  users,
  payMethods,
  payDetails,
};

export const usersById = computed(() => new Map(users.value.map((u) => [u.id, u])));
export const categoriesById = computed(() => new Map(categories.value.map((c) => [c.id, c])));
export const payMethodsById = computed(() => new Map(payMethods.value.map((p) => [p.id, p])));
export const payDetailsById = computed(() => new Map(payDetails.value.map((p) => [p.id, p])));

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;
export const usersSorted = computed(() => [...users.value].sort(byOrder));
export const personsSorted = computed(() => usersSorted.value.filter((u) => u.type === 'person'));
export const groupsSorted = computed(() => usersSorted.value.filter((u) => u.type === 'group'));
export const categoriesSorted = computed(() => [...categories.value].sort(byOrder));
export const payMethodsSorted = computed(() => [...payMethods.value].sort(byOrder));
export const payDetailsSorted = computed(() => [...payDetails.value].sort(byOrder));

export const monthEntries = computed(() =>
  entries.value.filter((e) => e.date.startsWith(viewMonth.value)).sort(compareEntries),
);
export const storeIndex = computed(() => buildStoreIndex(entries.value));

/* ───────── 초기화 ───────── */

export function refreshToday() {
  const t = todayKST();
  if (t !== today.value) today.value = t;
}

async function loadFromDb() {
  const d = db();
  const [e, c, u, p, pd, st] = await Promise.all([
    d.entries.toArray(),
    d.categories.toArray(),
    d.users.toArray(),
    d.payMethods.toArray(),
    d.payDetails.toArray(),
    d.meta.get('settings'),
  ]);
  const live = <T extends Base>(rows: T[]) => rows.filter((r) => !r.deleted);
  entries.value = live(e);
  categories.value = live(c);
  users.value = live(u);
  payMethods.value = live(p);
  payDetails.value = live(pd);
  settings.value = { ...DEFAULT_SETTINGS, ...((st?.value as Partial<AppSettings>) ?? {}) };
}

export async function initStore(dbName?: string) {
  const d = openDb(dbName);
  const seeded = await d.meta.get('seeded');
  if (!seeded) {
    // 처음 시작할 때만 기본 분류·지불수단을 넣는다 (이미 있는 ID는 건드리지 않음)
    const have = new Set([
      ...(await d.categories.toCollection().primaryKeys()),
      ...(await d.payMethods.toCollection().primaryKeys()),
    ]);
    await d.categories.bulkPut(seedCategories().filter((c) => !have.has(c.id)));
    await d.payMethods.bulkPut(seedPayMethods().filter((p) => !have.has(p.id)));
    await d.meta.put({ key: 'seeded', value: true });
  }
  await loadFromDb();
  today.value = todayKST();
  viewMonth.value = ymOf(today.value);
  ready.value = true;
  // 브라우저가 저장소를 임의로 정리하지 않도록 요청한다 (거부되어도 동작에는 영향 없음)
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

/* ───────── 저장 ───────── */

let lastStamp = 0;
/** 같은 날짜 안의 입력 순서를 보존하기 위해 항상 증가하는 값을 만든다. */
export function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export async function save<T extends TableName>(table: T, item: Rows[T]): Promise<Rows[T]> {
  const next = { ...item, updatedAt: Date.now() } as Rows[T];
  await (db()[table] as unknown as { put(r: Rows[T]): Promise<unknown> }).put(next);
  const s = sigs[table] as Signal<Rows[T][]>;
  const rest = s.value.filter((x) => x.id !== next.id);
  s.value = next.deleted ? rest : [...rest, next];
  return next;
}

/* ───────── 지출 내역 ───────── */

export interface EntryInput {
  date: string;
  store: string;
  memo: string;
  category: ID | null;
  amount: number;
  user: ID | null;
  payMethod: ID | null;
  payDetail: ID | null;
  isEstimate?: boolean;
}

export async function addEntry(input: EntryInput, extra: Partial<Entry> = {}): Promise<Entry> {
  const e: Entry = {
    ...input,
    id: uid(),
    source: 'manual',
    createdAt: nextStamp(),
    updatedAt: 0,
    ...extra,
  };
  return save('entries', e);
}

/** 수정한다. 금액을 바꾸면 [예상]이 풀리고 확정된다. 이전 값을 돌려준다(실행 취소용). */
export async function updateEntry(id: ID, patch: Partial<EntryInput>): Promise<Entry | null> {
  const prev = entries.value.find((e) => e.id === id);
  if (!prev) return null;
  const next: Entry = { ...prev, ...patch };
  if (patch.amount !== undefined && patch.amount !== prev.amount) next.isEstimate = false;
  await save('entries', next);
  return prev;
}

export async function removeEntry(id: ID): Promise<Entry | null> {
  const prev = entries.value.find((e) => e.id === id);
  if (!prev) return null;
  await save('entries', { ...prev, deleted: true });
  return prev;
}

/** 삭제·수정을 되돌린다 (이전 값을 그대로 다시 저장). */
export async function restoreEntry(prev: Entry): Promise<void> {
  await save('entries', { ...prev, deleted: false });
}

/* ───────── 목록(사용자·지불수단·결제상세·분류) ───────── */

export function nextOrder(list: { order: number }[]): number {
  return list.reduce((m, x) => Math.max(m, x.order), -1) + 1;
}

export function usageOf(table: Exclude<TableName, 'entries'>, id: ID): number {
  const es = entries.value;
  switch (table) {
    case 'categories':
      return es.filter((e) => e.category === id).length;
    case 'users':
      return (
        es.filter((e) => e.user === id).length +
        users.value.filter((u) => u.type === 'group' && u.memberIds.includes(id)).length
      );
    case 'payMethods':
      return (
        es.filter((e) => e.payMethod === id).length +
        payDetails.value.filter((p) => p.payMethodId === id).length
      );
    case 'payDetails':
      return es.filter((e) => e.payDetail === id).length;
  }
}

export function canDelete(table: Exclude<TableName, 'entries'>, id: ID): boolean {
  return usageOf(table, id) === 0;
}

export async function deleteItem(table: Exclude<TableName, 'entries'>, id: ID): Promise<boolean> {
  if (!canDelete(table, id)) return false;
  const row = (sigs[table].value as Base[]).find((r) => r.id === id);
  if (!row) return false;
  await save(table, { ...row, deleted: true } as never);
  return true;
}

/** 이름 중복 검사 (앞뒤 공백·대소문자 무시). 사용자는 개인·그룹을 통틀어 검사한다. */
export function nameTaken(
  table: Exclude<TableName, 'entries'>,
  name: string,
  exceptId?: ID,
): boolean {
  const n = name.trim().toLowerCase();
  return (sigs[table].value as { id: ID; name: string }[]).some(
    (r) => r.id !== exceptId && r.name.trim().toLowerCase() === n,
  );
}

type Orderable = { id: ID; order: number; type?: string };

/** 같은 구역(사용자는 개인/그룹별) 안에서 위/아래로 한 칸 옮긴다. */
export async function moveItem(
  table: Exclude<TableName, 'entries'>,
  id: ID,
  dir: -1 | 1,
): Promise<void> {
  const all = sigs[table].value as unknown as Orderable[];
  const me = all.find((r) => r.id === id);
  if (!me) return;
  const siblings = all
    .filter((r) => (table === 'users' ? r.type === me.type : true))
    .sort((a, b) => a.order - b.order);
  const i = siblings.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  for (let k = 0; k < siblings.length; k++) {
    if (siblings[k].order !== k) await save(table, { ...siblings[k], order: k } as never);
  }
}

/* ───────── 설정 ───────── */

export async function updateSettings(patch: Partial<AppSettings>) {
  const next = { ...settings.value, ...patch };
  settings.value = next;
  await db().meta.put({ key: 'settings', value: next });
}

/* ───────── 백업·복원 ───────── */

export interface BackupFile {
  app: 'gagyeboo';
  schemaVersion: number;
  exportedAt: string;
  settings: AppSettings;
  entries: Entry[];
  categories: Category[];
  users: User[];
  payMethods: PayMethod[];
  payDetails: PayDetail[];
}

export async function exportAll(): Promise<BackupFile> {
  const d = db();
  const [e, c, u, p, pd] = await Promise.all([
    d.entries.toArray(),
    d.categories.toArray(),
    d.users.toArray(),
    d.payMethods.toArray(),
    d.payDetails.toArray(),
  ]);
  return {
    app: 'gagyeboo',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settings.value,
    entries: e,
    categories: c,
    users: u,
    payMethods: p,
    payDetails: pd,
  };
}

export function validateBackup(data: unknown): data is BackupFile {
  if (!data || typeof data !== 'object') return false;
  const b = data as Record<string, unknown>;
  if (b.app !== 'gagyeboo' || typeof b.schemaVersion !== 'number') return false;
  if (b.schemaVersion > SCHEMA_VERSION) return false;
  for (const k of ['entries', 'categories', 'users', 'payMethods', 'payDetails']) {
    if (!Array.isArray(b[k])) return false;
  }
  return (b.entries as Entry[]).every(
    (e) => typeof e?.id === 'string' && typeof e.date === 'string' && typeof e.amount === 'number',
  );
}

export async function importAll(data: BackupFile): Promise<void> {
  const d = db();
  await d.transaction(
    'rw',
    [d.entries, d.categories, d.users, d.payMethods, d.payDetails, d.meta],
    async () => {
      await Promise.all([
        d.entries.clear(),
        d.categories.clear(),
        d.users.clear(),
        d.payMethods.clear(),
        d.payDetails.clear(),
      ]);
      await d.entries.bulkPut(data.entries);
      await d.categories.bulkPut(data.categories);
      await d.users.bulkPut(data.users);
      await d.payMethods.bulkPut(data.payMethods);
      await d.payDetails.bulkPut(data.payDetails);
      await d.meta.put({ key: 'seeded', value: true });
      if (data.settings) await d.meta.put({ key: 'settings', value: data.settings });
    },
  );
  await loadFromDb();
}

/** 모든 내역과 목록을 지우고 기본 분류·지불수단으로 되돌린다. */
export async function resetAll(): Promise<void> {
  const d = db();
  await d.transaction(
    'rw',
    [d.entries, d.categories, d.users, d.payMethods, d.payDetails, d.meta],
    async () => {
      await Promise.all([
        d.entries.clear(),
        d.categories.clear(),
        d.users.clear(),
        d.payMethods.clear(),
        d.payDetails.clear(),
        d.meta.clear(),
      ]);
      await d.categories.bulkPut(seedCategories());
      await d.payMethods.bulkPut(seedPayMethods());
      await d.meta.put({ key: 'seeded', value: true });
    },
  );
  await loadFromDb();
}

/* ───────── 알림(토스트) ───────── */

export interface ToastState {
  seq: number;
  message: string;
  undo?: () => Promise<void> | void;
}
export const toast = signal<ToastState | null>(null);
let toastSeq = 0;
export function showToast(message: string, undo?: ToastState['undo']) {
  toast.value = { seq: ++toastSeq, message, undo };
}
