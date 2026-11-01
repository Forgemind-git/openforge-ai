import { useEffect, useRef, useId } from 'react';

// Animated ForgeMind logo: 3D tilt + eye-tracking + blink + glow + float-bob.
// Props:
//   accentColor — hex for the inner hexagonal fill (default red brand color).
//   lookAtRef   — ref to another DOM element; if set, eyes track that element's
//                 viewport center each frame instead of the global mouse position.
// `expression` drives the FACE. The agent has no mouth, so every emotion has to be
// carried by the two eye shards: lid height, vertical anchor and inward/outward
// rotation. Anchoring matters — a lid closing from the TOP reads as tired or cross,
// the same lid closing from the BOTTOM reads as a smile.
export const AGENT_EXPRESSIONS = [
  { id: 'neutral',   label: 'Neutral',   hint: 'Default — eyes open, normal blink' },
  { id: 'happy',     label: 'Happy',     hint: 'Lids close from below — smiling eyes' },
  { id: 'excited',   label: 'Excited',   hint: 'Wide and bouncing' },
  { id: 'surprised', label: 'Surprised', hint: 'Wide open, blink suppressed' },
  { id: 'sad',       label: 'Sad',       hint: 'Lids drop, eyes sink and tilt in' },
  { id: 'angry',     label: 'Angry',     hint: 'Inner edges driven down — a furrow' },
  { id: 'dull',      label: 'Dull',      hint: 'Half-lidded and unimpressed' },
  { id: 'sleepy',    label: 'Sleepy',    hint: 'Nearly shut, slow' },
  { id: 'wink',      label: 'Wink',      hint: 'Left eye closed, right one open' },
  { id: 'focused',   label: 'Focused',   hint: 'Narrowed and squared up' },
];
export const EXPRESSION_IDS = AGENT_EXPRESSIONS.map((e) => e.id);

export default function ForgeMindLogo({ accentColor = '#dc2626', eyeColor = null, lookAtRef = null, lookAtPoint = null, lookPose = null, pointerRef = null, showOuterRing = true, thinking = false, mood = null, expression = 'neutral', tiltGain = 1, trackGain = 1 }) {
  const expr = EXPRESSION_IDS.includes(expression) ? expression : 'neutral';
  const svgRef = useRef(null);
  const tiltRef = useRef(null);
  const eyeLRef = useRef(null);
  const eyeRRef = useRef(null);
  const rafRef = useRef(0);
  const lookAtRefStable = useRef(lookAtRef);
  lookAtRefStable.current = lookAtRef;
  // Exact screen point to look at (e.g. the typing caret) — wins over ref/mouse.
  const lookPointStable = useRef(lookAtPoint);
  lookPointStable.current = lookAtPoint;
  // Fixed gaze pose {tx,ty,ex,ey} — overrides lookAt/mouse (e.g. the angled
  // "lean + look down from the side" while the user types).
  const lookPoseStable = useRef(lookPose);
  lookPoseStable.current = lookPose;
  // Optional pointer override (hand tracking): a ref whose `.current` is a live
  // {x,y} screen point (or null). When present it REPLACES the mouse position, so
  // the bot follows your hand through the exact same gentle cursor-drift path —
  // not the deliberate look-at swivel used for dashboards/typing.
  const pointerRefStable = useRef(pointerRef);
  pointerRefStable.current = pointerRef;
  // Unique per-instance ids — multiple logos mount at once, and SVG resolves a
  // referenced id (url(#…), clip-path) to the FIRST match in the document. Shared
  // ids made the eye glow/clip bind to the wrong (or a hidden) instance. Strip the
  // colons React emits so the value is safe inside url(#…).
  const uid = useId().replace(/:/g, '');
  const glowId = `eye-glow-${uid}`;
  const socketLId = `socket-L-${uid}`;
  const socketRId = `socket-R-${uid}`;
  // Mirror `thinking` into a ref so the long-lived RAF closure reads the live
  // value without re-subscribing the effect.
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  // Live cursor-tracking gains from the Agent Personality settings: tiltGain scales
  // how far the head leans toward the cursor; trackGain scales how fast it follows.
  // Mirrored into refs so the long-lived RAF closure reads the latest value.
  const tiltGainRef = useRef(tiltGain);
  tiltGainRef.current = tiltGain;
  const trackGainRef = useRef(trackGain);
  trackGainRef.current = trackGain;

  useEffect(() => {
    const LC = { x: 112, y: 143.9 };
    const RC = { x: 159.75, y: 143.9 };
    const EYE_MAX = 7, EYE_LERP = 0.16;
    const TILT_MAX = 14, TILT_LERP = 0.06;
    // Body-lean: besides turning its head, the bot physically shifts a few px
    // toward whatever it's tracking (cursor/hand/dashboard) so you can clearly
    // see it react — a small step into the target, not just an eye flick.
    const MOVE_MAX = 9;   // max px the body slides toward the target
    // When given a lookAt element, the bot makes a deliberate, pronounced turn to
    // face it (a near-360 head/body swivel) rather than the gentle mouse drift.
    const LOOK_MAX = 30, LOOK_EYE_MAX = 10;   // 42→30: softer turn toward dashboards/input (user: tilting too much)

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let lxE = 0, lyE = 0, rxE = 0, ryE = 0;
    let tiltX = 0, tiltY = 0;
    let moveX = 0, moveY = 0;   // current body offset toward the target (px)

    const onMove = (e) => { mx = e.clientX; my = e.clientY; };
    document.addEventListener('mousemove', onMove, { passive: true });

    // Hand tracking overrides the mouse each frame when a hand point is live.
    const applyPointer = () => {
      const pr = pointerRefStable.current;
      const p = pr && pr.current;
      if (p && typeof p.x === 'number') { mx = p.x; my = p.y; }
    };

    // `r` (the logo's own rect) and `t` (the gaze target) are computed ONCE per frame
    // in tick and threaded in here — getBoundingClientRect forces a synchronous layout,
    // and this used to be re-read up to ~5×/frame (each eye + target + hasLook), every
    // read landing after a style write → repeated layout thrash that tanked FPS when
    // the scene also had continuously-repainting elements.
    const getEyeTarget = (c, eyeMax, r, t) => {
      if (!r || r.width === 0) return { x: 0, y: 0 };
      const sx = 270 / r.width, sy = 270 / r.height;
      const dx = (t.x - r.left) * sx - c.x;
      const dy = (t.y - r.top) * sy - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.01) return { x: 0, y: 0 };
      const m = Math.min(d * 0.12, eyeMax);
      return { x: dx / d * m, y: dy / d * m };
    };

    const tick = () => {
      applyPointer();
      const r = svgRef.current?.getBoundingClientRect();
      if (r) {
        // One layout read per frame for the gaze target (see getEyeTarget note).
        const lookEl = lookAtRefStable.current && lookAtRefStable.current.current;
        const lookRect = lookEl ? lookEl.getBoundingClientRect() : null;
        const lookPt = lookPointStable.current;
        const hasPt = !!(lookPt && typeof lookPt.x === 'number');
        const t = hasPt
          ? { x: lookPt.x, y: lookPt.y }
          : (lookRect && lookRect.width > 0)
            ? { x: lookRect.left + lookRect.width / 2, y: lookRect.top + lookRect.height / 2 }
            : { x: mx, y: my };
        const pose = lookPoseStable.current;
        const look = !pose && (hasPt || !!(lookRect && lookRect.width > 0));
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // Personality gains apply ONLY to free cursor-following — the deliberate
        // look-at-element turn (typing into the input, scanning a dashboard, fixed
        // poses) stays EXACTLY as it was, unaffected by the lean/tracking sliders.
        // POWER curves so gain=1 == original tuning while the slider top gets real
        // authority (the linear map felt "not enough" at 2×).
        const freeCursor = !pose && !look;
        const gTiltRaw = Math.max(0, tiltGainRef.current ?? 1);
        const gTrackRaw = Math.max(0.05, trackGainRef.current ?? 1);
        const gTiltMouse = freeCursor ? Math.pow(gTiltRaw, 1.4) : 1;   // 1→1, 2→2.64, 3→4.66
        const gTrack = freeCursor ? Math.pow(gTrackRaw, 1.6) : 1;      // 1→1, 2→3.03, 3→5.80
        const lerpT = Math.max(0.02, Math.min(0.85, TILT_LERP * gTrack));
        let goalTX, goalTY;
        if (pose) {
          goalTX = pose.tx; goalTY = pose.ty;
        } else if (look) {
          // Deliberate turn toward the element: pick the DIRECTION and swivel hard
          // that way (saturating once it's a little away), so the turn is obvious
          // whether the target is the side dashboard or the input below.
          const dirx = t.x - cx, diry = t.y - cy;
          const dist = Math.hypot(dirx, diry) || 1;
          const sat = Math.min(1, dist / 130);
          goalTY = (dirx / dist) * LOOK_MAX * sat;    // rotateY: turn left/right to face it
          goalTX = -(diry / dist) * LOOK_MAX * sat;   // rotateX: tip up/down toward it
        } else if (thinkingRef.current) {
          // Thinking: hold a straight, neutral head — the bot is concentrating,
          // not watching the cursor. The pondering eye glance below keeps it
          // alive; deliberate pose/look turns (dashboard scans) still win above.
          goalTX = 0; goalTY = 0;
        } else {
          // Mouse/idle: follow the cursor + a gentle autonomous sway so the bot is
          // never a dead-straight stare (keeps it alive while it speaks).
          const nx = (t.x - cx) / (window.innerWidth / 2);
          const ny = (t.y - cy) / (window.innerHeight / 2);
          const tt = performance.now() / 1000;
          const swayY = Math.sin(tt * 0.55) * 5 + Math.sin(tt * 1.7 + 1) * 2;
          const swayX = Math.sin(tt * 0.8 + 2) * 3.5;
          goalTY = nx * TILT_MAX * gTiltMouse + swayY;
          goalTX = -ny * TILT_MAX * gTiltMouse + swayX;
        }
        // Clamp so high gains lean hard but never flip past a believable head turn.
        goalTX = Math.max(-64, Math.min(64, goalTX));
        goalTY = Math.max(-64, Math.min(64, goalTY));
        tiltX += (goalTX - tiltX) * lerpT;
        tiltY += (goalTY - tiltY) * lerpT;
        // Body-lean: slide a few px in the direction of the target so the bot
        // visibly moves toward it. Skipped for fixed poses and while thinking
        // (it holds a neutral, concentrating stance). Distance-saturated so a
        // far target still only nudges it, and gain-scaled on free cursor so the
        // personality "lean" slider moves the body too.
        let goalMoveX = 0, goalMoveY = 0;
        if (!pose && !thinkingRef.current) {
          const ddx = t.x - cx, ddy = t.y - cy;
          const dd = Math.hypot(ddx, ddy) || 1;
          const reach = Math.min(1, dd / 300);
          const g = look ? 1 : gTiltMouse;
          goalMoveX = (ddx / dd) * MOVE_MAX * reach * g;
          goalMoveY = (ddy / dd) * MOVE_MAX * reach * g;
        }
        goalMoveX = Math.max(-MOVE_MAX * 2, Math.min(MOVE_MAX * 2, goalMoveX));
        goalMoveY = Math.max(-MOVE_MAX * 2, Math.min(MOVE_MAX * 2, goalMoveY));
        moveX += (goalMoveX - moveX) * lerpT;
        moveY += (goalMoveY - moveY) * lerpT;
        if (tiltRef.current) {
          tiltRef.current.style.transform =
            `translate(${moveX.toFixed(2)}px, ${moveY.toFixed(2)}px) ` +
            `perspective(600px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
        }
        // Eyes: when given a lookAt target, lock onto it (even while thinking) so
        // the gaze matches the head turn. Otherwise, the thinking "ponder" glance
        // or normal cursor tracking.
        let tL, tR;
        if (pose) {
          tL = { x: pose.ex || 0, y: pose.ey || 0 }; tR = { x: pose.ex || 0, y: pose.ey || 0 };
        } else if (look) {
          tL = getEyeTarget(LC, LOOK_EYE_MAX, r, t); tR = getEyeTarget(RC, LOOK_EYE_MAX, r, t);
        } else if (thinkingRef.current) {
          const tt = performance.now() / 1000;
          const sweep = Math.sin(tt * 1.1);            // slow horizontal scan
          const dart = Math.sin(tt * 6.0) * 0.16;      // fast micro-jitter
          const gx = Math.max(-EYE_MAX, Math.min(EYE_MAX, (sweep + dart) * EYE_MAX));
          const gy = -EYE_MAX * 0.62 + Math.cos(tt * 0.8) * EYE_MAX * 0.22; // biased up
          tL = { x: gx, y: gy }; tR = { x: gx, y: gy };
        } else if (moodRef.current === 'idle') {
          // Bored idle: eyes drift lazily side to side, with a periodic daydream
          // glance up — reads as restless/bored waiting.
          const tt = performance.now() / 1000;
          const gx = Math.sin(tt * 0.45) * EYE_MAX * 0.85 + Math.sin(tt * 1.9) * EYE_MAX * 0.1;
          let gy = Math.sin(tt * 0.33 + 1) * EYE_MAX * 0.32 + EYE_MAX * 0.15;   // slight downward droop
          if ((tt * 0.16) % 1 > 0.82) gy = -EYE_MAX * 0.7;                       // occasional look-up
          tL = { x: gx, y: gy }; tR = { x: gx, y: gy };
        } else {
          // Idle/speaking: cursor gaze + small living eye drift (and occasional glance).
          const tt = performance.now() / 1000;
          const dx2 = Math.sin(tt * 0.9 + 0.5) * 1.8 + Math.sin(tt * 2.3) * 0.7;
          const dy2 = Math.sin(tt * 1.25) * 1.3;
          const bl = getEyeTarget(LC, EYE_MAX, r, t), br = getEyeTarget(RC, EYE_MAX, r, t);
          tL = { x: bl.x + dx2, y: bl.y + dy2 }; tR = { x: br.x + dx2, y: br.y + dy2 };
        }
        const lerpE = Math.max(0.03, Math.min(0.85, EYE_LERP * gTrack));
        lxE += (tL.x - lxE) * lerpE; lyE += (tL.y - lyE) * lerpE;
        rxE += (tR.x - rxE) * lerpE; ryE += (tR.y - ryE) * lerpE;
        if (eyeLRef.current) eyeLRef.current.style.transform = `translate(${lxE.toFixed(2)}px,${lyE.toFixed(2)}px)`;
        if (eyeRRef.current) eyeRRef.current.style.transform = `translate(${rxE.toFixed(2)}px,${ryE.toFixed(2)}px)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="logo-tilt" ref={tiltRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 270 270" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* Glow used on the eyes during the thinking reaction. */}
          <filter id={glowId} x="-300%" y="-300%" width="700%" height="700%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#22d3ee" floodOpacity="0.95" />
            <feDropShadow dx="0" dy="0" stdDeviation="4.5" floodColor="#22d3ee" floodOpacity="0.6" />
          </filter>
          <clipPath id={socketLId}><path d="M125.1 160.759V141.079C125.1 140.378 124.733 139.729 124.133 139.367L102.033 126.03C100.7 125.226 99 126.186 99 127.743V147.804C99 148.514 99.3762 149.171 99.9886 149.53L122.089 162.485C123.422 163.266 125.1 162.305 125.1 160.759Z" /></clipPath>
          <clipPath id={socketRId}><path d="M146.7 160.759V141.079C146.7 140.378 147.067 139.729 147.667 139.367L169.767 126.03C171.1 125.226 172.8 126.186 172.8 127.743V147.804C172.8 148.514 172.424 149.171 171.811 149.53L149.711 162.485C148.378 163.266 146.7 162.305 146.7 160.759Z" /></clipPath>
        </defs>
        <path d="M132.5 17.2168C134.047 16.3237 135.953 16.3237 137.5 17.2168L235.753 73.9434C237.3 74.8365 238.253 76.4871 238.253 78.2734V191.727C238.253 193.513 237.3 195.163 235.753 196.057L137.5 252.783C135.953 253.676 134.047 253.676 132.5 252.783L34.2471 196.057C32.7001 195.163 31.7471 193.513 31.7471 191.727V78.2734C31.7471 76.4871 32.7001 74.8365 34.2471 73.9434L132.5 17.2168Z" fill="#111111" stroke="#111111" strokeWidth="2" strokeLinejoin="round" />
        {showOuterRing && <path d="M132.5 24C133.8 23.27 136.2 23.27 137.5 24L229.5 76.5C230.8 77.23 231.5 78.62 231.5 80.08V189.92C231.5 191.38 230.8 192.77 229.5 193.5L137.5 246C136.2 246.73 133.8 246.73 132.5 246L40.5 193.5C39.2 192.77 38.5 191.38 38.5 189.92V80.08C38.5 78.62 39.2 77.23 40.5 76.5L132.5 24Z" fill="white" />}
        <path d="M132.5 50C133.8 49.27 136.2 49.27 137.5 50L207 92C208.3 92.73 209 94.12 209 95.58V174.42C209 175.88 208.3 177.27 207 178L137.5 220C136.2 220.73 133.8 220.73 132.5 220L63 178C61.7 177.27 61 175.88 61 174.42V95.58C61 94.12 61.7 92.73 63 92L132.5 50Z" fill="#111111" stroke="#111111" strokeWidth="2" strokeLinejoin="round" />
        <path d="M135.26 53.6155L101.777 73.606C100.496 74.3708 100.473 76.2184 101.735 77.0146L117.047 86.6768C117.693 87.0841 118.514 87.0886 119.163 86.6883L136.596 75.95C137.263 75.5394 138.107 75.5555 138.758 75.9912L159.388 89.8084C160.59 90.6133 160.567 92.3884 159.344 93.1609L133.581 109.437C132.953 109.834 132.157 109.85 131.513 109.478L86.897 83.729C86.2908 83.3792 85.5459 83.3717 84.9328 83.7092L65.0356 94.6617C64.3968 95.0133 64 95.6846 64 96.4138V174.378C64 175.085 64.3731 175.739 64.9814 176.099L134.336 217.145C134.966 217.518 135.75 217.517 136.378 217.142L205.274 176.1C205.879 175.739 206.25 175.087 206.25 174.382V113.114C206.25 111.568 204.57 110.606 203.236 111.39L186.715 121.105C186.104 121.464 185.729 122.12 185.729 122.829V161.881C185.729 162.57 185.374 163.21 184.791 163.576L136.396 193.895C135.759 194.294 134.952 194.303 134.307 193.916L83.6283 163.57C83.025 163.209 82.6557 162.558 82.6557 161.854V107.578C82.6557 106.024 84.3501 105.064 85.6832 105.862L134.356 135.007C134.975 135.378 135.746 135.386 136.373 135.029L203.287 96.9194C204.614 96.1634 204.638 94.2587 203.33 93.4693L137.319 53.6205C136.686 53.2386 135.895 53.2367 135.26 53.6155Z" fill={accentColor} stroke="#111111" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M120.6 91.8L97.2 76.95L91.35 80.55L132.75 104.4L152.55 91.8L137.25 81.45L120.6 91.8Z" fill="#111111" stroke="#111111" strokeWidth="4" strokeLinejoin="round" />
        <path d="M134.442 139.793L92.1314 114.325C90.7984 113.522 89.1 114.482 89.1 116.038V157.72C89.1 158.421 89.4675 159.071 90.0685 159.433L134.392 186.113C135.041 186.504 135.854 186.495 136.493 186.09L178.619 159.439C179.199 159.072 179.55 158.434 179.55 157.749V121.732C179.55 121.030 179.919 120.379 180.521 120.017L203.329 106.333C203.931 105.971 204.300 105.320 204.300 104.618V104.258C204.300 102.719 202.636 101.757 201.303 102.524L136.470 139.813C135.841 140.175 135.064 140.168 134.442 139.793Z" fill="#111111" stroke="#111111" strokeWidth="5" strokeLinejoin="round" />
        <path d="M125.1 160.759V141.079C125.1 140.378 124.733 139.729 124.133 139.367L102.033 126.03C100.7 125.226 99 126.186 99 127.743V147.804C99 148.514 99.3762 149.171 99.9886 149.53L122.089 162.485C123.422 163.266 125.1 162.305 125.1 160.759Z" fill="#111111" />
        <path d="M146.7 160.759V141.079C146.7 140.378 147.067 139.729 147.667 139.367L169.767 126.03C171.1 125.226 172.8 126.186 172.8 127.743V147.804C172.8 148.514 172.424 149.171 171.811 149.53L149.711 162.485C148.378 163.266 146.7 162.305 146.7 160.759Z" fill="#111111" />
        {/* Static glow layers — give the thinking eyes a cyan bloom. Kept separate
            from the animated eye groups because an SVG filter applied over the
            `transform-box: fill-box` blink subtree breaks rendering in Chrome
            (the eye paints black). These plain paths have no transformed ancestor,
            so the filter renders cleanly. */}
        {thinking && <g clipPath={`url(#${socketLId})`} filter={`url(#${glowId})`}>
          <path d="M125.1 160.759V141.079C125.1 140.378 124.733 139.729 124.133 139.367L102.033 126.03C100.7 125.226 99 126.186 99 127.743V147.804C99 148.514 99.3762 149.171 99.9886 149.53L122.089 162.485C123.422 163.266 125.1 162.305 125.1 160.759Z" fill={eyeColor || "#22d3ee"} transform="translate(112,143.9) scale(0.93) translate(-112,-143.9)" />
        </g>}
        {thinking && <g clipPath={`url(#${socketRId})`} filter={`url(#${glowId})`}>
          <path d="M146.7 160.759V141.079C146.7 140.378 147.067 139.729 147.667 139.367L169.767 126.03C171.1 125.226 172.8 126.186 172.8 127.743V147.804C172.8 148.514 172.424 149.171 171.811 149.53L149.711 162.485C148.378 163.266 146.7 162.305 146.7 160.759Z" fill={eyeColor || "#22d3ee"} transform="translate(159.75,143.9) scale(0.93) translate(-159.75,-143.9)" />
        </g>}
        <g clipPath={`url(#${socketLId})`}><g ref={eyeLRef}><g className={`fc-expr fc-expr-l fc-expr-${expr}`}><g className={`blink-wrapper${thinking ? ' blink-thinking' : ''}`} style={{ transformOrigin: '112px 143.9px' }}>
          <path d="M125.1 160.759V141.079C125.1 140.378 124.733 139.729 124.133 139.367L102.033 126.03C100.7 125.226 99 126.186 99 127.743V147.804C99 148.514 99.3762 149.171 99.9886 149.53L122.089 162.485C123.422 163.266 125.1 162.305 125.1 160.759Z" fill={eyeColor ? eyeColor : (thinking ? '#a5f3fc' : 'white')} transform="translate(112,143.9) scale(0.93) translate(-112,-143.9)" />
        </g></g></g></g>
        <g clipPath={`url(#${socketRId})`}><g ref={eyeRRef}><g className={`fc-expr fc-expr-r fc-expr-${expr}`}><g className={`blink-wrapper${thinking ? ' blink-thinking' : ''}`} style={{ transformOrigin: '159.75px 143.9px' }}>
          <path d="M146.7 160.759V141.079C146.7 140.378 147.067 139.729 147.667 139.367L169.767 126.03C171.1 125.226 172.8 126.186 172.8 127.743V147.804C172.8 148.514 172.424 149.171 171.811 149.530L149.711 162.485C148.378 163.266 146.7 162.305 146.7 160.759Z" fill={eyeColor ? eyeColor : (thinking ? '#a5f3fc' : 'white')} transform="translate(159.75,143.9) scale(0.93) translate(-159.75,-143.9)" />
        </g></g></g></g>
      </svg>
    </div>
  );
}
