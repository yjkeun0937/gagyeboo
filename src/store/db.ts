import Dexie, { type Table } from 'dexie';
import type {
  Asset,
  AssetLog,
  Category,
  Entry,
  FixedItem,
  FixedMonthRun,
  PayDetail,
  PayMethod,
  User,
} from '../lib/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * 로컬 저장소(IndexedDB). 스키마를 바꿀 때는 version(n)을 올리고 upgrade에서 변환한다.
 */
export class LedgerDB extends Dexie {
  entries!: Table<Entry, string>;
  categories!: Table<Category, string>;
  users!: Table<User, string>;
  payMethods!: Table<PayMethod, string>;
  payDetails!: Table<PayDetail, string>;
  fixedItems!: Table<FixedItem, string>;
  fixedRuns!: Table<FixedMonthRun, string>;
  assets!: Table<Asset, string>;
  assetLogs!: Table<AssetLog, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entries: 'id, date, updatedAt',
      categories: 'id',
      users: 'id',
      payMethods: 'id',
      payDetails: 'id',
      meta: 'key',
    });
    // v2 (R2): 고정지출 항목과 월별 처리 상태 추가. 기존 데이터는 그대로 둔다.
    this.version(2).stores({
      entries: 'id, date, updatedAt',
      categories: 'id',
      users: 'id',
      payMethods: 'id',
      payDetails: 'id',
      fixedItems: 'id',
      fixedRuns: 'id',
      meta: 'key',
    });
    // v3: 재산상황(항목과 변경 이력) 추가. 기존 데이터는 그대로 둔다.
    this.version(3).stores({
      entries: 'id, date, updatedAt',
      categories: 'id',
      users: 'id',
      payMethods: 'id',
      payDetails: 'id',
      fixedItems: 'id',
      fixedRuns: 'id',
      assets: 'id, state',
      assetLogs: 'id, assetId, at',
      meta: 'key',
    });
  }
}

/** 저장 형식 버전. 백업 파일에도 기록된다. */
export const SCHEMA_VERSION = 3;

let current: LedgerDB | null = null;

export function openDb(name = 'gagyeboo'): LedgerDB {
  current?.close();
  current = new LedgerDB(name);
  return current;
}

export function db(): LedgerDB {
  return current ?? openDb();
}
