(function () {
  'use strict';

  const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CODE_LEN = 12;

  function genCode() {
    const b = crypto.getRandomValues(new Uint8Array(CODE_LEN));
    return Array.from(b, x => ALPHA[x & 31]).join('');
  }
  function normCode(s) {
    return String(s || '').toUpperCase()
      .replace(/[IL]/g, '1').replace(/O/g, '0')
      .replace(/[^0-9A-Z]/g, '');
  }
  function isCode(c) { return c.length === CODE_LEN && [...c].every(ch => ALPHA.includes(ch)); }
  function fmtCode(c) { return c.match(/.{1,4}/g).join('-'); }

  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function keyFor(code) {
    const raw = await crypto.subtle.digest('SHA-256', te.encode('secret-santa-v1:' + code));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function seal(code, receiver) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(code), te.encode(JSON.stringify({ r: receiver })));
    return { cipher: b64(new Uint8Array(ct)), iv: b64(iv) };
  }
  async function open(code, cipher, iv) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(code), unb64(cipher));
    return JSON.parse(td.decode(pt)).r;
  }

  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  function draw(people, groups, noSwap) {
    const n = people.length;
    if (n < 2) return { error: 'Add at least 2 people first.' };
    if (noSwap && n < 3) return { error: 'With "No straight swaps" on you need at least 3 people.' };
    const at = new Map(people.map((p, i) => [p, i]));
    const ok = people.map((_, g) => people.map((_, r) => g !== r));
    for (const grp of groups) for (const a of grp) for (const b of grp)
      if (a !== b && at.has(a) && at.has(b)) ok[at.get(a)][at.get(b)] = false;
    const stuck = people.filter((_, g) => !ok[g].some(Boolean));
    if (stuck.length) return { error: `${stuck.join(', ')} can't draw anyone with these rules. Remove a rule or add people.` };
    const p = solve(n, ok, noSwap);
    if (!p) return { error: 'No draw is possible with these rules. Remove a rule, turn off "No straight swaps", or add people.' };
    return { pairs: people.map((g, i) => [g, people[p[i]]]) };
  }

  function solve(n, ok, noSwap) {
    const idx = [...Array(n).keys()];
    const valid = p => p.every((r, g) => ok[g][r] && (!noSwap || p[r] !== g));
    for (let t = 0; t < 6000; t++) { const p = shuffle(idx.slice()); if (valid(p)) return p; }
    const cnt = idx.map(g => ok[g].filter(Boolean).length);
    for (let a = 0; a < 8; a++) {
      const order = shuffle(idx.slice()).sort((x, y) => cnt[x] - cnt[y]);
      const p = Array(n).fill(-1), used = Array(n).fill(false);
      let nodes = 0, capped = false;
      const rec = k => {
        if (k === n) return true;
        if (++nodes > 300000) { capped = true; return false; }
        const g = order[k];
        for (const r of shuffle(idx.filter(r => ok[g][r] && !used[r]))) {
          if (noSwap && p[r] === g) continue;
          p[g] = r; used[r] = true;
          if (rec(k + 1)) return true;
          p[g] = -1; used[r] = false;
          if (capped) return false;
        }
        return false;
      };
      if (rec(0)) return p;
      if (!capped) return null;
    }
    return null;
  }

  function client() {
    const c = window.SANTA_CONFIG || {};
    if (!c.supabaseUrl || /YOUR/.test(c.supabaseUrl) || !c.supabaseKey || /YOUR/.test(c.supabaseKey)) return null;
    return window.supabase.createClient(c.supabaseUrl, c.supabaseKey);
  }
  const fmtWhen = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && typeof v !== 'string') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  }
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const o = btn.textContent; btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = o; }, 1500);
      return true;
    } catch (e) { return false; }
  }

  window.Santa = { genCode, normCode, isCode, fmtCode, seal, open, draw, solve, client, fmtWhen, h, copyText };
})();
