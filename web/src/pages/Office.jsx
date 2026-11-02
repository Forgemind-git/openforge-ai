// The office — modelled on Forge Growth's Forge AI tab: a floor with two slim
// rails of cards (natural height, vertically centred, click to open), Forge in
// the middle with the latest answer under it, a round-button toolbar on top and
// a floating composer at the bottom.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Mail, ListTodo, MessagesSquare, FileCheck2, History, Send, Mic, PhoneOff, Loader2, ArrowUpRight,
  Check, X, Plus, Settings2, Trash2, Clock, ShieldCheck, AlertTriangle, CheckCircle2, Sparkles, FlaskConical,
} from 'lucide-react';
import { streamChat } from '../api';
import { useApi } from '../lib/apiContext';
import { demoChat } from '../lib/demo';
import { Avatar, Answer, Modal } from '../components/ui.jsx';
import { createGeminiLive, isGeminiLiveSupported } from '../lib/geminiLive';
import { ago, timeOf, todayYmd, ymd, addDays, senderName } from '../lib/util';
import { Sheet, draftIcon } from './Sheets.jsx';

const PANELS = ['tasks', 'calendar', 'mail', 'chats', 'drafts'];
const SUGGESTIONS = ['What is on my plate today?', 'Which chats are waiting for a reply?', 'Summarise my unread mail', 'Plan my week'];
const STATION = {
  calendar: { title: 'Calendar', Icon: CalendarDays },
  chats: { title: 'Chats', Icon: MessagesSquare },
  tasks: { title: 'Tasks', Icon: ListTodo },
  mail: { title: 'Mail', Icon: Mail },
  drafts: { title: 'Drafts to approve', Icon: FileCheck2 },
};
const LEFT = ['calendar', 'chats', 'tasks'];
const RIGHT = ['mail', 'drafts'];

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
    await Promise.all(panels.map(async (p) => {
      if (['tasks', 'calendar', 'mail'].includes(p) && !st?.google) { setD(x => ({ ...x, [p]: [] })); setErrs(e => ({ ...e, [p]: 'google' })); return; }
      try { const v = await job[p](); setD(x => ({ ...x, [p]: v })); setErrs(e => ({ ...e, [p]: null })); }
      catch (e) { setD(x => ({ ...x, [p]: x[p] || [] })); setErrs(er => ({ ...er, [p]: e.notConnected ? 'google' : e.message })); }
    }));
  }, [api]);
  useEffect(() => { setD({ tasks: null, calendar: null, mail: null, chats: null, drafts: null }); load(); }, [load]);
  return { status, d, errs, load };
}

function RoundBtn({ title, onClick, children, testid }) {
  return <button type="button" className="roundbtn" title={title} aria-label={title} onClick={onClick} data-testid={testid}>{children}</button>;
}

// One card on a rail. The whole card opens its sheet; rows inside can act on their own.
function Station({ id, count, used, scanning, onOpen, children }) {
  const { title, Icon } = STATION[id];
  return (
    <div role="button" tabIndex={0} className={`fa-station station ${scanning ? 'scanning' : ''}`} data-station={id} aria-label={`Open ${title}`}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}>
      <div className="station-head">
        <Icon size={15} className={scanning ? 'acc' : 'muted'} />
        <span className="st-title">{title}</span>
        {count > 0 && <span className="pill red" data-testid={`count-${id}`}>{count}</span>}
        {scanning && <span className="fa-scan-pill">Reading</span>}
        {!scanning && used && <span className="fa-used-dot" title="Forge looked here in this answer" />}
        {!scanning && <span className="fa-open-chip" aria-hidden><ArrowUpRight size={13} />Open</span>}
      </div>
      <div className="station-body">{children}</div>
      {scanning && <><div className="fa-scan-tint" /><div className="fa-scan-sweep" />{['tl', 'tr', 'bl', 'br'].map(c => <span key={c} className={`fa-bracket fa-bracket-${c}`} />)}</>}
    </div>
  );
}

const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };

function NeedsSetup({ what, section }) {
  return <div className="st-muted">{what} isn't connected. <a href={`#/settings/${section}`} onClick={(e) => e.stopPropagation()}>Connect</a></div>;
}

export default function Office({ user }) {
  const { api, demo } = useApi();
  const { status, d, errs, load } = useOfficeData(api);
  const [sheet, setSheet] = useState(null);           // { view, id }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scan, setScan] = useState([]);               // stations being read right now
  const [used, setUsed] = useState([]);               // stations the last answer used

  const [convId, setConvId] = useState(null);
  const [lastQ, setLastQ] = useState('');
  const [answer, setAnswer] = useState(null);         // { text, error }
  const [proc, setProc] = useState([]);               // [{ id, label, status }]
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  const [live, setLive] = useState(null);             // null | 'connecting' | 'live'
  const [speaking, setSpeaking] = useState(false);
  const liveRef = useRef(null);
  const turnRef = useRef({ user: '', bot: '' });

  // Switching demo on/off starts clean.
  useEffect(() => { setAnswer(null); setLastQ(''); setConvId(null); setSheet(null); setUsed([]); setProc([]); }, [demo]);
  useEffect(() => {
    if (demo) return undefined;
    const es = new EventSource('/api/events');
    es.addEventListener('chats', () => load(['chats']));
    return () => es.close();
  }, [load, demo]);

  const onStep = (s) => {
    const views = (s.panels || []).filter(p => STATION[p]);
    if (s.phase === 'start') {
      setProc(p => [...p.slice(-3), { id: `${s.tool}-${Date.now()}`, label: s.label, status: 'running' }]);
      setScan(views);
    } else {
      setProc(p => { const i = [...p].reverse().findIndex(x => x.label === s.label && x.status === 'running'); if (i < 0) return p; const k = p.length - 1 - i; return p.map((x, j) => (j === k ? { ...x, status: s.phase === 'error' ? 'error' : 'done' } : x)); });
      setScan([]);
      if (views.length) setUsed(u => [...new Set([...u, ...views])]);
    }
    if (s.phase === 'done' && s.tool === 'open_view' && s.focus) setSheet(s.focus);
    if (s.phase === 'done' && s.drafts) load(['drafts']);
  };

  async function ask(text) {
    const q = String(text ?? input).trim();
    if (!q) return;
    if (live === 'live' && liveRef.current) { liveRef.current.sendText(q); setInput(''); setLastQ(q); return; }
    if (busy) return;
    setInput(''); setBusy(true); setLastQ(q); setAnswer(null); setUsed([]); setProc([]);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      await (demo ? demoChat : streamChat)({
        message: q, conversationId: convId, signal: ctrl.signal,
        onEvent: (ev, data) => {
          if (ev === 'conversation') setConvId(data.id);
          else if (ev === 'step') onStep(data);
          else if (ev === 'message') setAnswer({ text: data.content });
          else if (ev === 'error') setAnswer({ text: data.error, error: true });
        },
      });
    } catch (e) {
      if (e.name !== 'AbortError') setAnswer({ text: e.message, error: true });
    } finally {
      setBusy(false); setScan([]); abortRef.current = null;
      setTimeout(() => setProc([]), 1800);
    }
  }

  function newChat() { setConvId(null); setAnswer(null); setLastQ(''); setUsed([]); setProc([]); }
  async function openConversation(id) {
    const r = await api.get(`/assistant/conversations/${id}`);
    const msgs = r.messages || [];
    const lastA = [...msgs].reverse().find(m => m.role === 'assistant');
    const lastU = [...msgs].reverse().find(m => m.role === 'user');
    setConvId(id); setLastQ(lastU?.content || ''); setAnswer(lastA ? { text: lastA.content } : null); setHistoryOpen(false);
  }

  // ── Talk (Gemini Live) ──
  async function toggleTalk() {
    if (live) { liveRef.current?.stop(); liveRef.current = null; setLive(null); setSpeaking(false); return; }
    if (demo) { setAnswer({ text: 'Talk is live voice with your own Gemini key. Turn Demo off and add the key in Settings → Voice to try it.', error: true }); return; }
    if (!status?.voice) { setAnswer({ text: 'Talk needs your Gemini API key — add it in Settings → Voice.', error: true }); return; }
    if (!isGeminiLiveSupported()) { setAnswer({ text: 'This browser cannot open the microphone here (it needs HTTPS and a modern browser).', error: true }); return; }
    setLive('connecting'); turnRef.current = { user: '', bot: '' };
    const s = createGeminiLive({
      onReady: () => setLive('live'),
      onTranscript: (role, text) => {
        const t = turnRef.current;
        if (role === 'user') { if (t.bot) { t.bot = ''; t.user = ''; } t.user += text; setLastQ(t.user.trim()); }
        else { t.bot += text; setAnswer({ text: t.bot.trim() }); }
      },
      onTool: onStep,
      onConversation: (id) => setConvId(id),
      onSpeakingChange: setSpeaking,
      onTurnComplete: () => { setTimeout(() => setProc([]), 1500); },
      onError: (e) => setAnswer({ text: String(e), error: true }),
      onClose: () => { liveRef.current = null; setLive(null); setSpeaking(false); },
    });
    liveRef.current = s;
    try { await s.start(); } catch (e) { s.stop(); liveRef.current = null; setLive(null); setAnswer({ text: e.message || 'Could not start the microphone.', error: true }); }
  }
  useEffect(() => () => liveRef.current?.stop(), []);

  async function decide(a, ok) {
    try { await api.post(`/actions/${a.id}/${ok ? 'confirm' : 'discard'}`); }
    catch (e) { setAnswer({ text: e.message, error: true }); }
    load(['drafts', ...(ok ? ({ chat_message: ['chats'], email: ['mail'], email_reply: ['mail'], calendar_event: ['calendar'], task: ['tasks'], task_done: ['tasks'] }[a.kind] || []) : [])]);
  }

  // ── derived ──
  const today = todayYmd();
  const openTasks = (d.tasks || []).filter(t => t.status !== 'completed').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const overdue = openTasks.filter(t => t.due && t.due < today);
  const todaysEvents = (d.calendar || []).filter(e => ymd(e.start) === today);
  const nextEvents = (d.calendar || []).filter(e => new Date(e.end || e.start) >= new Date()).slice(0, 3);
  const unread = (d.mail || []).filter(m => m.unread);
  const waiting = (d.chats || []).filter(c => c.waitingForReply);
  const pending = (d.drafts || []).filter(a => a.status === 'pending');
  const week = useMemo(() => { const s = new Date(); const dow = (s.getDay() + 6) % 7; return Array.from({ length: 7 }, (_, i) => ymd(addDays(s, i - dow))); }, []);
  const firstName = String(user.name || '').split(' ')[0];
  const setupMissing = status && !status.model;
  const idle = !busy && !answer && !lastQ;
  const open = (view, id = null) => setSheet({ view, id });
  const loading = <Loader2 size={14} className="spin muted" />;

  const bodies = {
    calendar: errs.calendar === 'google' ? <NeedsSetup what="Google Calendar" section="google" /> : d.calendar === null ? loading : (
      <>
        <div className="weekstrip">
          {week.map((day, i) => {
            const n = (d.calendar || []).filter(e => ymd(e.start) === day).length;
            return (
              <div key={day} className={day === today ? 't' : day < today ? 'past' : ''}>
                <div className="wd">{'MTWTFSS'[i]}</div><div className="dn">{Number(day.slice(8))}</div>
                <div className="dots">{Array.from({ length: Math.min(n, 3) }, (_, k) => <span key={k} />)}</div>
              </div>
            );
          })}
        </div>
        {nextEvents.length ? nextEvents.map(e => (
          <div key={e.id} className="st-row"><Clock size={12} color="#d97706" /><span className="grow clip">{e.title}</span><span className="st-meta">{ymd(e.start) === today ? (e.allDay ? 'Today' : timeOf(e.start)) : `${new Date(e.start).toLocaleDateString(undefined, { weekday: 'short' })} ${new Date(e.start).getDate()}`}</span></div>
        )) : <div className="st-muted">Nothing coming up</div>}
      </>
    ),
    chats: status && !status.whatsapp && !status.telegram ? <NeedsSetup what="WhatsApp or Telegram" section="whatsapp" /> : d.chats === null ? loading : !d.chats.length ? <div className="st-muted">No messages yet</div> : (
      <>
        {waiting.length > 0 && <div className="st-big"><b>{waiting.length}</b><span className="st-meta">waiting for your reply</span></div>}
        {(waiting.length ? waiting : d.chats).slice(0, 3).map(c => (
          <div key={c.chatId} className="st-row fa-mini-row" role="button" tabIndex={0} data-testid="mini-chat" onClick={stop(() => open('chats', String(c.chatId)))}>
            <Avatar name={c.name} size={24} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 5 }}><span className="st-name clip">{c.name}</span><span className={`chan ${c.channel}`}>{c.channel === 'whatsapp' ? 'WA' : 'TG'}</span></div>
              <div className="st-meta clip">{c.lastMessage}</div>
            </div>
            <span className="st-meta">{ago(c.lastAt)}</span>
          </div>
        ))}
      </>
    ),
    tasks: errs.tasks === 'google' ? <NeedsSetup what="Google Tasks" section="google" /> : d.tasks === null ? loading : !openTasks.length ? <div className="st-muted">No open tasks</div> : (
      <>
        <div className="st-big"><b>{openTasks.length}</b><span className="st-meta">open{overdue.length ? ` · ${overdue.length} overdue` : ''}</span></div>
        {openTasks.slice(0, 3).map(t => (
          <div key={t.id} className="st-row">
            <button className="check" aria-label={`Mark ${t.title} done`} onClick={stop(async () => { await api.patch(`/tasks/${encodeURIComponent(t.listId)}/${encodeURIComponent(t.id)}`, { status: 'completed' }).catch(() => {}); load(['tasks']); })} />
            <span className="grow clip">{t.title}</span>
            {t.due && <span className={`pill ${t.due < today ? 'red' : t.due === today ? 'amber' : ''}`}>{t.due === today ? 'Today' : new Date(`${t.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
          </div>
        ))}
      </>
    ),
    mail: errs.mail === 'google' ? <NeedsSetup what="Gmail" section="google" /> : d.mail === null ? loading : !d.mail.length ? <div className="st-muted">Inbox is empty</div> : (
      <>
        {unread.length > 0 && <div className="st-big"><b>{unread.length}</b><span className="st-meta">unread</span></div>}
        {(unread.length ? unread : d.mail).slice(0, 3).map(m => (
          <div key={m.id} className="st-row fa-mini-row" role="button" tabIndex={0} data-testid="mini-mail" onClick={stop(() => open('mail', m.id))}>
            <Avatar name={senderName(m.from)} size={24} />
            <div className="grow" style={{ minWidth: 0 }}><div className="st-name clip" style={{ fontWeight: m.unread ? 800 : 600 }}>{senderName(m.from)}</div><div className="st-meta clip">{m.subject}</div></div>
            <span className="st-meta">{ago(m.date)}</span>
          </div>
        ))}
      </>
    ),
    drafts: d.drafts === null ? loading : !pending.length ? <div className="st-muted">Nothing waiting — drafts Forge prepares land here.</div> : pending.slice(0, 3).map(a => (
      <div key={a.id} className="st-row draft" data-testid="draft-row">
        {draftIcon(a.kind)}
        <span className="grow clip" style={{ fontWeight: 600 }}>{a.title}</span>
        <button className="btn primary sm" onClick={stop(() => decide(a, true))}><Check size={12} />Send</button>
        <button className="btn ghost icon sm" aria-label="Discard" onClick={stop(() => decide(a, false))}><X size={13} /></button>
      </div>
    )),
  };
  const counts = { calendar: todaysEvents.length, chats: waiting.length, tasks: overdue.length, mail: unread.length, drafts: pending.length };
  const rail = (side, ids) => (
    <div className={`rail rail-${side} fa-scroll`} data-testid={`rail-${side}`}>
      <div className="rail-in">
        {ids.map(id => <Station key={id} id={id} count={counts[id]} used={used.includes(id)} scanning={scan.includes(id)} onOpen={() => open(id)}>{bodies[id]}</Station>)}
      </div>
    </div>
  );
  const sources = !answer?.error && used.length > 0 && (
    <div className="sources">
      {used.map(id => { const I = STATION[id].Icon; return <button key={id} type="button" onClick={() => open(id)} data-testid="answer-source"><I size={12} />Open {STATION[id].title.replace(' to approve', '')}</button>; })}
    </div>
  );

  return (
    <main className={`fa-office office2 ${idle ? 'idle' : 'answering'}`} data-testid="office">
      <div className="toolbar">
        {(answer || convId) && <RoundBtn title="New conversation" testid="new-chat" onClick={newChat}><Plus size={16} /></RoundBtn>}
        <RoundBtn title="Conversations" testid="open-history" onClick={() => setHistoryOpen(true)}><History size={16} /></RoundBtn>
        <a className="roundbtn" href="#/settings" title="Settings" aria-label="Settings"><Settings2 size={16} /></a>
      </div>
      {proc.length > 0 && (
        <div className="proc-lines" data-testid="proc-lines">
          {proc.map(l => (
            <div key={l.id} className="fa-proc-line">
              {l.status === 'running' ? <Loader2 size={12} className="spin" /> : l.status === 'error' ? <AlertTriangle size={12} color="#fca5a5" /> : <CheckCircle2 size={12} color="#86efac" />}{l.label}
            </div>
          ))}
        </div>
      )}

      {rail('left', LEFT)}
      {rail('right', RIGHT)}

      <section className="centre">
        <div className={`bot ${sheet ? 'away' : ''}`} data-testid="assistant-logo">
          <div className={`fa-halo ${busy || speaking || live === 'live' ? 'on' : ''}`} />
          <div className="logo-float-anim"><img className="bot-gif" src="/forge-ai-blink.gif" alt="Forge AI" /></div>
        </div>
        <div className="centre-body" data-testid="chatlog">
          {idle && (
            <>
              <div className="greeting" data-testid="greeting">Hi{firstName ? ` ${firstName}` : ''}, I'm Forge AI</div>
              <div className="tagline"><ShieldCheck size={14} color="#16a34a" />I read your tasks, calendar, mail and chats. I only prepare drafts — nothing is sent until you press Send.</div>
              {demo && <div className="banner info demo-banner" data-testid="demo-banner"><FlaskConical size={14} style={{ verticalAlign: -2, marginRight: 4 }} /><strong>Demo mode</strong> — sample data so you can see how it works. Turn <strong>Demo</strong> off in the top bar to use your own accounts.</div>}
              {!demo && setupMissing && <div className="banner warn" data-testid="setup-banner"><AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Add your model key in <a href="#/settings/model">Settings → Model</a> (OpenAI or Anthropic), then connect Google, WhatsApp or Telegram.</div>}
              <div className="suggest">{SUGGESTIONS.map((s, i) => <button key={s} className={i === 0 ? 'first' : ''} onClick={() => ask(s)}>{i === 0 && <Sparkles size={13} />}{s}</button>)}</div>
            </>
          )}
          {lastQ && <div className="asked" data-testid="asked">“{lastQ}”</div>}
          {busy && !answer && <div className="answer-card thinking"><span className="fa-dots"><span /><span /><span /></span></div>}
          {answer && (
            <div className={`answer-card fa-answer-in fa-scroll ${answer.error ? 'err' : ''}`} data-testid="answer">
              {answer.error ? <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><span>{answer.text}</span></div> : <Answer text={answer.text} />}
              {sources}
            </div>
          )}
        </div>
      </section>

      <form className="composer2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        {live && (
          <span className="live-ind" data-testid="live-pill"><span className={live === 'live' ? 'fa-live-dot' : ''} />{live === 'connecting' ? 'Connecting…' : speaking ? 'Speaking' : 'Listening'}</span>
        )}
        <input ref={inputRef} value={input} aria-label="Message Forge" data-testid="assistant-input"
          placeholder={live === 'live' ? 'Talk, or type here…' : 'Ask Forge AI, or tell it what to prepare…'}
          onChange={(e) => setInput(e.target.value)} />
        <button type="button" className={`talkbtn ${live ? 'on' : ''}`} onClick={toggleTalk} data-testid="talk-btn" title={live ? 'End live voice' : 'Talk to Forge AI'}>
          {live === 'connecting' ? <Loader2 size={16} className="spin" /> : live ? <><PhoneOff size={16} />End</> : <><Mic size={16} />Talk</>}
        </button>
        {busy && !live ? (
          <button type="button" className="sendbtn" onClick={() => abortRef.current?.abort()} aria-label="Stop"><Loader2 size={17} className="spin" /></button>
        ) : (
          <button className="sendbtn" disabled={!input.trim()} aria-label="Send"><Send size={17} /></button>
        )}
      </form>

      {sheet && <Sheet key={String(demo)} sheet={sheet} setSheet={setSheet} data={d} errs={errs} status={status} reload={load} decide={decide} />}
      {historyOpen && <HistoryModal api={api} convId={convId} onOpen={openConversation} onClose={() => setHistoryOpen(false)} onNew={() => { newChat(); setHistoryOpen(false); }} />}
    </main>
  );
}

function HistoryModal({ api, convId, onOpen, onClose, onNew }) {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(convId);
  const [msgs, setMsgs] = useState(null);
  const reload = useCallback(() => api.get('/assistant/conversations').then(r => setList(r.conversations)).catch(() => setList([])), [api]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (!sel) { setMsgs(null); return; } setMsgs(null); api.get(`/assistant/conversations/${sel}`).then(r => setMsgs(r.messages)).catch(() => setMsgs([])); }, [sel, api]);
  return (
    <Modal title="Conversations" onClose={onClose} wide>
      <div className="sheet-body" data-testid="sheet-history">
        <div className="split">
          <div className="pane">
            <div style={{ padding: 8 }}><button className="btn sm" onClick={onNew}><Plus size={14} />New conversation</button></div>
            <div className="scroll" style={{ flex: 1 }}>
              {list === null ? <div className="empty"><Loader2 size={16} className="spin" /></div> : !list.length ? <div className="empty">No conversations yet.</div> : list.map(c => (
                <div key={c.id} className={`list-item ${sel === c.id ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => setSel(c.id)}>
                  <div className="grow"><div className="clip" style={{ fontWeight: 700, fontSize: 13.5 }}>{c.title}</div><div className="muted" style={{ fontSize: 12 }}>{ago(`${String(c.updated_at).replace(' ', 'T')}Z`)}</div></div>
                  <button className="btn ghost icon sm" aria-label="Delete conversation" onClick={async (e) => { e.stopPropagation(); await api.del(`/assistant/conversations/${c.id}`); if (sel === c.id) setSel(null); reload(); }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="pane">
            {!sel ? <div className="empty" style={{ margin: 'auto' }}>Pick a conversation to read it.</div> : msgs === null ? <div className="empty" style={{ margin: 'auto' }}><Loader2 size={16} className="spin" /></div> : (
              <>
                <div className="thread scroll">
                  {msgs.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'out' : 'in'}`}>{m.role === 'assistant' ? <Answer text={m.content} /> : m.content}</div>)}
                </div>
                <div style={{ padding: 10, display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => onOpen(sel)}>Continue this conversation</button></div>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
