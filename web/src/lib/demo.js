// Demo mode — sample data that lives only in this browser tab. It stands in for
// the API so every card, sheet and the chat show what OpenForge AI looks like once
// Google, WhatsApp and Telegram are connected. Nothing here reaches the server.
import { ymd, addDays } from './util';

const at = (dayOffset, h, m = 0) => { const d = addDays(new Date(), dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const day = (o) => ymd(addDays(new Date(), o));

function seed() {
  return {
    tasks: [
      { id: 't1', listId: 'l1', list: 'Work', title: 'Send the Q4 proposal to Meera', notes: 'Attach the pricing sheet', due: day(-1), status: 'needsAction' },
      { id: 't2', listId: 'l1', list: 'Work', title: 'Review landing page copy', notes: '', due: day(0), status: 'needsAction' },
      { id: 't3', listId: 'l1', list: 'Work', title: 'Prepare slides for Friday demo', notes: '10 slides max', due: day(2), status: 'needsAction' },
      { id: 't4', listId: 'l2', list: 'Personal', title: 'Book flight to Bengaluru', notes: '', due: day(0), status: 'needsAction' },
      { id: 't5', listId: 'l2', list: 'Personal', title: 'Renew gym membership', notes: '', due: day(5), status: 'needsAction' },
      { id: 't6', listId: 'l1', list: 'Work', title: 'Plan the November webinar', notes: '', due: null, status: 'needsAction' },
      { id: 't7', listId: 'l1', list: 'Work', title: 'Reply to the vendor invoice', notes: '', due: day(-2), status: 'completed' },
      { id: 't8', listId: 'l2', list: 'Personal', title: 'Call the bank', notes: '', due: day(-1), status: 'completed' },
    ],
    calendar: [
      { id: 'e1', title: 'Team stand-up', start: at(0, 9, 30), end: at(0, 9, 45), location: 'Google Meet' },
      { id: 'e2', title: 'Client call — Meera (Northwind)', start: at(0, 12, 0), end: at(0, 12, 30), location: 'Zoom' },
      { id: 'e3', title: 'Design review', start: at(0, 16, 0), end: at(0, 17, 0), location: 'Room 2' },
      { id: 'e4', title: 'Lunch with Ravi', start: at(1, 13, 0), end: at(1, 14, 0), location: 'Cafe Arabica' },
      { id: 'e5', title: 'Webinar dry run', start: at(2, 18, 0), end: at(2, 19, 0), location: '' },
      { id: 'e6', title: 'Friday demo', start: at(3, 11, 0), end: at(3, 12, 0), location: 'Main office' },
      { id: 'e7', title: 'Dentist', start: at(4, 10, 0), end: at(4, 10, 30), location: '' },
      { id: 'e8', title: 'Quarterly planning', start: at(6, 15, 0), end: at(6, 17, 0), location: 'Board room' },
    ].map(e => ({ ...e, allDay: false, link: null })),
    mail: [
      { id: 'm1', from: 'Meera Iyer <meera@northwind.example>', subject: 'Re: Proposal timeline', snippet: 'Could you send the revised proposal by tomorrow? The board meets on Thursday…', date: minsAgo(25), unread: true,
        body: 'Hi,\n\nCould you send the revised proposal by tomorrow? The board meets on Thursday and I would like to share it before then.\n\nAlso — is the onboarding still two weeks?\n\nThanks,\nMeera' },
      { id: 'm2', from: 'Ravi Kumar <ravi@studio.example>', subject: 'Lunch tomorrow?', snippet: 'Still on for 1pm? I booked Cafe Arabica.', date: minsAgo(90), unread: true, body: 'Still on for 1pm tomorrow? I booked Cafe Arabica.\n\n— Ravi' },
      { id: 'm3', from: 'Stripe <receipts@stripe.example>', subject: 'Your receipt from Cloud Hosting', snippet: 'Amount paid ₹4,200.00 · Card ending 4242', date: minsAgo(300), unread: false, body: 'Amount paid ₹4,200.00\nCard ending 4242\n\nThank you for your business.' },
      { id: 'm4', from: 'Anita Rao <anita@agency.example>', subject: 'Webinar speaker confirmed', snippet: 'Great news — our speaker confirmed for the 10th. Sending the bio…', date: minsAgo(60 * 20), unread: false, body: 'Great news — our speaker confirmed for the 10th. Sending the bio and photo later today.\n\nAnita' },
      { id: 'm5', from: 'GitHub <noreply@github.example>', subject: '[openforge-ai] New pull request', snippet: 'A new pull request was opened: Improve calendar week view', date: minsAgo(60 * 30), unread: false, body: 'A new pull request was opened: Improve calendar week view.' },
      { id: 'm6', from: 'Priya S <priya@clinic.example>', subject: 'Appointment confirmed', snippet: 'Your appointment is confirmed for the 5th at 10:00.', date: minsAgo(60 * 50), unread: false, body: 'Your appointment is confirmed for the 5th at 10:00.' },
    ].map(m => ({ ...m, threadId: m.id, to: 'you@example.com' })),
    chats: [
      { chatId: 1, channel: 'whatsapp', name: 'Arjun Mehta', number: '+91 98••••21', unread: 2, waitingForReply: true, replyWindowOpen: true,
        messages: [['in', 'Hi! Saw your post about the workshop', 140], ['out', 'Hi Arjun! Yes, it starts on the 11th.', 130], ['in', 'Is there a weekend batch?', 12], ['in', 'And what is the fee?', 11]] },
      { chatId: 2, channel: 'telegram', name: 'Design Team', number: null, unread: 1, waitingForReply: true, replyWindowOpen: true,
        messages: [['in', 'New mockups are in the shared folder', 95], ['out', 'Thanks, looking now', 80], ['in', 'Can you approve v3 before 5?', 40]] },
      { chatId: 3, channel: 'whatsapp', name: 'Sneha', number: '+91 90••••07', unread: 0, waitingForReply: false, replyWindowOpen: true,
        messages: [['in', 'Payment done ✅', 300], ['out', 'Received, thank you Sneha!', 290]] },
      { chatId: 4, channel: 'telegram', name: 'Karthik', number: null, unread: 0, waitingForReply: true, replyWindowOpen: true,
        messages: [['in', 'Sent you the invoice PDF', 60 * 26]] },
      { chatId: 5, channel: 'whatsapp', name: 'Fatima', number: '+971 50••••44', unread: 0, waitingForReply: false, replyWindowOpen: false,
        messages: [['in', 'See you next week!', 60 * 50], ['out', 'Sure 👍', 60 * 49]] },
    ],
    actions: [
      { id: 101, kind: 'email_reply', title: 'Reply: Re: Proposal timeline', status: 'pending', payload: { to: 'Meera Iyer', subject: 'Re: Proposal timeline', body: 'Hi Meera,\n\nYes — I will send the revised proposal by tomorrow noon, and onboarding is still two weeks.\n\nBest,', replyToId: 'm1' } },
    ],
    conversations: [
      { id: 1, title: 'What is on my plate today?', updated_at: minsAgo(40).replace('T', ' ').slice(0, 19) },
      { id: 2, title: 'Plan my week', updated_at: minsAgo(60 * 26).replace('T', ' ').slice(0, 19) },
    ],
  };
}

let S = seed();
export const resetDemo = () => { S = seed(); };

const chatRow = (c) => {
  const last = c.messages[c.messages.length - 1];
  return { chatId: c.chatId, channel: c.channel, name: c.name, number: c.number, unread: c.unread, waitingForReply: c.waitingForReply, replyWindowOpen: c.replyWindowOpen, lastMessage: last?.[1] || '', lastAt: minsAgo(last?.[2] ?? 0) };
};
const delay = (v, ms = 220) => new Promise(r => setTimeout(() => r(structuredClone(v)), ms));
const fail = (msg) => Promise.reject(Object.assign(new Error(msg), { status: 400 }));

export const demoApi = {
  get(url) {
    const u = new URL(url, 'http://x'); const p = u.pathname;
    if (p === '/office/status') return delay({ model: true, modelName: 'demo', provider: 'demo', voice: false, google: true, whatsapp: true, telegram: true, demo: true }, 60);
    if (p === '/tasks') return delay({ lists: [{ id: 'l1', title: 'Work' }, { id: 'l2', title: 'Personal' }], tasks: S.tasks });
    if (p === '/calendar') {
      const from = u.searchParams.get('from') ? new Date(u.searchParams.get('from')) : new Date(0);
      const to = u.searchParams.get('to') ? new Date(u.searchParams.get('to')) : new Date(8.64e15);
      return delay({ events: S.calendar.filter(e => new Date(e.start) >= from && new Date(e.start) < to).sort((a, b) => a.start.localeCompare(b.start)) });
    }
    if (p === '/mail') {
      const q = (u.searchParams.get('q') || '').toLowerCase().replace('in:inbox', '').trim();
      let list = S.mail;
      if (q.includes('is:unread')) list = list.filter(m => m.unread);
      const words = q.replace('is:unread', '').trim();
      if (words) list = list.filter(m => `${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(words));
      return delay({ messages: list.map(({ body, ...m }) => m) });
    }
    const mail = /^\/mail\/(.+)$/.exec(p);
    if (mail) { const m = S.mail.find(x => x.id === mail[1]); if (m) m.unread = false; return m ? delay(m) : fail('Not found'); }
    if (p === '/chats') return delay({ chats: S.chats.map(chatRow) });
    const chat = /^\/chats\/(\d+)\/messages$/.exec(p);
    if (chat) {
      const c = S.chats.find(x => x.chatId === Number(chat[1])); if (!c) return fail('Chat not found.');
      c.unread = 0;
      return delay({ chat: chatRow(c), messages: c.messages.map(([direction, text, m], i) => ({ id: i + 1, direction, text, at: minsAgo(m), status: direction === 'out' ? 'read' : null })) });
    }
    if (p === '/actions') return delay({ actions: S.actions });
    if (p === '/assistant/conversations') return delay({ conversations: S.conversations });
    if (/^\/assistant\/conversations\/\d+$/.test(p)) return delay({ conversation: {}, messages: [{ role: 'user', content: S.conversations.find(c => `/assistant/conversations/${c.id}` === p)?.title || 'Hello' }, { role: 'assistant', content: 'This is a sample conversation from demo mode. Ask me something below to see how I work.' }] });
    return fail('Not available in demo mode.');
  },
  post(url, body = {}) {
    if (url === '/tasks') { const t = { id: `t${Date.now()}`, listId: 'l1', list: 'Work', title: body.title, notes: '', due: body.due || null, status: 'needsAction' }; S.tasks.push(t); return delay(t, 120); }
    if (url === '/calendar') { const e = { id: `e${Date.now()}`, title: body.title, start: body.start, end: body.end || body.start, allDay: !!body.allDay, location: body.location || '', link: null }; S.calendar.push(e); return delay(e, 120); }
    if (url === '/mail/send') return delay({ id: 'sent' }, 300);
    const send = /^\/chats\/(\d+)\/send$/.exec(url);
    if (send) { const c = S.chats.find(x => x.chatId === Number(send[1])); c.messages.push(['out', body.text, 0]); c.waitingForReply = false; return delay({ id: 'x' }, 200); }
    const act = /^\/actions\/(\d+)\/(confirm|discard)$/.exec(url);
    if (act) {
      const a = S.actions.find(x => x.id === Number(act[1])); if (!a) return fail('That draft was not found.');
      if (a.status !== 'pending') return fail('This draft was already handled.');
      Object.assign(a.payload, body.edits || {});
      a.status = act[2] === 'confirm' ? 'done' : 'discarded';
      if (a.status === 'done' && a.kind === 'chat_message') { const c = S.chats.find(x => x.chatId === a.payload.chatId); if (c) { c.messages.push(['out', a.payload.text, 0]); c.waitingForReply = false; } }
      if (a.status === 'done' && a.kind === 'task') S.tasks.push({ id: `t${Date.now()}`, listId: 'l1', list: 'Work', title: a.payload.title, notes: '', due: a.payload.due || null, status: 'needsAction' });
      return delay({ ok: true, demo: true }, 250);
    }
    if (url === '/auth/logout') return Promise.resolve({ ok: true });
    return fail('Not available in demo mode.');
  },
  patch(url, body = {}) {
    const m = /^\/tasks\/([^/]+)\/([^/]+)$/.exec(url);
    if (m) { const t = S.tasks.find(x => x.id === decodeURIComponent(m[2])); if (t) { if (body.status) t.status = body.status; if (body.due !== undefined) t.due = body.due; } return delay({ ok: true }, 100); }
    return fail('Not available in demo mode.');
  },
  del(url) {
    const m = /^\/tasks\/([^/]+)\/([^/]+)$/.exec(url);
    if (m) { S.tasks = S.tasks.filter(x => x.id !== decodeURIComponent(m[2])); return delay({ ok: true }, 100); }
    const c = /^\/assistant\/conversations\/(\d+)$/.exec(url);
    if (c) { S.conversations = S.conversations.filter(x => x.id !== Number(c[1])); return delay({ ok: true }, 80); }
    return fail('Not available in demo mode.');
  },
};

// ── scripted assistant replies ──
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function draft(kind, title, payload) {
  const a = { id: Date.now(), kind, title, status: 'pending', payload };
  S.actions.unshift(a); return a;
}

export async function demoChat({ message, onEvent }) {
  const q = message.toLowerCase();
  const step = async (tool, label, panels, extra = {}) => {
    onEvent('step', { phase: 'start', tool, label, panels, ...extra });
    await sleep(650);
    onEvent('step', { phase: 'done', tool, label, panels, ...extra });
    return { tool, label, status: 'ok', panels };
  };
  const steps = [];
  let content;
  const today = ymd(new Date());
  if (/\b(draft|write)\b|reply to|respond to|answer (arjun|him|her|them)/.test(q)) {
    steps.push(await step('read_chat', 'Reading a chat', ['chats']));
    draft('chat_message', 'Reply to Arjun Mehta (whatsapp)', { chatId: 1, text: 'Hi Arjun! Yes — there is a weekend batch on Saturdays, 10am–1pm. The fee is ₹4,499. Shall I reserve a seat for you?' });
    steps.push(await step('prepare_chat_reply', 'Drafting a reply', ['drafts'], { drafts: true }));
    content = 'I drafted a reply to **Arjun** about the weekend batch and the fee. It is waiting on the **Drafts** card — nothing is sent until you press **Send**.';
  } else if (/chat|whatsapp|telegram|message|waiting/.test(q)) {
    steps.push(await step('list_chats', 'Checking chats', ['chats']));
    steps.push(await step('open_view', 'Opening', [], { focus: { view: 'chats', id: '1' } }));
    content = '**3 chats are waiting on you:**\n- **Arjun Mehta** (WhatsApp) — asks about a weekend batch and the fee\n- **Design Team** (Telegram) — wants v3 approved before 5pm\n- **Karthik** (Telegram) — sent an invoice PDF yesterday\n\nWant me to draft a reply to Arjun?';
  } else if (/mail|email|inbox|unread/.test(q)) {
    steps.push(await step('search_mail', 'Searching mail', ['mail']));
    steps.push(await step('open_view', 'Opening', [], { focus: { view: 'mail', id: 'm1' } }));
    content = '**2 unread emails:**\n- **Meera Iyer** — wants the revised proposal by tomorrow (board meets Thursday) and asks if onboarding is still two weeks.\n- **Ravi Kumar** — confirming lunch tomorrow at 1pm.\n\nA reply to Meera is already drafted on the **Drafts** card.';
  } else if (/week|calendar|schedule|meeting|plan/.test(q)) {
    steps.push(await step('list_events', 'Checking calendar', ['calendar']));
    steps.push(await step('list_tasks', 'Checking tasks', ['tasks']));
    steps.push(await step('open_view', 'Opening', [], { focus: { view: 'calendar' } }));
    content = 'Your week:\n- **Today** — stand-up 9:30, client call with Meera at 12, design review at 4\n- **Tomorrow** — lunch with Ravi at 1pm\n- **In 2 days** — webinar dry run at 6pm\n- **In 3 days** — Friday demo at 11\n\nBlock time for **Prepare slides for Friday demo** before the dry run.';
  } else if (/task|todo|to-do/.test(q)) {
    steps.push(await step('list_tasks', 'Checking tasks', ['tasks']));
    steps.push(await step('open_view', 'Opening', [], { focus: { view: 'tasks' } }));
    const open = S.tasks.filter(t => t.status !== 'completed');
    content = `You have **${open.length} open tasks** — **1 overdue**: *Send the Q4 proposal to Meera*. Two are due today.`;
  } else {
    steps.push(await step('get_overview', 'Looking over your day', ['calendar', 'tasks', 'mail', 'chats', 'drafts']));
    const todays = S.calendar.filter(e => ymd(e.start) === today).length;
    content = `Here's your day:\n- **${todays} meetings** — first is the stand-up at 9:30, then the client call with Meera at 12\n- **1 overdue task** — send the Q4 proposal to Meera\n- **2 unread emails** — Meera (proposal) and Ravi (lunch)\n- **3 chats waiting** — Arjun on WhatsApp is asking about the fee\n\nOne draft is waiting for you to approve.`;
  }
  onEvent('message', { content, steps });
  onEvent('done', {});
}
