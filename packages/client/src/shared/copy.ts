import en from '@copy/en.json';

type Dict = { [k: string]: string | Dict };

/** All user-facing text lives in copy/en.json. t('feed.paused', { name: 'X' }) */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  let cur: string | Dict | undefined = en as unknown as Dict;
  for (const part of key.split('.')) cur = typeof cur === 'object' ? cur[part] : undefined;
  const s = typeof cur === 'string' ? cur : key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export const copy = en;
