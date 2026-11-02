// The assistant's tools. READ tools look at the user's own Google + chat data.
// WRITE tools never act: each one only PREPARES a draft (an `actions` row) that
// appears on the Drafts card, where the user presses Send / Confirm. There is
// deliberately no tool that sends, emails, books or deletes on its own — a unit
// test fails if one is added.
const db = require('../db');
const google = require('../integrations/google');

const maskPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 6) return d ? '••••' : '';
  const rest = d.slice(-10); const cc = d.slice(0, -10);
  return `${cc ? `+${cc} ` : ''}${rest.slice(0, 2)}••••${rest.slice(-2)}`;
};
const chatName = (c) => c.name || (c.channel === 'whatsapp' ? maskPhone(c.external_id) : `Telegram ${c.external_id}`);

function chatRow(c) {
  return {
    chatId: c.id, channel: c.channel, name: chatName(c),
    number: c.channel === 'whatsapp' ? maskPhone(c.external_id) : null,
    lastMessage: c.last_text, lastAt: c.last_at, unread: c.unread,
    waitingForReply: !!c.last_inbound_at && (!c.last_at || c.last_inbound_at >= c.last_at),
    replyWindowOpen: c.channel !== 'whatsapp' || (c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600e3),
  };
}

function prepare(userId, kind, title, payload) {
  const r = db.prepare('INSERT INTO actions (user_id, kind, title, payload) VALUES (?,?,?,?)').run(userId, kind, title.slice(0, 160), JSON.stringify(payload));
  return { draftId: Number(r.lastInsertRowid), status: 'waiting_for_user', note: 'Drafted only. Tell the user it is on the Drafts card and nothing is sent until they press the button.' };
}

const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { return { ...fallback, unavailable: e.message }; } };
const ymd = (d) => d.toISOString().slice(0, 10);

const TOOLS = [
  {
    name: 'get_overview',
    description: 'A snapshot of the user\'s day: today\'s calendar, open and overdue tasks, unread inbox mail, chats waiting for a reply and drafts waiting for them. Call this first for "what\'s on today" / "where am I" questions.',
    input_schema: { type: 'object', properties: {} },
    panels: ['calendar', 'tasks', 'mail', 'chats', 'drafts'],
    async run(user) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const events = await safe(() => google.listEvents(user.id, { from: today, to: new Date(today.getTime() + 864e5), max: 20 }).then(items => ({ items })), { items: [] });
      const tasks = await safe(async () => {
        const { tasks } = await google.listTasks(user.id, { showCompleted: false });
        const t = ymd(new Date());
        return { open: tasks.length, overdue: tasks.filter(x => x.due && x.due < t).length, dueToday: tasks.filter(x => x.due === t).map(x => x.title) };
      }, {});
      const mail = await safe(async () => ({ unread: (await google.listMail(user.id, { q: 'in:inbox is:unread', max: 10 })).map(m => ({ id: m.id, from: m.from, subject: m.subject })) }), {});
      const chats = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY last_at DESC LIMIT 50').all(user.id).map(chatRow).filter(c => c.waitingForReply).slice(0, 10);
      const drafts = db.prepare(`SELECT id, kind, title FROM actions WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 10`).all(user.id);
      return { today: ymd(new Date()), events: events.items, eventsNote: events.unavailable, tasks, mail, chatsWaiting: chats, drafts };
    },
  },
  {
    name: 'list_tasks',
    description: 'The user\'s Google Tasks (all lists), with due dates. status: open (default), done or all.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all'] } } },
    panels: ['tasks'],
    async run(user, { status = 'open' }) {
      const { tasks } = await google.listTasks(user.id, { showCompleted: status !== 'open' });
      const f = status === 'done' ? tasks.filter(t => t.status === 'completed') : status === 'open' ? tasks.filter(t => t.status !== 'completed') : tasks;
      return { count: f.length, tasks: f.slice(0, 80).map(({ id, listId, list, title, due, status: st, notes }) => ({ id, listId, list, title, due, status: st, notes: notes.slice(0, 200) })) };
    },
  },
  {
    name: 'list_events',
    description: 'Events on the user\'s primary Google Calendar between two dates (YYYY-MM-DD, inclusive). Defaults to today through the next 7 days.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
    panels: ['calendar'],
    async run(user, { from, to }) {
      const f = from ? new Date(`${from}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
      const t = to ? new Date(`${to}T23:59:59`) : new Date(f.getTime() + 8 * 864e5);
      return { events: await google.listEvents(user.id, { from: f, to: t, max: 100 }) };
    },
  },
  {
    name: 'search_mail',
    description: 'Search the user\'s Gmail with Gmail search syntax (default "in:inbox"). Examples: "is:unread", "from:alice newer_than:7d", "subject:invoice". Returns sender, subject, date and snippet.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number', description: '1-30, default 10' } } },
    panels: ['mail'],
    async run(user, { query, max = 10 }) {
      return { messages: await google.listMail(user.id, { q: query || 'in:inbox', max: Math.max(1, Math.min(30, Number(max) || 10)) }) };
    },
  },
  {
    name: 'read_mail',
    description: 'Read one Gmail message in full by its id (from search_mail).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    panels: ['mail'],
    async run(user, { id }) { const m = await google.readMail(user.id, id); return { ...m, body: m.body.slice(0, 8000) }; },
  },
  {
    name: 'list_chats',
    description: 'The unified WhatsApp + Telegram inbox, newest first. waitingOnly=true lists only chats whose last message is from the other person.',
    input_schema: { type: 'object', properties: { channel: { type: 'string', enum: ['whatsapp', 'telegram'] }, waitingOnly: { type: 'boolean' }, search: { type: 'string' } } },
    panels: ['chats'],
    async run(user, { channel, waitingOnly, search }) {
      let rows = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY last_at DESC LIMIT 200').all(user.id);
      if (channel) rows = rows.filter(r => r.channel === channel);
      if (search) { const q = String(search).toLowerCase(); rows = rows.filter(r => (r.name || '').toLowerCase().includes(q)); }
      let out = rows.map(chatRow);
      if (waitingOnly) out = out.filter(c => c.waitingForReply);
      return { count: out.length, chats: out.slice(0, 40) };
    },
  },
  {
    name: 'read_chat',
    description: 'Read the recent messages of one chat (by chatId from list_chats), oldest first.',
    input_schema: { type: 'object', properties: { chatId: { type: 'number' }, limit: { type: 'number' } }, required: ['chatId'] },
    panels: ['chats'],
    async run(user, { chatId, limit = 40 }) {
      const c = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(Number(chatId), user.id);
      if (!c) throw new Error('No such chat.');
      const msgs = db.prepare('SELECT direction, text, kind, at FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(c.id, Math.min(Number(limit) || 40, 100)).reverse();
      return { chat: chatRow(c), messages: msgs.map(m => ({ from: m.direction === 'in' ? 'them' : 'you', text: m.text, at: m.at })) };
    },
  },
  {
    name: 'open_view',
    description: 'Open a card on the user\'s screen: tasks, calendar, mail, chats or drafts. Pass id to open one item (a mail id, or a chatId).',
    input_schema: { type: 'object', properties: { view: { type: 'string', enum: ['tasks', 'calendar', 'mail', 'chats', 'drafts'] }, id: { type: 'string' } }, required: ['view'] },
    panels: [],
    async run(user, { view, id }) { return { opened: view, ...(id ? { id } : {}) }; },
    focus: (args) => ({ view: args.view, id: args.id || null }),
  },
  // ── drafts: prepared, never sent ──
  {
    name: 'prepare_chat_reply',
    description: 'Draft a reply in a WhatsApp/Telegram chat. It is NOT sent — it waits on the Drafts card for the user to press Send.',
    input_schema: { type: 'object', properties: { chatId: { type: 'number' }, text: { type: 'string' } }, required: ['chatId', 'text'] },
    panels: ['drafts'], drafts: true,
    async run(user, { chatId, text }) {
      const c = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(Number(chatId), user.id);
      if (!c) throw new Error('No such chat.');
      if (!String(text || '').trim()) throw new Error('The reply is empty.');
      return prepare(user.id, 'chat_message', `Reply to ${chatName(c)} (${c.channel})`, { chatId: c.id, text: String(text) });
    },
  },
  {
    name: 'prepare_email',
    description: 'Draft an email, or a reply when replyToId (a Gmail message id) is given — the recipient and subject then come from that mail. NOT sent: it waits on the Drafts card.',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, replyToId: { type: 'string' } }, required: ['body'] },
    panels: ['drafts'], drafts: true,
    async run(user, { to, subject, body, replyToId }) {
      if (!replyToId && !to) throw new Error('Who is it to? Give an email address.');
      let title = `Email to ${to}`;
      if (replyToId) { const m = await google.readMail(user.id, replyToId); title = `Reply: ${m.subject}`; to = to || m.from; subject = subject || (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`); }
      return prepare(user.id, replyToId ? 'email_reply' : 'email', title, { to, subject: subject || '', body, replyToId: replyToId || null });
    },
  },
  {
    name: 'prepare_event',
    description: 'Draft a Google Calendar event. start/end are ISO date-times with offset (e.g. 2026-11-05T15:00:00+05:30), or YYYY-MM-DD with allDay=true. NOT created until the user presses Confirm.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, allDay: { type: 'boolean' }, description: { type: 'string' }, location: { type: 'string' } }, required: ['title', 'start'] },
    panels: ['drafts'], drafts: true,
    async run(user, a) {
      if (!a.allDay && isNaN(new Date(a.start))) throw new Error('start must be an ISO date-time with a timezone offset.');
      return prepare(user.id, 'calendar_event', `Event: ${a.title}`, { title: a.title, start: a.start, end: a.end || null, allDay: !!a.allDay, description: a.description || '', location: a.location || '' });
    },
  },
  {
    name: 'prepare_task',
    description: 'Draft a new Google Task (optional due date YYYY-MM-DD). NOT created until the user presses Confirm.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, notes: { type: 'string' }, due: { type: 'string' } }, required: ['title'] },
    panels: ['drafts'], drafts: true,
    async run(user, { title, notes, due }) { return prepare(user.id, 'task', `Task: ${title}`, { title, notes: notes || '', due: due || null }); },
  },
  {
    name: 'prepare_task_done',
    description: 'Draft marking a Google Task as done (ids from list_tasks). NOT changed until the user presses Confirm.',
    input_schema: { type: 'object', properties: { listId: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' } }, required: ['listId', 'taskId'] },
    panels: ['drafts'], drafts: true,
    async run(user, { listId, taskId, title }) { return prepare(user.id, 'task_done', `Mark done: ${title || 'task'}`, { listId, taskId, title: title || '' }); },
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));
const TOOL_LABELS = {
  get_overview: 'Looking over your day', list_tasks: 'Checking tasks', list_events: 'Checking calendar', search_mail: 'Searching mail',
  read_mail: 'Reading an email', list_chats: 'Checking chats', read_chat: 'Reading a chat', open_view: 'Opening',
  prepare_chat_reply: 'Drafting a reply', prepare_email: 'Drafting an email', prepare_event: 'Drafting an event',
  prepare_task: 'Drafting a task', prepare_task_done: 'Drafting a task update',
};

function systemPrompt(user, { tz, now = new Date() } = {}) {
  let local;
  try { local = now.toLocaleString('en-GB', { timeZone: tz || 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { local = now.toISOString(); }
  return [
    `You are Forge, the personal assistant inside OpenForge AI for ${user.name}.`,
    `Right now it is ${local} (${tz || 'UTC'}). Use this time zone for every date and time you mention or prepare.`,
    'You can see their Google Tasks, Google Calendar, Gmail inbox and a unified WhatsApp + Telegram chat inbox through your tools.',
    '',
    'RULES:',
    '• For anything about their real data, call a tool first and answer from what it returns. Never invent a task, event, email, message, name or number.',
    '• You NEVER send, email, book, create or change anything yourself. To do something, call a prepare_* tool: it puts a draft on the Drafts card and the user presses Send/Confirm. Then say plainly that the draft is waiting for them.',
    '• Open the relevant card with open_view when it helps the user see the answer (e.g. their calendar, a chat, an email).',
    '• Never write a phone number or an email address out in full in your answer — use the person\'s name.',
    '• A WhatsApp reply can only be sent within 24 hours of the person\'s last message (replyWindowOpen). If the window is closed, say so instead of drafting.',
    '• If a tool says Google or a chat channel is not connected, tell the user which setting to fill in (Settings → Model / Voice / Google / WhatsApp / Telegram).',
    '• Be brief and warm. Short paragraphs or short bullet lists; no tables.',
  ].join('\n');
}

module.exports = { TOOLS, TOOL_BY_NAME, TOOL_LABELS, systemPrompt, maskPhone, chatRow };
