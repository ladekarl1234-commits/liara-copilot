'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'liara-theme';

/** Light/dark toggle. Default is "system" (no data-theme; follows the OS). The
 * toggle sets an explicit theme (persisted) that overrides the OS preference. */
export function useTheme() {
  // effectiveDark = what the user currently sees (explicit choice, else OS)
  const [effectiveDark, setEffectiveDark] = useState(false);

  const compute = useCallback(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* storage blocked */
    }
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, []);

  useEffect(() => {
    setEffectiveDark(compute());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // only follow the OS while no explicit choice is stored
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        /* ignore */
      }
      if (stored !== 'light' && stored !== 'dark') setEffectiveDark(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [compute]);

  const toggle = useCallback(() => {
    const next = effectiveDark ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('data-theme', next);
    setEffectiveDark(next === 'dark');
  }, [effectiveDark]);

  return { effectiveDark, toggle };
}
