import { useEffect, useState } from 'preact/hooks';
import { addMonths, formatYm, yearNum, ymOf } from '../lib/dates';
import { entries, viewMonth } from '../store/store';
import { Ui } from './icons';

function MonthPicker({ onClose }: { onClose: () => void }) {
  const [year, setYear] = useState(yearNum(viewMonth.value));
  const withData = new Set(entries.value.map((e) => ymOf(e.date)));
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.month-picker, .month-title')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div class="month-picker" role="dialog" aria-label="연·월 선택">
      <div class="mp-year">
        <button type="button" class="icon-btn" aria-label="이전 해" onClick={() => setYear(year - 1)}>
          <Ui name="ChevronLeft" size={18} />
        </button>
        <strong>{year}년</strong>
        <button type="button" class="icon-btn" aria-label="다음 해" onClick={() => setYear(year + 1)}>
          <Ui name="ChevronRight" size={18} />
        </button>
      </div>
      <div class="mp-grid">
        {Array.from({ length: 12 }, (_, i) => {
          const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
          return (
            <button
              key={ym}
              type="button"
              class={`mp-month ${ym === viewMonth.value ? 'is-current' : ''} ${withData.has(ym) ? 'has-data' : ''}`}
              onClick={() => {
                viewMonth.value = ym;
                onClose();
              }}
            >
              {i + 1}월
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** « ‹ 2026년 10월 › » — 사용 내역·통계가 같은 월 선택을 공유한다 */
export function MonthNav() {
  const ym = viewMonth.value;
  const [picker, setPicker] = useState(false);
  const go = (n: number) => (viewMonth.value = addMonths(viewMonth.value, n));
  return (
    <div class="monthnav">
      <button type="button" class="icon-btn" aria-label="전년" onClick={() => go(-12)}>
        <Ui name="ChevronsLeft" />
      </button>
      <button type="button" class="icon-btn" aria-label="전월" onClick={() => go(-1)}>
        <Ui name="ChevronLeft" />
      </button>
      <button
        type="button"
        class="month-title"
        aria-haspopup="dialog"
        aria-expanded={picker}
        onClick={() => setPicker(!picker)}
      >
        {formatYm(ym)}
      </button>
      <button type="button" class="icon-btn" aria-label="다음 달" onClick={() => go(1)}>
        <Ui name="ChevronRight" />
      </button>
      <button type="button" class="icon-btn" aria-label="다음 해" onClick={() => go(12)}>
        <Ui name="ChevronsRight" />
      </button>
      {picker ? <MonthPicker onClose={() => setPicker(false)} /> : null}
    </div>
  );
}

export { ymOf };
