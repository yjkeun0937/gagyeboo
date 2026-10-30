import { entryStatus } from '../lib/calc';
import { daysInMonth, formatMD, monthNum, weekdayIndex, weekdayKo, WEEKDAYS_KO, ymOf } from '../lib/dates';
import { compactWon, won } from '../lib/format';
import type { Entry } from '../lib/types';
import { categoriesById, today } from '../store/store';
import { Ui } from '../ui/icons';
import { calDate, filter, openAdd } from '../ui/nav';
import { viewport } from '../ui/viewport';
import { EntryCard } from './EntryCard';

/** 하루치 집계 */
interface DayCell {
  date: string;
  total: number;
  count: number;
  pending: number;
  scheduled: number;
  /** 금액이 큰 분류 최대 3개의 색 */
  dots: string[];
  items: Entry[];
}

function buildDays(list: Entry[], t: string): Map<string, DayCell> {
  const map = new Map<string, DayCell>();
  const byCat = new Map<string, Map<string, number>>();
  for (const e of list) {
    let c = map.get(e.date);
    if (!c) {
      c = { date: e.date, total: 0, count: 0, pending: 0, scheduled: 0, dots: [], items: [] };
      map.set(e.date, c);
    }
    c.items.push(e);
    c.count++;
    const st = entryStatus(e, t);
    if (st === 'pending') c.pending++;
    else {
      c.total += e.amount;
      if (st === 'scheduled') c.scheduled++;
    }
    const key = e.category ?? '';
    const m = byCat.get(e.date) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + Math.abs(e.amount));
    byCat.set(e.date, m);
  }
  for (const [date, m] of byCat) {
    const cell = map.get(date)!;
    cell.dots = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => categoriesById.value.get(id)?.color ?? 'var(--ink-3)');
  }
  return map;
}

/** 월 달력 보기: 날짜 칸마다 하루 합계(보류 제외), 많이 쓴 날일수록 진하게 */
export function CalendarView({ entries, ym, filtering }: { entries: Entry[]; ym: string; filtering: boolean }) {
  const t = today.value;
  const mobile = viewport.value === 'mobile';
  const days = buildDays(entries, t);
  const dim = daysInMonth(ym);
  const lead = weekdayIndex(`${ym}-01`);
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7) cells.push(null);

  const maxTotal = Math.max(0, ...[...days.values()].map((d) => d.total));
  const monthTotal = [...days.values()].reduce((a, d) => a + d.total, 0);
  const selected = calDate.value && ymOf(calDate.value) === ym ? calDate.value : ymOf(t) === ym ? t : null;
  const sel = selected ? days.get(selected) : undefined;
  const monthName = `${monthNum(ym)}월`;

  const fmt = (n: number) => (mobile ? compactWon(n) : won(n));

  return (
    <div class="cal-wrap">
      <section class="cal" aria-label={`${monthName} 달력`}>
        <div class="cal-head" aria-hidden="true">
          {WEEKDAYS_KO.map((w, i) => (
            <span key={w} class={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>
              {w}
            </span>
          ))}
        </div>
        <div class="cal-grid" role="group" aria-label="날짜 선택">
          {cells.map((date, i) => {
            if (!date) return <span key={`b${i}`} class="cal-blank" aria-hidden="true" />;
            const d = days.get(date);
            const day = Number(date.slice(8));
            const wk = weekdayIndex(date);
            const heat = d && maxTotal > 0 && d.total > 0 ? Math.max(0.08, d.total / maxTotal) : 0;
            const label =
              `${monthNum(ym)}월 ${day}일 ${weekdayKo(date)}요일` +
              (d
                ? `, 합계 ${won(d.total)}원, ${d.count}건` +
                  (d.pending ? `, 보류 ${d.pending}건 합계 제외` : '') +
                  (d.scheduled ? `, 예정 ${d.scheduled}건 포함` : '')
                : ', 내역 없음');
            return (
              <button
                key={date}
                type="button"
                class={`cal-cell ${wk === 0 ? 'sun' : wk === 6 ? 'sat' : ''} ${date === t ? 'is-today' : ''} ${date === selected ? 'is-selected' : ''} ${date > t ? 'is-future' : ''}`}
                style={heat ? { '--heat': `${Math.round(heat * 34)}%` } : undefined}
                aria-label={label}
                aria-pressed={date === selected}
                onClick={() => {
                  calDate.value = date;
                  // 휴대폰에서는 달력 아래쪽의 내역이 화면 밖일 수 있으므로 보이는 곳까지 내려 준다
                  if (mobile) setTimeout(() => document.querySelector('.cal-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
                }}
              >
                <span class="cal-day">{day}</span>
                {d && (d.pending || d.scheduled) ? (
                  <span class={`cal-flag ${d.pending ? 'is-pending' : ''}`} aria-hidden="true">
                    {d.pending ? '보류' : '예정'}
                  </span>
                ) : null}
                {d && d.total !== 0 ? <span class="cal-total num">{fmt(d.total)}</span> : null}
                {d && d.dots.length ? (
                  <span class="cal-dots" aria-hidden="true">
                    {d.dots.map((c, k) => (
                      <i key={k} style={{ background: c }} />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p class="cal-foot">
          {monthName} 합계 <b class="num">{won(monthTotal)}</b>원
          {filtering ? ' (필터 적용)' : ''} · 보류는 합계에서 빠지고 예정은 포함됩니다
        </p>
      </section>

      <section class="cal-panel" aria-label="선택한 날의 내역" aria-live="polite">
        {selected ? (
          <>
            <header class="cal-panel-head">
              <strong>
                {formatMD(selected)} <span class="wk">({weekdayKo(selected)})</span>
              </strong>
              <span class="num">{won(sel ? sel.total : 0)}원</span>
            </header>
            {sel && sel.items.length ? (
              <div class="cal-items">
                {[...sel.items]
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((e) => (
                    <EntryCard key={e.id} e={e} t={t} query={filter.value.text.trim()} />
                  ))}
              </div>
            ) : (
              <p class="cal-none">{filtering ? '조건에 맞는 내역이 없습니다.' : '이 날은 기록이 없습니다.'}</p>
            )}
            <button type="button" class="btn" onClick={() => openAdd(selected)}>
              <Ui name="Plus" size={18} />이 날 지출 입력
            </button>
          </>
        ) : (
          <p class="cal-none">날짜를 누르면 그날의 내역을 볼 수 있습니다.</p>
        )}
      </section>
    </div>
  );
}
