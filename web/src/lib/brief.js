// The morning brief's script, built from exactly what the office cards show — the
// demo data in demo mode, your own Google / chat data otherwise — so what Forge AI
// says always matches the screen. No model call: it is instant and free.
//
// Each step: { focus, label, say, tiles: [{ value?, label, note?, tone? }] }
//   focus — the card the logo flies to (calendar, tasks, mail, chats, drafts), or
//           null for the centre (the greeting and the plan).
// Keep the whole script short (under ~130 words): it is read in about a minute.
import { timeOf, todayYmd, ymd, senderName } from './util';

const clip = (s, words = 7) => {
  const w = String(s || '').replace(/\s+/g, ' ').trim().replace(/[?!.…,;:]+$/, '').split(' ');
  return w.length > words ? `${w.slice(0, words).join(' ')}…` : w.join(' ');
};
// For the spoken line: dashes and brackets become pauses, "Re:" goes, "12:00 PM" is "12 PM".
const spoken = (s, words = 7) => clip(String(s || '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\s+[—–-]\s+/g, ', ').replace(/[()[\]]/g, ''), words);
const askOf = (s, words = 8) => `${spoken(s, words)}${/\?\s*$/.test(String(s || '')) ? '?' : '.'}`;
const sayTime = (iso) => timeOf(iso).replace(':00', '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export function buildBrief({ name, d, errs = {}, status = null }) {
  const today = todayYmd();
  const now = new Date();
  const steps = [];
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  steps.push({ focus: null, label: 'Morning brief', say: `${hello}${name ? ` ${first(name)}` : ''}! Here is your day, card by card.`, tiles: [{ label: date, note: 'Your brief, in about a minute' }] });

  // Calendar
  if (errs.calendar === 'google' || !Array.isArray(d.calendar)) {
    steps.push({ focus: 'calendar', label: 'Calendar', say: 'Your calendar is not connected yet. Add Google in Settings.', tiles: [] });
  } else {
    const todays = d.calendar.filter(e => ymd(e.start) === today).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const upcoming = todays.filter(e => new Date(e.end || e.start) >= now);
    const at = (e) => (e.allDay ? 'all day' : `at ${sayTime(e.start)}`);
    let say;
    if (!todays.length) say = 'Your calendar is clear today.';
    else if (!upcoming.length) say = `${plural(todays.length, 'meeting')} today, all done already.`;
    else {
      say = `${plural(todays.length, 'meeting')} today. Next, ${spoken(upcoming[0].title, 6)} ${at(upcoming[0])}`;
      say += upcoming[1] ? `, then ${spoken(upcoming[1].title, 6)} ${at(upcoming[1])}.` : '.';
    }
    steps.push({
      focus: 'calendar', label: 'Calendar', say,
      tiles: [{ value: todays.length, label: todays.length === 1 ? 'Meeting today' : 'Meetings today' },
        ...upcoming.slice(0, 2).map(e => ({ label: clip(e.title, 6), note: e.allDay ? 'All day' : timeOf(e.start) }))],
    });
  }

  // Tasks
  let overdueTask = null;
  if (errs.tasks === 'google' || !Array.isArray(d.tasks)) {
    steps.push({ focus: 'tasks', label: 'Tasks', say: 'Your tasks are not connected yet.', tiles: [] });
  } else {
    const open = d.tasks.filter(t => t.status !== 'completed');
    const overdue = open.filter(t => t.due && t.due < today);
    const dueToday = open.filter(t => t.due === today);
    overdueTask = overdue[0] || null;
    let say = open.length ? `${plural(open.length, 'open task')}` : 'No open tasks. Nice and clear.';
    if (open.length) {
      say += overdue.length ? `, ${overdue.length} overdue: ${spoken(overdue[0].title, 7)}.` : dueToday.length ? `, ${dueToday.length} due today.` : ', nothing overdue.';
    }
    steps.push({
      focus: 'tasks', label: 'Tasks', say,
      tiles: [{ value: open.length, label: 'Open tasks' },
        ...(overdue.length ? [{ value: overdue.length, label: 'Overdue', note: clip(overdue[0].title, 7), tone: 'red' }] : []),
        ...(!overdue.length && dueToday.length ? [{ value: dueToday.length, label: 'Due today', tone: 'amber' }] : [])],
    });
  }

  // Mail
  if (errs.mail === 'google' || !Array.isArray(d.mail)) {
    steps.push({ focus: 'mail', label: 'Mail', say: 'Gmail is not connected yet.', tiles: [] });
  } else {
    const unread = d.mail.filter(m => m.unread);
    const about = unread.slice(0, 2).map(m => `${first(senderName(m.from))} about ${spoken(m.subject, 4)}`);
    const say = unread.length ? `${plural(unread.length, 'unread email')}: ${listOf(about)}.` : 'Inbox zero. No unread mail.';
    steps.push({
      focus: 'mail', label: 'Mail', say,
      tiles: [{ value: unread.length, label: 'Unread' }, ...unread.slice(0, 2).map(m => ({ label: senderName(m.from), note: clip(m.subject, 6) }))],
    });
  }

  // Chats
  const chatsOn = !status || status.whatsapp || status.telegram;
  let waitingChat = null;
  if (!chatsOn || !Array.isArray(d.chats)) {
    steps.push({ focus: 'chats', label: 'Chats', say: 'WhatsApp and Telegram are not connected yet.', tiles: [] });
  } else {
    const waiting = d.chats.filter(c => c.waitingForReply);
    waitingChat = waiting[0] || null;
    const say = waiting.length
      ? `${plural(waiting.length, 'chat is', 'chats are')} waiting for you. ${first(waiting[0].name)} on ${waiting[0].channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'} asks: ${askOf(waiting[0].lastMessage, 8)}`
      : 'No chats waiting for a reply.';
    steps.push({
      focus: 'chats', label: 'Chats', say,
      tiles: [{ value: waiting.length, label: 'Waiting for you' }, ...waiting.slice(0, 2).map(c => ({ label: c.name, note: clip(c.lastMessage, 8) }))],
    });
  }

  // Drafts
  const pending = Array.isArray(d.drafts) ? d.drafts.filter(a => a.status === 'pending') : [];
  steps.push({
    focus: 'drafts', label: 'Drafts to approve',
    say: pending.length ? `${plural(pending.length, 'draft is', 'drafts are')} waiting for your OK. Nothing goes out until you press Send.` : 'No drafts waiting for you.',
    tiles: pending.length ? [{ value: pending.length, label: 'Waiting for your OK' }, ...pending.slice(0, 2).map(a => ({ label: clip(a.title, 6), tone: 'green' }))] : [],
  });

  // The plan
  const plan = [];
  if (waitingChat) plan.push(`reply to ${first(waitingChat.name)}`);
  if (overdueTask) plan.push(spoken(overdueTask.title, 6).replace(/^./, c => c.toLowerCase()));
  if (pending.length) plan.push(`approve ${pending.length === 1 ? 'the draft' : 'the drafts'}`);
  steps.push({
    focus: null, label: 'The plan',
    say: plan.length ? `Your plan: ${listOf(plan)}. Have a great day!` : 'Nothing urgent today. Have a great day!',
    tiles: plan.map(p => ({ label: p.replace(/^./, c => c.toUpperCase()) })),
  });

  return steps;
}

/**
 * Where in a spoken line (0–1) each tile is said: the word carrying its number, or
 * the first word of its label; anything not found is spread over the line.
 */
export function tileMoments(say, tiles) {
  const ws = String(say || '').split(/\s+/).filter(Boolean);
  const n = Math.max(1, ws.length);
  const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
  let from = 0;
  return (tiles || []).map((t, k) => {
    let at = -1;
    if (t.value != null) at = ws.findIndex((w, i) => i >= from && w.replace(/\D/g, '') === String(t.value));
    if (at < 0) { const key = norm(String(t.label || '').split(/\s+/)[0]); if (key.length > 2) at = ws.findIndex((w, i) => i >= from && norm(w).startsWith(key)); }
    if (at < 0) at = Math.round(((k + 1) / ((tiles || []).length + 1)) * n);
    from = at;
    return Math.min(0.95, at / n);
  });
}
