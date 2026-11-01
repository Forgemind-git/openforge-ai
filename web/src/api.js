// Fetch wrapper. Errors carry the server's human sentence.
async function req(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status; e.notConnected = !!data.notConnected; throw e;
  }
  return data;
}

export const api = {
  get: (u) => req('GET', u), post: (u, b) => req('POST', u, b || {}), put: (u, b) => req('PUT', u, b || {}),
  patch: (u, b) => req('PATCH', u, b || {}), del: (u) => req('DELETE', u),
};

// Chat with the assistant — SSE over POST.
export async function streamChat({ message, conversationId, onEvent, signal }) {
  const res = await fetch('/api/assistant/chat', {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (ev) { let d = {}; try { d = JSON.parse(data || '{}'); } catch { /* */ } onEvent(ev, d); }
    }
  }
}
