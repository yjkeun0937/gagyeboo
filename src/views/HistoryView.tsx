import { useEffect, useState } from 'preact/hooks';
import {
  budgetState,
  entryStatus,
  filterEntries,
  goalWarning,
  groupByDate,
  isCounted,
  isFilterActive,
  sortEntries,
  summarize,
  type DateGroup,
  type ListSort,
  type MonthSummary,
  type SortKey,
} from '../lib/calc';
import { formatMD, formatYm, monthNum, weekdayIndex, weekdayKo, ymOf } from '../lib/dates';
import { clearRecent, loadRecent, pushRecent, removeRecent } from '../lib/recent';
import { digitsOnly, won } from '../lib/format';
import { EMPTY_FILTER } from '../lib/types';
import { loadSample } from '../lib/sample';
import {
  categoriesById,
  categoriesSorted,
  entries,
  groupsSorted,
  monthEntries,
  payDetailsById,
  payMethodsById,
  payMethodsSorted,
  pendingFixed,
  personsSorted,
  settings,
  showToast,
  today,
  updateSettings,
  users,
  usersById,
  viewMonth,
} from '../store/store';
import { CategoryDot, PayBadge, PayGlyph, Ui, UserBadge, UserGlyph } from '../ui/icons';
import {
  calDate,
  chipsOpen,
  filter,
  historyView,
  listSort,
  openAdd,
  openEdit,
  openFixedWindow,
  openSettings,
  revealFuture,
  searchAllPeriod,
  searchOpen,
} from '../ui/nav';
import { MonthNav } from '../ui/monthnav';
import { CalendarView } from './CalendarView';
import { EntryCard, Hl, rowKey } from './EntryCard';
import { showPopover } from '../ui/overlay';
import { Empty, Pills } from '../ui/parts';
import { iconMode, viewport } from '../ui/viewport';

/* ───────── 월 이동 ───────── */

/** 해당 날짜(없으면 그 이전 가장 가까운 날, 그것도 없으면 이후 가장 가까운 날) 그룹이 화면 맨 위에 오게 한다. 정렬 방향과 무관 */
function scrollToDate(date: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const els = [...document.querySelectorAll<HTMLElement>('[data-date]')];
      if (!els.length) return;
      const dateOf = (el: HTMLElement) => el.dataset.date ?? '';
      const before = els.filter((el) => dateOf(el) <= date);
      const pool = before.length ? before : els;
      const pick = pool.reduce((best, el) =>
        before.length
          ? dateOf(el) > dateOf(best)
            ? el
            : best
          : dateOf(el) < dateOf(best)
            ? el
            : best,
      );
      pick.scrollIntoView({ block: 'start' });
    }),
  );
}

function goToday() {
  viewMonth.value = ymOf(today.value);
  calDate.value = today.value;
  if ((historyView.value ?? settings.value.defaultView) === 'list') scrollToDate(today.value);
}

function MonthBar() {
  const ym = viewMonth.value;
  const calendar = (historyView.value ?? settings.value.defaultView) === 'calendar';
  return (
    <div class="monthbar">
      <MonthNav />
      <button type="button" class="btn small" onClick={goToday} aria-label="오늘로 이동" data-current={ym === ymOf(today.value)}>
        오늘
      </button>
      <span class="grow" />
      <button
        type="button"
        class="icon-btn view-toggle"
        aria-label={calendar ? '목록으로 보기' : '캘린더로 보기'}
        title={calendar ? '목록으로 보기' : '캘린더로 보기'}
        onClick={() => (historyView.value = calendar ? 'list' : 'calendar')}
      >
        <Ui name={calendar ? 'List' : 'CalendarDays'} />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="검색·필터"
        aria-pressed={searchOpen.value}
        onClick={() => (searchOpen.value = !searchOpen.value)}
      >
        <Ui name="Search" />
      </button>
    </div>
  );
}

/* ───────── 월 요약 ───────── */

function Summary({ s, ym }: { s: MonthSummary; ym: string }) {
  const goal = settings.value.monthlyGoal;
  const fd = settings.value.futureDisplay;
  const warn = goalWarning(s, ym, today.value, goal);
  const reveal = revealFuture.value;
  return (
    <section class="summary" aria-label="월 요약">
      <div class="stat stat-total">
        <span class="stat-label">합계</span>
        <strong class="stat-value ledger-total num">
          {won(s.total)}
          <small>원</small>
        </strong>
      </div>
      <div class="stat">
        <span class="stat-label">하루평균</span>
        <strong class="stat-value num">{won(s.dailyAvg)}</strong>
      </div>
      <div class="stat">
        <span class="stat-label">예상 월지출</span>
        <strong class="stat-value num">
          {won(s.projected)}
          {warn ? (
            <button
              type="button"
              class="goal-badge"
              aria-label="예상 월지출이 목표를 넘습니다. 자세히 보기"
              onClick={(e) => showPopover(e.currentTarget, warn.title, warn.lines, '#B3261E')}
            >
              <span aria-hidden="true">!</span>
            </button>
          ) : null}
        </strong>
      </div>
      {fd === 'all' && (s.pendingCount > 0 || s.scheduledCount > 0) ? (
        <p class="summary-note">
          {s.pendingCount > 0 ? (
            <span>
              <span class="pill pill-pending">보류</span> {s.pendingCount}건 · {won(s.pendingTotal)}원 (집계 제외)
            </span>
          ) : null}
          {s.scheduledCount > 0 ? (
            <span>
              <span class="pill pill-scheduled">예정</span> {s.scheduledCount}건 · {won(s.scheduledTotal)}원 포함
            </span>
          ) : null}
        </p>
      ) : null}
      {fd === 'count' && (s.pendingCount > 0 || s.scheduledCount > 0) ? (
        <p class="summary-note">
          {s.pendingCount > 0 ? (
            <button type="button" class="count-chip" aria-pressed={reveal} onClick={() => (revealFuture.value = !reveal)}>
              <span class="pill pill-pending">보류</span> {s.pendingCount}건
            </button>
          ) : null}
          {s.scheduledCount > 0 ? (
            <button type="button" class="count-chip" aria-pressed={reveal} onClick={() => (revealFuture.value = !reveal)}>
              <span class="pill pill-scheduled">예정</span> {s.scheduledCount}건
            </button>
          ) : null}
          <small class="muted">{reveal ? '눌러서 다시 숨기기' : '눌러서 목록에 보기'}</small>
        </p>
      ) : null}
    </section>
  );
}

/* ───────── 알림 칩 (해당할 때만) ───────── */

function AlertChips({ estimateCount }: { estimateCount: number }) {
  const pending = pendingFixed.value;
  const f = filter.value;
  if (!pending.length && !estimateCount && !f.estimateOnly) return null;
  const thisMonth = ymOf(today.value);
  return (
    <div class="alert-chips">
      {pending.length ? (
        <button type="button" class="alert-chip is-warn" onClick={() => openFixedWindow()}>
          <Ui name="CalendarDays" size={16} />
          {pending.includes(thisMonth) ? '이번 달 고정지출 미처리' : `고정지출 미처리 ${pending.length}개월`}
        </button>
      ) : null}
      {estimateCount > 0 || f.estimateOnly ? (
        <button
          type="button"
          class="alert-chip"
          aria-pressed={f.estimateOnly}
          onClick={() => (filter.value = { ...f, estimateOnly: !f.estimateOnly })}
        >
          <span class="pill pill-estimate">예상</span>
          금액 {estimateCount}건
        </button>
      ) : null}
    </div>
  );
}

/* ───────── 구분별 합계 칩 (누르면 필터) ───────── */

function toggleFilter(patch: { userId?: string; payMethodId?: string; categoryId?: string }) {
  const cur = filter.value;
  const next = { ...cur };
  if (patch.userId !== undefined) {
    next.userId = cur.userId === patch.userId ? null : patch.userId;
    next.includeGroups = false;
  }
  if (patch.payMethodId !== undefined) {
    next.payMethodId = cur.payMethodId === patch.payMethodId ? null : patch.payMethodId;
  }
  if (patch.categoryId !== undefined) {
    next.categoryId = cur.categoryId === patch.categoryId ? null : patch.categoryId;
  }
  filter.value = next;
}

/** 정렬 선택 값 ↔ 정렬 상태 */
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'date-desc', label: '최신순' },
  { value: 'date-asc', label: '오래된순' },
  { value: 'amt-desc', label: '금액 큰 순' },
  { value: 'amt-asc', label: '금액 작은 순' },
  { value: 'store-asc', label: '사용처순' },
  { value: 'cat-asc', label: '분류순' },
];

function sortValue(): string {
  const ls = listSort.value;
  return ls ? `${ls.key}-${ls.dir}` : `date-${settings.value.dateSort}`;
}

function applySortValue(v: string) {
  const [key, dir] = v.split('-') as [string, 'asc' | 'desc'];
  if (key === 'date') {
    listSort.value = null;
    void updateSettings({ dateSort: dir });
  } else {
    listSort.value = { key: key as SortKey, dir };
  }
}

/** 모바일: 구분별 합계 아코디언 왼쪽의 정렬 선택 */
function SortButton() {
  const cur = sortValue();
  const label = SORT_OPTIONS.find((o) => o.value === cur)?.label ?? '최신순';
  return (
    <label class="sort-btn">
      <Ui name={cur.endsWith('asc') ? 'ArrowUp' : 'ArrowDown'} size={16} />
      <span>{label}</span>
      <select
        class="sort-select"
        aria-label="정렬 방법"
        value={cur}
        onChange={(e) => applySortValue(e.currentTarget.value)}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Breakdown({ s, hasList, calendar }: { s: MonthSummary | null; hasList: boolean; calendar: boolean }) {
  const f = filter.value;
  const vp = viewport.value;
  const mobile = vp === 'mobile';
  const hasBreak = !!s && s.count > 0;
  if (!mobile && !hasBreak) return null;
  if (mobile && !hasBreak && (!hasList || calendar)) return null;
  const open = !mobile || chipsOpen.value;
  if (!s) {
    return (
      <section class="breakdown">
        <div class="breakdown-bar">
          {calendar ? null : <SortButton />}
          <span class="grow" />
        </div>
      </section>
    );
  }
  const personList = personsSorted.value.filter((u) => (s.byUser.get(u.id) ?? 0) > 0);
  const groupList = groupsSorted.value.filter((u) => (s.byUser.get(u.id) ?? 0) > 0);
  const noUser = s.byUser.get(null) ?? 0;
  const payList = payMethodsSorted.value.filter((p) => (s.byPayMethod.get(p.id) ?? 0) > 0);
  const noPay = s.byPayMethod.get(null) ?? 0;
  const catList = categoriesSorted.value
    .filter((c) => (s.byCategory.get(c.id) ?? 0) > 0 || (c.budget ?? 0) > 0)
    .sort((a, b) => (s.byCategory.get(b.id) ?? 0) - (s.byCategory.get(a.id) ?? 0));
  const noCat = s.byCategory.get(null) ?? 0;
  return (
    <section class="breakdown" aria-label="구분별 합계">
      {mobile ? (
        <div class="breakdown-bar">
          {calendar ? null : <SortButton />}
          {hasBreak ? (
            <button
              type="button"
              class="breakdown-toggle"
              aria-expanded={open}
              onClick={() => (chipsOpen.value = !chipsOpen.value)}
            >
              구분별 합계
              <Ui name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
            </button>
          ) : (
            <span class="grow" />
          )}
        </div>
      ) : null}
      {hasBreak && open ? (
        <div class="breakdown-body">
          <div class="bk-group">
            <span class="bk-title">사용자</span>
            <div class="bk-chips">
              {personList.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  class="sum-chip"
                  aria-pressed={f.userId === u.id}
                  onClick={() => toggleFilter({ userId: u.id })}
                >
                  <UserGlyph user={u} size={20} />
                  {u.name}
                  <b class="num">{won(s.byUser.get(u.id) ?? 0)}</b>
                </button>
              ))}
              {groupList.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  class="sum-chip is-group"
                  aria-pressed={f.userId === u.id}
                  onClick={() => toggleFilter({ userId: u.id })}
                >
                  <UserGlyph user={u} size={20} />
                  {u.name}
                  <b class="num">{won(s.byUser.get(u.id) ?? 0)}</b>
                </button>
              ))}
              {noUser > 0 ? (
                <button
                  type="button"
                  class="sum-chip"
                  aria-pressed={f.userId === 'none'}
                  onClick={() => toggleFilter({ userId: 'none' })}
                >
                  미지정
                  <b class="num">{won(noUser)}</b>
                </button>
              ) : null}
            </div>
          </div>
          <div class="bk-group">
            <span class="bk-title">지불수단</span>
            <div class="bk-chips">
              {payList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class="sum-chip"
                  aria-pressed={f.payMethodId === p.id}
                  onClick={() => toggleFilter({ payMethodId: p.id })}
                >
                  <PayGlyph method={p} size={20} />
                  {p.name}
                  <b class="num">{won(s.byPayMethod.get(p.id) ?? 0)}</b>
                </button>
              ))}
              {noPay > 0 ? (
                <span class="sum-chip static">
                  미지정
                  <b class="num">{won(noPay)}</b>
                </span>
              ) : null}
            </div>
          </div>
          <div class="bk-group">
            <span class="bk-title">분류</span>
            <div class="bk-chips">
              {catList.map((c) => {
                const spent = s.byCategory.get(c.id) ?? 0;
                const bs = budgetState(spent, c.budget);
                return (
                  <button
                    key={c.id}
                    type="button"
                    class={`sum-chip ${bs ? `has-budget lv-${bs.level}` : ''}`}
                    aria-pressed={f.categoryId === c.id}
                    onClick={() => toggleFilter({ categoryId: c.id })}
                  >
                    <CategoryDot color={c.color} />
                    {c.name}
                    <b class="num">{won(spent)}</b>
                    {bs ? (
                      <>
                        <small class="bud-pct num">
                          {bs.level === 'over' ? <span class="bud-flag" aria-hidden="true">!</span> : null}
                          {Math.round(bs.percent)}%
                        </small>
                        <span class="sr-only">
                          {bs.level === 'over'
                            ? `예산 ${won(bs.budget)}원 초과, ${won(bs.over)}원 많이 썼습니다`
                            : `예산 ${won(bs.budget)}원 중 ${Math.round(bs.percent)}%`}
                        </span>
                        <span class="bud-meter" aria-hidden="true">
                          <i style={{ width: `${Math.min(100, bs.percent)}%` }} />
                        </span>
                      </>
                    ) : null}
                  </button>
                );
              })}
              {noCat > 0 ? (
                <span class="sum-chip static">
                  미분류
                  <b class="num">{won(noCat)}</b>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ───────── 검색·필터 줄 ───────── */

/** 천 단위로 보여 주는 금액 입력란 (비우면 제한 없음) */
function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      class="input num amount-filter"
      inputMode="numeric"
      placeholder={label}
      aria-label={label}
      value={value == null ? '' : won(value)}
      onInput={(e) => {
        const d = digitsOnly(e.currentTarget.value).slice(0, 12);
        onChange(d ? Number(d) : null);
      }}
    />
  );
}

function amountTag(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${won(min)}~${won(max)}원`;
  return min != null ? `${won(min)}원 이상` : `${won(max as number)}원 이하`;
}

function dateTag(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  if (from && to) return `${from} ~ ${to}`;
  return from ? `${from} 이후` : `${to} 이전`;
}

function FilterBar({
  resultCount,
  resultTotal,
  pendingCount,
  calendar,
}: {
  resultCount: number;
  resultTotal: number;
  pendingCount: number;
  calendar: boolean;
}) {
  const f = filter.value;
  const active = isFilterActive(f);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  if (!searchOpen.value && !active) return null;
  const allPeriod = searchAllPeriod.value && !calendar;
  const tags: { label: string; clear: () => void }[] = [];
  if (f.userId) {
    const name = f.userId === 'none' ? '사용자 미지정' : usersById.value.get(f.userId)?.name ?? '사용자';
    tags.push({ label: name, clear: () => (filter.value = { ...f, userId: null, includeGroups: false }) });
  }
  if (f.payMethodId)
    tags.push({
      label: payMethodsById.value.get(f.payMethodId)?.name ?? '지불수단',
      clear: () => (filter.value = { ...f, payMethodId: null, payDetailId: null }),
    });
  if (f.categoryId)
    tags.push({
      label: categoriesById.value.get(f.categoryId)?.name ?? '분류',
      clear: () => (filter.value = { ...f, categoryId: null }),
    });
  if (f.estimateOnly)
    tags.push({ label: '예상 금액만', clear: () => (filter.value = { ...f, estimateOnly: false }) });
  const at = amountTag(f.minAmount, f.maxAmount);
  if (at) tags.push({ label: `금액 ${at}`, clear: () => (filter.value = { ...f, minAmount: null, maxAmount: null }) });
  const dt = dateTag(f.dateFrom, f.dateTo);
  if (dt) tags.push({ label: dt, clear: () => (filter.value = { ...f, dateFrom: null, dateTo: null }) });
  const selectedPerson = f.userId && f.userId !== 'none' ? usersById.value.get(f.userId) : undefined;
  const commit = () => {
    if (f.text.trim()) setRecent(pushRecent(f.text));
  };
  return (
    <section class="filterbar" aria-label="검색·필터">
      {searchOpen.value ? (
        <>
          <div class="search-row">
            <input
              class="input"
              type="search"
              placeholder="사용처·명세 검색"
              value={f.text}
              aria-label="사용처·명세 검색"
              enterKeyHint="search"
              onInput={(e) => (filter.value = { ...f, text: e.currentTarget.value })}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit();
                  e.currentTarget.blur();
                }
              }}
            />
            {!calendar ? (
              <div class="segmented" role="group" aria-label="검색 범위">
                <button
                  type="button"
                  aria-pressed={!searchAllPeriod.value}
                  onClick={() => {
                    searchAllPeriod.value = false;
                    if (f.dateFrom || f.dateTo) filter.value = { ...f, dateFrom: null, dateTo: null };
                  }}
                >
                  이 달
                </button>
                <button
                  type="button"
                  aria-pressed={searchAllPeriod.value}
                  onClick={() => (searchAllPeriod.value = true)}
                >
                  전체 기간
                </button>
              </div>
            ) : null}
          </div>
          {!f.text.trim() && recent.length ? (
            <div class="recent-row" aria-label="최근 검색어">
              <span class="recent-title">최근</span>
              {recent.map((r) => (
                <span key={r} class="recent-chip">
                  <button type="button" class="recent-pick" onClick={() => (filter.value = { ...f, text: r })}>
                    {r}
                  </button>
                  <button
                    type="button"
                    class="recent-x"
                    aria-label={`최근 검색어 ${r} 지우기`}
                    onClick={() => setRecent(removeRecent(r))}
                  >
                    <Ui name="X" size={12} />
                  </button>
                </span>
              ))}
              <button type="button" class="btn small ghost" onClick={() => setRecent(clearRecent())}>
                모두 지우기
              </button>
            </div>
          ) : null}
          <div class="range-row">
            <span class="range-label">금액</span>
            <AmountField label="최소" value={f.minAmount} onChange={(v) => (filter.value = { ...f, minAmount: v })} />
            <span aria-hidden="true">~</span>
            <AmountField label="최대" value={f.maxAmount} onChange={(v) => (filter.value = { ...f, maxAmount: v })} />
            <span class="unit">원</span>
          </div>
          {allPeriod ? (
            <div class="range-row">
              <span class="range-label">기간</span>
              <input
                class="input date-filter"
                type="date"
                aria-label="시작일"
                value={f.dateFrom ?? ''}
                max={f.dateTo ?? undefined}
                onInput={(e) => (filter.value = { ...f, dateFrom: e.currentTarget.value || null })}
              />
              <span aria-hidden="true">~</span>
              <input
                class="input date-filter"
                type="date"
                aria-label="종료일"
                value={f.dateTo ?? ''}
                min={f.dateFrom ?? undefined}
                onInput={(e) => (filter.value = { ...f, dateTo: e.currentTarget.value || null })}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {active ? (
        <div class="tag-row">
          {tags.map((t) => (
            <button key={t.label} type="button" class="tag" onClick={t.clear}>
              {t.label}
              <Ui name="X" size={14} />
            </button>
          ))}
          {selectedPerson?.type === 'person' ? (
            <label class="check">
              <input
                type="checkbox"
                checked={f.includeGroups}
                onChange={(e) => (filter.value = { ...f, includeGroups: e.currentTarget.checked })}
              />
              속한 그룹 내역도 포함
            </label>
          ) : null}
          <span class="grow" />
          <span class="result-sum">
            결과 {resultCount}건 · 합계 <b class="num">{won(resultTotal)}</b>원
            {pendingCount > 0 ? <small class="muted"> (보류 {pendingCount}건은 합계 제외)</small> : null}
          </span>
          <button
            type="button"
            class="btn small"
            onClick={() => {
              filter.value = { ...EMPTY_FILTER };
            }}
          >
            필터 지우기
          </button>
        </div>
      ) : null}
    </section>
  );
}

/* ───────── 내역 목록 ───────── */

function Weekday({ date }: { date: string }) {
  const w = weekdayIndex(date);
  return <small class={`wk ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`}>{weekdayKo(date)}</small>;
}

function dateLabel(date: string, withYear: boolean) {
  return withYear ? `${date.slice(2, 4)}.${monthNum(date.slice(0, 7))}.${Number(date.slice(8))}` : formatMD(date);
}

function TableList({ groups, withYear, query }: { groups: DateGroup[]; withYear: boolean; query: string }) {
  const vp = viewport.value;
  const sort = settings.value.dateSort;
  const mode = iconMode.value;
  const compact = vp === 'tablet';
  const t = today.value;
  const ls = listSort.value;
  const sortBy = (key: SortKey) => {
    const dir = ls && ls.key === key ? (ls.dir === 'asc' ? 'desc' : 'asc') : key === 'amt' ? 'desc' : 'asc';
    listSort.value = { key, dir };
  };
  const headAria = (key: SortKey) => (ls && ls.key === key ? (ls.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      class={`sort-head ${ls?.key === k ? 'is-active' : ''}`}
      title={`누르면 ${label} 기준으로 정렬합니다`}
      onClick={() => sortBy(k)}
    >
      {label}
      {ls?.key === k ? <Ui name={ls.dir === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={14} /> : null}
    </button>
  );
  return (
    <div class={`ledger ${compact ? 'is-compact' : ''}`} role="table" aria-label="사용 내역">
      <div class="row head" role="row">
        <div class="c-date" role="columnheader" aria-sort={ls ? 'none' : sort === 'desc' ? 'descending' : 'ascending'}>
          <button
            type="button"
            class={`sort-head ${ls ? '' : 'is-active'}`}
            title={ls ? '날짜별로 묶어서 보기' : `누르면 ${sort === 'desc' ? '오래된순' : '최신순'}으로 바뀝니다`}
            onClick={() => {
              if (ls) listSort.value = null;
              else void updateSettings({ dateSort: sort === 'desc' ? 'asc' : 'desc' });
            }}
          >
            날짜
            {!ls ? <Ui name={sort === 'desc' ? 'ArrowDown' : 'ArrowUp'} size={14} /> : null}
          </button>
        </div>
        <div class="c-store" role="columnheader" aria-sort={headAria('store')}>
          <SortHead k="store" label="사용처" />
        </div>
        {!compact ? <div class="c-memo" role="columnheader">명세</div> : null}
        <div class="c-cat" role="columnheader" aria-sort={headAria('cat')}>
          <SortHead k="cat" label="분류" />
        </div>
        <div class="c-amt" role="columnheader" aria-sort={headAria('amt')}>
          <SortHead k="amt" label="금액" />
        </div>
        <div class="c-user" role="columnheader">사용자</div>
        <div class="c-pay" role="columnheader">지불수단</div>
        {!compact ? <div class="c-detail" role="columnheader">결제상세</div> : null}
      </div>
      {groups.map((g) => (
        <div class="day" data-date={g.date} key={ls ? g.items[0].id : g.date} role="rowgroup">
          {g.items.map((e, i) => {
            const st = entryStatus(e, t);
            const cat = e.category ? categoriesById.value.get(e.category) : undefined;
            const pay = e.payMethod ? payMethodsById.value.get(e.payMethod) : undefined;
            const det = e.payDetail ? payDetailsById.value.get(e.payDetail) : undefined;
            const u = e.user ? usersById.value.get(e.user) : undefined;
            return (
              <div
                key={e.id}
                class={`row st-${st}`}
                role="row"
                tabIndex={0}
                onClick={() => openEdit(e)}
                onKeyDown={(ev) => rowKey(ev, e)}
              >
                <div class="c-date" role="cell">
                  {i === 0 ? (
                    <>
                      {dateLabel(g.date, withYear)} <Weekday date={g.date} />
                    </>
                  ) : null}
                </div>
                <div class="c-store" role="cell">
                  <Pills status={st} estimate={e.isEstimate} />
                  <span class="store-text">
                    <Hl text={e.store || (compact ? e.memo : '')} q={query} />
                  </span>
                  {compact && e.store && e.memo ? (
                    <small class="memo-line">
                      <Hl text={e.memo} q={query} />
                    </small>
                  ) : null}
                </div>
                {!compact ? (
                  <div class="c-memo" role="cell">
                    <Hl text={e.memo} q={query} />
                  </div>
                ) : null}
                <div class="c-cat" role="cell">
                  <CategoryDot color={cat?.color} />
                  <span class="cat-text">{cat?.name ?? '미분류'}</span>
                </div>
                <div class="c-amt num" role="cell">
                  {won(e.amount)}
                </div>
                <div class="c-user" role="cell">
                  <UserBadge user={u} mode={mode} />
                </div>
                <div class="c-pay" role="cell">
                  <PayBadge method={pay} detail={det} mode={mode} showDetailInline={compact} />
                </div>
                {!compact ? (
                  <div class="c-detail" role="cell">
                    {det ? (
                      <>
                        <CategoryDot color={det.color} />
                        {det.name}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {g.items.length > 1 ? (
            <div class="row sub" role="row">
              <div class="sub-label">일계</div>
              <div class="sub-amt num ledger-total">{won(g.total)}</div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** flat: 날짜 묶음 없이 한 줄씩(열 기준 정렬). 이때는 카드마다 날짜를 보여 준다 */
function CardList({ groups, withYear, flat, query }: { groups: DateGroup[]; withYear: boolean; flat: boolean; query: string }) {
  const t = today.value;
  if (flat) {
    return (
      <div class="cards">
        <section class="day">
          {groups.map((g) => {
            const e = g.items[0];
            return <EntryCard key={e.id} e={e} t={t} query={query} dateText={`${dateLabel(e.date, withYear)} ${weekdayKo(e.date)}`} />;
          })}
        </section>
      </div>
    );
  }
  return (
    <div class="cards">
      {groups.map((g) => (
        <section class="day" data-date={g.date} key={g.date}>
          <header class="day-head">
            <span class="day-date">
              {dateLabel(g.date, withYear)} <Weekday date={g.date} />
            </span>
            <span class="day-total num">{won(g.total)}</span>
          </header>
          {g.items.map((e) => (
            <EntryCard key={e.id} e={e} t={t} query={query} />
          ))}
        </section>
      ))}
    </div>
  );
}

/* ───────── 화면 ───────── */

export function HistoryView() {
  const ym = viewMonth.value;
  const t = today.value;
  const f = filter.value;
  const filtering = isFilterActive(f);
  const calendar = (historyView.value ?? settings.value.defaultView) === 'calendar';
  const allPeriod = filtering && searchAllPeriod.value && !calendar;
  const sort = settings.value.dateSort;
  const fd = settings.value.futureDisplay;
  const ls: ListSort | null = calendar ? null : listSort.value;

  // 달을 옮기면 '건수만 표시'로 임시로 펼친 상태를 접는다
  useEffect(() => {
    revealFuture.value = false;
  }, [ym]);

  // 내림차순에서 오늘 이후 항목이 위에 쌓이는 경우, 이번 달을 열 때 오늘 그룹이 맨 위에 오게 한다
  useEffect(() => {
    if (calendar || ls) return;
    if (ym !== ymOf(today.value) || fd !== 'all' || sort !== 'desc') return;
    if (isFilterActive(filter.value)) return;
    if (monthEntries.value.some((e) => e.date > today.value)) scrollToDate(today.value);
  }, [ym, fd, sort, calendar, !!ls]);

  const summary = summarize(monthEntries.value, ym, t);
  const base = allPeriod ? entries.value : monthEntries.value;
  const list = filtering ? filterEntries(base, f, usersById.value) : base;
  // 오늘 이후 항목 표시 설정: 검색·필터 결과에는 항상 표시한다
  const hideFuture = !filtering && (fd === 'hide' || (fd === 'count' && !revealFuture.value));
  const visible = hideFuture ? list.filter((e) => e.date <= t) : list;
  const hiddenCount = list.length - visible.length;
  const catOrder = new Map(categoriesSorted.value.map((c, i) => [c.id, i]));
  const groups: DateGroup[] = ls
    ? sortEntries(visible, ls, catOrder).map((e) => ({ date: e.date, items: [e], total: isCounted(e, t) ? e.amount : 0 }))
    : groupByDate(visible, t, sort);
  const counted = list.filter((e) => isCounted(e, t));
  const resultTotal = counted.reduce((a, e) => a + e.amount, 0);
  const pendingCount = list.length - counted.length;
  const estimateCount = monthEntries.value.filter((e) => e.isEstimate).length;
  const vp = viewport.value;
  const noUsers = users.value.length === 0;
  const query = f.text.trim();

  return (
    <div class="history">
      <MonthBar />
      <AlertChips estimateCount={estimateCount} />
      {!allPeriod ? <Summary s={summary} ym={ym} /> : null}
      <Breakdown s={allPeriod ? null : summary} hasList={groups.length > 0} calendar={calendar} />
      <FilterBar resultCount={list.length} resultTotal={resultTotal} pendingCount={pendingCount} calendar={calendar} />

      {entries.value.length === 0 ? (
        <Empty title="아직 기록이 없습니다">
          <p>
            지출을 입력하면 이 화면에 월별로 쌓입니다. 먼저 사용자(개인)를 등록해 두면 누구의 지출인지 함께 기록할 수 있습니다.
          </p>
          <div class="empty-actions">
            <button type="button" class="btn primary" onClick={() => openAdd()}>
              <Ui name="Plus" size={18} />
              지출 입력
            </button>
            {noUsers ? (
              <button type="button" class="btn" onClick={() => openSettings('lists', 'users')}>
                사용자 등록
              </button>
            ) : null}
            <button
              type="button"
              class="btn"
              onClick={async () => {
                const n = await loadSample();
                showToast(`가상 데이터 ${n}건을 넣었습니다`);
              }}
            >
              가상 데이터로 둘러보기
            </button>
          </div>
        </Empty>
      ) : calendar ? (
        <CalendarView entries={list} ym={ym} filtering={filtering} />
      ) : groups.length === 0 && hiddenCount > 0 ? (
        <Empty title={`${formatYm(ym)}에는 표시할 내역이 없습니다`}>
          <p>오늘 이후 항목 {hiddenCount}건이 숨겨져 있습니다.</p>
          <div class="empty-actions">
            {fd === 'count' ? (
              <button type="button" class="btn" onClick={() => (revealFuture.value = true)}>
                목록에 보기
              </button>
            ) : (
              <button type="button" class="btn" onClick={() => openSettings('display')}>
                표시 설정 바꾸기
              </button>
            )}
          </div>
        </Empty>
      ) : groups.length === 0 ? (
        <Empty title={filtering ? '조건에 맞는 내역이 없습니다' : `${formatYm(ym)}에는 기록이 없습니다`}>
          <div class="empty-actions">
            {filtering ? (
              <button type="button" class="btn" onClick={() => (filter.value = { ...EMPTY_FILTER })}>
                필터 지우기
              </button>
            ) : (
              <button type="button" class="btn primary" onClick={() => openAdd(ymOf(t) === ym ? t : `${ym}-01`)}>
                <Ui name="Plus" size={18} />이 달에 지출 입력
              </button>
            )}
          </div>
        </Empty>
      ) : vp === 'mobile' ? (
        <CardList groups={groups} withYear={allPeriod} flat={!!ls} query={query} />
      ) : (
        <TableList groups={groups} withYear={allPeriod} query={query} />
      )}
    </div>
  );
}
