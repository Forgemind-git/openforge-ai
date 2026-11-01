import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Mail, ListTodo, MessagesSquare, FileCheck2, History, Send, Mic, MicOff, Loader2, Maximize2,
  Check, X, Plus, Settings as Cog, Trash2, Square, Clock,
} from 'lucide-react';
import { streamChat } from '../api';
import { useApi } from '../lib/apiContext';
import { demoChat } from '../lib/demo';
import ForgeMindLogo from '../components/ForgeMindLogo.jsx';
import { Avatar, Answer } from '../components/ui.jsx';
import { createGeminiLive, isGeminiLiveSupported } from '../lib/geminiLive';
import { ago, timeOf, todayYmd, ymd, addDays, senderName } from '../lib/util';
import { Sheet, DraftCard, draftIcon } from './Sheets.jsx';

const PANELS = ['tasks', 'calendar', 'mail', 'chats', 'drafts'];
const SUGGESTIONS = ['What is on my plate today?', 'Which chats are waiting for a reply?', 'Summarise my unread mail', 'Plan my week'];

function useOfficeData(api) {
  const [status, setStatus] = useState(null);
  const [d, setD] = useState({ tasks: null, calendar: null, mail: null, chats: null, drafts: null });
  const [errs, setErrs] = useState({});
  const load = useCallback(async (panels = PANELS) => {
    const st = await api.get('/office/status').catch(() => null);
    if (st) setStatus(st);
    const job = {
      tasks: () => api.get('/tasks').then(r => r.tasks),
      calendar: () => api.get(`/calendar?from=${encodeURIComponent(addDays(new Date(new Date().setHours(0, 0, 0, 0)), -1).toISOString())}&to=${encodeURIComponent(addDays(new Date(), 14).toISOString())}`).then(r => r.events),
      mail: () => api.get('/mail?q=in:inbox&max=12').then(r => r.messages),
      chats: () => api.get('/chats').then(r => r.chats),
      drafts: () => api.get('/actions').then(r => r.actions),
    };
    const googleOn = st?.google;
    await Promise.all(panels.map(async (p) => {
      if (['tasks', 'calendar', 'mail'].includes(p) && !googleOn) { setD(x => ({ ...x, [p]: [] })); setErrs(e => ({ ...e, [p]: 'google' })); return; }
      try { const v = await job[p](); setD(x => ({ ...x, [p]: v })); setErrs(e => ({ ...e, [p]: null })); }
      catch (e) { setD(x => ({ ...x, [p]: x[p] || [] })); setErrs(er => ({ ...er, [p]: e.notConnected ? 'google' : e.message })); }
    }));
  }, [api]);
  useEffect(() => { setD({ tasks: null, calendar: null, mail: null, chats: null, drafts: null }); load(); }, [load]);
  return { status, d, errs, load };
}

function Station({ id, icon: Icon, color, title, count, lit, onOpen, children, flex = true, action }) {
  return (
    <section className={`card station ${flex ? 'flex1' : ''} ${lit ? 'lit' : ''}`} data-station={id} aria-label={title}>
      <div className="station-head">
        <span className="ico" style={{ background: `${color}1f`, color }}><Icon size={16} /></span>
        <h3>{title}</h3>
        {count != null && count > 0 && <span className="pill red" data-testid={`count-${id}`}>{count}</span>}
        {action}
        {onOpen && <button className="btn ghost icon" onClick={onOpen} title={`Open ${title}`} aria-label={`Open ${title}`}><Maximize2 size={15} /></button>}
      </div>
      <div className="station-body scroll">{children}</div>
      {lit && <><div className="fa-scan-tint" /><div className="fa-scan-sweep" /></>}
    </section>
  );
}

function NeedsSetup({ what, section }) {
  return <div className="empty">{what} isn't connected yet.<br /><a href={`#/settings/${section}`}>Connect it in Settings</a></div>;
}

export default function Office({ user }) {
  const { api, demo } = useApi();
  const { status, d, errs, load } = useOfficeData(api);
  const [sheet, setSheet] = useState(null);          // { view, id }
  const [lit, setLit] = useState({});
  const [mobileTab, setMobileTab] = useState('assistant');
  const [history, setHistory] = useState([]);

  // chat
  const [convId, setConvId] = useState(null);
  const [msgs, setMsgs] = useState([]);              // {role, content, steps, live}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState([]);        // labels of tools in flight
  const logRef = useRef(null);
  const abortRef = useRef(null);

  // voice
  const [live, setLive] = useState(null);            // null | 'connecting' | 'on'
  const [speaking, setSpeaking] = useState(false);
  const liveRef = useRef(null);

  const loadHistory = useCallback(() => api.get('/assistant/conversations').then(r => setHistory(r.conversations)).catch(() => {}), [api]);
  // Switching demo on/off starts a fresh conversation.
  useEffect(() => { setMsgs([]); setConvId(null); setSheet(null); }, [demo]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // New chat messages arrive over the event stream.
  useEffect(() => {
    if (demo) return undefined;
    const es = new EventSource('/api/events');
    es.addEventListener('chats', () => load(['chats']));
    return () => es.close();
  }, [load, demo]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, running]);

  const light = (panels = []) => {
    if (!panels.length) return;
    setLit(l => ({ ...l, ...Object.fromEntries(panels.map(p => [p, true])) }));
    setTimeout(() => setLit(l => ({ ...l, ...Object.fromEntries(panels.map(p => [p, false])) })), 1600);
  };
  const onStep = (s) => {
    if (s.phase === 'start') { setRunning(r => [...r, s.label]); light(s.panels); }
    else setRunning(r => { const i = r.indexOf(s.label); return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)]; });
    if (s.phase === 'done' && s.tool === 'open_view' && s.focus) { setSheet(s.focus); setMobileTab('assistant'); }
    if (s.phase === 'done' && s.drafts) load(['drafts']);
  };

  async function ask(text) {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    if (live && liveRef.current) { liveRef.current.sendText(q); setInput(''); setMsgs(m => [...m, { role: 'user', content: q }]); return; }
    setInput(''); setBusy(true);
    setMsgs(m => [...m, { role: 'user', content: q }]);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      await (demo ? demoChat : streamChat)({
        message: q, conversationId: convId, signal: ctrl.signal,
        onEvent: (ev, data) => {
          if (ev === 'conversation') setConvId(data.id);
          else if (ev === 'step') onStep(data);
          else if (ev === 'message') setMsgs(m => [...m, { role: 'assistant', content: data.content, steps: data.steps }]);
          else if (ev === 'error') setMsgs(m => [...m, { role: 'error', content: data.error }]);
        },
      });
    } catch (e) {
      if (e.name !== 'AbortError') setMsgs(m => [...m, { role: 'error', content: e.message }]);
    } finally { setBusy(false); setRunning([]); abortRef.current = null; loadHistory(); }
  }

  async function openConversation(id) {
    const r = await api.get(`/assistant/conversations/${id}`);
    setConvId(id);
    setMsgs(r.messages.map(m => ({ role: m.role, content: m.content, steps: m.steps })));
    setMobileTab('assistant');
  }
  function newChat() { setConvId(null); setMsgs([]); }

  // ── Talk (Gemini Live) ──
  const appendLive = (role, text) => setMsgs((m) => {
    const last = m[m.length - 1];
    if (last && last.live && last.role === role) return [...m.slice(0, -1), { ...last, content: last.content + text }];
    return [...m.map(x => (x.live ? { ...x, live: false } : x)), { role, content: text, live: true }];
  });
  async function toggleTalk() {
    if (live) { liveRef.current?.stop(); liveRef.current = null; setLive(null); setSpeaking(false); loadHistory(); return; }
    if (demo) { setMsgs(m => [...m, { role: 'error', content: 'Talk is live voice with your own Gemini key. Turn Demo off and add the key in Settings → Voice to try it.' }]); return; }
    if (!status?.voice) { setMsgs(m => [...m, { role: 'error', content: 'Talk needs your Gemini API key — add it in Settings → Voice.' }]); return; }
    if (!isGeminiLiveSupported()) { setMsgs(m => [...m, { role: 'error', content: 'This browser cannot open the microphone here (it needs HTTPS and a modern browser).' }]); return; }
    setLive('connecting');
    const s = createGeminiLive({
      onReady: () => setLive('on'),
      onTranscript: (role, text) => appendLive(role === 'user' ? 'user' : 'assistant', text),
      onTool: (t) => onStep({ ...t, phase: t.phase }),
      onConversation: (id) => setConvId(id),
      onSpeakingChange: setSpeaking,
      onTurnComplete: () => setMsgs(m => m.map(x => (x.live ? { ...x, live: false } : x))),
      onError: (e) => setMsgs(m => [...m, { role: 'error', content: String(e) }]),
      onClose: () => { liveRef.current = null; setLive(null); setSpeaking(false); },
    });
    liveRef.current = s;
    try { await s.start(); } catch (e) { s.stop(); liveRef.current = null; setLive(null); setMsgs(m => [...m, { role: 'error', content: e.message || 'Could not start the microphone.' }]); }
  }
  useEffect(() => () => liveRef.current?.stop(), []);

  async function decide(a, ok) {
    try {
      if (ok) await api.post(`/actions/${a.id}/confirm`);
      else await api.post(`/actions/${a.id}/discard`);
    } catch (e) { setMsgs(m => [...m, { role: 'error', content: e.message }]); }
    load(['drafts', ...(ok ? ({ chat_message: ['chats'], email: ['mail'], email_reply: ['mail'], calendar_event: ['calendar'], task: ['tasks'], task_done: ['tasks'] }[a.kind] || []) : [])]);
  }

  // ── derived ──
  const today = todayYmd();
  const openTasks = (d.tasks || []).filter(t => t.status !== 'completed');
  const overdue = openTasks.filter(t => t.due && t.due < today);
  const todaysEvents = (d.calendar || []).filter(e => ymd(e.start) === today);
  const upcoming = (d.calendar || []).filter(e => ymd(e.start) > today).slice(0, 4);
  const unread = (d.mail || []).filter(m => m.unread);
  const waiting = (d.chats || []).filter(c => c.waitingForReply);
  const pending = (d.drafts || []).filter(a => a.status === 'pending');
  const week = useMemo(() => { const s = new Date(); const dow = (s.getDay() + 6) % 7; return Array.from({ length: 7 }, (_, i) => ymd(addDays(s, i - dow))); }, []);
  const thinking = busy || live === 'connecting';
  const firstName = String(user.name || '').split(' ')[0];
  const setupMissing = status && !status.model;

  const err = (p, label, section) => (errs[p] === 'google' ? <NeedsSetup what={label} section={section} /> : errs[p] ? <div className="banner err">{errs[p]}</div> : null);

  const leftCol = (
    <div className={`col ${mobileTab === 'today' ? 'show' : ''}`}>
      <Station id="calendar" icon={CalendarDays} color="#d97706" title="Calendar" count={todaysEvents.length} lit={lit.calendar} onOpen={() => setSheet({ view: 'calendar' })}>
        {err('calendar', 'Google Calendar', 'google') || (
          <>
            <div className="weekstrip" data-testid="weekstrip">
              {week.map((day, i) => {
                const n = (d.calendar || []).filter(e => ymd(e.start) === day).length;
                return (
                  <div key={day} className={day === today ? 't' : ''}>
                    <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.8 }}>{'MTWTFSS'[i]}</div>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>{Number(day.slice(8))}</div>
                    <div style={{ height: 5, display: 'flex', justifyContent: 'center', gap: 2, marginTop: 1 }}>
                      {Array.from({ length: Math.min(n, 3) }, (_, k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 2, background: day === today ? '#fff' : '#d97706' }} />)}
                    </div>
                  </div>
                );
              })}
            </div>
            {d.calendar === null ? <Loader2 size={16} className="spin muted" /> : !todaysEvents.length && <div className="muted" style={{ fontSize: 13, padding: '4px 2px' }}>Nothing on your calendar today.</div>}
            {todaysEvents.map(e => (
              <button key={e.id} className="mini-row" onClick={() => setSheet({ view: 'calendar' })}>
                <Clock size={13} color="#d97706" /><span className="t grow clip">{e.title}</span><span className="s">{e.allDay ? 'All day' : timeOf(e.start)}</span>
              </button>
            ))}
            {upcoming.length > 0 && <div className="eyebrow" style={{ marginTop: 4 }}>Coming up</div>}
            {upcoming.map(e => (
              <button key={e.id} className="mini-row" onClick={() => setSheet({ view: 'calendar' })}>
                <span className="t grow clip">{e.title}</span><span className="s">{new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              </button>
            ))}
          </>
        )}
      </Station>
      <Station id="mail" icon={Mail} color="#2563eb" title="Mail" count={unread.length} lit={lit.mail} onOpen={() => setSheet({ view: 'mail' })}>
        {err('mail', 'Gmail', 'google') || (d.mail === null ? <Loader2 size={16} className="spin muted" /> : !d.mail.length ? <div className="empty">Inbox is empty.</div> : d.mail.slice(0, 8).map(m => (
          <button key={m.id} className="mini-row" onClick={() => setSheet({ view: 'mail', id: m.id })} data-testid="mini-mail">
            <Avatar name={senderName(m.from)} size={26} />
            <div className="grow"><div className="t clip" style={{ fontWeight: m.unread ? 800 : 600 }}>{senderName(m.from)}</div><div className="s clip">{m.subject}</div></div>
            <span className="s">{ago(m.date)}</span>
          </button>
        )))}
      </Station>
      <Station id="history" icon={History} color="#7c3aed" title="Conversations" lit={false} flex
        action={<button className="btn ghost sm" onClick={newChat} title="New conversation"><Plus size={14} />New</button>}>
        {!history.length ? <div className="empty">Your conversations with Forge will appear here.</div> : history.map(c => (
          <div key={c.id} className="row" style={{ gap: 4 }}>
            <button className="mini-row grow" onClick={() => openConversation(c.id)} style={convId === c.id ? { background: 'var(--fc-primary-faint)' } : undefined}>
              <span className="t grow clip">{c.title}</span><span className="s">{ago(`${c.updated_at.replace(' ', 'T')}Z`)}</span>
            </button>
            <button className="btn ghost icon" aria-label="Delete conversation" onClick={async () => { await api.del(`/assistant/conversations/${c.id}`); if (convId === c.id) newChat(); loadHistory(); }}><Trash2 size={13} /></button>
          </div>
        ))}
      </Station>
    </div>
  );

  const rightCol = (
    <div className={`col ${mobileTab === 'work' ? 'show' : ''}`}>
      <Station id="tasks" icon={ListTodo} color="#16a34a" title="Tasks" count={overdue.length} lit={lit.tasks} onOpen={() => setSheet({ view: 'tasks' })}>
        {err('tasks', 'Google Tasks', 'google') || (d.tasks === null ? <Loader2 size={16} className="spin muted" /> : !openTasks.length ? <div className="empty">No open tasks. Nice.</div> : (
          <>
            <div className="muted" style={{ fontSize: 12.5 }}>{openTasks.length} open{overdue.length ? ` · ${overdue.length} overdue` : ''}</div>
            {openTasks.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 7).map(t => (
              <div key={t.id} className="mini-row" style={{ cursor: 'default' }}>
                <button className="check" aria-label={`Mark ${t.title} done`} onClick={async () => { await api.patch(`/tasks/${encodeURIComponent(t.listId)}/${encodeURIComponent(t.id)}`, { status: 'completed' }).catch(() => {}); load(['tasks']); }} />
                <span className="t grow clip">{t.title}</span>
                {t.due && <span className={`pill ${t.due < today ? 'red' : t.due === today ? 'amber' : ''}`}>{t.due === today ? 'Today' : new Date(`${t.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
              </div>
            ))}
          </>
        ))}
      </Station>
      <Station id="chats" icon={MessagesSquare} color="#0891b2" title="Chats" count={waiting.length} lit={lit.chats} onOpen={() => setSheet({ view: 'chats' })}>
        {status && !status.whatsapp && !status.telegram ? <NeedsSetup what="WhatsApp or Telegram" section="whatsapp" /> : d.chats === null ? <Loader2 size={16} className="spin muted" /> : !d.chats.length ? <div className="empty">No messages yet. They arrive here from your WhatsApp and Telegram webhooks.</div> : d.chats.slice(0, 7).map(c => (
          <button key={c.chatId} className="mini-row" onClick={() => setSheet({ view: 'chats', id: String(c.chatId) })} data-testid="mini-chat">
            <Avatar name={c.name} size={26} />
            <div className="grow"><div className="row" style={{ gap: 6 }}><span className="t clip">{c.name}</span><span className={`pill ${c.channel === 'whatsapp' ? 'green' : 'blue'}`} style={{ padding: '1px 6px', fontSize: 10 }}>{c.channel === 'whatsapp' ? 'WA' : 'TG'}</span></div><div className="s clip">{c.lastMessage}</div></div>
            <span className="s">{ago(c.lastAt)}</span>
            {c.unread > 0 && <span className="pill red">{c.unread}</span>}
          </button>
        ))}
      </Station>
      <Station id="drafts" icon={FileCheck2} color="#dc2626" title="Drafts to approve" count={pending.length} lit={lit.drafts} onOpen={() => setSheet({ view: 'drafts' })}>
        {d.drafts === null ? <Loader2 size={16} className="spin muted" /> : !pending.length ? <div className="empty">Nothing waiting. When Forge prepares a message, email, event or task, it lands here — nothing is sent until you press Send.</div> : pending.slice(0, 4).map(a => (
          <div key={a.id} className="row" style={{ background: 'var(--fc-raised)', borderRadius: 10, padding: 8, gap: 8 }} data-testid="draft-row">
            {draftIcon(a.kind)}
            <span className="t grow clip" style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</span>
            <button className="btn sm" onClick={() => setSheet({ view: 'drafts', id: String(a.id) })}>Review</button>
            <button className="btn primary sm" onClick={() => decide(a, true)}><Check size={13} />Send</button>
            <button className="btn ghost icon" aria-label="Discard" onClick={() => decide(a, false)}><X size={14} /></button>
          </div>
        ))}
      </Station>
    </div>
  );

  return (
    <>
      <div className="mtabs" role="tablist">
        {[['assistant', 'Assistant'], ['today', 'Today'], ['work', 'Work']].map(([k, l]) => (
          <button key={k} className={mobileTab === k ? 'on' : ''} onClick={() => setMobileTab(k)}>{l}</button>
        ))}
      </div>
      <main className="office floor">
        {leftCol}
        <div className={`center ${mobileTab === 'assistant' ? 'show' : ''}`}>
          <div className="stage">
            <div className="logo">
              <div className={`fa-halo ${thinking || speaking || live === 'on' ? 'on' : ''}`} />
              <ForgeMindLogo thinking={thinking} expression={speaking ? 'happy' : busy ? 'focused' : 'neutral'} />
            </div>
            {!msgs.length && (
              <>
                <div className="hello">Hi {firstName}, I'm Forge.</div>
                <div className="sub">Ask about your tasks, calendar, mail or chats. I prepare drafts — you press Send.</div>
              </>
            )}
            {live && <div className="pill red" style={{ marginTop: 6 }} data-testid="live-pill"><span className="fa-live-dot" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />{live === 'connecting' ? 'Connecting voice…' : speaking ? 'Speaking' : 'Listening'}</div>}
          </div>
          {demo && (
            <div className="banner info demo-banner" data-testid="demo-banner">
              <strong>Demo mode</strong> — sample tasks, calendar, mail and chats so you can see how Open Forge AI works. Try a suggestion below. Turn <strong>Demo</strong> off in the top bar to use your own accounts.
            </div>
          )}
          {!demo && setupMissing && (
            <div className="banner info" style={{ margin: '10px 4px 0' }} data-testid="setup-banner">
              Start by adding your model key: <a href="#/settings/model">Settings → Model</a> (OpenAI or Anthropic). Then connect Google, WhatsApp or Telegram for the cards.
            </div>
          )}
          <div className="chatlog scroll" ref={logRef} data-testid="chatlog">
            {!msgs.length && <div className="suggest">{SUGGESTIONS.map(s => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === 'user' ? 'user' : m.role === 'error' ? 'err' : 'bot'} fa-answer-in`}>
                {m.steps?.length > 0 && <div className="steps">{m.steps.map((s, j) => <span key={j} className={`pill ${s.status === 'error' ? 'red' : ''}`}>{s.status === 'error' ? <X size={11} /> : <Check size={11} />}{s.label}</span>)}</div>}
                {m.role === 'assistant' ? <Answer text={m.content} /> : m.content}
              </div>
            ))}
            {running.length > 0 && <div className="bubble bot" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="fa-dots"><span /><span /><span /></span><span className="muted">{running[running.length - 1]}…</span></div>}
            {busy && !running.length && <div className="bubble bot"><span className="fa-dots muted"><span /><span /><span /></span></div>}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <textarea value={input} rows={1} placeholder={live ? 'Speak, or type to Forge…' : 'Ask Forge anything…'} aria-label="Message Forge"
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
            <button type="button" className={`btn talk ${live ? 'live' : ''}`} onClick={toggleTalk} title={live ? 'Stop talking' : 'Talk to Forge'} data-testid="talk-btn">
              {live === 'connecting' ? <Loader2 size={16} className="spin" /> : live ? <MicOff size={16} /> : <Mic size={16} />}{live ? 'Stop' : 'Talk'}
            </button>
            {busy ? (
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()} aria-label="Stop"><Square size={14} /></button>
            ) : (
              <button className="btn primary" disabled={!input.trim()} aria-label="Send"><Send size={16} /></button>
            )}
          </form>
          <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>
            {demo ? <>Sample data · </> : status?.model ? <>Model: <span className="mono">{status.modelName}</span> · </> : null}<a href="#/settings" style={{ color: 'inherit' }}><Cog size={11} style={{ verticalAlign: -1 }} /> Settings</a>
          </div>
        </div>
        {rightCol}
      </main>
      {sheet && <Sheet key={String(demo)} sheet={sheet} setSheet={setSheet} data={d} errs={errs} status={status} reload={load} decide={decide} DraftCard={DraftCard} />}
    </>
  );
}
