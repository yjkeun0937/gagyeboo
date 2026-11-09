/**
 * 손님이 올린 제안 파일(proposal-*.json)을 검사해서 주인의 제안 기록으로 바꾼다.
 * 손님 앱이 만든 파일이라도 믿지 않는다: 형식·길이·금액을 확인하고, 주인의 목록에 없는 분류·사용자·지불수단은 비운다.
 */
import { isValidYmd } from './dates';
import type { Category, PayDetail, PayMethod, Proposal, User } from './types';

export const MAX_PROPOSAL_BYTES = 16 * 1024;
export const MAX_PENDING = 300;

export interface Lists {
  categories: Pick<Category, 'id'>[];
  users: Pick<User, 'id'>[];
  payMethods: Pick<PayMethod, 'id'>[];
  payDetails: Pick<PayDetail, 'id' | 'payMethodId'>[];
}

export type ParsedProposal = Omit<Proposal, 'id' | 'updatedAt' | 'deleted' | 'from' | 'receivedAt'>;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseProposalFile(data: unknown, lists: Lists): { ok: true; value: ParsedProposal } | { ok: false; reason: string } {
  if (!data || typeof data !== 'object') return { ok: false, reason: '형식이 맞지 않습니다' };
  const d = data as Record<string, unknown>;
  if (d.app !== 'gagyeboo-proposal' || d.v !== 1) return { ok: false, reason: '가계부 제안 파일이 아닙니다' };
  const date = typeof d.date === 'string' ? d.date : '';
  if (!isValidYmd(date) || date < '2000-01-01' || date > '2100-12-31') return { ok: false, reason: '날짜가 올바르지 않습니다' };
  const amount = d.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999) {
    return { ok: false, reason: '금액이 올바르지 않습니다' };
  }
  const store = str(d.store, 60);
  const memo = str(d.memo, 100);
  if (!store && !memo) return { ok: false, reason: '사용처와 명세가 모두 비어 있습니다' };
  const pick = (v: unknown, rows: { id: string }[]) => (typeof v === 'string' && rows.some((r) => r.id === v) ? v : null);
  const payMethod = pick(d.payMethod, lists.payMethods);
  const detail = pick(d.payDetail, lists.payDetails);
  const dm = detail ? lists.payDetails.find((x) => x.id === detail) : undefined;
  const payDetail = payMethod && dm && (dm.payMethodId === null || dm.payMethodId === payMethod) ? detail : null;
  return {
    ok: true,
    value: {
      date,
      store,
      memo,
      amount: Math.round(amount),
      category: pick(d.category, lists.categories),
      user: pick(d.user, lists.users),
      payMethod,
      payDetail,
      isEstimate: d.isEstimate === true ? true : undefined,
      srcId: typeof d.id === 'string' ? d.id.slice(0, 64) : undefined,
    },
  };
}
