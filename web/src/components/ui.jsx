import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { initials, colorFor } from '../lib/util';

export function Avatar({ name, size = 28 }) {
  return <span className="avatar" style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.4 }}>{initials(name)}</span>;
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`card ${wide ? 'sheet' : 'modal'} fa-sheet-in`} role="dialog" aria-label={title}>
        <div className="row" style={{ marginBottom: wide ? 0 : 12, padding: wide ? '14px 16px' : 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, flex: 1 }}>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyBox({ value, testid }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copybox" data-testid={testid}>
      <code>{value}</code>
      <button className="btn sm" type="button" onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>
        {done ? <Check size={14} /> : <Copy size={14} />}{done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// A tiny, safe markdown subset for the assistant's answers: paragraphs, bullet
// lists, **bold**, `code`. Rendered as React elements — never as HTML.
function inline(text, key) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={`${key}-${i}`}>{p.slice(1, -1)}</code>;
    return p;
  });
}
export function Answer({ text }) {
  const blocks = []; let list = null;
  String(text || '').split('\n').forEach((line, i) => {
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) { if (!list) { list = []; blocks.push({ list }); } list.push(inline(li[1], i)); return; }
    list = null;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) blocks.push({ p: <strong>{inline(h[1], i)}</strong> });
    else if (line.trim()) blocks.push({ p: inline(line, i) });
  });
  return (
    <div className="answer">
      {blocks.map((b, i) => (b.list ? <ul key={i}>{b.list.map((x, j) => <li key={j}>{x}</li>)}</ul> : <p key={i}>{b.p}</p>))}
    </div>
  );
}
