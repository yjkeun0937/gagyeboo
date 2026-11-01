import { monthNum, yearNum } from './dates';
import { dueDate, fixedEntryId, monthsBetween } from './fixed';
import type { FixedItem, FixedMonthRun, ID, Proposal } from './types';

/**
 * 입력 대기 목록 계산.
 * - 고정지출: 활성 항목 중 그 달에 해당하고, 아직 내역으로 만들지 않았고(지운 내역 포함),
 *   '입력하지 않음'으로 처리하지도 않았고, 옛 월초 창에서 처리한 달이 아닌 것.
 *   저장하지 않고 그때그때 계산하므로 기기를 여러 대 써도 중복되지 않는다.
 * - 손님 제안: 받은 제안(처리하면 삭제 표시가 되어 목록에서 빠진다).
 */

export interface QueueItem {
  /** 목록 안에서 구분하는 키 (고정지출은 내역 ID와 같고, 제안은 p:제안ID) */
  key: string;
  kind: 'fixed' | 'proposal';
  /** 입력되는 달 YYYY-MM */
  ym: string;
  /** 내역에 기록될 날짜 YYYY-MM-DD */
  date: string;
  store: string;
  memo: string;
  amount: number;
  isEstimate: boolean;
  category: ID | null;
  user: ID | null;
  payMethod: ID | null;
  payDetail: ID | null;
  /** 고정지출이면 항목 ID, 제안이면 제안 ID */
  refId: ID;
  /** 제안자 표시 이름 (제안일 때) */
  from?: string;
  /** 정렬용 */
  order: number;
}

export interface QueueInput {
  items: FixedItem[];
  firstUseYm: string;
  todayYm: string;
  /** 옛 월초 창에서 '처리함·건너뜀'으로 기록한 달 */
  runs: FixedMonthRun[];
  /** 이미 내역이 있거나(지운 것 포함) 지금 취소하지 않은 고정지출 내역 ID */
  handledIds: ReadonlySet<string>;
  /** '입력하지 않음' 처리한 ID (= 고정지출 내역 ID) */
  skippedIds: ReadonlySet<string>;
  proposals: Proposal[];
}

export function buildQueue(q: QueueInput): QueueItem[] {
  const out: QueueItem[] = [];
  const doneMonths = new Set(q.runs.map((r) => r.ym));
  const active = q.items.filter((i) => i.active);
  if (q.firstUseYm <= q.todayYm) {
    for (const ym of monthsBetween(q.firstUseYm, q.todayYm)) {
      if (doneMonths.has(ym)) continue;
      for (const item of active) {
        if (item.startYm && ym < item.startYm) continue;
        const date = dueDate(item.schedule, ym);
        if (!date) continue;
        const id = fixedEntryId(item.id, ym);
        if (q.handledIds.has(id) || q.skippedIds.has(id)) continue;
        out.push({
          key: id,
          kind: 'fixed',
          ym,
          date,
          store: item.name,
          memo: item.memo,
          amount: item.amount,
          isEstimate: item.amountMode === 'estimate',
          category: item.category,
          user: item.user,
          payMethod: item.payMethod,
          payDetail: item.payDetail,
          refId: item.id,
          order: item.order,
        });
      }
    }
  }
  for (const p of q.proposals) {
    if (p.deleted) continue;
    out.push({
      key: `p:${p.id}`,
      kind: 'proposal',
      ym: p.date.slice(0, 7),
      date: p.date,
      store: p.store,
      memo: p.memo,
      amount: p.amount,
      isEstimate: !!p.isEstimate,
      category: p.category,
      user: p.user,
      payMethod: p.payMethod,
      payDetail: p.payDetail,
      refId: p.id,
      from: p.from,
      order: p.receivedAt,
    });
  }
  // 입력되는 달이 오래된 것부터, 같은 달은 날짜순, 같은 날은 고정지출 → 제안
  return out.sort(
    (a, b) =>
      a.ym.localeCompare(b.ym) ||
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? 0 : a.kind === 'fixed' ? -1 : 1) ||
      a.order - b.order,
  );
}

/** 오늘 달 기준으로 몇 개월 전 건인지 (이번 달이면 0) */
export function monthsAgo(ym: string, todayYm: string): number {
  return (yearNum(todayYm) - yearNum(ym)) * 12 + (monthNum(todayYm) - monthNum(ym));
}

/** 99건을 넘으면 99+ */
export const countLabel = (n: number) => (n > 99 ? '99+' : String(n));
