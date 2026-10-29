import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { compactWon, niceScale, won } from '../lib/format';
import { showPopover } from './overlay';

/** 차트 영역의 실제 너비(px). 글자 크기를 화면에 맞게 유지하려고 viewBox 대신 실제 크기로 그린다. */
export function useWidth(initial = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(200, Math.floor(el.clientWidth)));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface Tip {
  title: string;
  lines?: string[];
  swatch?: string;
}

/** 막대·점의 위쪽에 툴팁을 띄운다 (마우스는 올리면, 터치·키보드는 누르면). */
function tipAt(svg: SVGSVGElement | null, x: number, y: number, tip: Tip) {
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const anchor = {
    getBoundingClientRect: () =>
      ({
        left: r.left + x,
        width: 0,
        right: r.left + x,
        top: r.top + y - 12,
        bottom: r.top + y - 12,
        height: 0,
      }) as DOMRect,
  };
  showPopover(anchor as unknown as Element, tip.title, tip.lines ?? [], tip.swatch);
}

const hoverOnly = (fn: () => void) => (e: PointerEvent) => {
  if (e.pointerType === 'mouse') fn();
};

/* ───────── 막대(세로) ───────── */

export function ColumnChart({
  values,
  labels,
  tips,
  height = 200,
  labelEvery = 1,
  ariaLabel,
  color = 'var(--primary)',
  emphasize,
}: {
  values: number[];
  labels: string[];
  tips: Tip[];
  height?: number;
  labelEvery?: number;
  ariaLabel: string;
  color?: string;
  /** 눈에 띄게 할 막대의 위치 (나머지는 옅게) */
  emphasize?: number;
}) {
  const [ref, w] = useWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const L = 44;
  const R = 8;
  const T = 10;
  const B = 24;
  const pw = w - L - R;
  const ph = height - T - B;
  const max = Math.max(0, ...values);
  const { max: top, step } = niceScale(max, 4);
  const band = pw / Math.max(1, values.length);
  const bw = Math.min(24, Math.max(3, band * 0.7));
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const y = (v: number) => T + ph - (v / top) * ph;

  return (
    <div ref={ref} class="chart">
      <svg ref={svgRef} width={w} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke="var(--line)" stroke-width="1" />
            <text x={L - 6} y={y(v) + 4} text-anchor="end" class="chart-tick">
              {compactWon(v)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = L + band * i + band / 2;
          const h = (v / top) * ph;
          const x0 = cx - bw / 2;
          const y0 = T + ph - h;
          const r = Math.min(4, h, bw / 2);
          const show = () => tipAt(svgRef.current, cx, h > 0 ? y0 : T + ph, tips[i]);
          return (
            <g key={i}>
              {h > 0 ? (
                <path
                  d={`M${x0},${y0 + h} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} L${x0 + bw - r},${y0} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} L${x0 + bw},${y0 + h} Z`}
                  fill={color}
                  opacity={emphasize === undefined || emphasize === i ? 1 : 0.45}
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={cx} y={height - 6} text-anchor="middle" class="chart-tick">
                  {labels[i]}
                </text>
              ) : null}
              <rect
                x={L + band * i}
                y={T}
                width={band}
                height={ph + B - 4}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${tips[i].title} ${(tips[i].lines ?? []).join(' ')}`}
                onPointerEnter={hoverOnly(show)}
                onClick={show}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), show())}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ───────── 꺾은선 ───────── */

export function LineChart({
  values,
  labels,
  tips,
  height = 200,
  labelEvery = 1,
  ariaLabel,
  color = 'var(--primary)',
}: {
  values: number[];
  labels: string[];
  tips: Tip[];
  height?: number;
  labelEvery?: number;
  ariaLabel: string;
  color?: string;
}) {
  const [ref, w] = useWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const L = 44;
  const R = 14;
  const T = 12;
  const B = 24;
  const pw = w - L - R;
  const ph = height - T - B;
  const max = Math.max(0, ...values);
  const { max: top, step } = niceScale(max, 4);
  const n = values.length;
  const x = (i: number) => L + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
  const y = (v: number) => T + ph - (v / top) * ph;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`);
  const line = pts.length ? `M${pts.join(' L')}` : '';
  const area = pts.length ? `${line} L${x(n - 1)},${T + ph} L${x(0)},${T + ph} Z` : '';
  const last = n - 1;

  return (
    <div ref={ref} class="chart">
      <svg ref={svgRef} width={w} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke="var(--line)" stroke-width="1" />
            <text x={L - 6} y={y(v) + 4} text-anchor="end" class="chart-tick">
              {compactWon(v)}
            </text>
          </g>
        ))}
        {area ? <path d={area} fill={color} opacity="0.1" /> : null}
        {line ? (
          <path d={line} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ) : null}
        {values.map((v, i) => {
          const show = () => tipAt(svgRef.current, x(i), y(v), tips[i]);
          return (
            <g key={i}>
              {i % labelEvery === 0 ? (
                <text x={x(i)} y={height - 6} text-anchor="middle" class="chart-tick">
                  {labels[i]}
                </text>
              ) : null}
              {/* 끝점만 표시하고, 나머지 점은 올렸을 때만 보이게 해 선이 묻히지 않게 한다 */}
              {i === last ? (
                <circle cx={x(i)} cy={y(v)} r="4" fill={color} stroke="var(--surface)" stroke-width="2" />
              ) : null}
              <circle
                cx={x(i)}
                cy={y(v)}
                r="14"
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${tips[i].title} ${(tips[i].lines ?? []).join(' ')}`}
                onPointerEnter={hoverOnly(show)}
                onClick={show}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), show())}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ───────── 도넛 ───────── */

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  slices,
  center,
  ariaLabel,
}: {
  slices: DonutSlice[];
  center: ComponentChildren;
  ariaLabel: string;
}) {
  const size = 168;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const svgRef = useRef<SVGSVGElement>(null);
  let acc = 0;
  const GAP = 2;
  return (
    <div class="donut" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg ref={svgRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" stroke-width={stroke} />
        {total > 0
          ? slices.map((s, i) => {
              const len = (s.value / total) * c;
              const dash = Math.max(0, len - (slices.length > 1 ? GAP : 0));
              const offset = -acc;
              acc += len;
              const show = () => {
                const rect = svgRef.current?.getBoundingClientRect();
                if (!rect) return;
                const mid = (acc - len / 2) / c; // 0~1, 12시 방향부터 시계 방향
                const ang = mid * 2 * Math.PI - Math.PI / 2;
                const x = size / 2 + Math.cos(ang) * r;
                const y = size / 2 + Math.sin(ang) * r;
                tipAt(svgRef.current, x, y + 12, {
                  title: s.label,
                  lines: [`${won(s.value)}원 (${Math.round((s.value / total) * 1000) / 10}%)`],
                  swatch: s.color,
                });
              };
              return (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  stroke-width={stroke}
                  stroke-dasharray={`${dash} ${c - dash}`}
                  stroke-dashoffset={offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${s.label} ${won(s.value)}원`}
                  onPointerEnter={hoverOnly(show)}
                  onClick={show}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), show())}
                />
              );
            })
          : null}
      </svg>
      <div class="donut-center">{center}</div>
    </div>
  );
}

/* ───────── 순위 막대 목록 ───────── */

export interface RankItem {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: ComponentChildren;
  sub?: string;
  onClick?: () => void;
}

export function RankedBars({ items, total }: { items: RankItem[]; total: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul class="ranked">
      {items.map((it) => {
        const pct = total > 0 ? Math.round((it.value / total) * 1000) / 10 : 0;
        const inner = (
          <>
            <span class="rk-label">
              {it.icon ?? <span class="dot" style={{ background: it.color }} aria-hidden="true" />}
              <span class="rk-name">{it.label}</span>
              {it.sub ? <small class="muted">{it.sub}</small> : null}
            </span>
            <span class="rk-bar" aria-hidden="true">
              <span
                class="rk-fill"
                style={{ width: `${Math.max(1.5, (it.value / max) * 100)}%`, background: it.color }}
              />
            </span>
            <span class="rk-value num">{won(it.value)}</span>
            <span class="rk-pct num">{pct}%</span>
          </>
        );
        return (
          <li key={it.key}>
            {it.onClick ? (
              <button type="button" class="rk-row is-button" onClick={it.onClick}>
                {inner}
              </button>
            ) : (
              <div class="rk-row">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ───────── 누적 영역 (여러 계열을 위로·아래로 쌓음) ───────── */

export interface StackSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** 'down'이면 0 아래쪽으로 쌓는다. 값은 항상 양수로 주고, 축·라벨도 양수로 표시한다. */
  side?: 'up' | 'down';
}

/**
 * 엑셀의 '누적 영역형'과 같은 차트. 계열은 주어진 순서대로 0선에서 멀어지는 방향으로 쌓인다.
 * side가 'down'인 계열은 0 아래쪽(음수 영역)에 쌓이지만, 눈금·정점 표시·툴팁은 모두 양수 금액이다.
 * 색은 계열(분류)에 고정되어 있어, 선택이 바뀌어도 남은 계열의 색은 변하지 않는다.
 */
export function StackedAreaChart({
  series,
  labels,
  tipTitle,
  height = 240,
  ariaLabel,
}: {
  series: StackSeries[];
  labels: string[];
  tipTitle: (i: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, w] = useWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const ups = series.filter((s) => s.side !== 'down');
  const downs = series.filter((s) => s.side === 'down');
  const hasDown = downs.length > 0;
  const L = 44;
  const R = 30;
  const T = 24;
  const B = hasDown ? 44 : 24;
  const H = hasDown ? height + 60 : height;
  const pw = w - L - R;
  const ph = H - T - B;

  // 월별 누적 경계 (0선에서 바깥쪽으로 얼마나 쌓였는지, 양수)
  const stack = (list: StackSeries[]) => {
    const cum: number[][] = [];
    list.forEach((sr, si) => cum.push(sr.values.map((v, i) => (si === 0 ? 0 : cum[si - 1][i]) + v)));
    return cum;
  };
  const cumUp = stack(ups);
  const cumDown = stack(downs);
  const sums = (cum: number[][]) => labels.map((_, i) => (cum.length ? cum[cum.length - 1][i] : 0));
  const totalUp = sums(cumUp);
  const totalDown = sums(cumDown);
  const maxUp = Math.max(0, ...totalUp);
  const maxDown = Math.max(0, ...totalDown);
  // 위·아래가 같은 눈금 간격을 쓰되, 범위는 각각 따로 잡는다
  const { step } = niceScale(Math.max(maxUp, maxDown), hasDown ? 3 : 4);
  const topUp = maxUp > 0 || !hasDown ? Math.max(step, Math.ceil(maxUp / step - 1e-9) * step) : 0;
  const topDown = hasDown ? Math.max(step, Math.ceil(maxDown / step - 1e-9) * step) : 0;
  const span = topUp + topDown;
  /** signed: 위쪽은 +, 아래쪽은 − */
  const y = (v: number) => T + ph - ((v + topDown) / span) * ph;
  const x = (i: number) => L + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
  const ticks: number[] = [];
  for (let v = -topDown; v <= topUp + 1e-9; v += step) ticks.push(Math.round(v));
  const band = n <= 1 ? pw : pw / (n - 1);
  // 월 간격이 넓으면 정확한 금액, 좁으면 '만' 단위로 줄여 표시
  const fmtTotal = (v: number) => (band >= 64 ? won(v) : compactWon(v));
  // 정점 라벨은 큰 값부터 놓되, 이미 놓은 라벨과 가로로 겹치면 생략한다 (생략된 달은 툴팁으로 확인)
  const pickLabels = (totals: number[]) => {
    const shown = new Set<number>();
    const placed: [number, number][] = [];
    labels
      .map((_, i) => i)
      .filter((i) => totals[i] > 0)
      .sort((p, q) => totals[q] - totals[p])
      .forEach((i) => {
        const half = (fmtTotal(totals[i]).length * 6.4) / 2 + 3;
        const lo = x(i) - half;
        const hi = x(i) + half;
        if (placed.every(([a, b]) => hi < a || lo > b)) {
          placed.push([lo, hi]);
          shown.add(i);
        }
      });
    return shown;
  };
  const shownUp = pickLabels(totalUp);
  const shownDown = pickLabels(totalDown);
  const axisEvery = band < 40 ? 2 : 1;

  const path = (cum: number[][], si: number, sign: 1 | -1) => {
    const outer = cum[si].map((v, i) => `${x(i)},${y(sign * v)}`);
    const inner = (si === 0 ? labels.map(() => 0) : cum[si - 1]).map((v, i) => `${x(i)},${y(sign * v)}`).reverse();
    return `M${outer.join(' L')} L${inner.join(' L')} Z`;
  };

  const show = (i: number) => {
    setActive(i);
    const lines: string[] = [];
    ups
      .map((sr) => ({ sr, v: sr.values[i] }))
      .filter((r) => r.v > 0)
      .reverse() // 그래프에서 위에 있는 계열이 위에 오도록
      .forEach((r) => lines.push(`${r.sr.label} ${won(r.v)}원`));
    if (hasDown) {
      lines.push(`위쪽 합계 ${won(totalUp[i])}원`);
      downs
        .map((sr) => ({ sr, v: sr.values[i] }))
        .filter((r) => r.v > 0)
        .forEach((r) => lines.push(`${r.sr.label} ${won(r.v)}원`));
      lines.push(`아래쪽 합계 ${won(totalDown[i])}원`);
    } else {
      lines.push(`합계 ${won(totalUp[i])}원`);
    }
    tipAt(svgRef.current, x(i), y(totalUp[i]), { title: tipTitle(i), lines });
  };

  return (
    <div ref={ref} class="chart">
      <svg ref={svgRef} width={w} height={H} role="img" aria-label={ariaLabel} onPointerLeave={() => setActive(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={w - R}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 && hasDown ? 'var(--ink-3)' : 'var(--line)'}
              stroke-width={v === 0 && hasDown ? 1.5 : 1}
            />
            <text x={L - 6} y={y(v) + 4} text-anchor="end" class="chart-tick">
              {compactWon(Math.abs(v))}
            </text>
          </g>
        ))}
        {ups.map((sr, si) => (
          <path
            key={sr.key}
            d={path(cumUp, si, 1)}
            fill={sr.color}
            fill-opacity="0.9"
            stroke="var(--surface)"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        ))}
        {downs.map((sr, si) => (
          <path
            key={sr.key}
            d={path(cumDown, si, -1)}
            fill={sr.color}
            fill-opacity="0.9"
            stroke="var(--surface)"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        ))}
        {active !== null ? (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={T}
            y2={T + ph}
            stroke="var(--ink)"
            stroke-width="1"
            stroke-dasharray="3 3"
          />
        ) : null}
        {labels.map((l, i) => (
          <g key={i}>
            {shownUp.has(i) ? (
              <text x={x(i)} y={y(totalUp[i]) - 7} text-anchor="middle" class="chart-val">
                {fmtTotal(totalUp[i])}
              </text>
            ) : null}
            {shownDown.has(i) ? (
              <text x={x(i)} y={y(-totalDown[i]) + 15} text-anchor="middle" class="chart-val is-down">
                {fmtTotal(totalDown[i])}
              </text>
            ) : null}
            {i % axisEvery === 0 ? (
              <text x={x(i)} y={H - 6} text-anchor="middle" class="chart-tick">
                {l}
              </text>
            ) : null}
            <rect
              x={x(i) - band / 2}
              y={T}
              width={band}
              height={ph + B - 4}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${tipTitle(i)} ${hasDown ? `위쪽 합계 ${won(totalUp[i])}원, 아래쪽 합계 ${won(totalDown[i])}원` : `합계 ${won(totalUp[i])}원`}`}
              onPointerEnter={hoverOnly(() => show(i))}
              onClick={() => show(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), show(i))}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
