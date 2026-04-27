import { useEffect, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';

export type ResolvedTheme = 'light' | 'dark';

export function useTheme(): ResolvedTheme {
  const settings = useSettingsStore((s) => s.settings);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const wanted = settings?.theme ?? 'auto';
  if (wanted === 'light') return 'light';
  if (wanted === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}
