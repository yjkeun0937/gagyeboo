import { entryStatus } from '../lib/calc';
import { won } from '../lib/format';
import type { Entry } from '../lib/types';
import {
  categoriesById,
  payDetailsById,
  payMethodsById,
  usersById,
} from '../store/store';
import { CategoryDot, PayBadge, UserBadge } from '../ui/icons';
import { openEdit } from '../ui/nav';
import { Pills } from '../ui/parts';

/** 검색어와 같은 부분을 강조해서 보여 준다 */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const out: preact.ComponentChildren[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(ql, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

export function rowKey(e: KeyboardEvent, entry: Entry) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openEdit(entry);
  }
}

export function EntryCard({ e, t, query, dateText }: { e: Entry; t: string; query: string; dateText?: string }) {
  const st = entryStatus(e, t);
  const cat = e.category ? categoriesById.value.get(e.category) : undefined;
  const pay = e.payMethod ? payMethodsById.value.get(e.payMethod) : undefined;
  const det = e.payDetail ? payDetailsById.value.get(e.payDetail) : undefined;
  const u = e.user ? usersById.value.get(e.user) : undefined;
  return (
    <div
      class={`card st-${st}`}
      role="button"
      tabIndex={0}
      onClick={() => openEdit(e)}
      onKeyDown={(ev) => rowKey(ev, e)}
    >
      <div class="card-l1">
        <span class="card-store">
          <Pills status={st} estimate={e.isEstimate} />
          <span class="store-text">
            <Hl text={e.store || e.memo || '(내용 없음)'} q={query} />
          </span>
        </span>
        <span class="num amt">{won(e.amount)}</span>
      </div>
      <div class="card-l2">
        {dateText ? <span class="card-date">{dateText}</span> : null}
        <CategoryDot color={cat?.color} />
        <span class="cat-text">{cat?.name ?? '미분류'}</span>
        {e.store && e.memo ? (
          <span class="memo-text">
            · <Hl text={e.memo} q={query} />
          </span>
        ) : null}
        <span class="grow" />
        <UserBadge user={u} mode="icon" />
        <PayBadge method={pay} detail={det} mode="icon" />
      </div>
    </div>
  );
}

