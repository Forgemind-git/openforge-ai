import { useEffect, useState, useCallback } from 'react';
import { Settings as SettingsIcon, Sun, Moon, LogOut, Loader2 } from 'lucide-react';
import { api } from './api';
import { useTheme } from './lib/util';
import AuthPage from './pages/AuthPage.jsx';
import Office from './pages/Office.jsx';
import SettingsPage from './pages/Settings.jsx';

const theme = useTheme();

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [pref, setPref] = useState(theme.get());
  const hash = useHash();

  useEffect(() => { theme.apply(pref); }, [pref]);
  useEffect(() => {
    if (pref !== 'system' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => theme.apply('system');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [pref]);

  const load = useCallback(() => api.get('/auth/status').then(setBoot).catch(() => setBoot({ needsSetup: false, user: null, offline: true })), []);
  useEffect(() => { load(); }, [load]);

  if (!boot) return <div className="authwrap"><Loader2 className="spin" /></div>;
  if (!boot.user) return <AuthPage mode={boot.needsSetup ? 'setup' : 'login'} onDone={load} offline={boot.offline} />;

  const route = hash.replace(/^#\/?/, '').split('/');
  const page = route[0] === 'settings' ? 'settings' : 'office';
  const isDark = document.documentElement.dataset.theme === 'dark';

  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand" style={{ color: '#fff', textDecoration: 'none' }}>
          <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 54 19v26L32 58 10 45V19z" fill="none" stroke="#dc2626" strokeWidth="5" /><rect x="21" y="26" width="8" height="12" rx="2" fill="#fff" /><rect x="35" y="26" width="8" height="12" rx="2" fill="#fff" /></svg>
          <span>Open</span><span className="tag">Forge</span>
        </a>
        <nav className="navpills" aria-label="Main">
          <a href="#/" className={page === 'office' ? 'on' : ''}>Assistant</a>
          <a href="#/settings" className={page === 'settings' ? 'on' : ''}>Settings</a>
        </nav>
        <span className="who" style={{ marginLeft: page === 'office' ? 0 : 'auto' }}>{boot.user.name}</span>
        <button className="tbtn" title={isDark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme" onClick={() => setPref(isDark ? 'light' : 'dark')}>
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <a className="tbtn" href="#/settings" title="Settings" aria-label="Settings"><SettingsIcon size={17} /></a>
        <button className="tbtn" title="Sign out" aria-label="Sign out" onClick={async () => { await api.post('/auth/logout'); load(); }}><LogOut size={17} /></button>
      </header>
      {page === 'settings'
        ? <SettingsPage user={boot.user} section={route[1] || 'model'} onUserChange={load} />
        : <Office user={boot.user} />}
    </>
  );
}
