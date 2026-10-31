import { signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import {
  END_REASON_LABEL,
  STATE_LABEL,
  STATE_ORDER,
  TAX_LABEL,
  buildTrend,
  categoryDef,
  formatAt,
  groupByState,
  maturityInfo,
  summarize,
  type StateGroup,
} from '../lib/assets';
import { won } from '../lib/format';
import type { Asset, AssetState } from '../lib/types';
import { assetLogs, assets, assetsUpdatedAt, showToast, setAssetState, today, undoAssetChange, usersById } from '../store/store';
import { LineChart, type Tip } from '../ui/charts';
import { Ui } from '../ui/icons';
import { openAssetAdd, openAssetCopy, openAssetEdit } from '../ui/nav';
import { Empty, Split } from '../ui/parts';
import { viewport } from '../ui/viewport';

/** 지금 표시 중인 상태. 처음에는 보유만 켜져 있고, 최소 하나는 켜 둔다 */
const shown = signal<AssetState[]>(['active']);

function toggleState(st: AssetState) {
  const on = shown.value.includes(st);
  if (on && shown.value.length === 1) return;
  shown.value = on ? shown.value.filter((x) => x !== st) : [...shown.value, st];
}

const wonText = (n: number) => `${won(n)}원`;
const ownerName = (id: string | null) => (id ? (usersById.value.get(id)?.name ?? '(삭제된 사용자)') : '');

/** 이름 아래·옆에 보여 줄 세부 내용 */
function detailParts(a: Asset): string[] {
  const out: string[] = [];
  if (a.payStatus) out.push(a.payStatus);
  if (a.coverage) out.push(a.coverage);
  if (a.term) out.push(a.term);
  if (a.rate != null) out.push(`${a.rate}%`);
  if (a.maturity) out.push(`만기 ${a.maturity}`);
  if (a.tax) out.push(TAX_LABEL[a.tax]);
  return out;
}

function MaturityBadge({ a }: { a: Asset }) {
  const m = maturityInfo(a, today.value);
  if (!m) return null;
  return m.level === 'over' ? (
    <span class="pill asset-over" title="만기일이 지났습니다. 재예치했다면 종료로 옮기고 새로 등록해 주세요">
      만기 경과 {m.days}일
    </span>
  ) : (
    <span class="pill asset-soon" title="만기가 가깝습니다">
      {m.days === 0 ? '오늘 만기' : `만기 D-${m.days}`}
    </span>
  );
}

/** 만기가 지난 보유 항목의 단축 버튼 */
function OverActions({ a }: { a: Asset }) {
  if (maturityInfo(a, today.value)?.level !== 'over') return null;
  return (
    <span class="asset-quick">
      <button
        type="button"
        class="btn small"
        onClick={async (e) => {
          e.stopPropagation();
          const u = await setAssetState(a.id, 'ended', { reason: 'matured', endedOn: a.maturity ?? today.value });
          if (u) showToast('종료로 옮겼습니다', () => undoAssetChange(u));
        }}
      >
        종료로 이동
      </button>
      <button
        type="button"
        class="btn small"
        onClick={(e) => {
          e.stopPropagation();
          openAssetCopy(a.id);
        }}
      >
        복사해서 새로 등록
      </button>
    </span>
  );
}

function AssetRow({ a }: { a: Asset }) {
  const parts = detailParts(a);
  const open = () => openAssetEdit(a.id);
  return (
    <tr
      class="asset-row"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <th scope="row">
        <span class="asset-name">{a.name}</span>
        {a.memo ? <small class="asset-memo">{a.memo}</small> : null}
      </th>
      <td>{a.kind}</td>
      <td>{ownerName(a.owner) || <span class="muted">-</span>}</td>
      <td class="num asset-amt">{a.amount == null ? <span class="muted">미정</span> : won(a.amount)}</td>
      <td class="asset-detail">
        {parts.join(' · ')} <MaturityBadge a={a} />
        {a.state === 'ended' ? (
          <span class="asset-endnote">
            {a.endReason ? END_REASON_LABEL[a.endReason] : '종료'} {a.endedOn ?? ''}
          </span>
        ) : null}
        <OverActions a={a} />
      </td>
      <td class="asset-cash">{a.inCash ? '현금' : ''}</td>
    </tr>
  );
}

function AssetCard({ a }: { a: Asset }) {
  const parts = detailParts(a);
  return (
    <div
      class="asset-card"
      role="button"
      tabIndex={0}
      onClick={() => openAssetEdit(a.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openAssetEdit(a.id);
        }
      }}
    >
      <span class="asset-card-top">
        <span class="asset-name">{a.name}</span>
        <span class="num asset-amt">{a.amount == null ? <span class="muted">미정</span> : `${won(a.amount)}원`}</span>
      </span>
      <span class="asset-card-sub">
        {[a.kind, ownerName(a.owner)].filter(Boolean).join(' · ')}
        {a.inCash ? <span class="asset-cash-tag">현금</span> : null}
      </span>
      {parts.length || maturityInfo(a, today.value) ? (
        <span class="asset-card-sub">
          {parts.join(' · ')} <MaturityBadge a={a} />
        </span>
      ) : null}
      {a.memo ? <span class="asset-memo">{a.memo}</span> : null}
      {a.state === 'ended' ? (
        <span class="asset-endnote">
          {a.endReason ? END_REASON_LABEL[a.endReason] : '종료'} {a.endedOn ?? ''}
        </span>
      ) : null}
      <OverActions a={a} />
    </div>
  );
}

function Group({ g, mobile }: { g: StateGroup; mobile: boolean }) {
  return (
    <section class="asset-group" data-state={g.state} aria-label={STATE_LABEL[g.state]}>
      <header class="asset-group-head">
        <h3>
          {STATE_LABEL[g.state]} <small class="num">{g.items.length}건</small>
        </h3>
        <span class="asset-group-sum num">
          {g.state === 'active' ? '합계 ' : '참고 합계 '}
          <b>{wonText(g.summary.total)}</b>
        </span>
      </header>
      {g.items.length === 0 ? (
        <p class="hint asset-empty">{STATE_LABEL[g.state]} 항목이 없습니다.</p>
      ) : (
        g.byCategory.map((c) => (
          <div class="asset-cat" key={c.category}>
            <h4>
              {categoryDef(c.category).label} <small class="num">{c.items.length}건</small>
              <span class="num asset-cat-sum">{c.summary.unknown === c.items.length ? '금액 미정' : wonText(c.summary.total)}</span>
            </h4>
            {mobile ? (
              <div class="asset-cards">
                {c.items.map((a) => (
                  <AssetCard key={a.id} a={a} />
                ))}
              </div>
            ) : (
              <div class="asset-table-wrap">
                <table class="asset-table">
                  <colgroup>
                    <col class="c-name" />
                    <col class="c-kind" />
                    <col class="c-owner" />
                    <col class="c-amt" />
                    <col />
                    <col class="c-cash" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>{categoryDef(c.category).nameLabel}</th>
                      <th>종류</th>
                      <th>소유자</th>
                      <th class="num">금액</th>
                      <th>세부</th>
                      <th>현금</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.items.map((a) => (
                      <AssetRow key={a.id} a={a} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

/** 맨 아래 접이식: 이력을 되짚어 만든 보유 총계·현금 총계의 변화 */
function TrendAccordion() {
  const live = new Set(assets.value.map((a) => a.id));
  const points = useMemo(
    () => buildTrend(assetLogs.value.filter((l) => live.has(l.assetId))),
    [assetLogs.value, assets.value],
  );
  const labels = points.map((p) => p.date.slice(2).replace(/-/g, '.'));
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const tips = (key: 'total' | 'cash'): Tip[] =>
    points.map((p) => ({ title: p.date, lines: [`${key === 'total' ? '보유 총계' : '현금 총계'} ${wonText(p[key])}`] }));
  return (
    <details class="acc asset-trend">
      <summary>총액 추이</summary>
      <div class="acc-body">
        {points.length < 2 ? (
          <p class="hint">
            금액이나 상태를 바꾼 날이 둘 이상 쌓이면 변화를 그래프로 볼 수 있습니다.
            {points.length === 1 ? ` (현재 ${points[0].date} 기준 보유 총계 ${wonText(points[0].total)})` : ''}
          </p>
        ) : (
          <>
            <p class="hint">변경 이력을 처음부터 되짚어 계산합니다. 금액·현금 포함·상태를 바꾼 날에만 점이 생기고, 완전 삭제한 항목은 빠집니다.</p>
            <h4 class="sub-h">보유 총계</h4>
            <LineChart values={points.map((p) => p.total)} labels={labels} tips={tips('total')} labelEvery={labelEvery} height={170} ariaLabel="보유 총계 변화 꺾은선 그래프" />
            <h4 class="sub-h">현금 총계</h4>
            <LineChart values={points.map((p) => p.cash)} labels={labels} tips={tips('cash')} labelEvery={labelEvery} height={170} color="var(--good)" ariaLabel="현금 총계 변화 꺾은선 그래프" />
          </>
        )}
      </div>
    </details>
  );
}

export function AssetsView() {
  const mobile = viewport.value === 'mobile';
  const all = assets.value;
  const active = useMemo(() => all.filter((a) => a.state === 'active'), [all]);
  const sum = summarize(active);
  const groups = groupByState(all, shown.value);
  const counts = (st: AssetState) => all.filter((a) => a.state === st).length;
  const updated = assetsUpdatedAt.value;

  return (
    <div class="assets-view">
     <Split
      resetKey={shown.value.join(",")}
      top={
       <>
      <div class="assets-head">
        <h2>재산상황</h2>
        <button type="button" class="btn primary" onClick={() => openAssetAdd()}>
          <Ui name="Plus" size={18} />
          항목 추가
        </button>
      </div>

      <div class="tiles">
        <div class="tile">
          <span class="tile-label">보유 총계</span>
          <strong class="tile-value"><span class="num">{wonText(sum.total)}</span></strong>
          <span class="tile-sub">보유 {sum.count}건 기준</span>
        </div>
        <div class="tile">
          <span class="tile-label">현금 총계</span>
          <strong class="tile-value"><span class="num">{wonText(sum.cash)}</span></strong>
          <span class="tile-sub">'현금 포함' 항목만</span>
        </div>
        <div class="tile">
          <span class="tile-label">최종 업데이트</span>
          <strong class="tile-value"><span class="num">{updated ? formatAt(updated) : '-'}</span></strong>
          <span class="tile-sub">항목을 바꾼 가장 최근 시각</span>
        </div>
      </div>
      {sum.unknown ? <p class="hint">금액이 미정인 보유 항목 {sum.unknown}건은 합계에서 빠져 있습니다.</p> : null}

      <div class="segmented asset-toggle" role="group" aria-label="표시할 상태">
        {STATE_ORDER.map((st) => (
          <button key={st} type="button" aria-pressed={shown.value.includes(st)} onClick={() => toggleState(st)}>
            {STATE_LABEL[st]} <span class="num">{counts(st)}</span>
          </button>
        ))}
      </div>
       </>
      }
     >
      {all.length === 0 ? (
        <Empty title="아직 등록한 재산 항목이 없습니다">
          <p>예금·보험·부동산 같은 재산을 등록하면 총계와 변경 이력을 볼 수 있습니다.</p>
          <button type="button" class="btn primary" onClick={() => openAssetAdd()}>
            첫 항목 추가
          </button>
        </Empty>
      ) : (
        groups.map((g) => <Group key={g.state} g={g} mobile={mobile} />)
      )}

      <TrendAccordion />
     </Split>
    </div>
  );
}

