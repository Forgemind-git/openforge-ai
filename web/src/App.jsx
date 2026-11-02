import { useEffect, useState, useCallback, useMemo } from 'react';
import { Sun, Moon, LogOut, Loader2, Instagram, Globe, FlaskConical, Github, Star } from 'lucide-react';
import { api } from './api';
import { useTheme } from './lib/util';
import { ApiContext } from './lib/apiContext';
import { demoApi, resetDemo } from './lib/demo';
import AuthPage from './pages/AuthPage.jsx';
import Office from './pages/Office.jsx';
import SettingsPage from './pages/Settings.jsx';

const theme = useTheme();
const LINKS = { instagram: 'https://www.instagram.com/forgemind_ai/', website: 'https://forgemind.in/' };
const DEMO_KEY = 'openforge.demo';
const readDemo = () => { try { const v = localStorage.getItem(DEMO_KEY); return v == null ? null : v === '1'; } catch { return null; } };

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function Brand({ size = 30 }) {
  return (
    <span className="brand">
      <img src="/forgemind-logo.svg" alt="" width={size} height={size} />
      <span className="brand-name">Open Forge</span><span className="tag">AI</span>
    </span>
  );
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [pref, setPref] = useState(theme.get());
  const [demo, setDemo] = useState(readDemo());
  const hash = useHash();
  const [meta, setMeta] = useState(null);
  useEffect(() => { api.get('/meta').then(setMeta).catch(() => {}); }, []);

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

  // First visit: show the demo until something real is connected. After that the
  // person's own choice (the Demo switch) is remembered in this browser.
  useEffect(() => {
    if (!boot?.user || demo !== null) return;
    api.get('/office/status').then(s => setDemo(!(s.model || s.google || s.whatsapp || s.telegram))).catch(() => setDemo(false));
  }, [boot, demo]);

  const ctx = useMemo(() => ({ api: demo ? demoApi : api, demo: !!demo }), [demo]);
  const toggleDemo = () => { const v = !demo; if (v) resetDemo(); setDemo(v); try { localStorage.setItem(DEMO_KEY, v ? '1' : '0'); } catch { /* */ } };

  if (!boot) return <div className="authwrap"><Loader2 className="spin" /></div>;
  if (!boot.user) return <AuthPage mode={boot.needsSetup ? 'setup' : 'login'} onDone={load} offline={boot.offline} demo={boot.demoLogin} links={LINKS} />;

  const route = hash.replace(/^#\/?/, '').split('/');
  const page = route[0] === 'settings' ? 'settings' : 'office';
  const isDark = document.documentElement.dataset.theme === 'dark';

  return (
    <ApiContext.Provider value={ctx}>
      <header className="topbar">
        <a href="#/" className="brand-link" aria-label="Open Forge AI home"><Brand /></a>
        <nav className="navpills" aria-label="Main">
          <a href="#/" className={page === 'office' ? 'on' : ''}>Assistant</a>
          <a href="#/settings" className={page === 'settings' ? 'on' : ''}>Settings</a>
        </nav>
        <div className="tright">
          <button className={`demo-switch ${demo ? 'on' : ''}`} onClick={toggleDemo} role="switch" aria-checked={!!demo} title="Show sample data so you can see every card working" data-testid="demo-switch">
            <FlaskConical size={15} /><span>Demo</span><span className="knob" />
          </button>
          {meta?.url && (
            <a className="gh-star" href={meta.url} target="_blank" rel="noreferrer" title={meta.stars != null ? `Star Open Forge AI on GitHub — ${meta.stars} ${meta.stars === 1 ? 'star' : 'stars'}${meta.starsCheckedAt ? `, checked ${new Date(meta.starsCheckedAt).toLocaleString()}` : ''}` : 'Star Open Forge AI on GitHub'} data-testid="gh-star">
              <Github size={15} /><span className="gh-label">Star</span>
              {meta.stars != null && <span className="gh-count" data-testid="gh-count"><Star size={12} />{meta.stars >= 1000 ? `${(meta.stars / 1000).toFixed(1)}k` : meta.stars}</span>}
            </a>
          )}
          <span className="tsep" />
          <a className="tbtn" href={LINKS.instagram} target="_blank" rel="noreferrer" title="Forgemind AI on Instagram" aria-label="Instagram"><Instagram size={17} /></a>
          <a className="tbtn" href={LINKS.website} target="_blank" rel="noreferrer" title="forgemind.in" aria-label="Website"><Globe size={17} /></a>
          <button className="tbtn" title={isDark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme" onClick={() => setPref(isDark ? 'light' : 'dark')}>
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <span className="tsep" />
          <span className="who" title={boot.user.email}>{boot.user.name}</span>
          <button className="tbtn" title="Sign out" aria-label="Sign out" onClick={async () => { await api.post('/auth/logout'); load(); }}><LogOut size={17} /></button>
        </div>
      </header>
      {page === 'settings'
        ? <SettingsPage user={boot.user} section={route[1] || 'model'} onUserChange={load} />
        : <Office user={boot.user} />}
    </ApiContext.Provider>
  );
}
