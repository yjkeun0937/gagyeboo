import { useEffect, useState } from 'preact/hooks';
import {
  entryStatus,
  filterEntries,
  groupByDate,
  isCounted,
  isFilterActive,
  summarize,
  type DateGroup,
  type MonthSummary,
} from '../lib/calc';
import { addMonths, formatMD, formatYm, monthNum, weekdayIndex, weekdayKo, ymOf, yearNum } from '../lib/dates';
import { won } from '../lib/format';
import { EMPTY_FILTER, type Entry } from '../lib/types';
import { clearSample, hasSample, loadSample } from '../lib/sample';
import {
  categoriesById,
  categoriesSorted,
  entries,
  groupsSorted,
  monthEntries,
  payDetailsById,
  payMethodsById,
  payMethodsSorted,
  personsSorted,
  showToast,
  today,
  users,
  usersById,
  viewMonth,
} from '../store/store';
import { CategoryDot, PayBadge, PayGlyph, Ui, UserBadge, UserGlyph } from '../ui/icons';
import {
  chipsOpen,
  filter,
  openAdd,
  openEdit,
  openSettings,
  searchAllPeriod,
  searchOpen,
  sheet,
  tab,
} from '../ui/nav';
import { Empty, Pills } from '../ui/parts';
import { iconMode, viewport } from '../ui/viewport';

/* ───────── 월 이동 ───────── */

function scrollToDate(date: string) {
  requestAnimationFrame(() => {
    const groups = [...document.querySelectorAll<HTMLElement>('[data-date]')];
    if (!groups.length) return;
    let target = groups[groups.length - 1];
    for (const g of groups) {
      if ((g.dataset.date ?? '') <= date) target = g;
      else break;
    }
    // 오늘보다 앞선 날짜가 하나도 없으면 첫 그룹
    if (groups[0].dataset.date! > date) target = groups[0];
    target.scrollIntoView({ block: 'start' });
  });
}

function goToday() {
  viewMonth.value = ymOf(today.value);
  scrollToDate(today.value);
}

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

function MonthBar() {
  const ym = viewMonth.value;
  const [picker, setPicker] = useState(false);
  const go = (n: number) => (viewMonth.value = addMonths(viewMonth.value, n));
  return (
    <div class="monthbar">
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
      <button type="button" class="btn small" onClick={goToday} disabled={ym === ymOf(today.value) && false}>
        오늘
      </button>
      <span class="grow" />
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

function Summary({ s }: { s: MonthSummary }) {
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
        <strong class="stat-value num">{won(s.projected)}</strong>
      </div>
      {s.pendingCount > 0 || s.scheduledCount > 0 ? (
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
    </section>
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

function Breakdown({ s }: { s: MonthSummary }) {
  const f = filter.value;
  const vp = viewport.value;
  const open = vp !== 'mobile' || chipsOpen.value;
  const personList = personsSorted.value.filter((u) => (s.byUser.get(u.id) ?? 0) > 0);
  const groupList = groupsSorted.value.filter((u) => (s.byUser.get(u.id) ?? 0) > 0);
  const noUser = s.byUser.get(null) ?? 0;
  const payList = payMethodsSorted.value.filter((p) => (s.byPayMethod.get(p.id) ?? 0) > 0);
  const noPay = s.byPayMethod.get(null) ?? 0;
  const catList = categoriesSorted.value
    .filter((c) => (s.byCategory.get(c.id) ?? 0) > 0)
    .sort((a, b) => (s.byCategory.get(b.id) ?? 0) - (s.byCategory.get(a.id) ?? 0));
  const noCat = s.byCategory.get(null) ?? 0;
  if (s.count === 0) return null;
  return (
    <section class="breakdown" aria-label="구분별 합계">
      {vp === 'mobile' ? (
        <button
          type="button"
          class="breakdown-toggle"
          aria-expanded={open}
          onClick={() => (chipsOpen.value = !chipsOpen.value)}
        >
          구분별 합계
          <Ui name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
        </button>
      ) : null}
      {open ? (
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
              {catList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  class="sum-chip"
                  aria-pressed={f.categoryId === c.id}
                  onClick={() => toggleFilter({ categoryId: c.id })}
                >
                  <CategoryDot color={c.color} />
                  {c.name}
                  <b class="num">{won(s.byCategory.get(c.id) ?? 0)}</b>
                </button>
              ))}
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

function FilterBar({ resultCount, resultTotal }: { resultCount: number; resultTotal: number }) {
  const f = filter.value;
  const active = isFilterActive(f);
  if (!searchOpen.value && !active) return null;
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
  const selectedPerson = f.userId && f.userId !== 'none' ? usersById.value.get(f.userId) : undefined;
  return (
    <section class="filterbar" aria-label="검색·필터">
      {searchOpen.value ? (
        <div class="search-row">
          <input
            class="input"
            type="search"
            placeholder="사용처·명세 검색"
            value={f.text}
            aria-label="사용처·명세 검색"
            onInput={(e) => (filter.value = { ...f, text: e.currentTarget.value })}
          />
          <div class="segmented" role="group" aria-label="검색 범위">
            <button
              type="button"
              aria-pressed={!searchAllPeriod.value}
              onClick={() => (searchAllPeriod.value = false)}
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
        </div>
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
            결과 {resultCount}건 · <b class="num">{won(resultTotal)}</b>원
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

function rowKey(e: KeyboardEvent, entry: Entry) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openEdit(entry);
  }
}

function TableList({ groups, withYear }: { groups: DateGroup[]; withYear: boolean }) {
  const vp = viewport.value;
  const mode = iconMode.value;
  const compact = vp === 'tablet';
  const t = today.value;
  return (
    <div class={`ledger ${compact ? 'is-compact' : ''}`} role="table" aria-label="사용 내역">
      <div class="row head" role="row">
        <div class="c-date" role="columnheader">날짜</div>
        <div class="c-store" role="columnheader">사용처</div>
        {!compact ? <div class="c-memo" role="columnheader">명세</div> : null}
        <div class="c-cat" role="columnheader">분류</div>
        <div class="c-amt" role="columnheader">금액</div>
        <div class="c-user" role="columnheader">사용자</div>
        <div class="c-pay" role="columnheader">지불수단</div>
        {!compact ? <div class="c-detail" role="columnheader">결제상세</div> : null}
      </div>
      {groups.map((g) => (
        <div class="day" data-date={g.date} key={g.date} role="rowgroup">
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
                  <span class="store-text">{e.store || (compact ? e.memo : '')}</span>
                  {compact && e.store && e.memo ? <small class="memo-line">{e.memo}</small> : null}
                </div>
                {!compact ? (
                  <div class="c-memo" role="cell">
                    {e.memo}
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

function CardList({ groups, withYear }: { groups: DateGroup[]; withYear: boolean }) {
  const t = today.value;
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
          {g.items.map((e) => {
            const st = entryStatus(e, t);
            const cat = e.category ? categoriesById.value.get(e.category) : undefined;
            const pay = e.payMethod ? payMethodsById.value.get(e.payMethod) : undefined;
            const det = e.payDetail ? payDetailsById.value.get(e.payDetail) : undefined;
            const u = e.user ? usersById.value.get(e.user) : undefined;
            return (
              <div
                key={e.id}
                class={`card st-${st}`}
                role="button"
                tabIndex={0}
                onClick={() => openEdit(e)}
                onKeyDown={(ev) => rowKey(ev, e)}
              >
                <div class="card-l1">
                  <span class="card-store">
                    <Pills status={st} estimate={e.isEstimate} />
                    <span class="store-text">{e.store || e.memo || '(내용 없음)'}</span>
                  </span>
                  <span class="num amt">{won(e.amount)}</span>
                </div>
                <div class="card-l2">
                  <CategoryDot color={cat?.color} />
                  <span class="cat-text">{cat?.name ?? '미분류'}</span>
                  {e.store && e.memo ? <span class="memo-text">· {e.memo}</span> : null}
                  <span class="grow" />
                  <UserBadge user={u} mode="icon" />
                  <PayBadge method={pay} detail={det} mode="icon" />
                </div>
              </div>
            );
          })}
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
  const allPeriod = filtering && searchAllPeriod.value;

  // 화면 단축키: ← → 로 월 이동 (입력 중이거나 시트가 열려 있으면 제외)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (sheet.value || tab.value !== 'history' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') viewMonth.value = addMonths(viewMonth.value, -1);
      if (e.key === 'ArrowRight') viewMonth.value = addMonths(viewMonth.value, 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const summary = summarize(monthEntries.value, ym, t);
  const base = allPeriod ? entries.value : monthEntries.value;
  const list = filtering ? filterEntries(base, f, usersById.value) : base;
  const groups = groupByDate(list, t);
  const counted = list.filter((e) => isCounted(e, t));
  const resultTotal = counted.reduce((a, e) => a + e.amount, 0);
  const vp = viewport.value;
  const noUsers = users.value.length === 0;

  return (
    <div class="history">
      <MonthBar />
      {!allPeriod ? <Summary s={summary} /> : null}
      {!allPeriod ? <Breakdown s={summary} /> : null}
      <FilterBar resultCount={list.length} resultTotal={resultTotal} />

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
        <CardList groups={groups} withYear={allPeriod} />
      ) : (
        <TableList groups={groups} withYear={allPeriod} />
      )}
    </div>
  );
}

export { hasSample, clearSample };
