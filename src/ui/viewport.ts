import { computed, signal } from '@preact/signals';
import { settings } from '../store/store';

export type Viewport = 'mobile' | 'tablet' | 'desktop';

function measure(): Viewport {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  return w <= 640 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
}

export const viewport = signal<Viewport>(measure());

if (typeof window !== 'undefined') {
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const v = measure();
      if (v !== viewport.value) viewport.value = v;
    });
  });
}

/** 사용자·지불수단 표시 방식: full=아이콘+이름, short=아이콘+짧은 이름, icon=아이콘만 */
export type IconMode = 'full' | 'short' | 'icon';

export const iconMode = computed<IconMode>(() => {
  const s = settings.value.iconMode;
  if (s === 'full') return 'full';
  if (s === 'icon') return 'icon';
  const v = viewport.value;
  return v === 'mobile' ? 'icon' : v === 'tablet' ? 'short' : 'full';
});
