import type { ComponentType } from 'preact';
import * as L from './lucide-subset';
import { initialOf, shortName } from '../lib/format';
import type { PayDetail, PayMethod, User } from '../lib/types';
import type { IconMode } from './viewport';
import { showPopover } from './overlay';
import { usersById } from '../store/store';

interface LucideProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  class?: string;
  'aria-hidden'?: 'true';
}

const REGISTRY = L as unknown as Record<string, ComponentType<LucideProps>>;

/** 설정의 아이콘 선택 목록 */
export const USER_ICON_CHOICES = [
  'User', 'UserRound', 'Smile', 'Baby', 'Glasses', 'GraduationCap', 'Briefcase', 'Backpack', 'School',
  'Crown', 'Star', 'Heart', 'Sparkles', 'Sun', 'Moon', 'Droplets', 'Flame', 'Leaf', 'Flower2', 'Cat',
  'Dog', 'PawPrint', 'Ghost', 'Rocket', 'Bike', 'Car', 'Music', 'Gamepad2', 'Coffee',
  'Users', 'UsersRound', 'House',
].map((n) => `lucide:${n}`);

export const PAY_ICON_CHOICES = [
  'Banknote', 'CreditCard', 'WalletCards', 'Wallet', 'Coins', 'CircleDollarSign', 'Smartphone', 'QrCode',
  'Nfc', 'Gift', 'Ticket', 'Landmark', 'PiggyBank', 'Receipt', 'BadgePercent', 'Building2', 'ShoppingCart',
].map((n) => `lucide:${n}`);

export const COLOR_CHOICES = [
  '#D1495B', '#E07A1F', '#E8A400', '#7A8B2E', '#2E9E6B', '#0F9D9A', '#2F7FB8', '#2338A0',
  '#6B5BD2', '#B5479B', '#8C6A3F', '#5B7083',
];

export function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  if (name.startsWith('emoji:')) {
    return (
      <span class="emoji" style={{ fontSize: `${size}px`, lineHeight: 1 }} aria-hidden="true">
        {name.slice(6)}
      </span>
    );
  }
  const C = REGISTRY[name.replace(/^lucide:/, '')];
  if (!C) return null;
  return <C size={size} color={color} strokeWidth={strokeWidth} aria-hidden="true" />;
}

/** UI 장식용 아이콘 (예: Ui name="Plus") */
export function Ui({ name, size = 18, class: cls }: { name: keyof typeof L; size?: number; class?: string }) {
  const C = REGISTRY[name as string];
  return C ? <C size={size} aria-hidden="true" class={cls} /> : null;
}

/* ───────── 사용자 ───────── */

export function userGlyph(u: Pick<User, 'type' | 'icon' | 'name'>): string | null {
  if (u.icon) return u.icon;
  return u.type === 'group' ? 'lucide:UsersRound' : null;
}

export function userDescription(u: User): { title: string; lines: string[] } {
  if (u.type === 'group') {
    const members = u.memberIds
      .map((id) => usersById.value.get(id)?.name)
      .filter((x): x is string => !!x);
    return { title: u.name, lines: [`그룹 · ${members.join(', ') || '구성원 없음'}`] };
  }
  return { title: u.name, lines: ['개인'] };
}

/** 아이콘(또는 이니셜) 원형 배지 */
export function UserGlyph({ user, size = 24 }: { user: User; size?: number }) {
  const glyph = userGlyph(user);
  return (
    <span
      class="glyph"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        color: user.color,
        background: `color-mix(in srgb, ${user.color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${user.color} 45%, transparent)`,
        fontSize: `${Math.round(size * 0.52)}px`,
      }}
      aria-hidden="true"
    >
      {glyph ? <Icon name={glyph} size={Math.round(size * 0.64)} /> : initialOf(user.name)}
    </span>
  );
}

export function UserBadge({ user, mode }: { user: User | null | undefined; mode: IconMode }) {
  if (!user) return <span class="muted">{mode === 'icon' ? '–' : '미지정'}</span>;
  const desc = userDescription(user);
  const label =
    mode === 'full' ? user.name : mode === 'short' ? shortName(user.name, 4) : null;
  if (mode === 'icon') {
    return (
      <button
        type="button"
        class="badge badge-btn"
        aria-label={`${desc.title} (${desc.lines[0]})`}
        onClick={(e) => {
          e.stopPropagation();
          showPopover(e.currentTarget, desc.title, desc.lines, user.color);
        }}
      >
        <UserGlyph user={user} size={26} />
      </button>
    );
  }
  return (
    <span class="badge" title={`${desc.title} · ${desc.lines[0]}`}>
      <UserGlyph user={user} size={24} />
      <span class="badge-name">{label}</span>
    </span>
  );
}

/* ───────── 지불수단·결제상세 ───────── */

export function PayGlyph({
  method,
  detail,
  size = 24,
}: {
  method: PayMethod;
  detail?: PayDetail | null;
  size?: number;
}) {
  // 모양은 지불수단 아이콘 그대로, 색만 결제상세(카드사)의 색을 따른다.
  const color = detail?.color ?? method.color;
  return (
    <span
      class="glyph glyph-pay"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
      aria-hidden="true"
    >
      <Icon name={method.icon} size={Math.round(size * 0.64)} />
    </span>
  );
}

export function PayBadge({
  method,
  detail,
  mode,
  showDetailInline = false,
}: {
  method: PayMethod | null | undefined;
  detail?: PayDetail | null;
  mode: IconMode;
  showDetailInline?: boolean;
}) {
  if (!method) return <span class="muted">–</span>;
  const text = detail ? `${method.name} · ${detail.name}` : method.name;
  if (mode === 'icon') {
    return (
      <button
        type="button"
        class="badge badge-btn"
        aria-label={text}
        onClick={(e) => {
          e.stopPropagation();
          showPopover(
            e.currentTarget,
            method.name,
            detail ? [detail.name] : [],
            detail?.color ?? method.color,
          );
        }}
      >
        <PayGlyph method={method} detail={detail} size={26} />
      </button>
    );
  }
  return (
    <span class="badge" title={text}>
      <PayGlyph method={method} detail={detail} size={24} />
      <span class="badge-name">
        {mode === 'short' ? shortName(method.name, 4) : method.name}
        {showDetailInline && detail ? <small class="detail-inline"> {detail.name}</small> : null}
      </span>
    </span>
  );
}

export function CategoryDot({ color }: { color?: string }) {
  return <span class="dot" style={{ background: color ?? 'var(--ink-3)' }} aria-hidden="true" />;
}
