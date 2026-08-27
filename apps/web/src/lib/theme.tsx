import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  /** تم واقعی اعمال‌شده پس از حل کردن `system` */
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'darin:theme';

/**
 * حالت روشن و تیره (قانون ۵۸).
 *
 * ترجیح در `localStorage` ذخیره می‌شود. حالت `system` از تنظیم سیستم‌عامل
 * پیروی می‌کند — بسیاری از کاربران شب‌ها سیستمشان خودکار تیره می‌شود و
 * انتظار دارند برنامه هم همراهی کند.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {
      // localStorage در حالت ناشناس مرورگر ممکن است خطا بدهد
    }
    return 'system';
  });

  const [systemDark, setSystemDark] = React.useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    // رنگ نوار مرورگر موبایل با تم هماهنگ می‌شود
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0f1218' : '#1e40af');
  }, [resolved]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ذخیره نشدن ترجیح نباید برنامه را بشکند
    }
  }, []);

  const value = React.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme باید داخل ThemeProvider استفاده شود.');
  return context;
}
