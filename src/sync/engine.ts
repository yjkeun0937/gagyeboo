/**
 * 기기 간 동기화 엔진 (구글 드라이브 앱 전용 폴더).
 *
 * 로컬(IndexedDB)이 작업본이고, 드라이브 파일이 기기 간 공유본이다.
 * - `meta.json`: 분류·사용자·지불수단·결제상세·고정지출·월별 처리 상태, 공유 설정(월간 목표·미래 내역 표시), 처음 쓴 달
 * - `entries-YYYY.json`: 그 해 날짜의 지출 내역 (삭제 표시 포함)
 * 기록 하나하나를 id로 맞춰, 같은 id는 `updatedAt`이 더 큰 쪽을 쓴다. 삭제는 삭제 표시(deleted)로 전파된다.
 * 업로드할지는 "내 기록 중 드라이브보다 새롭거나 드라이브에 없는 것이 있는가"로 정하므로,
 * 두 기기가 동시에 올려 한쪽이 덮어쓰여도 다음 동기화에서 빠진 기록이 다시 올라간다.
 */
import type { Asset, AssetLog, Base, Entry } from '../lib/types';
import { SCHEMA_VERSION, type LedgerDB } from '../store/db';

export interface RemoteFile {
  id: string;
  name: string;
  /** 파일이 바뀔 때마다 달라지는 값 */
  version: string;
}

/** 드라이브 접근 방식. 실제 구현은 drive.ts, 테스트에서는 메모리 구현을 쓴다. */
export interface DriveClient {
  list(): Promise<RemoteFile[]>;
  read(id: string): Promise<string>;
  create(name: string, content: string): Promise<RemoteFile>;
  update(id: string, content: string): Promise<RemoteFile>;
  remove(id: string): Promise<void>;
  /** 없어졌으면 null */
  stat(id: string): Promise<RemoteFile | null>;
}

export class SyncError extends Error {
  constructor(
    public code: 'newer-version' | 'conflict' | 'bad-data',
    message: string,
  ) {
    super(message);
  }
}

export const META_FILE = 'meta.json';
/** 재산상황(항목과 변경 이력). 계정 공유를 만들 때 따로 뺄 수 있게 별도 파일로 둔다 */
export const ASSETS_FILE = 'assets.json';
export const entriesFile = (year: string) => `entries-${year}.json`;
const ENTRIES_RE = /^entries-(\d{4})\.json$/;

const META_TABLES = ['categories', 'users', 'payMethods', 'payDetails', 'fixedItems', 'fixedRuns'] as const;
type MetaTable = (typeof META_TABLES)[number];

/** 설정 중 기기 간에 공유하는 것 (테마·글자 크기·정렬 같은 화면 취향은 기기마다 따로 둔다) */
export interface SharedSettings {
  monthlyGoal: number | null;
  futureDisplay: 'all' | 'count' | 'hide';
  at: number;
}

interface MetaDoc {
  app: 'gagyeboo';
  kind: 'meta';
  schemaVersion: number;
  categories: Base[];
  users: Base[];
  payMethods: Base[];
  payDetails: Base[];
  fixedItems: Base[];
  fixedRuns: Base[];
  shared?: SharedSettings;
  firstUseYm?: string;
}

interface AssetsDoc {
  app: 'gagyeboo';
  kind: 'assets';
  schemaVersion: number;
  assets: Asset[];
  logs: AssetLog[];
}

interface EntriesDoc {
  app: 'gagyeboo';
  kind: 'entries';
  schemaVersion: number;
  year: string;
  entries: Entry[];
}

/** 파일별로 마지막에 맞춘 드라이브 상태: 버전과 기록별 수정 시각 */
export interface SyncState {
  accountSub?: string;
  files: Record<string, { version: string; stamps: Record<string, number> }>;
  lastSyncAt?: number;
}

export const emptySyncState = (): SyncState => ({ files: {} });

export interface SyncResult {
  state: SyncState;
  /** 드라이브에서 받아 이 기기에 반영한 기록 수 */
  pulled: number;
  /** 드라이브로 올린 파일 수 */
  pushedFiles: number;
  /** 설정·목록이 바뀌어 화면을 다시 불러와야 하는지 */
  changed: boolean;
}

/* ───────── 로컬 읽기 ───────── */

type Table = {
  toArray(): Promise<Base[]>;
  get(id: string): Promise<Base | undefined>;
  put(row: Base): Promise<unknown>;
  bulkPut(rows: Base[]): Promise<unknown>;
};
const tbl = (ldb: LedgerDB, name: string) => (ldb as unknown as Record<string, Table>)[name];

async function metaGet<T>(ldb: LedgerDB, key: string): Promise<T | undefined> {
  return (await ldb.meta.get(key))?.value as T | undefined;
}

async function localShared(ldb: LedgerDB): Promise<SharedSettings> {
  const s = await metaGet<{ monthlyGoal?: number | null; futureDisplay?: SharedSettings['futureDisplay'] }>(ldb, 'settings');
  const at = (await metaGet<number>(ldb, 'settingsAt')) ?? 0;
  return { monthlyGoal: s?.monthlyGoal ?? null, futureDisplay: s?.futureDisplay ?? 'all', at };
}

const ymNum = (ym: string | undefined) => (ym && /^\d{4}-\d{2}$/.test(ym) ? Number(ym.replace('-', '')) : Infinity);

interface Scope {
  name: string;
  /** 이 파일에 들어갈 내 기록의 (키 → 수정 시각) */
  stamps: Record<string, number>;
  build(): string;
}

async function localScopes(ldb: LedgerDB): Promise<Scope[]> {
  const scopes: Scope[] = [];
  // meta.json
  const metaRows: Record<MetaTable, Base[]> = {} as never;
  const stamps: Record<string, number> = {};
  for (const t of META_TABLES) {
    metaRows[t] = await tbl(ldb, t).toArray();
    for (const r of metaRows[t]) stamps[`${t}:${r.id}`] = r.updatedAt;
  }
  const shared = await localShared(ldb);
  const firstUseYm = await metaGet<string>(ldb, 'firstUseYm');
  stamps.shared = shared.at;
  stamps.firstUseYm = ymNum(firstUseYm);
  scopes.push({
    name: META_FILE,
    stamps,
    build: () =>
      JSON.stringify({
        app: 'gagyeboo',
        kind: 'meta',
        schemaVersion: SCHEMA_VERSION,
        ...metaRows,
        shared,
        firstUseYm,
      } satisfies MetaDoc),
  });
  // entries-YYYY.json
  const byYear = new Map<string, Entry[]>();
  for (const e of (await ldb.entries.toArray()) as Entry[]) {
    const y = e.date.slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(e);
  }
  for (const [year, rows] of [...byYear].sort()) {
    const st: Record<string, number> = {};
    for (const r of rows) st[r.id] = r.updatedAt;
    scopes.push({
      name: entriesFile(year),
      stamps: st,
      build: () =>
        JSON.stringify({ app: 'gagyeboo', kind: 'entries', schemaVersion: SCHEMA_VERSION, year, entries: rows } satisfies EntriesDoc),
    });
  }
  // assets.json (삭제 표시도 올려야 다른 기기에서 지워진다)
  const assetRows = (await ldb.assets.toArray()) as Asset[];
  const logRows = (await ldb.assetLogs.toArray()) as AssetLog[];
  if (assetRows.length || logRows.length) {
    const st: Record<string, number> = {};
    for (const r of assetRows) st[`a:${r.id}`] = r.updatedAt;
    for (const r of logRows) st[`l:${r.id}`] = r.updatedAt;
    scopes.push({
      name: ASSETS_FILE,
      stamps: st,
      build: () =>
        JSON.stringify({ app: 'gagyeboo', kind: 'assets', schemaVersion: SCHEMA_VERSION, assets: assetRows, logs: logRows } satisfies AssetsDoc),
    });
  }
  return scopes;
}

/* ───────── 드라이브 내용을 로컬에 합치기 ───────── */

interface Applied {
  rows: number;
  changed: boolean;
  /** 이 문서가 담고 있는 기록의 (키 → 수정 시각) */
  stamps: Record<string, number>;
}

function parse(text: string): MetaDoc | EntriesDoc | AssetsDoc {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new SyncError('bad-data', '드라이브 파일을 읽을 수 없습니다 (형식 오류)');
  }
  const d = doc as { app?: string; kind?: string; schemaVersion?: number };
  if (!d || d.app !== 'gagyeboo' || (d.kind !== 'meta' && d.kind !== 'entries' && d.kind !== 'assets')) {
    throw new SyncError('bad-data', '이 앱의 파일이 아닙니다');
  }
  if ((d.schemaVersion ?? 0) > SCHEMA_VERSION) {
    throw new SyncError('newer-version', '다른 기기에서 앱이 더 새 버전으로 바뀌었습니다. 이 화면을 새로고침한 뒤 다시 시도해 주세요');
  }
  return doc as MetaDoc | EntriesDoc | AssetsDoc;
}

/** 한 테이블에 대해, 로컬에 없거나 더 오래된 기록만 덮어쓴다 (읽기-비교-쓰기를 한 트랜잭션에서) */
async function mergeRows(ldb: LedgerDB, name: string, rows: Base[]): Promise<number> {
  const good = rows.filter((r) => r && typeof r.id === 'string' && typeof r.updatedAt === 'number');
  if (!good.length) return 0;
  const table = tbl(ldb, name);
  let applied = 0;
  await ldb.transaction('rw', (ldb as unknown as Record<string, never>)[name], async () => {
    const locals = (await table.toArray()) as Base[];
    const byId = new Map(locals.map((r) => [r.id, r]));
    const put: Base[] = [];
    for (const r of good) {
      const cur = byId.get(r.id);
      if (!cur || r.updatedAt > cur.updatedAt) put.push(r);
    }
    if (put.length) await table.bulkPut(put);
    applied = put.length;
  });
  return applied;
}

async function applyDoc(ldb: LedgerDB, doc: MetaDoc | EntriesDoc | AssetsDoc): Promise<Applied> {
  const stamps: Record<string, number> = {};
  let rows = 0;
  let changed = false;
  if (doc.kind === 'entries') {
    const list = Array.isArray(doc.entries) ? doc.entries.filter((e) => typeof e?.date === 'string' && typeof e.amount === 'number') : [];
    for (const e of list) stamps[e.id] = e.updatedAt;
    rows += await mergeRows(ldb, 'entries', list);
    return { rows, changed: rows > 0, stamps };
  }
  if (doc.kind === 'assets') {
    const as = Array.isArray(doc.assets) ? doc.assets.filter((a) => a && typeof a.name === 'string') : [];
    const ls = Array.isArray(doc.logs) ? doc.logs.filter((l) => l && typeof l.assetId === 'string' && typeof l.at === 'number') : [];
    for (const a of as) stamps[`a:${a.id}`] = a.updatedAt;
    for (const l of ls) stamps[`l:${l.id}`] = l.updatedAt;
    rows += await mergeRows(ldb, 'assets', as);
    rows += await mergeRows(ldb, 'assetLogs', ls);
    return { rows, changed: rows > 0, stamps };
  }
  for (const t of META_TABLES) {
    const list = Array.isArray(doc[t]) ? doc[t] : [];
    for (const r of list) stamps[`${t}:${r.id}`] = r.updatedAt;
    const n = await mergeRows(ldb, t, list);
    rows += n;
    if (n) changed = true;
  }
  if (doc.shared && typeof doc.shared.at === 'number') {
    stamps.shared = doc.shared.at;
    const mine = await localShared(ldb);
    if (doc.shared.at > mine.at) {
      const cur = (await metaGet<Record<string, unknown>>(ldb, 'settings')) ?? {};
      await ldb.meta.put({
        key: 'settings',
        value: { ...cur, monthlyGoal: doc.shared.monthlyGoal ?? null, futureDisplay: doc.shared.futureDisplay ?? 'all' },
      });
      await ldb.meta.put({ key: 'settingsAt', value: doc.shared.at });
      changed = true;
      rows += 1;
    }
  }
  stamps.firstUseYm = ymNum(doc.firstUseYm);
  const mineYm = await metaGet<string>(ldb, 'firstUseYm');
  if (doc.firstUseYm && ymNum(doc.firstUseYm) < ymNum(mineYm)) {
    await ldb.meta.put({ key: 'firstUseYm', value: doc.firstUseYm });
    changed = true;
  }
  return { rows, changed, stamps };
}

/** 내 기록 중 드라이브(remote)보다 새롭거나 드라이브에 없는 것이 있는지 */
function hasNewer(local: Record<string, number>, remote: Record<string, number>): boolean {
  for (const [k, v] of Object.entries(local)) {
    if (k === 'firstUseYm') {
      if (v < (remote[k] ?? Infinity)) return true;
    } else if (v > (remote[k] ?? -1)) return true;
  }
  return false;
}

/* ───────── 동기화 한 번 ───────── */

export async function syncOnce(ldb: LedgerDB, client: DriveClient, prev: SyncState): Promise<SyncResult> {
  let state: SyncState = { ...prev, files: { ...prev.files } };
  let pulled = 0;
  let changed = false;
  let pushedFiles = 0;

  for (let attempt = 0; attempt < 4; attempt++) {
    const listed = await client.list();
    const remote = new Map<string, RemoteFile[]>();
    for (const f of listed) {
      if (f.name !== META_FILE && f.name !== ASSETS_FILE && !ENTRIES_RE.test(f.name)) continue;
      (remote.get(f.name) ?? remote.set(f.name, []).get(f.name)!).push(f);
    }
    for (const files of remote.values()) files.sort((a, b) => (a.id < b.id ? -1 : 1));

    // 1) 받기: 버전이 달라졌거나 같은 이름의 파일이 여러 개인 것만 읽어서 합친다
    const remoteStamps: Record<string, Record<string, number>> = {};
    for (const [name, files] of remote) {
      const known = state.files[name];
      const dup = files.length > 1;
      if (!dup && known && known.version === files[0].version) {
        remoteStamps[name] = known.stamps;
        continue;
      }
      const merged: Record<string, number> = {};
      for (const f of files) {
        const applied = await applyDoc(ldb, parse(await client.read(f.id)));
        pulled += applied.rows;
        if (applied.changed) changed = true;
        for (const [k, v] of Object.entries(applied.stamps)) merged[k] = Math.max(merged[k] ?? -1, v);
      }
      remoteStamps[name] = merged;
      state.files[name] = { version: files[0].version, stamps: merged };
    }
    // 드라이브에서 사라진 파일은 기억에서도 지운다
    for (const name of Object.keys(state.files)) if (!remote.has(name)) delete state.files[name];

    // 2) 올리기: 내 기록이 더 새롭거나 드라이브에 없을 때, 또는 중복 파일을 정리해야 할 때
    const scopes = await localScopes(ldb);
    let conflict = false;
    for (const sc of scopes) {
      const files = remote.get(sc.name) ?? [];
      const need = files.length > 1 || (files.length === 0 ? Object.keys(sc.stamps).length > 0 && hasNewer(sc.stamps, {}) : hasNewer(sc.stamps, remoteStamps[sc.name] ?? {}));
      if (!need) continue;
      if (files.length) {
        const st = await client.stat(files[0].id);
        if (!st || st.version !== files[0].version) {
          conflict = true; // 읽은 뒤에 다른 기기가 바꿨다 → 처음부터 다시
          break;
        }
      }
      const content = sc.build();
      const res = files.length ? await client.update(files[0].id, content) : await client.create(sc.name, content);
      for (const extra of files.slice(1)) await client.remove(extra.id);
      state.files[sc.name] = { version: res.version, stamps: sc.stamps };
      pushedFiles++;
    }
    if (!conflict) {
      state = { ...state, lastSyncAt: Date.now() };
      return { state, pulled, pushedFiles, changed };
    }
    // 다른 기기가 바꾼 파일은 다음 바퀴에서 다시 읽도록 기억을 지운다
    state.files = {};
  }
  throw new SyncError('conflict', '다른 기기와 동시에 저장되어 잠시 후 다시 시도합니다');
}

/** 로그인 직후 확인 창에 보여줄 숫자: 이 기기 / 드라이브 / 합친 뒤의 지출 내역 건수 */
export async function previewMerge(
  ldb: LedgerDB,
  client: DriveClient,
): Promise<{ local: number; remote: number; merged: number }> {
  const live = (rows: Entry[]) => rows.filter((e) => !e.deleted);
  const local = (await ldb.entries.toArray()) as Entry[];
  const localMap = new Map(local.map((e) => [e.id, e]));
  const remoteMap = new Map<string, Entry>();
  for (const f of await client.list()) {
    if (!ENTRIES_RE.test(f.name)) continue;
    const doc = parse(await client.read(f.id));
    if (doc.kind !== 'entries') continue;
    for (const e of doc.entries ?? []) {
      const cur = remoteMap.get(e.id);
      if (!cur || e.updatedAt > cur.updatedAt) remoteMap.set(e.id, e);
    }
  }
  const mergedMap = new Map(localMap);
  for (const [id, e] of remoteMap) {
    const cur = mergedMap.get(id);
    if (!cur || e.updatedAt > cur.updatedAt) mergedMap.set(id, e);
  }
  return {
    local: live([...localMap.values()]).length,
    remote: live([...remoteMap.values()]).length,
    merged: live([...mergedMap.values()]).length,
  };
}
