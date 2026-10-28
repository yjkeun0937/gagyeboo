import type { Category, PayMethod } from './types';

/**
 * 기본 분류·지불수단. ID를 고정해 두어, 기기마다 따로 시작해도 동기화할 때 중복이 생기지 않는다.
 * 사용자·결제상세는 비어 있는 상태로 시작한다 (앱 소스에 개인 이름을 넣지 않기 위함).
 */
const CATEGORY_SEED: [string, string][] = [
  ['집밥', '#4C9A2A'],
  ['외식', '#E07A1F'],
  ['의복품위유지비', '#B5479B'],
  ['주거생활용품가전', '#2F7FB8'],
  ['통신비', '#6B5BD2'],
  ['교통비', '#0F9D9A'],
  ['교양오락문화생활', '#D9A400'],
  ['교제비', '#D1495B'],
  ['교육비', '#3F6FD8'],
  ['보험료', '#5B7083'],
  ['세금공과금', '#8C6A3F'],
  ['경조사비', '#C2548A'],
  ['의료건강비용', '#2E9E6B'],
  ['은행저축', '#2A5D9F'],
  ['기부후원', '#E2693C'],
  ['용돈', '#7A8B2E'],
  ['잡비', '#8A8F98'],
];

const PAY_SEED: [string, string, string][] = [
  ['현금', 'lucide:Banknote', '#2E8B57'],
  ['신용', 'lucide:CreditCard', '#D1495B'],
  ['체크', 'lucide:WalletCards', '#2F7FB8'],
  ['핸드폰결제', 'lucide:Smartphone', '#6B5BD2'],
  ['페이', 'lucide:QrCode', '#E07A1F'],
  ['회사복지포인트', 'lucide:Gift', '#0F9D9A'],
  ['소비쿠폰', 'lucide:Ticket', '#B5479B'],
];

const pad2 = (n: number) => String(n).padStart(2, '0');

export function seedCategories(): Category[] {
  return CATEGORY_SEED.map(([name, color], i) => ({
    id: `cat_${pad2(i + 1)}`,
    name,
    color,
    order: i,
    updatedAt: 0,
  }));
}

export function seedPayMethods(): PayMethod[] {
  return PAY_SEED.map(([name, icon, color], i) => ({
    id: `pay_${pad2(i + 1)}`,
    name,
    icon,
    color,
    order: i,
    updatedAt: 0,
  }));
}
