import { useState } from 'preact/hooks';
import type { Category, ID, ListTableName, PayDetail, PayMethod, User } from '../lib/types';
import { uid } from '../lib/format';
import {
  canDelete,
  categoriesSorted,
  deleteItem,
  moveItem,
  nameTaken,
  nextOrder,
  payDetails,
  payDetailsSorted,
  payMethods,
  payMethodsSorted,
  categories,
  personsSorted,
  groupsSorted,
  save,
  showToast,
  usageOf,
  users,
  usersById,
} from '../store/store';
import {
  CategoryDot,
  COLOR_CHOICES,
  Icon,
  PAY_ICON_CHOICES,
  PayGlyph,
  Ui,
  USER_ICON_CHOICES,
  UserGlyph,
} from '../ui/icons';
import { listsTab, type ListsTab } from '../ui/nav';
import { askConfirm, Modal } from '../ui/overlay';

type ListTable = ListTableName;

/* ───────── 공통 입력 요소 ───────── */

function ColorPicker({
  value,
  onChange,
  others,
}: {
  value: string;
  onChange: (c: string) => void;
  others: string[];
}) {
  const dup = others.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div>
      <div class="swatches" role="radiogroup" aria-label="색상">
        {COLOR_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            class="swatch"
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <input
          type="color"
          class="swatch-input"
          value={value}
          aria-label="직접 고르기"
          onInput={(e) => onChange(e.currentTarget.value.toUpperCase())}
        />
      </div>
      {dup ? <p class="hint warn">같은 색을 쓰는 항목이 이미 있습니다. 구분이 어려울 수 있어요.</p> : null}
    </div>
  );
}

function IconPicker({
  value,
  choices,
  color,
  onChange,
  allowNone,
  noneLabel,
  otherIcons,
}: {
  value: string | null;
  choices: string[];
  color: string;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  otherIcons: (string | null)[];
}) {
  const [emoji, setEmoji] = useState(value?.startsWith('emoji:') ? value.slice(6) : '');
  const dup = value !== null && otherIcons.includes(value);
  return (
    <div>
      <div class="icon-grid" role="radiogroup" aria-label="아이콘">
        {allowNone ? (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            class="icon-choice"
            onClick={() => onChange(null)}
            title={noneLabel}
          >
            <span class="icon-none">Aa</span>
          </button>
        ) : null}
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c.replace('lucide:', '')}
            class="icon-choice"
            style={{ color }}
            onClick={() => onChange(c)}
          >
            <Icon name={c} size={20} />
          </button>
        ))}
      </div>
      <div class="inline-add">
        <label class="small-label" for="emoji-in">
          이모지로 지정
        </label>
        <input
          id="emoji-in"
          class="input emoji-input"
          value={emoji}
          maxLength={4}
          placeholder="🍚"
          onInput={(e) => {
            const v = e.currentTarget.value.trim();
            setEmoji(v);
            if (v) onChange(`emoji:${v}`);
          }}
        />
      </div>
      {allowNone && value === null && noneLabel ? <p class="hint">{noneLabel}</p> : null}
      {dup ? <p class="hint warn">같은 아이콘을 쓰는 항목이 이미 있습니다. 작은 화면에서 구분이 어려울 수 있어요.</p> : null}
    </div>
  );
}

function NameField({
  value,
  onChange,
  error,
  label = '이름',
}: {
  value: string;
  onChange: (v: string) => void;
  error: string;
  label?: string;
}) {
  return (
    <div class="field">
      <label for="le-name">{label}</label>
      <input
        id="le-name"
        class="input"
        value={value}
        maxLength={20}
        data-autofocus
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      {error ? <span class="field-error">{error}</span> : null}
    </div>
  );
}

/* ───────── 편집 대화상자 ───────── */

function UserEditor({
  initial,
  type,
  onClose,
}: {
  initial?: User;
  type: 'person' | 'group';
  onClose: () => void;
}) {
  const persons = personsSorted.value;
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
  const [color, setColor] = useState(
    initial?.color ?? COLOR_CHOICES[users.value.length % COLOR_CHOICES.length],
  );
  const [members, setMembers] = useState<ID[]>(initial?.memberIds ?? []);
  const [err, setErr] = useState('');
  const isGroup = type === 'group';
  const others = users.value.filter((u) => u.id !== initial?.id);

  const submit = async () => {
    const n = name.trim();
    if (!n) return setErr('이름을 입력해 주세요');
    if (nameTaken('users', n, initial?.id)) return setErr('이미 있는 이름입니다 (개인·그룹 통틀어 중복 불가)');
    if (isGroup && members.length < 2) return setErr('그룹에는 개인을 2명 이상 넣어야 합니다');
    const base: User = initial ?? {
      id: uid(),
      updatedAt: 0,
      name: n,
      type,
      memberIds: [],
      icon: null,
      color,
      order: nextOrder(users.value.filter((u) => u.type === type)),
    };
    await save('users', { ...base, name: n, icon, color, memberIds: isGroup ? members : [] });
    onClose();
  };

  return (
    <Modal
      title={`${isGroup ? '그룹' : '개인'} ${initial ? '수정' : '추가'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" class="btn primary" onClick={submit}>
            저장
          </button>
        </>
      }
    >
      <NameField value={name} onChange={(v) => { setName(v); setErr(''); }} error={err} />
      {isGroup ? (
        <div class="field">
          <span class="label">구성원 (개인 2명 이상)</span>
          {persons.length < 2 ? (
            <p class="hint warn">그룹을 만들려면 먼저 개인을 2명 이상 등록해야 합니다.</p>
          ) : null}
          <div class="chips">
            {persons.map((p) => (
              <button
                key={p.id}
                type="button"
                class="chip"
                aria-pressed={members.includes(p.id)}
                onClick={() => {
                  setMembers(members.includes(p.id) ? members.filter((x) => x !== p.id) : [...members, p.id]);
                  setErr('');
                }}
              >
                <UserGlyph user={p} size={20} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div class="field">
        <span class="label">아이콘</span>
        <IconPicker
          value={icon}
          choices={USER_ICON_CHOICES}
          color={color}
          onChange={setIcon}
          allowNone
          noneLabel={isGroup ? '지정하지 않으면 기본 그룹 아이콘' : '지정하지 않으면 이름의 첫 글자를 씁니다'}
          otherIcons={others.map((u) => u.icon)}
        />
      </div>
      <div class="field">
        <span class="label">색상</span>
        <ColorPicker value={color} onChange={setColor} others={others.map((u) => u.color)} />
      </div>
    </Modal>
  );
}

function PayMethodEditor({ initial, onClose }: { initial?: PayMethod; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? PAY_ICON_CHOICES[0]);
  const [color, setColor] = useState(initial?.color ?? COLOR_CHOICES[0]);
  const [err, setErr] = useState('');
  const others = payMethods.value.filter((p) => p.id !== initial?.id);
  const submit = async () => {
    const n = name.trim();
    if (!n) return setErr('이름을 입력해 주세요');
    if (nameTaken('payMethods', n, initial?.id)) return setErr('이미 있는 이름입니다');
    const base: PayMethod = initial ?? {
      id: uid(),
      updatedAt: 0,
      name: n,
      icon: icon ?? PAY_ICON_CHOICES[0],
      color,
      order: nextOrder(payMethods.value),
    };
    await save('payMethods', { ...base, name: n, icon: icon ?? PAY_ICON_CHOICES[0], color });
    onClose();
  };
  return (
    <Modal
      title={`지불수단 ${initial ? '수정' : '추가'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" class="btn primary" onClick={submit}>
            저장
          </button>
        </>
      }
    >
      <NameField value={name} onChange={(v) => { setName(v); setErr(''); }} error={err} />
      <div class="field">
        <span class="label">아이콘</span>
        <IconPicker
          value={icon}
          choices={PAY_ICON_CHOICES}
          color={color}
          onChange={setIcon}
          otherIcons={others.map((p) => p.icon)}
        />
      </div>
      <div class="field">
        <span class="label">색상</span>
        <ColorPicker value={color} onChange={setColor} others={others.map((p) => p.color)} />
      </div>
    </Modal>
  );
}

function PayDetailEditor({ initial, onClose }: { initial?: PayDetail; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [methodId, setMethodId] = useState<ID | null>(initial?.payMethodId ?? payMethodsSorted.value[0]?.id ?? null);
  const [color, setColor] = useState(initial?.color ?? COLOR_CHOICES[1]);
  const [err, setErr] = useState('');
  const method = payMethods.value.find((m) => m.id === methodId);
  const others = payDetails.value.filter((p) => p.id !== initial?.id);
  const submit = async () => {
    const n = name.trim();
    if (!n) return setErr('이름을 입력해 주세요');
    if (nameTaken('payDetails', n, initial?.id)) return setErr('이미 있는 이름입니다');
    const base: PayDetail = initial ?? {
      id: uid(),
      updatedAt: 0,
      name: n,
      payMethodId: methodId,
      color,
      order: nextOrder(payDetails.value),
    };
    await save('payDetails', { ...base, name: n, payMethodId: methodId, color });
    onClose();
  };
  return (
    <Modal
      title={`결제상세 ${initial ? '수정' : '추가'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" class="btn primary" onClick={submit}>
            저장
          </button>
        </>
      }
    >
      <NameField
        value={name}
        onChange={(v) => { setName(v); setErr(''); }}
        error={err}
        label="이름 (카드사·상품권 등)"
      />
      <div class="field">
        <span class="label">지불수단</span>
        <div class="chips">
          {payMethodsSorted.value.map((m) => (
            <button
              key={m.id}
              type="button"
              class="chip"
              aria-pressed={methodId === m.id}
              onClick={() => setMethodId(m.id)}
            >
              <PayGlyph method={m} size={20} />
              {m.name}
            </button>
          ))}
        </div>
        <p class="hint">모양은 지불수단의 아이콘을 따르고, 색만 다르게 정할 수 있습니다.</p>
      </div>
      <div class="field">
        <span class="label">색상</span>
        <ColorPicker value={color} onChange={setColor} others={others.map((p) => p.color)} />
        {method ? (
          <div class="preview">
            미리보기 <PayGlyph method={method} detail={{ color } as PayDetail} size={28} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function CategoryEditor({ initial, onClose }: { initial?: Category; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? COLOR_CHOICES[2]);
  const [err, setErr] = useState('');
  const others = categories.value.filter((c) => c.id !== initial?.id);
  const submit = async () => {
    const n = name.trim();
    if (!n) return setErr('이름을 입력해 주세요');
    if (nameTaken('categories', n, initial?.id)) return setErr('이미 있는 이름입니다');
    const base: Category = initial ?? {
      id: uid(),
      updatedAt: 0,
      name: n,
      color,
      order: nextOrder(categories.value),
    };
    await save('categories', { ...base, name: n, color });
    onClose();
  };
  return (
    <Modal
      title={`분류 ${initial ? '수정' : '추가'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" class="btn primary" onClick={submit}>
            저장
          </button>
        </>
      }
    >
      <NameField value={name} onChange={(v) => { setName(v); setErr(''); }} error={err} />
      <div class="field">
        <span class="label">색상</span>
        <ColorPicker value={color} onChange={setColor} others={others.map((c) => c.color)} />
      </div>
    </Modal>
  );
}

/* ───────── 목록 행 ───────── */

interface RowProps {
  table: ListTable;
  id: ID;
  hidden?: boolean;
  glyph: preact.ComponentChildren;
  title: string;
  meta?: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  unitLabel: string;
}

function ListRow(p: RowProps) {
  const used = usageOf(p.table, p.id);
  const deletable = canDelete(p.table, p.id);
  const toggleHidden = async () => {
    const all = (p.table === 'users' ? users.value : p.table === 'payMethods' ? payMethods.value : p.table === 'payDetails' ? payDetails.value : categories.value) as { id: ID; hidden?: boolean }[];
    const row = all.find((r) => r.id === p.id);
    if (row) await save(p.table, { ...row, hidden: !row.hidden } as never);
  };
  const remove = async () => {
    const ok = await askConfirm({
      title: `'${p.title}'을(를) 삭제할까요?`,
      message: '사용한 기록이 없어 삭제할 수 있습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (ok && (await deleteItem(p.table, p.id))) showToast('삭제했습니다');
  };
  return (
    <li class={`list-row ${p.hidden ? 'is-hidden' : ''}`}>
      <span class="lr-glyph">{p.glyph}</span>
      <button type="button" class="lr-main" onClick={p.onEdit} aria-label={`${p.title} 수정`}>
        <span class="lr-title">
          {p.title}
          {p.hidden ? <span class="pill pill-estimate">숨김</span> : null}
        </span>
        <small class="lr-meta">
          {p.meta ? `${p.meta} · ` : ''}
          {used > 0 ? `${p.unitLabel} ${used}건에서 사용 중` : '사용 기록 없음'}
        </small>
      </button>
      <span class="lr-actions">
        <button type="button" class="icon-btn" aria-label="위로" disabled={p.isFirst} onClick={() => moveItem(p.table, p.id, -1)}>
          <Ui name="ArrowUp" size={16} />
        </button>
        <button type="button" class="icon-btn" aria-label="아래로" disabled={p.isLast} onClick={() => moveItem(p.table, p.id, 1)}>
          <Ui name="ArrowDown" size={16} />
        </button>
        <button type="button" class="icon-btn" aria-label={p.hidden ? '다시 보이기' : '숨기기'} title={p.hidden ? '다시 보이기' : '입력 화면에서 숨기기'} onClick={toggleHidden}>
          <Ui name={p.hidden ? 'Eye' : 'EyeOff'} size={16} />
        </button>
        <button
          type="button"
          class="icon-btn danger-text"
          aria-label="삭제"
          disabled={!deletable}
          title={deletable ? '삭제' : '사용한 기록이 있어 삭제할 수 없습니다. 숨기기를 이용하세요'}
          onClick={remove}
        >
          <Ui name="Trash2" size={16} />
        </button>
      </span>
    </li>
  );
}

/* ───────── 목록 관리 화면 ───────── */

const TAB_LABEL: Record<ListsTab, string> = {
  users: '사용자',
  payMethods: '지불수단',
  payDetails: '결제상세',
  categories: '분류',
};

type EditorState =
  | { kind: 'user'; type: 'person' | 'group'; item?: User }
  | { kind: 'pay'; item?: PayMethod }
  | { kind: 'detail'; item?: PayDetail }
  | { kind: 'category'; item?: Category }
  | null;

export function ListsManager() {
  const tab = listsTab.value;
  const [editor, setEditor] = useState<EditorState>(null);
  const close = () => setEditor(null);

  const persons = personsSorted.value;
  const groups = groupsSorted.value;

  return (
    <div class="lists">
      <div class="subtabs" role="tablist" aria-label="목록 종류">
        {(Object.keys(TAB_LABEL) as ListsTab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} class="subtab" onClick={() => (listsTab.value = t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <>
          <p class="hint">
            먼저 <b>개인</b>을 등록하고, 여러 명이 함께 쓰는 경우 <b>그룹</b>을 만드세요. 그룹 금액은 구성원에게 나누지 않고 그룹 그대로 집계합니다.
          </p>
          <div class="list-head">
            <h3>개인</h3>
            <button type="button" class="btn small primary" onClick={() => setEditor({ kind: 'user', type: 'person' })}>
              <Ui name="Plus" size={16} />
              개인 추가
            </button>
          </div>
          {persons.length === 0 ? <p class="empty-line">등록된 개인이 없습니다.</p> : null}
          <ul class="list">
            {persons.map((u, i) => (
              <ListRow
                key={u.id}
                table="users"
                id={u.id}
                hidden={u.hidden}
                glyph={<UserGlyph user={u} size={30} />}
                title={u.name}
                isFirst={i === 0}
                isLast={i === persons.length - 1}
                unitLabel="내역"
                onEdit={() => setEditor({ kind: 'user', type: 'person', item: u })}
              />
            ))}
          </ul>
          <div class="list-head">
            <h3>그룹</h3>
            <button
              type="button"
              class="btn small primary"
              disabled={persons.length < 2}
              title={persons.length < 2 ? '개인을 2명 이상 등록해야 만들 수 있습니다' : undefined}
              onClick={() => setEditor({ kind: 'user', type: 'group' })}
            >
              <Ui name="Plus" size={16} />
              그룹 추가
            </button>
          </div>
          {persons.length < 2 ? <p class="hint">개인을 2명 이상 등록하면 그룹을 만들 수 있습니다.</p> : null}
          {groups.length === 0 && persons.length >= 2 ? <p class="empty-line">등록된 그룹이 없습니다.</p> : null}
          <ul class="list">
            {groups.map((u, i) => (
              <ListRow
                key={u.id}
                table="users"
                id={u.id}
                hidden={u.hidden}
                glyph={<UserGlyph user={u} size={30} />}
                title={u.name}
                meta={u.memberIds.map((id) => usersById.value.get(id)?.name).filter(Boolean).join(', ')}
                isFirst={i === 0}
                isLast={i === groups.length - 1}
                unitLabel="내역"
                onEdit={() => setEditor({ kind: 'user', type: 'group', item: u })}
              />
            ))}
          </ul>
        </>
      ) : null}

      {tab === 'payMethods' ? (
        <>
          <div class="list-head">
            <h3>지불수단</h3>
            <button type="button" class="btn small primary" onClick={() => setEditor({ kind: 'pay' })}>
              <Ui name="Plus" size={16} />
              추가
            </button>
          </div>
          <ul class="list">
            {payMethodsSorted.value.map((m, i, a) => (
              <ListRow
                key={m.id}
                table="payMethods"
                id={m.id}
                hidden={m.hidden}
                glyph={<PayGlyph method={m} size={30} />}
                title={m.name}
                isFirst={i === 0}
                isLast={i === a.length - 1}
                unitLabel="내역"
                onEdit={() => setEditor({ kind: 'pay', item: m })}
              />
            ))}
          </ul>
        </>
      ) : null}

      {tab === 'payDetails' ? (
        <>
          <p class="hint">카드사·상품권처럼 지불수단 아래의 세부 구분입니다. 모양은 지불수단과 같고 색만 다릅니다.</p>
          <div class="list-head">
            <h3>결제상세</h3>
            <button type="button" class="btn small primary" onClick={() => setEditor({ kind: 'detail' })}>
              <Ui name="Plus" size={16} />
              추가
            </button>
          </div>
          {payDetailsSorted.value.length === 0 ? <p class="empty-line">등록된 결제상세가 없습니다.</p> : null}
          <ul class="list">
            {payDetailsSorted.value.map((d, i, a) => {
              const m = payMethods.value.find((x) => x.id === d.payMethodId);
              return (
                <ListRow
                  key={d.id}
                  table="payDetails"
                  id={d.id}
                  hidden={d.hidden}
                  glyph={m ? <PayGlyph method={m} detail={d} size={30} /> : <CategoryDot color={d.color} />}
                  title={d.name}
                  meta={m?.name}
                  isFirst={i === 0}
                  isLast={i === a.length - 1}
                  unitLabel="내역"
                  onEdit={() => setEditor({ kind: 'detail', item: d })}
                />
              );
            })}
          </ul>
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <div class="list-head">
            <h3>분류</h3>
            <button type="button" class="btn small primary" onClick={() => setEditor({ kind: 'category' })}>
              <Ui name="Plus" size={16} />
              추가
            </button>
          </div>
          <ul class="list">
            {categoriesSorted.value.map((c, i, a) => (
              <ListRow
                key={c.id}
                table="categories"
                id={c.id}
                hidden={c.hidden}
                glyph={<CategoryDot color={c.color} />}
                title={c.name}
                isFirst={i === 0}
                isLast={i === a.length - 1}
                unitLabel="내역"
                onEdit={() => setEditor({ kind: 'category', item: c })}
              />
            ))}
          </ul>
        </>
      ) : null}

      {editor?.kind === 'user' ? <UserEditor type={editor.type} initial={editor.item} onClose={close} /> : null}
      {editor?.kind === 'pay' ? <PayMethodEditor initial={editor.item} onClose={close} /> : null}
      {editor?.kind === 'detail' ? <PayDetailEditor initial={editor.item} onClose={close} /> : null}
      {editor?.kind === 'category' ? <CategoryEditor initial={editor.item} onClose={close} /> : null}
    </div>
  );
}
