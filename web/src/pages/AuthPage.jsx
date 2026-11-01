import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';
import { Instagram, Globe } from 'lucide-react';
import ForgeMindLogo from '../components/ForgeMindLogo.jsx';

export default function AuthPage({ mode, onDone, offline, demo, links }) {
  const setup = mode === 'setup';
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(offline ? 'The server is not answering. Check that Open Forge AI is running.' : '');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.post(setup ? '/auth/setup' : '/auth/login', f); onDone(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="authwrap floor">
      <form className="card authcard fa-sheet-in" onSubmit={submit} data-testid={setup ? 'setup-form' : 'login-form'}>
        <div style={{ width: 88, height: 88, margin: '0 auto 6px' }}><ForgeMindLogo /></div>
        <h1 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
          {setup ? 'Welcome to Open Forge AI' : 'Sign in to Open Forge AI'}
        </h1>
        <p className="sec" style={{ textAlign: 'center', margin: '0 0 20px', lineHeight: 1.5 }}>
          {setup ? 'Create the first account. It becomes the admin of this install — there is no default password.' : 'Your self-hosted assistant for tasks, calendar, mail and chats.'}
        </p>
        {!setup && demo && (
          <div className="banner info" style={{ marginBottom: 16 }} data-testid="demo-login">
            <strong>Demo login</strong><br />
            Email: <span className="mono">{demo.email}</span><br />
            Password: <span className="mono">{demo.password}</span>
            <div style={{ marginTop: 8 }}><button type="button" className="btn sm" onClick={() => setF({ ...f, email: demo.email, password: demo.password })}>Fill in for me</button></div>
          </div>
        )}
        {setup && (
          <div className="field"><label className="label" htmlFor="name">Your name</label>
            <input id="name" className="input" value={f.name} onChange={set('name')} autoComplete="name" required /></div>
        )}
        <div className="field"><label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></div>
        <div className="field"><label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} required />
          {setup && <div className="hint">At least 8 characters.</div>}</div>
        {err && <div className="banner err" style={{ marginBottom: 12 }}>{err}</div>}
        <button className="btn primary" style={{ width: '100%', padding: 12 }} disabled={busy}>
          {busy && <Loader2 size={16} className="spin" />}{setup ? 'Create admin account' : 'Sign in'}
        </button>
        {links && (
          <div className="row" style={{ justifyContent: 'center', gap: 14, marginTop: 16, fontSize: 12.5 }}>
            <span className="muted">by Forgemind AI</span>
            <a href={links.website} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}><Globe size={13} />forgemind.in</a>
            <a href={links.instagram} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}><Instagram size={13} />@forgemind_ai</a>
          </div>
        )}
      </form>
    </div>
  );
}
