// The morning brief. Forge AI leaves the centre of the office and flies to each card
// in turn — Calendar, Tasks, Mail, Chats, Drafts — then back to the centre for the
// plan, reading out what each card shows. A small panel beside the logo holds that
// card's key numbers; each one lights up as the voice says it.
//
//   demo brief — the demo data, read by the browser's own voice (free, no keys).
//   live brief — your own data, read by the Gemini Live voice (mode 'narrate');
//                without a Gemini key it falls back to the browser voice.
// Nothing here sends or changes anything. Styles: morning-brief.css.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, RotateCcw, Sunrise, Check, Volume2 } from 'lucide-react';
import { narrate } from '../lib/narration';
import { tileMoments } from '../lib/brief';
import './morning-brief.css';

const HUD_W = 268;

// Where the logo and the panel go for a step (screen px).
function placeFor(focus) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const narrow = vw < 1100;   // the rails turn into strips above the centre (theme.css)
  const size = narrow ? 56 : 88;
  const clampX = (x, w) => Math.max(10, Math.min(vw - w - 10, x));
  const clampY = (y, h) => Math.max(76, Math.min(vh - h - 10, y));
  const card = focus && document.querySelector(`[data-station="${focus}"]`);
  if (card) {
    const r = card.getBoundingClientRect();
    if (narrow) {
      return { lx: clampX(r.right - size + 6, size), ly: clampY(r.top - size / 2, size), size, hx: 10, hy: null, hw: vw - 20 };
    }
    const left = r.left + r.width / 2 < vw / 2;
    const lx = left ? r.right + 14 : r.left - 14 - size;
    const hx = left ? lx + size + 10 : lx - 10 - HUD_W;
    return { lx, ly: clampY(r.top + 2, size), size, hx: clampX(hx, HUD_W), hy: clampY(r.top, 200), hw: HUD_W };
  }
  // The centre: where the office's own logo stands.
  const bot = document.querySelector('[data-testid="assistant-logo"]');
  const b = bot ? bot.getBoundingClientRect() : { left: vw / 2 - 64, top: 140, width: 128, height: 128, bottom: 268 };
  const big = narrow ? 80 : b.width;
  const lx = b.left + b.width / 2 - big / 2;
  const hw = narrow ? vw - 20 : HUD_W + 40;
  return { lx, ly: b.top, size: big, hx: narrow ? 10 : clampX(b.left + b.width / 2 - hw / 2, hw), hy: narrow ? null : b.top + b.height + 14, hw };
}

function Tile({ t, on, now }) {
  return (
    <div className={`mb-tile ${on ? 'on' : ''} ${now ? 'now' : ''}`} data-said={on ? '1' : '0'}>
      {t.value != null
        ? <span className={`mb-val ${t.tone || ''}`}>{t.value}</span>
        : <span className="mb-tick"><Check size={13} /></span>}
      <span className="mb-txt"><b>{t.label}</b>{t.note && <span>{t.note}</span>}</span>
    </div>
  );
}

export default function MorningBrief({ steps, live, demo, onFocus, onClose, onReplay }) {
  const [idx, setIdx] = useState(-1);
  const [frac, setFrac] = useState(0);
  const [mode, setMode] = useState(null);
  const [done, setDone] = useState(false);
  const [secs, setSecs] = useState(0);
  const [pos, setPos] = useState(null);
  const t0 = useRef(performance.now());

  // Read the script; the line being heard decides where the logo is.
  useEffect(() => {
    const r = narrate(steps.map(s => s.say), {
      live,
      onLine: (i) => setIdx(i),
      onProgress: (i, f) => setFrac(f),
      onMode: setMode,
      onDone: () => { setDone(true); setSecs(Math.round((performance.now() - t0.current) / 1000)); },
    });
    return () => r.stop();
  }, [steps, live]);

  const focus = done || idx < 0 ? null : steps[idx]?.focus ?? null;
  useEffect(() => {
    onFocus(focus);
    const card = focus && document.querySelector(`[data-station="${focus}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus, onFocus]);
  useEffect(() => () => onFocus(null), [onFocus]);

  // Follow the target every frame (cards can scroll or the window resize).
  useLayoutEffect(() => {
    let raf;
    const loop = () => {
      const p = placeFor(focus);
      setPos(cur => (cur && Object.keys(p).every(k => cur[k] === p[k] || (typeof p[k] === 'number' && Math.abs(cur[k] - p[k]) < 1)) ? cur : p));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [focus]);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const st = steps[Math.max(0, idx)];
  const tiles = !done && idx >= 0 ? (st.tiles || []) : [];
  const moments = tileMoments(st?.say, tiles);
  const said = moments.filter(m => frac >= m - 0.02).length;
  const voice = mode === 'live' ? 'Gemini Live voice' : mode === 'browser' ? (demo ? 'Browser voice · demo data' : 'Browser voice') : 'Starting…';

  if (!pos) return null;
  return (
    <>
      <div className="mb-logo" data-testid="brief-logo" data-focus={focus || 'centre'}
        style={{ width: pos.size, height: pos.size, transform: `translate(${pos.lx}px, ${pos.ly}px)` }}>
        <div className="logo-float-anim"><img src="/forge-ai-blink.gif" alt="" /></div>
      </div>
      <div className="mb-hud" data-testid="brief-hud" data-step={st?.focus || 'centre'} data-idx={idx} data-done={done ? '1' : '0'} data-mode={mode || ''} data-said={said}
        style={{ width: pos.hw, transform: pos.hy == null ? 'none' : `translate(${pos.hx}px, ${pos.hy}px)`, ...(pos.hy == null ? { left: pos.hx, top: 'auto', bottom: 10 } : {}) }}>
        <div className="mb-head">
          <span className={`mb-dot ${done ? 'off' : ''}`} />
          <span className="mb-label">{done ? 'Brief done' : idx < 0 ? 'Morning brief' : st.label}</span>
          <span className="grow" />
          {!done && idx >= 0 && <span className="mb-count">{idx + 1}/{steps.length}</span>}
          <button type="button" className="mb-x" onClick={onClose} aria-label="Stop the brief" data-testid="brief-stop"><X size={14} /></button>
        </div>
        {idx < 0 && !done && <div className="mb-wait"><Sunrise size={14} color="#dc2626" />Getting your day ready <span className="fa-dots" aria-hidden><span /><span /><span /></span></div>}
        {tiles.length > 0 && (
          <div className="mb-tiles" key={idx}>
            {tiles.slice(0, 4).map((t, i) => <Tile key={i} t={t} on={i < said} now={i === said - 1} />)}
          </div>
        )}
        {!done && idx >= 0 && <div className="mb-caption" data-testid="brief-caption">{st.say}</div>}
        {done && (
          <div className="mb-end">
            <span>That was your day in {secs} seconds.</span>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={onReplay}><RotateCcw size={13} />Replay</button>
              <button type="button" className="btn sm primary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
        <div className="mb-voice" data-testid="brief-voice"><Volume2 size={12} />{voice}
          {mode === 'browser' && !demo && <a href="#/settings/voice" onClick={onClose}>Use the Gemini voice</a>}
        </div>
      </div>
    </>
  );
}
