import { useEffect, useState } from 'react';
import { Bot, AudioLines, Chrome, MessageCircle, Send, UserRound, Users, Loader2, CheckCircle2, AlertCircle, Plug, Trash2, KeyRound } from 'lucide-react';
import { api } from '../api';
import { CopyBox } from '../components/ui.jsx';

const SECTIONS = [
  { id: 'model', label: 'Model', icon: Bot },
  { id: 'voice', label: 'Voice', icon: AudioLines },
  { id: 'google', label: 'Google', icon: Chrome },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'telegram', label: 'Telegram', icon: Send },
  { id: 'account', label: 'Account', icon: UserRound },
];

function Status({ ok, warn, children }) {
  return <span className={`pill ${ok ? 'green' : warn ? 'amber' : ''}`}>{ok ? <CheckCircle2 size={12} /> : warn ? <AlertCircle size={12} /> : null}{children}</span>;
}
function SecretField({ label, id, value, onChange, mask, placeholder, hint }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={mask?.set ? `Saved ••••${mask.last4} — paste a new one to replace it` : placeholder} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
function useSave(setView) {
  const [st, setSt] = useState({ busy: false, err: '', ok: '' });
  const run = async (fn, ok = 'Saved.') => {
    setSt({ busy: true, err: '', ok: '' });
    try { const v = await fn(); if (v) setView(v); setSt({ busy: false, err: '', ok }); return v; }
    catch (e) { setSt({ busy: false, err: e.message, ok: '' }); return null; }
  };
  const Msg = () => (st.err ? <div className="banner err" style={{ marginBottom: 12 }}>{st.err}</div> : st.ok ? <div className="banner ok" style={{ marginBottom: 12 }}>{st.ok}</div> : null);
  return [st, run, Msg];
}

function ModelSection({ v, setView }) {
  const [provider, setProvider] = useState(v.provider || 'anthropic');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(v.model || '');
  const [models, setModels] = useState([]);
  const [st, run, Msg] = useSave(setView);
  useEffect(() => { if (v.apiKey.set && v.provider === provider) api.get('/settings/model/models').then(r => setModels(r.models || [])).catch(() => {}); }, [v.apiKey.set, v.provider, provider]);
  const list = [...new Set([...(models.length && v.provider === provider ? models : []), ...(v.defaults?.[provider] || [])])];
  const same = v.provider === provider;
  return (
    <>
      <p className="lead">The brain of your assistant. Pick a provider, paste your own API key and choose a model. The key is encrypted on this server and never shown again.</p>
      <div className="field"><label className="label">Provider</label>
        <div className="seg">{[['anthropic', 'Anthropic'], ['openai', 'OpenAI']].map(([k, l]) => <button key={k} type="button" className={provider === k ? 'on' : ''} onClick={() => { setProvider(k); if (k !== v.provider) setModel(''); }}>{l}</button>)}</div>
      </div>
      <SecretField id="model-key" label={`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`} value={key} onChange={setKey} mask={same ? v.apiKey : null}
        placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'} hint={provider === 'openai' ? <>Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.</> : <>Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</>} />
      <div className="field"><label className="label" htmlFor="model-name">Model</label>
        <input id="model-name" className="input" list="model-list" value={model} placeholder={v.defaults?.[provider]?.[0]} onChange={(e) => setModel(e.target.value)} />
        <datalist id="model-list">{list.map(m => <option key={m} value={m} />)}</datalist>
        <div className="hint">Any model id your key can use. Saving checks the key with the provider.</div>
      </div>
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || (!key && !(same && v.apiKey.set))} onClick={() => run(async () => { const r = await api.put('/settings/model', { provider, apiKey: key || undefined, model: model || undefined }); setKey(''); if (r.models) setModels(r.models); return r; }, 'Key checked and saved.')}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}Save & test</button>
        {v.apiKey.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/model'), 'Removed.')}><Trash2 size={14} />Remove</button>}
      </div>
    </>
  );
}

function VoiceSection({ v, setView }) {
  const [key, setKey] = useState('');
  const [f, setF] = useState({ model: v.model, voice: v.voice, language: v.language });
  const [st, run, Msg] = useSave(setView);
  return (
    <>
      <p className="lead">Talk mode uses <strong>Gemini Live</strong> for real-time voice. Your microphone audio is streamed through this server to Google with your own key; the assistant uses the same tools as in chat and still only prepares drafts.</p>
      <SecretField id="gemini-key" label="Gemini API key" value={key} onChange={setKey} mask={v.apiKey} placeholder="AIza…" hint={<>Create one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.</>} />
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="live-model">Live model</label>
          <input id="live-model" className="input" list="live-models" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          <datalist id="live-models"><option value="gemini-3.1-flash-live-preview" /><option value="gemini-2.5-flash-native-audio-preview-09-2025" /><option value="gemini-live-2.5-flash-preview" /></datalist>
          <div className="hint">Must be a Gemini model that supports the Live API.</div></div>
        <div className="field"><label className="label" htmlFor="live-voice">Voice</label>
          <select id="live-voice" className="select" value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })}>{(v.voices || []).map(x => <option key={x}>{x}</option>)}</select></div>
      </div>
      <div className="field"><label className="label" htmlFor="live-lang">Spoken language</label>
        <input id="live-lang" className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} placeholder="English" /></div>
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || (!key && !v.apiKey.set)} onClick={() => run(async () => { const r = await api.put('/settings/voice', { ...f, apiKey: key || undefined }); setKey(''); return r; })}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}Save</button>
        {v.apiKey.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/voice'), 'Removed.')}><Trash2 size={14} />Remove</button>}
      </div>
    </>
  );
}

function GoogleSection({ v, setView }) {
  const [clientId, setClientId] = useState(v.clientId || '');
  const [secret, setSecret] = useState('');
  const [st, run, Msg] = useSave(setView);
  useEffect(() => {
    const on = (e) => { if (e.origin === window.location.origin && e.data?.type === 'openforge:google') api.get('/settings').then(setView); };
    window.addEventListener('message', on); return () => window.removeEventListener('message', on);
  }, [setView]);
  return (
    <>
      <p className="lead">Gmail, Google Calendar and Google Tasks — through <strong>your own</strong> Google Cloud OAuth client, so your data goes straight between this server and Google.</p>
      <ol className="steps-list">
        <li>In <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noreferrer">Google Cloud Console</a>, enable the <strong>Gmail API</strong>, <strong>Google Calendar API</strong> and <strong>Google Tasks API</strong>.</li>
        <li>Set up the OAuth consent screen (External). Add yourself as a test user — or publish the app so sign-ins don't expire after 7 days.</li>
        <li>Create credentials → <strong>OAuth client ID</strong> → <em>Web application</em>, and add this <strong>Authorized redirect URI</strong>:</li>
      </ol>
      <div className="field"><CopyBox value={v.redirectUri} testid="google-redirect" /></div>
      <div className="field"><label className="label">Authorized JavaScript origin (optional)</label><CopyBox value={v.javascriptOrigin} /></div>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="g-id">Client ID</label>
          <input id="g-id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" /></div>
        <SecretField id="g-secret" label="Client secret" value={secret} onChange={setSecret} mask={v.clientSecret} placeholder="GOCSPX-…" />
      </div>
      <Msg />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={st.busy || !clientId} onClick={() => run(async () => { const r = await api.put('/settings/google', { clientId, clientSecret: secret || undefined }); setSecret(''); return r; })}>Save client</button>
        <button className="btn primary" disabled={st.busy || !v.clientSecret.set || !v.clientId} onClick={() => run(async () => { const { url } = await api.post('/settings/google/connect'); window.open(url, 'openforge-google', 'width=520,height=680'); return null; }, 'A Google window opened — finish signing in there.')}>
          <Plug size={15} />{v.connected ? 'Reconnect Google' : 'Connect Google'}</button>
        {v.connected && <button className="btn danger" onClick={() => run(() => api.post('/settings/google/disconnect'), 'Disconnected.')}>Disconnect</button>}
        {v.clientId && <button className="btn ghost" onClick={() => run(() => api.del('/settings/google'), 'Removed.')}><Trash2 size={14} />Remove client</button>}
      </div>
      {v.status === 'expired' && <div className="banner err" style={{ marginTop: 12 }}>Google sign-in expired: {v.lastError}. Press Reconnect.</div>}
      {v.connected && <div className="hint" style={{ marginTop: 10 }}>Connected as <strong>{v.email}</strong>.</div>}
    </>
  );
}

function WhatsAppSection({ v, setView }) {
  const [f, setF] = useState({ phoneNumberId: v.phoneNumberId || '', accessToken: '', verifyToken: v.verifyToken || '', appSecret: '' });
  const [st, run, Msg] = useSave(setView);
  return (
    <>
      <p className="lead">The <strong>WhatsApp Cloud API</strong> (Meta). Incoming messages reach OpenForge AI through a webhook; you reply from the Chats card. A free-text reply is only allowed within 24 hours of the person's last message — that's Meta's rule.</p>
      <ol className="steps-list">
        <li>At <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a> create a Business app and add the <strong>WhatsApp</strong> product.</li>
        <li>From WhatsApp → API Setup copy the <strong>Phone number ID</strong>. For a token that doesn't expire, create a <strong>System User</strong> token in Business Settings with <code>whatsapp_business_messaging</code>.</li>
        <li>Save here, then paste the <strong>Callback URL</strong> and <strong>Verify token</strong> below into WhatsApp → Configuration → Webhook, and subscribe to the <code>messages</code> field.</li>
      </ol>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="wa-id">Phone number ID</label>
          <input id="wa-id" className="input" inputMode="numeric" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} placeholder="1234567890123456" /></div>
        <SecretField id="wa-token" label="Access token" value={f.accessToken} onChange={(x) => setF({ ...f, accessToken: x })} mask={v.accessToken} placeholder="EAAG…" />
      </div>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="wa-verify">Verify token</label>
          <input id="wa-verify" className="input" value={f.verifyToken} onChange={(e) => setF({ ...f, verifyToken: e.target.value })} placeholder="Leave blank to generate one" />
          <div className="hint">Any string you choose — Meta sends it back once to prove the webhook is yours.</div></div>
        <SecretField id="wa-secret" label="App secret (recommended)" value={f.appSecret} onChange={(x) => setF({ ...f, appSecret: x })} mask={v.appSecret} placeholder="From App settings → Basic" hint="Used to check every webhook really came from Meta." />
      </div>
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || !f.phoneNumberId} onClick={() => run(async () => { const r = await api.put('/settings/whatsapp', { ...f, accessToken: f.accessToken || undefined, appSecret: f.appSecret || undefined }); setF({ ...f, accessToken: '', appSecret: '', verifyToken: r.whatsapp.verifyToken }); return r; }, 'Checked with Meta and saved.')}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}Save & test</button>
        {v.accessToken.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/whatsapp'), 'Removed.')}><Trash2 size={14} />Remove</button>}
      </div>
      {v.callbackUrl && (
        <div style={{ marginTop: 16 }}>
          <div className="field"><label className="label">Callback URL — paste into Meta</label><CopyBox value={v.callbackUrl} testid="wa-callback" /></div>
          <div className="field"><label className="label">Verify token — paste into Meta</label><CopyBox value={v.verifyToken} /></div>
          <div className="hint">{v.displayPhone ? `Number: ${v.displayPhone}. ` : ''}{v.lastEventAt ? `Last webhook received ${new Date(v.lastEventAt).toLocaleString()}.` : 'No webhook received yet.'}</div>
        </div>
      )}
    </>
  );
}

function TelegramSection({ v, setView }) {
  const [token, setToken] = useState('');
  const [st, run, Msg] = useSave(setView);
  return (
    <>
      <p className="lead">A <strong>Telegram bot</strong> as a chat channel. OpenForge AI registers its webhook for you — messages to the bot appear on the Chats card and you reply from there.</p>
      <ol className="steps-list">
        <li>In Telegram, message <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> → <code>/newbot</code> and copy the token.</li>
        <li>Paste it here and press Save. To read group messages, also turn off privacy mode with <code>/setprivacy</code>.</li>
      </ol>
      <SecretField id="tg-token" label="Bot token" value={token} onChange={setToken} mask={v.botToken} placeholder="123456789:AA…" />
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || (!token && !v.botToken.set)} onClick={() => run(async () => { const r = await api.put('/settings/telegram', { botToken: token || undefined }); setToken(''); return r; }, 'Saved.')}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}{v.botToken.set ? 'Save & re-register webhook' : 'Save & register webhook'}</button>
        {v.botToken.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/telegram'), 'Removed and webhook deleted.')}><Trash2 size={14} />Remove</button>}
      </div>
      {v.status === 'error' && <div className="banner err" style={{ marginTop: 12 }}>{v.lastError}</div>}
      {v.webhookUrl && <div className="field" style={{ marginTop: 16 }}><label className="label">Webhook registered with Telegram</label><CopyBox value={v.webhookUrl} /></div>}
      {v.botUsername && <div className="hint">Bot: <a href={`https://t.me/${v.botUsername}`} target="_blank" rel="noreferrer">@{v.botUsername}</a>. {v.lastEventAt ? `Last message received ${new Date(v.lastEventAt).toLocaleString()}.` : 'No messages received yet.'}</div>}
    </>
  );
}

function AccountSection({ user, onUserChange }) {
  const [f, setF] = useState({ name: user.name, currentPassword: '', newPassword: '' });
  const [st, run, Msg] = useSave(() => {});
  const [users, setUsers] = useState(null);
  const [nu, setNu] = useState({ name: '', email: '', password: '', role: 'user' });
  const [ust, urun, UMsg] = useSave(() => {});
  const isAdmin = user.role === 'admin';
  const loadUsers = () => isAdmin && api.get('/auth/users').then(r => setUsers(r.users)).catch(() => {});
  useEffect(() => { loadUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="lead">Signed in as <strong>{user.email}</strong> ({user.role}).</p>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="acc-name">Name</label><input id="acc-name" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div />
        <div className="field"><label className="label" htmlFor="acc-cur">Current password</label><input id="acc-cur" className="input" type="password" autoComplete="current-password" value={f.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="acc-new">New password</label><input id="acc-new" className="input" type="password" autoComplete="new-password" value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} /></div>
      </div>
      <Msg />
      <button className="btn primary" disabled={st.busy} onClick={() => run(async () => { await api.put('/auth/me', f); setF({ ...f, currentPassword: '', newPassword: '' }); onUserChange(); return null; })}>Save</button>
      {isAdmin && (
        <div style={{ marginTop: 26 }}>
          <h3 style={{ margin: '0 0 6px', display: 'flex', gap: 8, alignItems: 'center' }}><Users size={17} />People on this install</h3>
          <p className="sec" style={{ marginTop: 0, fontSize: 13.5 }}>Everyone signs in with their own account and connects their own keys — nobody sees anyone else's data.</p>
          {(users || []).map(u => (
            <div key={u.id} className="row" style={{ padding: '8px 0' }}>
              <span className="grow"><strong>{u.name}</strong> <span className="muted">{u.email}</span></span>
              <span className="pill">{u.role}</span>
              {u.id !== user.id && <button className="btn ghost icon" aria-label={`Remove ${u.name}`} onClick={() => { if (window.confirm(`Remove ${u.name}? Their settings and conversations are deleted.`)) urun(async () => { await api.del(`/auth/users/${u.id}`); loadUsers(); return null; }, 'Removed.'); }}><Trash2 size={14} /></button>}
            </div>
          ))}
          <div className="grid2" style={{ marginTop: 10 }}>
            <input className="input" placeholder="Name" value={nu.name} onChange={e => setNu({ ...nu, name: e.target.value })} aria-label="New user name" />
            <input className="input" placeholder="Email" type="email" value={nu.email} onChange={e => setNu({ ...nu, email: e.target.value })} aria-label="New user email" />
            <input className="input" placeholder="Temporary password (8+)" type="password" autoComplete="new-password" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} aria-label="New user password" />
            <select className="select" value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })} aria-label="Role"><option value="user">User</option><option value="admin">Admin</option></select>
          </div>
          <div style={{ marginTop: 10 }}><UMsg /></div>
          <button className="btn" disabled={ust.busy} onClick={() => urun(async () => { await api.post('/auth/users', nu); setNu({ name: '', email: '', password: '', role: 'user' }); loadUsers(); return null; }, 'Account created.')}>Add person</button>
        </div>
      )}
    </>
  );
}

export default function SettingsPage({ user, section, onUserChange }) {
  const [view, setView] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/settings').then(setView).catch(e => setErr(e.message)); }, []);
  // Switching sections swaps the card in place; keep the page at the top so nothing jumps.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [section]);
  const active = SECTIONS.find(s => s.id === section) || SECTIONS[0];
  const connected = (id) => {
    if (!view) return false;
    if (id === 'model') return view.model.apiKey.set;
    if (id === 'voice') return view.voice.apiKey.set;
    if (id === 'google') return view.google.connected;
    if (id === 'whatsapp') return view.whatsapp.accessToken.set;
    if (id === 'telegram') return view.telegram.status === 'connected';
    return false;
  };
  const badge = (id) => {
    if (!view) return null;
    if (id === 'model') return <Status ok={view.model.apiKey.set} warn={view.model.status === 'error'}>{view.model.apiKey.set ? `${view.model.provider} · ${view.model.model}` : 'Not set'}</Status>;
    if (id === 'voice') return <Status ok={view.voice.apiKey.set}>{view.voice.apiKey.set ? 'Gemini Live' : 'Not set'}</Status>;
    if (id === 'google') return <Status ok={view.google.connected} warn={view.google.status === 'expired'}>{view.google.connected ? 'Connected' : view.google.status === 'expired' ? 'Expired' : view.google.clientId ? 'Client saved' : 'Not set'}</Status>;
    if (id === 'whatsapp') return <Status ok={view.whatsapp.accessToken.set}>{view.whatsapp.accessToken.set ? 'Connected' : 'Not set'}</Status>;
    if (id === 'telegram') return <Status ok={view.telegram.status === 'connected'} warn={view.telegram.status === 'error'}>{view.telegram.status === 'connected' ? 'Webhook on' : view.telegram.status === 'error' ? 'Error' : 'Not set'}</Status>;
    return null;
  };
  return (
    <div className="settings">
      <nav className="card snav" aria-label="Settings sections">
        {SECTIONS.map(s => (
          <a key={s.id} href={`#/settings/${s.id}`} className={active.id === s.id ? 'on' : ''} data-testid={`snav-${s.id}`}>
            <s.icon size={16} />{s.label}{s.id !== 'account' && <span className={`dot ${connected(s.id) ? 'ok' : ''}`} />}
          </a>
        ))}
      </nav>
      <div>
        {err && <div className="banner err">{err}</div>}
        {!view ? <div className="card ssec"><div className="empty"><Loader2 className="spin" /></div></div> : (
          <section key={active.id} className="card ssec" data-testid={`settings-${active.id}`}>
            <h2><active.icon size={19} />{active.label}<span style={{ marginLeft: 'auto' }}>{badge(active.id)}</span></h2>
            {active.id === 'model' && <ModelSection v={view.model} setView={setView} />}
            {active.id === 'voice' && <VoiceSection v={view.voice} setView={setView} />}
            {active.id === 'google' && <GoogleSection v={view.google} setView={setView} />}
            {active.id === 'whatsapp' && <WhatsAppSection v={view.whatsapp} setView={setView} />}
            {active.id === 'telegram' && <TelegramSection v={view.telegram} setView={setView} />}
            {active.id === 'account' && <AccountSection user={user} onUserChange={onUserChange} />}
          </section>
        )}
      </div>
    </div>
  );
}
