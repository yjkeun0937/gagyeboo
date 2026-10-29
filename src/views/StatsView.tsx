import { signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatMD,
  formatYm,
  monthNum,
  todayKST,
  weekdayKo,
  yearNum,
  ymOf,
} from '../lib/dates';
import { won } from '../lib/format';
import { monthStats, rangeStats, yearStats, type MonthStats, type RangeFilter, type Slice } from '../lib/stats';
import { EMPTY_FILTER, type ID } from '../lib/types';
import {
  categoriesById,
  categoriesSorted,
  entries,
  payDetailsById,
  payMethodsById,
  payMethodsSorted,
  today,
  usersById,
  usersSorted,
  viewMonth,
} from '../store/store';
import {
  ColumnChart,
  Donut,
  LineChart,
  RankedBars,
  StackedAreaChart,
  type DonutSlice,
  type RankItem,
} from '../ui/charts';
import { CategoryDot, PayGlyph, Ui, UserGlyph } from '../ui/icons';
import { filter, openEdit, setTab } from '../ui/nav';
import { MonthNav } from '../ui/monthnav';
import { Empty } from '../ui/parts';

type StatsTab = 'month' | 'year' | 'range';
const statsTab = signal<StatsTab>('month');
const statsYear = signal(yearNum(viewMonth.value));
const rangeStart = signal(`${todayKST().slice(0, 7)}-01`);
const rangeEnd = signal(todayKST());
const rangeFilter = signal<RangeFilter>({
  category: null,
  user: null,
  payMethod: null,
});
const rangeLimit = signal(50);

const TAB_LABEL: Record<StatsTab, string> = {
  month: '월간',
  year: '연간',
  range: '기간 지정',
};
const GRAY = '#8A8F98';
const MAX_SLICES = 7;

const wonText = (n: number) => `${won(n)}원`;

/* ───────── 공통 조각 ───────── */

function Card({ title, children, note }: { title: string; children: preact.ComponentChildren; note?: string }) {
  return (
    <section class="stat-card">
      <h3>{title}</h3>
      {note ? <p class="hint">{note}</p> : null}
      {children}
    </section>
  );
}

function Tiles({
  items,
}: {
  items: {
    label: string;
    value: preact.ComponentChildren;
    sub?: preact.ComponentChildren;
  }[];
}) {
  return (
    <div class="tiles">
      {items.map((t) => (
        <div class="tile" key={t.label}>
          <span class="tile-label">{t.label}</span>
          <strong class="tile-value">{t.value}</strong>
          {t.sub ? <span class="tile-sub">{t.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** 증감 표시: 부호·화살표·글자로 알 수 있게 하고, 지출이 늘면 경고색 / 줄면 좋은색 */
function Delta({ diff, base }: { diff: number; base: number }) {
  if (diff === 0) return <span class="muted">변동 없음</span>;
  const up = diff > 0;
  const pct = base > 0 ? ` (${up ? '+' : '−'}${Math.round((Math.abs(diff) / base) * 1000) / 10}%)` : '';
  return (
    <span class={up ? 'delta-up' : 'delta-down'}>
      {up ? '▲' : '▼'} {up ? '+' : '−'}
      {won(Math.abs(diff))}원{pct}
    </span>
  );
}

function sliceItems(
  slices: Slice[],
  name: (k: ID | null) => string,
  color: (k: ID | null) => string,
  icon?: (k: ID | null) => preact.ComponentChildren,
  onPick?: (k: ID | null) => void,
): RankItem[] {
  return slices.map((s) => ({
    key: String(s.key),
    label: name(s.key),
    value: s.total,
    color: color(s.key),
    sub: `${s.count}건`,
    icon: icon?.(s.key),
    onClick: onPick ? () => onPick(s.key) : undefined,
  }));
}

/** 통계에서 항목을 누르면 그 조건의 사용 내역으로 이동 */
function gotoHistory(ym: string, patch: Partial<typeof EMPTY_FILTER>) {
  viewMonth.value = ym;
  filter.value = { ...EMPTY_FILTER, ...patch };
  setTab('history');
}

const catName = (k: ID | null) => (k ? (categoriesById.value.get(k)?.name ?? '분류') : '미분류');
const catColor = (k: ID | null) => (k ? (categoriesById.value.get(k)?.color ?? GRAY) : GRAY);

/* ───────── 월간 ───────── */

function CategoryCard({ s }: { s: MonthStats }) {
  const top = s.byCategory.slice(0, MAX_SLICES);
  const rest = s.byCategory.slice(MAX_SLICES);
  const slices: DonutSlice[] = top.map((x) => ({
    label: catName(x.key),
    value: x.total,
    color: catColor(x.key),
  }));
  const restTotal = rest.reduce((a, x) => a + x.total, 0);
  if (restTotal > 0)
    slices.push({
      label: `기타 ${rest.length}개 분류`,
      value: restTotal,
      color: GRAY,
    });
  return (
    <Card title="분류별 지출">
      <div class="donut-wrap">
        <Donut
          slices={slices}
          ariaLabel={`분류별 지출 비율. 가장 큰 분류는 ${catName(s.byCategory[0]?.key ?? null)}`}
          center={
            <>
              <small>합계</small>
              <b class="num">{won(s.total)}</b>
            </>
          }
        />
        <div class="grow">
          <RankedBars
            total={s.total}
            items={sliceItems(s.byCategory, catName, catColor, undefined, (k) =>
              gotoHistory(s.ym, { categoryId: k }),
            ).filter((it) => it.key !== 'null' || true)}
          />
        </div>
      </div>
    </Card>
  );
}

function UserCard({ s }: { s: MonthStats }) {
  const persons = s.byUser.filter((x) => x.key && usersById.value.get(x.key)?.type === 'person');
  const groups = s.byUser.filter((x) => x.key && usersById.value.get(x.key)?.type === 'group');
  const none = s.byUser.filter((x) => x.key === null || !usersById.value.has(x.key));
  const mk = (list: Slice[]) =>
    sliceItems(
      list,
      (k) => (k ? (usersById.value.get(k)?.name ?? '사용자') : '미지정'),
      (k) => (k ? (usersById.value.get(k)?.color ?? GRAY) : GRAY),
      (k) => {
        const u = k ? usersById.value.get(k) : undefined;
        return u ? <UserGlyph user={u} size={20} /> : undefined;
      },
      (k) => gotoHistory(s.ym, { userId: k ?? 'none' }),
    );
  return (
    <Card title="사용자별 지출" note="그룹 지출은 구성원에게 나누지 않고 기록된 그대로 집계합니다.">
      {persons.length ? (
        <>
          <h4 class="sub-h">개인</h4>
          <RankedBars items={mk(persons)} total={s.total} />
        </>
      ) : null}
      {groups.length ? (
        <>
          <h4 class="sub-h">그룹</h4>
          <RankedBars items={mk(groups)} total={s.total} />
        </>
      ) : null}
      {none.length ? (
        <>
          <h4 class="sub-h">미지정</h4>
          <RankedBars items={mk(none)} total={s.total} />
        </>
      ) : null}
    </Card>
  );
}

function PayCard({ s }: { s: MonthStats }) {
  return (
    <Card title="지불수단별 지출">
      <ul class="ranked">
        {s.byPayMethod.map((p) => {
          const m = p.key ? payMethodsById.value.get(p.key) : undefined;
          const details = s.byDetail.get(p.key) ?? [];
          const only = details.length === 1 && details[0].key === null;
          return (
            <li key={String(p.key)}>
              <button
                type="button"
                class="rk-row is-button"
                onClick={() => gotoHistory(s.ym, { payMethodId: p.key })}
                disabled={!p.key}
              >
                <span class="rk-label">
                  {m ? <PayGlyph method={m} size={20} /> : <span class="dot" style={{ background: GRAY }} />}
                  <span class="rk-name">{m?.name ?? '미지정'}</span>
                  <small class="muted">{p.count}건</small>
                </span>
                <span class="rk-bar" aria-hidden="true">
                  <span
                    class="rk-fill"
                    style={{
                      width: `${Math.max(1.5, (p.total / (s.byPayMethod[0]?.total || 1)) * 100)}%`,
                      background: m?.color ?? GRAY,
                    }}
                  />
                </span>
                <span class="rk-value num">{won(p.total)}</span>
                <span class="rk-pct num">{s.total ? Math.round((p.total / s.total) * 1000) / 10 : 0}%</span>
              </button>
              {!only && details.length ? (
                <ul class="rk-details">
                  {details.map((d) => {
                    const det = d.key ? payDetailsById.value.get(d.key) : undefined;
                    return (
                      <li key={String(d.key)}>
                        <span class="dot" style={{ background: det?.color ?? GRAY }} aria-hidden="true" />
                        <span class="rk-name">{det?.name ?? '상세 없음'}</span>
                        <span class="num">{wonText(d.total)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DailyCard({ s }: { s: MonthStats }) {
  const dim = s.daily.length;
  const labels = s.daily.map((_, i) => String(i + 1));
  const tips = s.daily.map((v, i) => {
    const date = `${s.ym}-${String(i + 1).padStart(2, '0')}`;
    return {
      title: `${formatMD(date)} (${weekdayKo(date)})`,
      lines: [wonText(v)],
    };
  });
  return (
    <Card title="일별 지출">
      <ColumnChart
        values={s.daily}
        labels={labels}
        tips={tips}
        labelEvery={dim > 28 ? 5 : 4}
        ariaLabel={`${formatYm(s.ym)} 일별 지출 막대 그래프`}
      />
      <details class="table-view">
        <summary>표로 보기</summary>
        <table class="mini-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th class="num">지출</th>
              <th class="num">누적</th>
            </tr>
          </thead>
          <tbody>
            {s.daily.map((v, i) =>
              v > 0 ? (
                <tr key={i}>
                  <td>{formatMD(`${s.ym}-${String(i + 1).padStart(2, '0')}`)}</td>
                  <td class="num">{won(v)}</td>
                  <td class="num">{won(s.cumulative[i] ?? 0)}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function CumulativeCard({ s }: { s: MonthStats }) {
  const labels = s.cumulative.map((_, i) => String(i + 1));
  const tips = s.cumulative.map((v, i) => {
    const date = `${s.ym}-${String(i + 1).padStart(2, '0')}`;
    return { title: `${formatMD(date)}까지`, lines: [`누적 ${wonText(v)}`] };
  });
  return (
    <Card title="누적 지출">
      <LineChart
        values={s.cumulative}
        labels={labels}
        tips={tips}
        labelEvery={s.cumulative.length > 28 ? 5 : 4}
        ariaLabel={`${formatYm(s.ym)} 누적 지출 꺾은선 그래프`}
      />
    </Card>
  );
}

function WeekdayCard({ s }: { s: MonthStats }) {
  // 월요일부터 보여준다
  const order = [1, 2, 3, 4, 5, 6, 0];
  const w = order.map((i) => s.weekday[i]);
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  return (
    <Card title="요일별 하루 평균" note="그 요일에 쓴 금액을 그 요일의 날 수로 나눈 값입니다.">
      <ColumnChart
        values={w.map((x) => x.avg)}
        labels={w.map((x) => names[x.idx])}
        tips={w.map((x) => ({
          title: `${names[x.idx]}요일`,
          lines: [`하루 평균 ${wonText(x.avg)}`, `합계 ${wonText(x.total)} · ${x.days}일`],
        }))}
        height={180}
        ariaLabel="요일별 하루 평균 지출 막대 그래프"
      />
    </Card>
  );
}

function StoresCard({ s }: { s: MonthStats }) {
  if (!s.topStores.length) return null;
  return (
    <Card title="사용처 TOP 10">
      <table class="mini-table">
        <thead>
          <tr>
            <th>사용처</th>
            <th class="num">횟수</th>
            <th class="num">금액</th>
          </tr>
        </thead>
        <tbody>
          {s.topStores.map((x, i) => (
            <tr key={x.store}>
              <td>
                <span class="rank-no">{i + 1}</span>
                {x.store}
              </td>
              <td class="num">{x.count}회</td>
              <td class="num">{won(x.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function DeltaCard({ s }: { s: MonthStats }) {
  const prevYm = addMonths(s.ym, -1);
  const rows = s.deltas.filter((d) => d.diff !== 0).slice(0, 8);
  return (
    <Card title={`${monthNum(prevYm)}월 대비 분류별 증감`}>
      {rows.length === 0 ? (
        <p class="hint">전월과 달라진 분류가 없습니다.</p>
      ) : (
        <div class="table-scroll">
          <table class="mini-table is-nowrap">
            <thead>
              <tr>
                <th>분류</th>
                <th class="num">{monthNum(prevYm)}월</th>
                <th class="num">{monthNum(s.ym)}월</th>
                <th class="num">증감</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={String(d.key)}>
                  <td>
                    <CategoryDot color={catColor(d.key)} /> {catName(d.key)}
                  </td>
                  <td class="num">{won(d.prev)}</td>
                  <td class="num">{won(d.cur)}</td>
                  <td class="num">
                    <Delta diff={d.diff} base={d.prev} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MonthlyStats() {
  const ym = viewMonth.value;
  const s = useMemo(() => monthStats(entries.value, ym, today.value), [entries.value, ym, today.value]);
  return (
    <>
      <div class="monthbar">
        <MonthNav />
      </div>
      {s.count === 0 ? (
        <Empty title={`${formatYm(ym)}에는 집계할 내역이 없습니다`}>
          <p class="hint">[보류] 내역은 통계에 포함되지 않습니다.</p>
        </Empty>
      ) : (
        <>
          <Tiles
            items={[
              {
                label: '합계',
                value: <span class="num">{wonText(s.total)}</span>,
              },
              { label: '내역', value: <span class="num">{s.count}건</span> },
              {
                label: `${monthNum(addMonths(ym, -1))}월 대비`,
                value: s.prevTotal > 0 || s.total > 0 ? <Delta diff={s.total - s.prevTotal} base={s.prevTotal} /> : '-',
                sub:
                  s.prevTotal > 0
                    ? `${monthNum(addMonths(ym, -1))}월 ${wonText(s.prevTotal)}`
                    : '비교할 지난달 내역 없음',
              },
            ]}
          />
          <div class="stat-grid">
            <CategoryCard s={s} />
            <UserCard s={s} />
            <PayCard s={s} />
            <DeltaCard s={s} />
            <DailyCard s={s} />
            <CumulativeCard s={s} />
            <WeekdayCard s={s} />
            <StoresCard s={s} />
          </div>
        </>
      )}
    </>
  );
}

/* ───────── 연간 ───────── */

/** 누적 영역 그래프에서 빼 둔 분류 (기본은 모두 선택). 미분류는 'none' */
const yearOff = signal<Set<string>>(new Set());
const catKey = (k: ID | null) => k ?? 'none';
/** 표의 막대는 각 행(분류)의 최대 월 지출을 100%로 잡는다 */
const rowMax = (months: number[]) => Math.max(1, ...months);

function YearlyStats() {
  const year = statsYear.value;
  const order = categoriesSorted.value.map((c) => c.id);
  const y = useMemo(
    () => yearStats(entries.value, year, today.value, order),
    [entries.value, year, today.value, categoriesSorted.value],
  );
  const off = yearOff.value;
  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  const present = y.rows.map((r) => r.category);
  const picked = y.rows.filter((r) => !off.has(catKey(r.category)));
  const pickedTotal = picked.reduce((a, r) => a + r.total, 0);
  const toggle = (k: ID | null) => {
    const next = new Set(off);
    if (next.has(catKey(k))) next.delete(catKey(k));
    else next.add(catKey(k));
    yearOff.value = next;
  };

  return (
    <>
      <div class="monthbar">
        <div class="monthnav">
          <button type="button" class="icon-btn" aria-label="전년" onClick={() => (statsYear.value = year - 1)}>
            <Ui name="ChevronLeft" />
          </button>
          <strong class="month-title is-static">{year}년</strong>
          <button type="button" class="icon-btn" aria-label="다음 해" onClick={() => (statsYear.value = year + 1)}>
            <Ui name="ChevronRight" />
          </button>
        </div>
      </div>
      {y.total === 0 ? (
        <Empty title={`${year}년에는 집계할 내역이 없습니다`} />
      ) : (
        <>
          <Tiles
            items={[
              { label: '연 합계', value: <span class="num">{wonText(y.total)}</span> },
              { label: '월평균', value: <span class="num">{wonText(y.avg)}</span>, sub: `${y.monthsCounted}개월 기준` },
              {
                label: '지출이 가장 많은 달',
                value: y.peakMonth ? `${y.peakMonth}월` : '-',
                sub: y.peakMonth ? wonText(y.monthTotals[y.peakMonth - 1]) : undefined,
              },
            ]}
          />
          <Card
            title="월별 지출 (분류별 누적)"
            note="분류를 눌러 켜고 끌 수 있습니다. 선택한 분류가 위로 쌓여 보입니다."
          >
            <div class="chips chart-filter" role="group" aria-label="그래프에 표시할 분류">
              <button type="button" class="chip" onClick={() => (yearOff.value = new Set(present.map(catKey)))}>
                모두 지우기
              </button>
              <button type="button" class="chip" onClick={() => (yearOff.value = new Set())}>
                전체
              </button>
              {present.map((id) => (
                <button
                  key={catKey(id)}
                  type="button"
                  class="chip"
                  aria-pressed={!off.has(catKey(id))}
                  onClick={() => toggle(id)}
                >
                  <CategoryDot color={catColor(id)} />
                  {catName(id)}
                </button>
              ))}
            </div>
            {picked.length === 0 ? (
              <p class="hint chart-empty">표시할 분류를 선택하세요.</p>
            ) : (
              <>
                <StackedAreaChart
                  series={picked.map((r) => ({
                    key: catKey(r.category),
                    label: catName(r.category),
                    color: catColor(r.category),
                    values: r.months,
                  }))}
                  labels={labels}
                  tipTitle={(i) => `${year}년 ${i + 1}월`}
                  height={260}
                  ariaLabel={`${year}년 선택한 ${picked.length}개 분류의 월별 지출 누적 영역 그래프`}
                />
                <p class="hint chart-sum">
                  선택한 {picked.length}개 분류 합계 <b class="num">{wonText(pickedTotal)}</b>
                </p>
              </>
            )}
          </Card>
          <Card
            title="분류 × 월 지출표"
            note="칸 뒤의 막대는 그 분류의 가장 많이 쓴 달을 100%로 한 크기입니다. 칸을 누르면 그 달·분류의 사용 내역으로 이동합니다."
          >
            <div class="matrix-wrap">
              <table class="matrix">
                <thead>
                  <tr>
                    <th>분류</th>
                    {labels.map((l) => (
                      <th key={l} class="num">
                        {l}
                      </th>
                    ))}
                    <th class="num">합계</th>
                    <th class="num">월평균</th>
                    <th class="num">비율</th>
                  </tr>
                </thead>
                <tbody>
                  {y.rows.map((r) => (
                    <tr key={String(r.category)}>
                      <th scope="row">
                        <CategoryDot color={catColor(r.category)} /> {catName(r.category)}
                      </th>
                      {r.months.map((v, i) => (
                        <td
                          key={i}
                          class={`num ${v > 0 ? 'has-bar' : ''}`}
                          style={
                            v > 0
                              ? { '--w': `${Math.max(3, (v / rowMax(r.months)) * 100)}%`, '--c': catColor(r.category) }
                              : undefined
                          }
                        >
                          {v > 0 ? (
                            <button
                              type="button"
                              class="cell-btn"
                              onClick={() =>
                                gotoHistory(`${year}-${String(i + 1).padStart(2, '0')}`, { categoryId: r.category })
                              }
                              aria-label={`${i + 1}월 ${catName(r.category)} ${wonText(v)}`}
                            >
                              {won(v)}
                            </button>
                          ) : (
                            <span class="muted">·</span>
                          )}
                        </td>
                      ))}
                      <td class="num strong">{won(r.total)}</td>
                      <td class="num">{won(r.avg)}</td>
                      <td class="num">{Math.round(r.share * 1000) / 10}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">월 합계</th>
                    {y.monthTotals.map((v, i) => (
                      <td
                        key={i}
                        class={`num strong ${v > 0 ? 'has-bar' : ''}`}
                        style={
                          v > 0
                            ? { '--w': `${Math.max(3, (v / rowMax(y.monthTotals)) * 100)}%`, '--c': 'var(--primary)' }
                            : undefined
                        }
                      >
                        {v > 0 ? won(v) : <span class="muted">·</span>}
                      </td>
                    ))}
                    <td class="num strong ledger-total">{won(y.total)}</td>
                    <td class="num strong">{won(y.avg)}</td>
                    <td class="num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ───────── 기간 지정 ───────── */

function RangeStats() {
  const start = rangeStart.value;
  const end = rangeEnd.value;
  const f = rangeFilter.value;
  const r = useMemo(
    () => rangeStats(entries.value, start, end, today.value, f),
    [entries.value, start, end, today.value, f],
  );
  const t = today.value;
  const preset = (a: string, b: string) => {
    rangeStart.value = a;
    rangeEnd.value = b;
    rangeLimit.value = 50;
  };
  const thisMonth = ymOf(t);
  const lastMonth = addMonths(thisMonth, -1);
  const setF = (patch: Partial<RangeFilter>) => {
    rangeFilter.value = { ...f, ...patch };
    rangeLimit.value = 50;
  };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  const swapped = start > end;
  const shown = r.entries.slice(0, rangeLimit.value);

  return (
    <>
      <section class="stat-card range-form">
        <div class="range-dates">
          <div class="field">
            <label for="rg-start">시작일</label>
            <input
              id="rg-start"
              class="input"
              type="date"
              value={start}
              onInput={(e) => e.currentTarget.value && (rangeStart.value = e.currentTarget.value)}
            />
          </div>
          <span class="range-sep" aria-hidden="true">
            ~
          </span>
          <div class="field">
            <label for="rg-end">종료일</label>
            <input
              id="rg-end"
              class="input"
              type="date"
              value={end}
              onInput={(e) => e.currentTarget.value && (rangeEnd.value = e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="chips">
          <button
            type="button"
            class="chip"
            onClick={() => preset(`${thisMonth}-01`, `${thisMonth}-${daysInMonth(thisMonth)}`)}
          >
            이번 달
          </button>
          <button
            type="button"
            class="chip"
            onClick={() => preset(`${lastMonth}-01`, `${lastMonth}-${daysInMonth(lastMonth)}`)}
          >
            지난달
          </button>
          <button type="button" class="chip" onClick={() => preset(addDays(t, -29), t)}>
            최근 30일
          </button>
          <button
            type="button"
            class="chip"
            onClick={() => preset(`${yearNum(thisMonth)}-01-01`, `${yearNum(thisMonth)}-12-31`)}
          >
            올해
          </button>
        </div>
        <div class="range-filters">
          <div class="field">
            <label for="rg-cat">분류</label>
            <select
              id="rg-cat"
              class="input"
              value={f.category ?? ''}
              onChange={(e) =>
                setF({
                  category: (e.currentTarget.value || null) as RangeFilter['category'],
                })
              }
            >
              <option value="">전체</option>
              {categoriesSorted.value.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">미분류</option>
            </select>
          </div>
          <div class="field">
            <label for="rg-user">사용자</label>
            <select
              id="rg-user"
              class="input"
              value={f.user ?? ''}
              onChange={(e) =>
                setF({
                  user: (e.currentTarget.value || null) as RangeFilter['user'],
                })
              }
            >
              <option value="">전체</option>
              {usersSorted.value.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.type === 'group' ? `${u.name} (그룹)` : u.name}
                </option>
              ))}
              <option value="none">미지정</option>
            </select>
          </div>
          <div class="field">
            <label for="rg-pay">지불수단</label>
            <select
              id="rg-pay"
              class="input"
              value={f.payMethod ?? ''}
              onChange={(e) =>
                setF({
                  payMethod: (e.currentTarget.value || null) as RangeFilter['payMethod'],
                })
              }
            >
              <option value="">전체</option>
              {payMethodsSorted.value.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="none">미지정</option>
            </select>
          </div>
        </div>
        {swapped ? <p class="hint warn">시작일이 종료일보다 늦어서 두 날짜를 바꿔 계산했습니다.</p> : null}
      </section>

      {!valid ? null : r.count === 0 ? (
        <Empty title="조건에 맞는 내역이 없습니다" />
      ) : (
        <>
          <Tiles
            items={[
              {
                label: '합계',
                value: <span class="num">{wonText(r.total)}</span>,
              },
              { label: '내역', value: <span class="num">{r.count}건</span> },
              {
                label: '하루 평균',
                value: <span class="num">{wonText(r.dailyAvg)}</span>,
                sub: `${r.days}일 기준`,
              },
            ]}
          />
          <div class="stat-grid">
            <Card title="분류별 합계">
              <RankedBars total={r.total} items={sliceItems(r.byCategory, catName, catColor)} />
            </Card>
            <Card title={`내역 ${r.count}건`}>
              <ul class="range-list">
                {shown.map((e) => (
                  <li key={e.id}>
                    <button type="button" class="range-row" onClick={() => openEdit(e)}>
                      <span class="rr-date num">{formatMD(e.date)}</span>
                      <span class="rr-main">
                        <span class="rr-store">{e.store || e.memo || '(내용 없음)'}</span>
                        <small class="muted">
                          <CategoryDot color={catColor(e.category)} /> {catName(e.category)}
                        </small>
                      </span>
                      <span class="num rr-amt">{won(e.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {r.entries.length > shown.length ? (
                <button type="button" class="btn small" onClick={() => (rangeLimit.value += 50)}>
                  더 보기 ({r.entries.length - shown.length}건 남음)
                </button>
              ) : null}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/* ───────── 화면 ───────── */

export function StatsView() {
  const tab = statsTab.value;
  return (
    <div class="stats-view">
      <div class="subtabs" role="tablist" aria-label="통계 종류">
        {(Object.keys(TAB_LABEL) as StatsTab[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            class="subtab"
            onClick={() => (statsTab.value = k)}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>
      <p class="hint stats-note">[보류] 내역은 모든 통계에서 제외됩니다. [예정] 내역은 포함됩니다.</p>
      {tab === 'month' ? <MonthlyStats /> : tab === 'year' ? <YearlyStats /> : <RangeStats />}
    </div>
  );
}
