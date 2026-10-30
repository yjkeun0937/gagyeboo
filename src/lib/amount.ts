/**
 * 금액 입력란의 수식: 더하기(+)와 곱하기(*)만 쓴다. 곱하기가 먼저 계산된다 (100*5+200 = 700).
 * 천 단위 쉼표와 공백은 무시한다. 소수점·음수·괄호·그 밖의 글자는 잘못된 수식으로 본다.
 */

export type AmountParse =
  | { ok: true; value: number; /** + 또는 * 가 들어 있는 수식인가 */ isExpr: boolean }
  | { ok: false; reason: 'empty' | 'syntax' | 'toolarge' };

/** 한 번에 입력할 수 있는 최대 금액 (기존 입력란의 10자리 제한과 같음) */
export const MAX_AMOUNT = 9_999_999_999;

export function parseAmount(text: string): AmountParse {
  const s = text.replace(/[\s,]/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  // '5 3'처럼 숫자 사이가 공백으로 떨어져 있으면 53으로 붙이지 않고 잘못된 수식으로 본다
  if (/\d\s+\d/.test(text)) return { ok: false, reason: 'syntax' };
  // 숫자와 연산자가 번갈아 나와야 한다: 숫자 (연산자 숫자)*
  if (!/^\d+([+*]\d+)*$/.test(s)) return { ok: false, reason: 'syntax' };
  let total = 0;
  for (const term of s.split('+')) {
    let product = 1;
    for (const f of term.split('*')) {
      product *= Number(f);
      if (!Number.isFinite(product) || product > MAX_AMOUNT) return { ok: false, reason: 'toolarge' };
    }
    total += product;
    if (total > MAX_AMOUNT) return { ok: false, reason: 'toolarge' };
  }
  return { ok: true, value: total, isExpr: /[+*]/.test(s) };
}

/** 오류 안내 문구 (경고 팝업에 쓴다) */
export function amountErrorMessage(reason: 'empty' | 'syntax' | 'toolarge'): string {
  if (reason === 'toolarge') return '금액이 너무 큽니다. 99억 9천만 원 이하로 입력해 주세요';
  if (reason === 'empty') return '금액을 입력해 주세요';
  return '금액 수식이 올바르지 않습니다. 숫자와 +, * 로만 입력해 주세요 (예: 500+1000, 100*5+200)';
}

/** 숫자만 있으면 천 단위 쉼표를 넣어 보여 주고, 수식이나 그 밖의 글자는 입력한 그대로 둔다 */
export function displayAmountText(text: string): string {
  if (/^\d+$/.test(text)) return new Intl.NumberFormat('ko-KR').format(Number(text));
  return text;
}
