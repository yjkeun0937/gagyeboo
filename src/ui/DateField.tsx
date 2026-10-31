import { useEffect, useRef, useState } from 'preact/hooks';
import { completeOnTab, typeDate } from '../lib/dateinput';
import { isValidYmd } from '../lib/dates';
import { Ui } from './icons';

/**
 * 날짜 입력창 (YYYY-MM-DD).
 * 숫자만 쳐도 하이픈이 자동으로 들어가고, 연도 4자리를 치면 월로, 월 2자리를 치면 일로 넘어간다.
 * 연도를 2자리만 치고 Tab을 누르면 20xx로 바꿔 월로 넘어간다. 오른쪽 달력 버튼으로 고를 수도 있다.
 */
export function DateField({
  id,
  value,
  onChange,
  label,
  autoFocus,
  strict,
  class: cls,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
  /** true면 완성된 올바른 날짜(또는 빈 칸)가 될 때만 onChange를 부른다. 치는 도중의 글자는 이 칸 안에만 남는다 (필터·기간 칸용) */
  strict?: boolean;
  class?: string;
}) {
  const [typed, setTyped] = useState(value);
  const committed = useRef(value);
  // 밖에서 값이 바뀌면(프리셋 버튼 등) 보이는 글자도 따라간다
  useEffect(() => {
    if (strict && value !== committed.current) {
      committed.current = value;
      setTyped(value);
    }
  }, [value, strict]);
  const shown = strict ? typed : value;
  const emit = (next: string) => {
    if (!strict) return onChange(next);
    setTyped(next);
    if (next === '' || isValidYmd(next)) {
      committed.current = next;
      onChange(next);
    }
  };
  const textRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const apply = (el: HTMLInputElement, next: string) => {
    if (el.value !== next) el.value = next;
    // 입력 중에 가운데를 고치는 경우가 아니면 커서는 항상 끝
    el.setSelectionRange(next.length, next.length);
    emit(next);
  };

  return (
    <div class={`date-field ${cls ?? ''}`}>
      <input
        id={id}
        ref={textRef}
        class="input num"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        aria-label={label}
        autoFocus={autoFocus}
        value={shown}
        onInput={(e) => {
          const el = e.currentTarget;
          const deleting = ((e as InputEvent).inputType ?? '').startsWith('delete');
          apply(el, typeDate(el.value, deleting));
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || e.shiftKey) return;
          const el = e.currentTarget;
          const r = completeOnTab(el.value);
          if (!r) return;
          if (r.stay) e.preventDefault();
          apply(el, r.text);
        }}
      />
      <button
        type="button"
        class="icon-btn date-pick"
        aria-label="달력에서 고르기"
        tabIndex={-1}
        onClick={() => {
          const p = pickRef.current;
          if (!p) return;
          try {
            p.showPicker();
          } catch {
            p.focus();
            p.click();
          }
        }}
      >
        <Ui name="CalendarDays" size={18} />
      </button>
      <input
        ref={pickRef}
        class="date-native"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={isValidYmd(shown) ? shown : ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v) {
            emit(v);
            textRef.current?.focus();
          }
        }}
      />
    </div>
  );
}
