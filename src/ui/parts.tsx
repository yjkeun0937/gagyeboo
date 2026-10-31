import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
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

/**
 * 위쪽 조작 영역(top)과 아래쪽 목록(children)을 나눈다.
 * 데스크탑에서는 위쪽은 고정하고 아래쪽만 스크롤되며, 위쪽을 조작해 resetKey가 바뀌면 아래쪽을 맨 위로 되돌린다.
 * 데스크탑이 아니면 그냥 이어 붙인 것과 같다(쪽 전체가 스크롤).
 */
export function Split({ top, children, resetKey }: { top: ComponentChildren; children: ComponentChildren; resetKey?: string }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [resetKey]);
  return (
    <div class="split">
      <div class="split-top">{top}</div>
      <div class="split-body" ref={body}>
        {children}
      </div>
    </div>
  );
}
