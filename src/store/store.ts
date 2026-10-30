import { computed, signal, type Signal } from '@preact/signals';
import { buildStoreIndex, compareEntries } from '../lib/calc';
import { todayKST, ymOf } from '../lib/dates';
import { dueDate, fixedEntryId, pendingMonths, runId } from '../lib/fixed';
import { uid } from '../lib/format';
import type { ImportPlan } from '../lib/importer';
import { seedCategories, seedPayMethods } from '../lib/seed';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Base,
  type Category,
  type Entry,
  type FixedItem,
  type FixedMonthRun,
  type ID,
  type ListTableName,
  type PayDetail,
  type PayMethod,
  type TableName,
  type User,
} from '../lib/types';
import { SCHEMA_VERSION, db, openDb } from './db';

/* ───────── 상태 ───────── */

export const ready = signal(false);
/** 시작이 오래 걸리는 이유를 화면에 알리기 위한 상태 */
export const bootBlocked = signal(false); // 다른 창의 이전 버전이 DB 업데이트를 막고 있음
export const bootError = signal<string | null>(null);
/** 이 창이 열려 있는 동안 다른 창이 앱을 더 새 버전으로 올려, 이 창의 DB 연결이 닫힘 */
export const staleTab = signal(false);
export const entries = signal<Entry[]>([]);
export const categories = signal<Category[]>([]);
export const users = signal<User[]>([]);
export const payMethods = signal<PayMethod[]>([]);
export const payDetails = signal<PayDetail[]>([]);
export const fixedItems = signal<FixedItem[]>([]);
export const fixedRuns = signal<FixedMonthRun[]>([]);
export const settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });
/** 이 기기에서 앱을 처음 쓴 달. 이 달 이전은 고정지출 월초 입력 대상이 아니다. */
export const firstUseYm = signal(ymOf(todayKST()));

export const today = signal(todayKST());
export const viewMonth = signal(ymOf(today.value));

interface Rows {
  entries: Entry;
  categories: Category;
  users: User;
  payMethods: PayMethod;
  payDetails: PayDetail;
  fixedItems: FixedItem;
  fixedRuns: FixedMonthRun;
}

const sigs: { [K in TableName]: Signal<Rows[K][]> } = {
  entries,
  categories,
  users,
  payMethods,
  payDetails,
  fixedItems,
  fixedRuns,
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
export const fixedItemsSorted = computed(() => [...fixedItems.value].sort(byOrder));
/** 월초 입력 창에서 처리해야 하는 달(오래된 순) */
export const pendingFixed = computed(() =>
  pendingMonths(
    firstUseYm.value,
    ymOf(today.value),
    fixedRuns.value,
    fixedItems.value,
    entries.value,
  ),
);

/* ───────── 초기화 ───────── */

export function refreshToday() {
  const t = todayKST();
  if (t !== today.value) today.value = t;
}

async function loadFromDb() {
  const d = db();
  const [e, c, u, p, pd, fi, fr, st, fu] = await Promise.all([
    d.entries.toArray(),
    d.categories.toArray(),
    d.users.toArray(),
    d.payMethods.toArray(),
    d.payDetails.toArray(),
    d.fixedItems.toArray(),
    d.fixedRuns.toArray(),
    d.meta.get('settings'),
    d.meta.get('firstUseYm'),
  ]);
  const live = <T extends Base>(rows: T[]) => rows.filter((r) => !r.deleted);
  entries.value = live(e);
  categories.value = live(c);
  users.value = live(u);
  payMethods.value = live(p);
  payDetails.value = live(pd);
  fixedItems.value = live(fi);
  fixedRuns.value = live(fr);
  if (typeof fu?.value === 'string') firstUseYm.value = fu.value;
  settings.value = { ...DEFAULT_SETTINGS, ...((st?.value as Partial<AppSettings>) ?? {}) };
}

export async function initStore(dbName?: string) {
  try {
    await initStoreInner(dbName);
  } catch (err) {
    // 조용히 멈추지 않고 이유를 보여 준다
    bootError.value = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('initStore failed', err);
  }
}

async function initStoreInner(dbName?: string) {
  const d = openDb(dbName);
  // 다른 창(특히 백그라운드로 멈춘 이전 버전 탭)이 연결을 놓지 않으면 업그레이드가 대기한다
  d.on('blocked', () => {
    bootBlocked.value = true;
  });
  // 다른 창에서 더 새 버전이 열리면 이 창의 연결은 (기본 동작대로) 닫히고, 새로고침을 안내한다
  d.on('versionchange', () => {
    staleTab.value = true;
  });
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
  if (!(await d.meta.get('firstUseYm'))) {
    await d.meta.put({ key: 'firstUseYm', value: ymOf(todayKST()) });
  }
  await loadFromDb();
  today.value = todayKST();
  viewMonth.value = ymOf(today.value);
  bootBlocked.value = false;
  ready.value = true;
  // 브라우저가 저장소를 임의로 정리하지 않도록 요청한다 (거부되어도 동작에는 영향 없음)
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

/* ───────── 저장 ───────── */

/** 로컬 데이터가 바뀔 때 알릴 곳 (동기화가 변경 후 몇 초 뒤에 묶어서 올리려고 등록한다) */
let onLocalChange: (() => void) | null = null;
export function setChangeListener(fn: (() => void) | null) {
  onLocalChange = fn;
}
/** 동기화가 받아 온 내용을 화면에 다시 반영한다 */
export const reloadFromDb = () => loadFromDb();

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
  onLocalChange?.();
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

export function usageOf(table: ListTableName, id: ID): number {
  const es = entries.value;
  const fx = fixedItems.value;
  switch (table) {
    case 'categories':
      return es.filter((e) => e.category === id).length + fx.filter((f) => f.category === id).length;
    case 'users':
      return (
        es.filter((e) => e.user === id).length +
        fx.filter((f) => f.user === id).length +
        users.value.filter((u) => u.type === 'group' && u.memberIds.includes(id)).length
      );
    case 'payMethods':
      return (
        es.filter((e) => e.payMethod === id).length +
        fx.filter((f) => f.payMethod === id).length +
        payDetails.value.filter((p) => p.payMethodId === id).length
      );
    case 'payDetails':
      return es.filter((e) => e.payDetail === id).length + fx.filter((f) => f.payDetail === id).length;
  }
}

export function canDelete(table: ListTableName, id: ID): boolean {
  return usageOf(table, id) === 0;
}

export async function deleteItem(table: ListTableName, id: ID): Promise<boolean> {
  if (!canDelete(table, id)) return false;
  const row = (sigs[table].value as Base[]).find((r) => r.id === id);
  if (!row) return false;
  await save(table, { ...row, deleted: true } as never);
  return true;
}

/** 이름 중복 검사 (앞뒤 공백·대소문자 무시). 사용자는 개인·그룹을 통틀어 검사한다. */
export function nameTaken(
  table: ListTableName | 'fixedItems',
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
  table: ListTableName | 'fixedItems',
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

/* ───────── 고정지출 ───────── */

export type FixedItemInput = Omit<FixedItem, 'id' | 'updatedAt' | 'deleted' | 'order'>;

export async function addFixedItem(input: FixedItemInput): Promise<FixedItem> {
  return save('fixedItems', { ...input, id: uid(), updatedAt: 0, order: nextOrder(fixedItems.value) });
}

export async function updateFixedItem(id: ID, patch: Partial<FixedItemInput>): Promise<void> {
  const cur = fixedItems.value.find((f) => f.id === id);
  if (cur) await save('fixedItems', { ...cur, ...patch });
}

/** 등록 항목을 지운다. 이미 만들어진 내역은 그대로 둔다. */
export async function deleteFixedItem(id: ID): Promise<void> {
  const cur = fixedItems.value.find((f) => f.id === id);
  if (cur) await save('fixedItems', { ...cur, deleted: true });
}

export interface FixedPick {
  itemId: ID;
  /** 창에서 금액을 고쳤으면 그 금액(확정). 없으면 등록 금액 */
  amount?: number;
}

/**
 * 고른 항목을 그 달 지정일 날짜의 내역으로 추가하고 그 달을 '처리함'으로 기록한다.
 * 이미 추가된 항목은 건너뛴다. 추가한 내역 ID를 돌려준다 (실행 취소용).
 */
export async function addFixedEntries(ym: string, picks: FixedPick[]): Promise<string[]> {
  const live = new Set(entries.value.map((e) => e.id));
  const made: string[] = [];
  for (const p of picks) {
    const item = fixedItems.value.find((f) => f.id === p.itemId);
    if (!item) continue;
    const id = fixedEntryId(item.id, ym);
    const date = dueDate(item.schedule, ym);
    if (!date || live.has(id)) continue;
    const edited = p.amount !== undefined && p.amount !== item.amount;
    await addEntry(
      {
        date,
        store: item.name,
        memo: item.memo,
        category: item.category,
        amount: p.amount ?? item.amount,
        user: item.user,
        payMethod: item.payMethod,
        payDetail: item.payDetail,
      },
      {
        id,
        source: 'fixed',
        fixedId: item.id,
        fixedYm: ym,
        isEstimate: item.amountMode === 'estimate' && !edited,
      },
    );
    made.push(id);
  }
  await markMonth(ym, 'done');
  return made;
}

export async function markMonth(ym: string, status: 'done' | 'skipped'): Promise<void> {
  await save('fixedRuns', { id: runId(ym), updatedAt: 0, ym, status });
}

/** '처리함·건너뜀' 기록을 지워 그 달을 다시 미처리로 되돌린다. */
export async function clearMonthRun(ym: string): Promise<void> {
  const cur = fixedRuns.value.find((r) => r.ym === ym);
  if (cur) await save('fixedRuns', { ...cur, deleted: true });
}

/* ───────── 설정 ───────── */

export async function updateSettings(patch: Partial<AppSettings>) {
  const next = { ...settings.value, ...patch };
  settings.value = next;
  await db().meta.put({ key: 'settings', value: next });
  // 월간 목표·미래 내역 표시는 기기 간에 공유되므로 바꾼 시각을 남긴다 (화면 취향은 기기마다 따로)
  if ('monthlyGoal' in patch || 'futureDisplay' in patch) {
    await db().meta.put({ key: 'settingsAt', value: Date.now() });
    onLocalChange?.();
  }
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
  /** v2부터. v1 백업에는 없다 */
  fixedItems?: FixedItem[];
  fixedRuns?: FixedMonthRun[];
}

export async function exportAll(): Promise<BackupFile> {
  const d = db();
  const [e, c, u, p, pd, fi, fr] = await Promise.all([
    d.entries.toArray(),
    d.categories.toArray(),
    d.users.toArray(),
    d.payMethods.toArray(),
    d.payDetails.toArray(),
    d.fixedItems.toArray(),
    d.fixedRuns.toArray(),
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
    fixedItems: fi,
    fixedRuns: fr,
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
  for (const k of ['fixedItems', 'fixedRuns']) {
    if (b[k] !== undefined && !Array.isArray(b[k])) return false;
  }
  return (b.entries as Entry[]).every(
    (e) => typeof e?.id === 'string' && typeof e.date === 'string' && typeof e.amount === 'number',
  );
}

const ALL_TABLES: TableName[] = ['entries', 'categories', 'users', 'payMethods', 'payDetails', 'fixedItems', 'fixedRuns'];

/**
 * 모든 표를 `rows`로 바꾼다. 기기 간 동기화에서 '지금 이 상태가 최신'으로 인정받도록,
 * 새 내용은 지금 시각으로 다시 찍고 사라지는 기록은 삭제 표시로 남긴다 (그냥 지우면 드라이브에서 되살아난다).
 */
async function replaceAllRows(rows: { [K in TableName]?: Base[] }): Promise<void> {
  const d = db();
  const now = Date.now();
  await d.transaction('rw', [d.entries, d.categories, d.users, d.payMethods, d.payDetails, d.fixedItems, d.fixedRuns], async () => {
    for (const t of ALL_TABLES) {
      const table = d[t] as unknown as {
        toArray(): Promise<Base[]>;
        clear(): Promise<void>;
        bulkPut(r: Base[]): Promise<unknown>;
      };
      const incoming = rows[t] ?? [];
      const keep = new Set(incoming.map((r) => r.id));
      const gone = (await table.toArray())
        .filter((r) => !keep.has(r.id) && !r.deleted)
        .map((r) => ({ ...r, deleted: true, updatedAt: now }));
      await table.bulkPut([...incoming.map((r) => ({ ...r, updatedAt: now })), ...gone]);
    }
  });
}

export async function importAll(data: BackupFile): Promise<void> {
  const d = db();
  await replaceAllRows({
    entries: data.entries,
    categories: data.categories,
    users: data.users,
    payMethods: data.payMethods,
    payDetails: data.payDetails,
    fixedItems: data.fixedItems ?? [],
    fixedRuns: data.fixedRuns ?? [],
  });
  await d.meta.put({ key: 'seeded', value: true });
  if (data.settings) {
    await d.meta.put({ key: 'settings', value: data.settings });
    await d.meta.put({ key: 'settingsAt', value: Date.now() });
  }
  await loadFromDb();
  onLocalChange?.();
}

/** 모든 내역과 목록을 지우고 기본 분류·지불수단으로 되돌린다. (로그인 중이면 다른 기기에도 전파된다) */
export async function resetAll(): Promise<void> {
  const d = db();
  const now = Date.now();
  await replaceAllRows({
    categories: seedCategories().map((c) => ({ ...c, updatedAt: now })),
    payMethods: seedPayMethods().map((p) => ({ ...p, updatedAt: now })),
  });
  await d.meta.put({ key: 'firstUseYm', value: ymOf(todayKST()) });
  await d.meta.put({ key: 'seeded', value: true });
  await d.meta.delete('settings');
  await d.meta.put({ key: 'settingsAt', value: now });
  await loadFromDb();
  settings.value = { ...DEFAULT_SETTINGS };
  onLocalChange?.();
}

/**
 * 이 기기의 데이터만 지우고 처음 상태로 되돌린다. 드라이브에는 아무 것도 보내지 않는다.
 * (로그아웃하면서 '이 기기에서 삭제'를 고른 경우)
 */
export async function wipeLocalOnly(): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.entries, d.categories, d.users, d.payMethods, d.payDetails, d.fixedItems, d.fixedRuns, d.meta], async () => {
    await Promise.all([
      d.entries.clear(),
      d.categories.clear(),
      d.users.clear(),
      d.payMethods.clear(),
      d.payDetails.clear(),
      d.fixedItems.clear(),
      d.fixedRuns.clear(),
      d.meta.clear(),
    ]);
    await d.meta.put({ key: 'firstUseYm', value: ymOf(todayKST()) });
    await d.categories.bulkPut(seedCategories());
    await d.payMethods.bulkPut(seedPayMethods());
    await d.meta.put({ key: 'seeded', value: true });
  });
  await loadFromDb();
  settings.value = { ...DEFAULT_SETTINGS };
}

/* ───────── 엑셀 가져오기 ───────── */

/** 가져오기 한 번의 기록. 이 기기에만 남고, 되돌릴 때 '새로 등록한 목록도 지우기'에 쓴다 */
export interface ImportBatchMeta {
  id: string;
  at: number;
  label: string;
  entries: number;
  users: ID[];
  categories: ID[];
  payMethods: ID[];
  payDetails: ID[];
}

/** 확정: 새 목록과 내역을 한 번에 저장한다. 도중에 실패하면 아무것도 저장되지 않는다. */
export async function commitImport(plan: ImportPlan, label: string): Promise<ImportBatchMeta> {
  const d = db();
  const at = Date.now();
  const meta: ImportBatchMeta = {
    id: plan.batchId,
    at,
    label,
    entries: plan.entries.length,
    users: plan.users.map((u) => u.id),
    categories: plan.categories.map((c) => c.id),
    payMethods: plan.payMethods.map((c) => c.id),
    payDetails: plan.payDetails.map((c) => c.id),
  };
  await d.transaction('rw', [d.entries, d.categories, d.users, d.payMethods, d.payDetails, d.meta], async () => {
    await d.users.bulkPut(plan.users.map((x) => ({ ...x, updatedAt: at })));
    await d.categories.bulkPut(plan.categories.map((x) => ({ ...x, updatedAt: at })));
    await d.payMethods.bulkPut(plan.payMethods.map((x) => ({ ...x, updatedAt: at })));
    await d.payDetails.bulkPut(plan.payDetails.map((x) => ({ ...x, updatedAt: at })));
    await d.entries.bulkPut(plan.entries.map((x) => ({ ...x, updatedAt: at })));
    const prev = ((await d.meta.get('importBatches'))?.value as ImportBatchMeta[] | undefined) ?? [];
    await d.meta.put({ key: 'importBatches', value: [...prev, meta].slice(-20) });
  });
  await loadFromDb();
  onLocalChange?.();
  return meta;
}

export interface LastImport {
  id: string;
  at: number;
  /** 지금 남아 있는 내역 수 */
  count: number;
  meta: ImportBatchMeta | null;
}

/** 가장 나중에 가져온 묶음 (내역에 남은 묶음 ID로 찾는다. 다른 기기에서 가져온 것도 보인다) */
export async function findLastImport(): Promise<LastImport | null> {
  const counts = new Map<string, number>();
  for (const e of entries.value) if (e.importBatchId) counts.set(e.importBatchId, (counts.get(e.importBatchId) ?? 0) + 1);
  if (!counts.size) return null;
  const metas = ((await db().meta.get('importBatches'))?.value as ImportBatchMeta[] | undefined) ?? [];
  const stamp = (id: string) => metas.find((m) => m.id === id)?.at ?? (Number(id.replace(/\D/g, '')) || 0);
  const id = [...counts.keys()].sort((a, b) => stamp(b) - stamp(a))[0];
  return { id, at: stamp(id), count: counts.get(id)!, meta: metas.find((m) => m.id === id) ?? null };
}

/** 가져오기 묶음을 통째로 지운다. removeNew이면 그때 새로 등록한 목록 중 이제 쓰이지 않는 것도 지운다 */
export async function undoImport(batchId: string, removeNew: boolean): Promise<{ entries: number; lists: number }> {
  const targets = entries.value.filter((e) => e.importBatchId === batchId);
  const d = db();
  const now = Date.now();
  await d.entries.bulkPut(targets.map((e) => ({ ...e, deleted: true, updatedAt: now })));
  await loadFromDb();
  let lists = 0;
  const meta = ((await d.meta.get('importBatches'))?.value as ImportBatchMeta[] | undefined)?.find((m) => m.id === batchId);
  if (removeNew && meta) {
    // 쓰이는 순서를 거슬러 지운다: 결제상세 → 지불수단, 그룹 → 개인, 분류
    const groupsFirst = [...meta.users].sort((a, b) => Number(usersById.value.get(a)?.type === 'person') - Number(usersById.value.get(b)?.type === 'person'));
    const plan: [ListTableName, ID[]][] = [
      ['payDetails', meta.payDetails],
      ['payMethods', meta.payMethods],
      ['users', groupsFirst],
      ['categories', meta.categories],
    ];
    for (const [table, ids] of plan) for (const id of ids) if (await deleteItem(table, id)) lists++;
  }
  onLocalChange?.();
  return { entries: targets.length, lists };
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
