// The office cards opened full size.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Check, X, ChevronLeft, ChevronRight, Send, MessageSquare, Mail, CalendarPlus, ListPlus, ListChecks, Search, Trash2, ExternalLink, Reply } from 'lucide-react';
import { api } from '../api';
import { Modal, Avatar } from '../components/ui.jsx';
import { ago, timeOf, todayYmd, ymd, addDays, dayLabel, senderName } from '../lib/util';

const TITLES = { tasks: 'Tasks', calendar: 'Calendar', mail: 'Mail', chats: 'Chats', drafts: 'Drafts to approve' };

export function Sheet({ sheet, setSheet, data, errs, status, reload, decide }) {
  const close = () => setSheet(null);
  const view = sheet.view;
  useEffect(() => {
    const on = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  });
  const notGoogle = ['tasks', 'calendar', 'mail'].includes(view) && errs[view] === 'google';
  return (
    <Modal title={TITLES[view] || 'Open Forge'} onClose={close} wide>
      <div className="sheet-body" data-testid={`sheet-${view}`}>
        {notGoogle ? <div className="empty">Google isn't connected. <a href="#/settings/google" onClick={close}>Connect it in Settings</a>.</div>
          : view === 'tasks' ? <TasksSheet tasks={data.tasks || []} reload={() => reload(['tasks'])} />
          : view === 'calendar' ? <CalendarSheet reload={() => reload(['calendar'])} />
          : view === 'mail' ? <MailSheet initialId={sheet.id} />
          : view === 'chats' ? <ChatsSheet chats={data.chats || []} initialId={sheet.id} status={status} reload={() => reload(['chats'])} />
          : view === 'drafts' ? <DraftsSheet drafts={data.drafts || []} focusId={sheet.id} reload={() => reload(['drafts', 'chats', 'mail', 'calendar', 'tasks'])} decide={decide} />
          : null}
      </div>
    </Modal>
  );
}

export function draftIcon(kind) {
  const p = { size: 15, style: { flexShrink: 0 } };
  if (kind === 'chat_message') return <MessageSquare {...p} color="#0891b2" />;
  if (kind === 'email' || kind === 'email_reply') return <Mail {...p} color="#2563eb" />;
  if (kind === 'calendar_event') return <CalendarPlus {...p} color="#d97706" />;
  if (kind === 'task_done') return <ListChecks {...p} color="#16a34a" />;
  return <ListPlus {...p} color="#16a34a" />;
}

// ── Tasks: kanban by due date. Drag a card to re-date it, or onto Done. ──
function TasksSheet({ tasks, reload }) {
  const today = todayYmd();
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [adding, setAdding] = useState({ title: '', due: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cols = [
    { id: 'overdue', title: 'Overdue', pick: t => t.status !== 'completed' && t.due && t.due < today, due: null },
    { id: 'today', title: 'Today', pick: t => t.status !== 'completed' && t.due === today, due: today },
    { id: 'later', title: 'Upcoming & no date', pick: t => t.status !== 'completed' && (!t.due || t.due > today), due: '' },
    { id: 'done', title: 'Done', pick: t => t.status === 'completed', due: null },
  ];
  async function patch(t, body) { setErr(''); try { await api.patch(`/tasks/${encodeURIComponent(t.listId)}/${encodeURIComponent(t.id)}`, body); } catch (e) { setErr(e.message); } reload(); }
  async function drop(col) {
    const t = tasks.find(x => x.id === drag); setDrag(null); setOver(null);
    if (!t || col.id === 'overdue') return;
    if (col.id === 'done') return patch(t, { status: 'completed' });
    return patch(t, { ...(t.status === 'completed' ? { status: 'needsAction' } : {}), due: col.id === 'today' ? today : (t.due && t.due > today ? t.due : null) });
  }
  async function add(e) {
    e.preventDefault(); if (!adding.title.trim()) return;
    setBusy(true); setErr('');
    try { await api.post('/tasks', { title: adding.title.trim(), due: adding.due || null }); setAdding({ title: '', due: '' }); reload(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={add}>
        <input className="input grow" placeholder="Add a task…" value={adding.title} onChange={e => setAdding({ ...adding, title: e.target.value })} aria-label="New task title" />
        <input className="input" type="date" style={{ width: 160 }} value={adding.due} onChange={e => setAdding({ ...adding, due: e.target.value })} aria-label="Due date" />
        <button className="btn primary" disabled={busy || !adding.title.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}Add</button>
      </form>
      {err && <div className="banner err" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="kanban" data-testid="kanban">
        {cols.map(col => {
          const items = tasks.filter(col.pick).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
          return (
            <div key={col.id} className={`kcol scroll ${over === col.id ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver(null)} onDrop={() => drop(col)}>
              <h4>{col.title}<span className="pill">{items.length}</span></h4>
              {!items.length && <div className="empty" style={{ padding: 8 }}>—</div>}
              {items.slice(0, col.id === 'done' ? 30 : 200).map(t => (
                <div key={t.id} className={`kcard ${drag === t.id ? 'dragging' : ''}`} draggable onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null); }}>
                  <button className={`check ${t.status === 'completed' ? 'on' : ''}`} aria-label={t.status === 'completed' ? 'Mark not done' : 'Mark done'}
                    onClick={() => patch(t, { status: t.status === 'completed' ? 'needsAction' : 'completed' })}>{t.status === 'completed' && <Check size={12} />}</button>
                  <div className="grow">
                    <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: t.status === 'completed' ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>{t.title}</div>
                    {t.notes && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t.notes.slice(0, 120)}</div>}
                    <div className="row" style={{ gap: 5, marginTop: 5 }}>
                      {t.due && <span className={`pill ${t.status !== 'completed' && t.due < today ? 'red' : ''}`}>{new Date(`${t.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
                      <span className="pill">{t.list}</span>
                    </div>
                  </div>
                  <button className="btn ghost icon" aria-label="Delete task" onClick={async () => { if (window.confirm(`Delete “${t.title}”?`)) { await api.del(`/tasks/${encodeURIComponent(t.listId)}/${encodeURIComponent(t.id)}`).catch(e => setErr(e.message)); reload(); } }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Calendar: a week at a time, plus "add event". ──
function CalendarSheet({ reload }) {
  const [start, setStart] = useState(() => { const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; });
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const fetchWeek = () => { setEvents(null); api.get(`/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(addDays(start, 7).toISOString())}`).then(r => setEvents(r.events)).catch(e => { setErr(e.message); setEvents([]); }); };
  useEffect(fetchWeek, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayYmd();
  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      const body = form.allDay ? { title: form.title, start: form.date, end: ymd(addDays(new Date(`${form.date}T00:00:00`), 1)), allDay: true }
        : { title: form.title, start: new Date(`${form.date}T${form.from}`).toISOString(), end: new Date(`${form.date}T${form.to}`).toISOString(), location: form.location };
      await api.post('/calendar', body); setForm(null); fetchWeek(); reload();
    } catch (x) { setErr(x.message); }
  }
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn icon" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={16} /></button>
        <button className="btn sm" onClick={() => { const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); setStart(s); }}>This week</button>
        <button className="btn icon" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={16} /></button>
        <strong className="grow">{dayLabel(days[0])} – {dayLabel(days[6])}</strong>
        <button className="btn primary" onClick={() => setForm({ title: '', date: today, from: '10:00', to: '10:30', allDay: false, location: '' })}><Plus size={15} />Event</button>
      </div>
      {err && <div className="banner err" style={{ marginBottom: 10 }}>{err}</div>}
      {form && (
        <form className="card" style={{ padding: 12, marginBottom: 12, background: 'var(--fc-raised)', boxShadow: 'none' }} onSubmit={save}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '2 1 220px' }} placeholder="Event title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required aria-label="Event title" />
            <input className="input" type="date" style={{ width: 150 }} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required aria-label="Date" />
            {!form.allDay && <><input className="input" type="time" style={{ width: 110 }} value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} aria-label="From" /><input className="input" type="time" style={{ width: 110 }} value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} aria-label="To" /></>}
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={form.allDay} onChange={e => setForm({ ...form, allDay: e.target.checked })} />All day</label>
            <button className="btn primary">Add to calendar</button><button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="week">
        {days.map(d => {
          const key = ymd(d);
          const evs = (events || []).filter(e => ymd(e.start) === key);
          return (
            <div key={key} className={`day scroll ${key === today ? 'today' : ''}`}>
              <h4>{d.toLocaleDateString(undefined, { weekday: 'short' })} <span style={{ fontSize: 16, color: 'var(--fc-text)' }}>{d.getDate()}</span></h4>
              {events === null ? <Loader2 size={14} className="spin muted" /> : evs.map(e => (
                <a key={e.id} className="ev" href={e.link} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="time">{e.allDay ? 'All day' : `${timeOf(e.start)} – ${timeOf(e.end)}`}</div>
                  <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{e.title}</div>
                  {e.location && <div className="muted" style={{ fontSize: 11.5 }}>{e.location}</div>}
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Mail: inbox list + reader + reply. ──
function MailSheet({ initialId }) {
  const [q, setQ] = useState('in:inbox');
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(initialId || null);
  const [msg, setMsg] = useState(null);
  const [reply, setReply] = useState('');
  const [state, setState] = useState({ busy: false, err: '', ok: '' });
  const search = (query = q) => { setList(null); api.get(`/mail?q=${encodeURIComponent(query)}&max=25`).then(r => setList(r.messages)).catch(e => { setState(s => ({ ...s, err: e.message })); setList([]); }); };
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sel) return; setMsg(null); setReply(''); setState({ busy: false, err: '', ok: '' }); api.get(`/mail/${encodeURIComponent(sel)}`).then(setMsg).catch(e => setState(s => ({ ...s, err: e.message }))); }, [sel]);
  async function send() {
    setState({ busy: true, err: '', ok: '' });
    try { await api.post('/mail/send', { replyToId: sel, body: reply }); setReply(''); setState({ busy: false, err: '', ok: 'Reply sent.' }); }
    catch (e) { setState({ busy: false, err: e.message, ok: '' }); }
  }
  return (
    <div className="split">
      <div className="pane">
        <form className="row" style={{ padding: 8 }} onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="input grow" value={q} onChange={e => setQ(e.target.value)} aria-label="Search mail" placeholder="Gmail search, e.g. is:unread" />
          <button className="btn icon" aria-label="Search"><Search size={15} /></button>
        </form>
        <div className="scroll" style={{ flex: 1 }}>
          {list === null ? <div className="empty"><Loader2 size={16} className="spin" /></div> : !list.length ? <div className="empty">No messages.</div> : list.map(m => (
            <button key={m.id} className={`list-item ${sel === m.id ? 'on' : ''}`} onClick={() => setSel(m.id)}>
              <Avatar name={senderName(m.from)} size={30} />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}><span className="clip grow" style={{ fontWeight: m.unread ? 800 : 600, fontSize: 13.5 }}>{senderName(m.from)}</span><span className="muted" style={{ fontSize: 11.5 }}>{ago(m.date)}</span></div>
                <div className="clip" style={{ fontSize: 13, fontWeight: m.unread ? 700 : 500 }}>{m.subject}</div>
                <div className="clip muted" style={{ fontSize: 12 }}>{m.snippet}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="pane">
        {!sel ? <div className="empty" style={{ margin: 'auto' }}>Pick an email to read it.</div> : !msg ? <div className="empty" style={{ margin: 'auto' }}>{state.err || <Loader2 size={16} className="spin" />}</div> : (
          <>
            <div style={{ padding: 16, flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 800 }}>{msg.subject}</h3>
              <div className="muted" style={{ fontSize: 12.5 }}>From <strong className="sec">{senderName(msg.from)}</strong> · {new Date(msg.date).toLocaleString()}</div>
            </div>
            <div className="scroll mailbody" style={{ flex: 1, padding: '0 16px 12px' }}>{msg.body || msg.snippet}</div>
            <div style={{ padding: 12, flexShrink: 0 }}>
              {state.err && <div className="banner err" style={{ marginBottom: 8 }}>{state.err}</div>}
              {state.ok && <div className="banner ok" style={{ marginBottom: 8 }}>{state.ok}</div>}
              <textarea className="textarea" style={{ background: 'var(--fc-card)' }} placeholder={`Reply to ${senderName(msg.from)}…`} value={reply} onChange={e => setReply(e.target.value)} aria-label="Reply" />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn primary" disabled={!reply.trim() || state.busy} onClick={send}>{state.busy ? <Loader2 size={15} className="spin" /> : <Reply size={15} />}Send reply</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Chats: WhatsApp + Telegram inbox. ──
function ChatsSheet({ chats, initialId, status, reload }) {
  const [sel, setSel] = useState(initialId ? Number(initialId) : (chats[0]?.chatId || null));
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [state, setState] = useState({ busy: false, err: '' });
  const [filter, setFilter] = useState('all');
  const endRef = useRef(null);
  const load = () => { if (sel) api.get(`/chats/${sel}/messages`).then(setThread).catch(e => setState({ busy: false, err: e.message })); };
  useEffect(() => { setThread(null); setState({ busy: false, err: '' }); load(); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const es = new EventSource('/api/events'); es.addEventListener('chats', load); return () => es.close(); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread]);
  async function send(e) {
    e.preventDefault(); if (!text.trim()) return;
    setState({ busy: true, err: '' });
    try { await api.post(`/chats/${sel}/send`, { text }); setText(''); load(); reload(); setState({ busy: false, err: '' }); }
    catch (x) { setState({ busy: false, err: x.message }); }
  }
  const shown = chats.filter(c => filter === 'all' || (filter === 'waiting' ? c.waitingForReply : c.channel === filter));
  if (!chats.length) {
    return <div className="empty" style={{ margin: 'auto', maxWidth: 420 }}>No chats yet. {(!status?.whatsapp && !status?.telegram) ? <>Connect <a href="#/settings/whatsapp">WhatsApp</a> or <a href="#/settings/telegram">Telegram</a> in Settings; </> : null}new messages arrive here as soon as someone writes to your number or bot.</div>;
  }
  return (
    <div className="split">
      <div className="pane">
        <div className="seg" style={{ margin: 8 }}>
          {[['all', 'All'], ['waiting', 'Waiting'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <div className="scroll" style={{ flex: 1 }}>
          {shown.map(c => (
            <button key={c.chatId} className={`list-item ${sel === c.chatId ? 'on' : ''}`} onClick={() => setSel(c.chatId)}>
              <Avatar name={c.name} size={32} />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}><span className="clip grow" style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</span><span className="muted" style={{ fontSize: 11.5 }}>{ago(c.lastAt)}</span></div>
                <div className="row" style={{ gap: 6 }}><span className={`pill ${c.channel === 'whatsapp' ? 'green' : 'blue'}`} style={{ padding: '1px 6px', fontSize: 10 }}>{c.channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}</span><span className="clip muted grow" style={{ fontSize: 12 }}>{c.lastMessage}</span>{c.unread > 0 && <span className="pill red">{c.unread}</span>}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="pane">
        {!thread ? <div className="empty" style={{ margin: 'auto' }}>{state.err || (sel ? <Loader2 size={16} className="spin" /> : 'Pick a chat.')}</div> : (
          <>
            <div className="row" style={{ padding: '12px 14px', flexShrink: 0 }}>
              <Avatar name={thread.chat.name} size={34} />
              <div className="grow"><div style={{ fontWeight: 800 }}>{thread.chat.name}</div><div className="muted" style={{ fontSize: 12 }}>{thread.chat.channel === 'whatsapp' ? `WhatsApp · ${thread.chat.number}` : 'Telegram'}</div></div>
            </div>
            <div className="thread scroll">
              {thread.messages.map(m => (
                <div key={m.id} className={`msg ${m.direction}`}>{m.text}<div className="at">{timeOf(m.at)}{m.direction === 'out' && m.status ? ` · ${m.status}` : ''}</div></div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={send} style={{ padding: 10, flexShrink: 0 }}>
              {thread.chat.channel === 'whatsapp' && !thread.chat.replyWindowOpen && <div className="banner info" style={{ marginBottom: 8 }}>WhatsApp's 24-hour reply window is closed for this chat — Meta only allows a free-text reply within 24 hours of their last message.</div>}
              {state.err && <div className="banner err" style={{ marginBottom: 8 }}>{state.err}</div>}
              <div className="row">
                <input className="input grow" style={{ background: 'var(--fc-card)' }} value={text} onChange={e => setText(e.target.value)} placeholder="Type a reply…" aria-label="Reply" />
                <button className="btn primary" disabled={!text.trim() || state.busy}>{state.busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}Send</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── Drafts: what Forge prepared, waiting for the user. ──
export function DraftCard({ a, onDone, focus }) {
  const editable = { chat_message: ['text'], email: ['to', 'subject', 'body'], email_reply: ['body'], calendar_event: ['title', 'start', 'end'], task: ['title', 'due', 'notes'], task_done: [] }[a.kind] || [];
  const [edits, setEdits] = useState({});
  const [state, setState] = useState({ busy: false, err: '' });
  const ref = useRef(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: 'center' }); }, [focus]);
  const val = (k) => (edits[k] ?? a.payload[k] ?? '');
  const LABEL = { text: 'Message', to: 'To', subject: 'Subject', body: 'Body', title: 'Title', start: 'Start', end: 'End', due: 'Due (YYYY-MM-DD)', notes: 'Notes' };
  const verb = { chat_message: 'Send', email: 'Send email', email_reply: 'Send reply', calendar_event: 'Add to calendar', task: 'Create task', task_done: 'Mark done' }[a.kind] || 'Confirm';
  async function go(ok) {
    setState({ busy: true, err: '' });
    try { if (ok) await api.post(`/actions/${a.id}/confirm`, { edits }); else await api.post(`/actions/${a.id}/discard`); onDone(); }
    catch (e) { setState({ busy: false, err: e.message }); }
  }
  const done = a.status !== 'pending';
  return (
    <div ref={ref} className="card" style={{ padding: 14, boxShadow: focus ? '0 0 0 2px var(--fc-primary)' : undefined, background: 'var(--fc-raised)', marginBottom: 10 }} data-testid="draft-card">
      <div className="row" style={{ marginBottom: 10 }}>
        {draftIcon(a.kind)}<strong className="grow">{a.title}</strong>
        <span className={`pill ${a.status === 'done' ? 'green' : a.status === 'failed' ? 'red' : a.status === 'pending' ? 'amber' : ''}`}>{a.status === 'done' ? 'sent' : a.status}</span>
      </div>
      {editable.map(k => (
        <div key={k} className="field" style={{ marginBottom: 8 }}>
          <label className="label">{LABEL[k]}</label>
          {['text', 'body', 'notes'].includes(k)
            ? <textarea className="textarea" style={{ background: 'var(--fc-card)' }} value={val(k)} disabled={done} onChange={e => setEdits({ ...edits, [k]: e.target.value })} />
            : <input className="input" style={{ background: 'var(--fc-card)' }} value={val(k) || ''} disabled={done} onChange={e => setEdits({ ...edits, [k]: e.target.value })} />}
        </div>
      ))}
      {a.kind === 'task_done' && <div className="muted" style={{ marginBottom: 8 }}>Marks “{a.payload.title || 'this task'}” as done in Google Tasks.</div>}
      {a.status === 'failed' && a.result?.error && <div className="banner err" style={{ marginBottom: 8 }}>{a.result.error}</div>}
      {state.err && <div className="banner err" style={{ marginBottom: 8 }}>{state.err}</div>}
      {!done && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" disabled={state.busy} onClick={() => go(false)}><X size={14} />Discard</button>
          <button className="btn primary" disabled={state.busy} onClick={() => go(true)}>{state.busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{verb}</button>
        </div>
      )}
      {a.status === 'done' && a.result?.link && <a href={a.result.link} target="_blank" rel="noreferrer" className="row" style={{ gap: 5, fontSize: 13 }}>Open in Google <ExternalLink size={12} /></a>}
    </div>
  );
}

function DraftsSheet({ drafts, focusId, reload }) {
  const pending = drafts.filter(a => a.status === 'pending');
  const recent = drafts.filter(a => a.status !== 'pending');
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div className="banner info" style={{ marginBottom: 12 }}>Forge never sends anything on its own. Everything it prepares waits here — edit it if you like, then press the button.</div>
      {!pending.length && <div className="empty">No drafts waiting.</div>}
      {pending.map(a => <DraftCard key={a.id} a={a} onDone={reload} focus={String(a.id) === String(focusId)} />)}
      {recent.length > 0 && <div className="eyebrow" style={{ margin: '14px 0 8px' }}>Last 24 hours</div>}
      {recent.map(a => <DraftCard key={a.id} a={a} onDone={reload} />)}
    </div>
  );
}
