import { daysInMonth, dayOf, ymOf } from './dates';
import type { Entry, EntryFilter, ID, User } from './types';

/**
 * normal    : 일반 내역
 * pending   : [보류] 고정지출 창에서 추가했고 지정일(오늘 이후)이 아직 오지 않음 → 집계 제외
 * scheduled : [예정] 직접 입력(또는 가져온) 오늘 이후 날짜 내역 → 집계 포함
 */
export type EntryStatus = 'normal' | 'pending' | 'scheduled';

export function entryStatus(e: Pick<Entry, 'date' | 'source'>, today: string): EntryStatus {
  if (e.date > today) return e.source === 'fixed' ? 'pending' : 'scheduled';
  return 'normal';
}

/** 모든 합계·통계에 들어가는 내역인가 (보류만 제외) */
export function isCounted(e: Pick<Entry, 'date' | 'source'>, today: string): boolean {
  return entryStatus(e, today) !== 'pending';
}

export function compareEntries(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt - b.createdAt;
}

export interface MonthSummary {
  count: number;
  total: number;
  dailyAvg: number;
  projected: number;
  pendingCount: number;
  pendingTotal: number;
  scheduledCount: number;
  scheduledTotal: number;
  /** key: 사용자 ID, null = 미지정 */
  byUser: Map<ID | null, number>;
  byPayMethod: Map<ID | null, number>;
  byCategory: Map<ID | null, number>;
}

function add<K>(m: Map<K, number>, k: K, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}

/**
 * 엑셀 월 시트 상단 요약과 같은 계산:
 *  - 하루평균 = 이번 달이면 합계 ÷ 오늘 일수, 그 밖의 달이면 합계 ÷ 월 일수
 *  - 예상월지출 = 하루평균 × 월 일수
 * 보류 내역은 전부 제외하고, 예정 내역은 포함한다.
 */
export function summarize(monthEntries: Entry[], ym: string, today: string): MonthSummary {
  const s: MonthSummary = {
    count: 0,
    total: 0,
    dailyAvg: 0,
    projected: 0,
    pendingCount: 0,
    pendingTotal: 0,
    scheduledCount: 0,
    scheduledTotal: 0,
    byUser: new Map(),
    byPayMethod: new Map(),
    byCategory: new Map(),
  };
  for (const e of monthEntries) {
    const st = entryStatus(e, today);
    if (st === 'pending') {
      s.pendingCount++;
      s.pendingTotal += e.amount;
      continue;
    }
    if (st === 'scheduled') {
      s.scheduledCount++;
      s.scheduledTotal += e.amount;
    }
    s.count++;
    s.total += e.amount;
    add(s.byUser, e.user, e.amount);
    add(s.byPayMethod, e.payMethod, e.amount);
    add(s.byCategory, e.category, e.amount);
  }
  const dim = daysInMonth(ym);
  const divisor = ymOf(today) === ym ? dayOf(today) : dim;
  s.dailyAvg = s.total / divisor;
  s.projected = s.dailyAvg * dim;
  return s;
}

export interface DateGroup {
  date: string;
  items: Entry[];
  /** 보류를 뺀 하루 합계 */
  total: number;
}

export function groupByDate(entries: Entry[], today: string): DateGroup[] {
  const sorted = [...entries].sort(compareEntries);
  const groups: DateGroup[] = [];
  for (const e of sorted) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== e.date) {
      g = { date: e.date, items: [], total: 0 };
      groups.push(g);
    }
    g.items.push(e);
    if (isCounted(e, today)) g.total += e.amount;
  }
  return groups;
}

export function isFilterActive(f: EntryFilter): boolean {
  return !!(f.text.trim() || f.categoryId || f.userId || f.payMethodId || f.payDetailId);
}

export function filterEntries(
  entries: Entry[],
  f: EntryFilter,
  usersById: Map<ID, User>,
): Entry[] {
  const q = f.text.trim().toLowerCase();
  return entries.filter((e) => {
    if (q && !`${e.store} ${e.memo}`.toLowerCase().includes(q)) return false;
    if (f.categoryId && e.category !== f.categoryId) return false;
    if (f.payMethodId && e.payMethod !== f.payMethodId) return false;
    if (f.payDetailId && e.payDetail !== f.payDetailId) return false;
    if (f.userId) {
      if (f.userId === 'none') {
        if (e.user != null) return false;
      } else if (e.user !== f.userId) {
        if (!f.includeGroups || !e.user) return false;
        const u = usersById.get(e.user);
        if (!(u && u.type === 'group' && u.memberIds.includes(f.userId))) return false;
      }
    }
    return true;
  });
}

/** 사용 빈도(많은 순) → 최근(날짜 늦은 순)으로 사용처 후보를 만든다. */
export interface StoreStat {
  store: string;
  count: number;
  last: Entry;
}

export function buildStoreIndex(entries: Entry[]): StoreStat[] {
  const map = new Map<string, StoreStat>();
  for (const e of entries) {
    const key = e.store.trim();
    if (!key) continue;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { store: key, count: 1, last: e });
    } else {
      cur.count++;
      if (compareEntries(cur.last, e) < 0) cur.last = e;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || (a.last.date < b.last.date ? 1 : -1),
  );
}

export function suggestStores(index: StoreStat[], query: string, limit = 6): StoreStat[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, limit);
  const starts: StoreStat[] = [];
  const contains: StoreStat[] = [];
  for (const s of index) {
    const name = s.store.toLowerCase();
    if (name === q) continue; // 이미 완전히 같으면 제안하지 않는다
    if (name.startsWith(q)) starts.push(s);
    else if (name.includes(q)) contains.push(s);
  }
  return [...starts, ...contains].slice(0, limit);
}
