import type { EntryStatus } from '../lib/calc';

/** 사용처 앞에 붙는 알약: 보류(집계 제외) · 예정(집계 포함) · 예상(금액 미확정) */
export function Pills({ status, estimate }: { status: EntryStatus; estimate?: boolean }) {
  return (
    <>
      {status === 'pending' ? (
        <span class="pill pill-pending" title="지정일 전이라 집계에서 제외됩니다">
          보류
        </span>
      ) : null}
      {status === 'scheduled' ? (
        <span class="pill pill-scheduled" title="오늘 이후 날짜의 내역입니다 (집계에 포함)">
          예정
        </span>
      ) : null}
      {estimate ? (
        <span class="pill pill-estimate" title="금액이 확정되지 않았습니다">
          예상
        </span>
      ) : null}
    </>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: preact.ComponentChildren;
}) {
  return (
    <div class="empty">
      <p class="empty-title">{title}</p>
      {children ? <div class="empty-body">{children}</div> : null}
    </div>
  );
}
