// Small shared helpers.
// Letters only — an unnamed contact shown as a masked number gets '#', not '+9'.
export const initials = (name) => String(name || '').split(/\s+/).filter(w => /^\p{L}/u.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '#';
const PALETTE = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
export const colorFor = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

export const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const todayYmd = () => ymd(new Date());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export const timeOf = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const dayLabel = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// "Jane Doe <jane@x.com>" → "Jane Doe" (never show the address in full on the office cards).
export const senderName = (from) => { const m = /^"?([^"<]+?)"?\s*</.exec(from || ''); return m ? m[1].trim() : String(from || '').replace(/@.*/, '@…'); };

export function useTheme() {
  const get = () => { try { return localStorage.getItem('openforge.theme') || 'system'; } catch { return 'system'; } };
  return {
    get,
    apply(pref) {
      const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      try { localStorage.setItem('openforge.theme', pref); } catch { /* private window */ }
    },
  };
}
