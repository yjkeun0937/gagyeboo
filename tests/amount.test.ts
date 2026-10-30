import { describe, expect, it } from 'vitest';
import { amountErrorMessage, displayAmountText, MAX_AMOUNT, parseAmount } from '../src/lib/amount';

const val = (t: string) => {
  const r = parseAmount(t);
  return r.ok ? r.value : null;
};

describe('금액 수식', () => {
  it('일반 숫자', () => {
    expect(parseAmount('1500')).toEqual({ ok: true, value: 1500, isExpr: false });
    expect(parseAmount(' 1,500 ')).toEqual({ ok: true, value: 1500, isExpr: false });
    expect(parseAmount('007')).toEqual({ ok: true, value: 7, isExpr: false });
  });
  it('더하기', () => {
    expect(parseAmount('500+1000')).toEqual({ ok: true, value: 1500, isExpr: true });
    expect(val('1+2+3+4')).toBe(10);
  });
  it('곱하기를 먼저 계산한다', () => {
    expect(val('100*5+200')).toBe(700);
    expect(val('200+100*5')).toBe(700);
    expect(val('2*3*4')).toBe(24);
    expect(val('1000*2+500*3')).toBe(3500);
  });
  it('공백·쉼표는 무시한다', () => {
    expect(val('1,000 + 500')).toBe(1500);
    expect(val('1,000*2')).toBe(2000);
  });
  it('잘못된 수식', () => {
    for (const t of ['5++3', '+5', '5+', '*3', '5*', '5**3', 'abc', '5 3', '5-3', '5/2', '(5+3)*2', '1.5*2', '5+a', '5x3', '5×3', '-5']) {
      const r = parseAmount(t);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.reason, t).toBe('syntax');
    }
  });
  it('빈 입력', () => {
    expect(parseAmount('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseAmount('  ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('너무 큰 값', () => {
    expect(val(String(MAX_AMOUNT))).toBe(MAX_AMOUNT);
    expect(parseAmount(String(MAX_AMOUNT + 1))).toEqual({ ok: false, reason: 'toolarge' });
    expect(parseAmount('99999999*99999999')).toEqual({ ok: false, reason: 'toolarge' });
    expect(parseAmount('9999999999+1')).toEqual({ ok: false, reason: 'toolarge' });
  });
  it('안내 문구와 표시', () => {
    expect(amountErrorMessage('syntax')).toContain('수식');
    expect(displayAmountText('1234567')).toBe('1,234,567');
    expect(displayAmountText('100*5+200')).toBe('100*5+200');
    expect(displayAmountText('')).toBe('');
    expect(displayAmountText('1000.5')).toBe('1000.5');
  });
});
