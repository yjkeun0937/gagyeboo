/** 최근 검색어: 이 기기의 브라우저에만 저장하고, 동기화·백업에는 넣지 않는다 */
const KEY = 'gagyeboo.recentSearches';
const MAX = 8;

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

/** 맨 앞에 넣고(같은 말은 앞으로 옮김) 최대 개수를 지킨 새 목록을 돌려준다 */
export function pushRecent(term: string): string[] {
  const t = term.trim();
  if (!t) return loadRecent();
  const next = [t, ...loadRecent().filter((x) => x !== t)].slice(0, MAX);
  save(next);
  return next;
}

export function removeRecent(term: string): string[] {
  const next = loadRecent().filter((x) => x !== term);
  save(next);
  return next;
}

export function clearRecent(): string[] {
  save([]);
  return [];
}
