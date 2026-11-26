(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const S = window.Santa, h = S.h;
  const sb = S.client();

  let drawings = [], counts = {}, cur = null, asg = [];
  let sel = [], showPairs = null, confirming = null, saveTimer = null;

  const base = new URL('../secret-santa/', location.href).href;
  const linkFor = code => base + '#' + S.fmtCode(code);
  const sig = c => JSON.stringify([c.people, c.groups, c.noSwap]);
  const say = (el, t, kind) => { el.className = 'msg ' + (kind || ''); el.textContent = t || ''; };

  async function init() {
    if (!sb) { $('#setup').hidden = false; return; }
    const { data } = await sb.auth.getSession();
    if (data.session) enterApp(data.session.user); else showLogin();
    sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') showLogin(); });
  }
  function showLogin() {
    $('#app').hidden = true; $('#who').hidden = true; $('#login').hidden = false;
    cur = null; drawings = []; $('#editor').replaceChildren();
    $('#em').focus();
  }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#loginBtn'); btn.disabled = true; say($('#loginMsg'), 'Signing in...');
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    btn.disabled = false; $('#pw').value = '';
    if (error) return say($('#loginMsg'), 'Wrong email or password.', 'err');
    say($('#loginMsg'), '');
    enterApp(data.user);
  });
  $('#signout').addEventListener('click', async () => { await flushSave(); await sb.auth.signOut(); });

  async function enterApp(user) {
    $('#login').hidden = true; $('#app').hidden = false; $('#who').hidden = false;
    $('#email').textContent = user.email || '';
    await loadList();
    if (drawings.length) select(drawings[0].id); else renderEmpty();
  }

  async function loadList() {
    const [d, a] = await Promise.all([
      sb.from('drawings').select('id,title,note,config,drawn_at,created_at').order('created_at', { ascending: false }),
      sb.from('assignments').select('drawing_id,first_viewed_at')
    ]);
    if (d.error) return fatal(d.error);
    drawings = d.data.map(x => ({ ...x, config: normConfig(x.config) }));
    counts = {};
    for (const r of a.data || []) {
      const c = counts[r.drawing_id] || (counts[r.drawing_id] = { n: 0, seen: 0 });
      c.n++; if (r.first_viewed_at) c.seen++;
    }
    renderList();
  }
  const normConfig = c => ({ people: [], groups: [], noSwap: true, drawnSig: null, ...(c || {}) });
  async function loadAsg() {
    const { data, error } = await sb.from('assignments')
      .select('giver,code,cipher,iv,first_viewed_at,view_count').eq('drawing_id', cur.id).order('giver');
    if (error) return fatal(error);
    asg = data;
    counts[cur.id] = { n: asg.length, seen: asg.filter(a => a.first_viewed_at).length };
  }
  function fatal(err) {
    console.error(err);
    if (err && /JWT|auth/i.test(err.message || '')) return sb.auth.signOut();
    say($('#shareMsg') || $('#appMsg'), 'Server error: ' + (err.message || 'unknown'), 'err');
  }

  function queueSave() {
    $('#saveState') && ($('#saveState').textContent = 'Saving...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  async function flushSave() { if (saveTimer) { clearTimeout(saveTimer); await save(); } }
  async function save() {
    saveTimer = null;
    if (!cur) return;
    const title = cur.title.trim() || 'Untitled drawing';
    const { error } = await sb.from('drawings')
      .update({ title, note: cur.note.trim(), config: cur.config }).eq('id', cur.id);
    const st = $('#saveState');
    if (st) st.textContent = error ? 'Not saved: ' + error.message : 'Saved';
  }

  function renderList() {
    const ul = $('#drawings');
    if (!drawings.length) return ul.replaceChildren(h('li', { class: 'empty' }, 'No drawings yet.'));
    ul.replaceChildren(...drawings.map(d => {
      const c = counts[d.id];
      const sub = c && c.n ? `${c.n} people, ${c.seen} opened` : `${d.config.people.length} people, not drawn yet`;
      return h('li', {}, h('button', {
        'aria-current': String(cur && cur.id === d.id),
        onclick: () => select(d.id)
      }, h('b', {}, d.title || 'Untitled drawing'), h('small', {}, sub)));
    }));
  }
  function renderEmpty() {
    $('#editor').replaceChildren(h('div', { class: 'card' },
      h('h2', {}, 'No drawing selected'),
      h('p', { class: 'hint' }, 'Create a drawing, give it a title like "Smith Family 2026", then add people.'),
      h('button', { class: 'btn', onclick: newDrawing }, 'New drawing')));
  }
  $('#new').addEventListener('click', () => newDrawing());
  async function newDrawing() {
    await flushSave();
    const { data, error } = await sb.from('drawings')
      .insert({ title: 'Untitled drawing', config: normConfig() }).select('id,title,note,config,drawn_at,created_at').single();
    if (error) return fatal(error);
    drawings.unshift({ ...data, config: normConfig(data.config) });
    await select(data.id);
    const t = $('#title'); if (t) { t.focus(); t.select(); }
  }
  async function select(id) {
    await flushSave();
    cur = drawings.find(d => d.id === id);
    sel = []; showPairs = null; confirming = null; asg = [];
    if (!cur) return renderEmpty();
    renderEditor();
    renderList();
    await loadAsg();
    renderShare(); renderList();
  }

  function renderEditor() {
    const c = cur.config;
    const details = h('div', { class: 'card' },
      h('h2', {}, 'Details', h('small', { id: 'saveState' }, 'Saved')),
      h('label', { class: 'lbl', for: 'title' }, 'Drawing title (shown to everyone)'),
      h('input', { type: 'text', id: 'title', maxlength: '80', value: cur.title, oninput: e => {
        cur.title = e.target.value; queueSave();
        const b = document.querySelector('#drawings [aria-current=true] b'); if (b) b.textContent = cur.title || 'Untitled drawing';
      } }),
      h('label', { class: 'lbl', for: 'note' }, 'Note shown with each reveal'),
      h('input', { type: 'text', id: 'note', maxlength: '200', placeholder: 'e.g. $30 limit, swap on Dec 20', value: cur.note, oninput: e => { cur.note = e.target.value; queueSave(); } }),
      h('label', { class: 'opt' },
        h('input', { type: 'checkbox', checked: c.noSwap, onchange: e => { c.noSwap = e.target.checked; changed(); } }),
        h('span', {}, 'No straight swaps', h('small', {}, 'Stops two people from drawing each other.')))
    );
    const people = h('div', { class: 'card' },
      h('h2', {}, "Who's in", h('small', { id: 'count' })),
      h('p', { class: 'hint' }, 'Type a name and press Enter, or paste a comma separated list.'),
      h('form', { class: 'row', autocomplete: 'off', onsubmit: addPeople },
        h('input', { type: 'text', id: 'nameIn', maxlength: '400', placeholder: 'Name', 'aria-label': 'Name' }),
        h('button', { class: 'btn', type: 'submit' }, 'Add')),
      h('div', { class: 'msg', id: 'peopleMsg', role: 'status' }),
      h('ul', { class: 'chips', id: 'people' }));
    const rules = h('div', { class: 'card' },
      h('h2', {}, "Who can't draw who"),
      h('p', { class: 'hint' }, 'Pick two or more names (siblings, couples, housemates). Nobody in a group can draw anyone else in it.'),
      h('div', { class: 'row', id: 'picker' }),
      h('div', { class: 'row' }, h('button', { class: 'btn', id: 'block', onclick: addGroup })),
      h('ul', { class: 'rules', id: 'rules' }));
    const share = h('div', { class: 'card', id: 'shareCard' });
    const danger = h('div', { class: 'card', id: 'dangerCard' });
    $('#editor').replaceChildren(details, h('div', { class: 'cols' }, people, rules), share, danger);
    renderPeople(); renderShare(); renderDanger();
  }

  function changed() { queueSave(); renderPeople(); renderShare(); renderList(); }

  function addPeople(e) {
    e.preventDefault();
    const c = cur.config, inp = $('#nameIn');
    const names = inp.value.split(/[,\n;]+/).map(s => s.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean);
    const have = new Set(c.people.map(p => p.toLowerCase())), dupes = [];
    for (const n of names) {
      if (have.has(n.toLowerCase())) dupes.push(n);
      else if (c.people.length >= 200) { dupes.push(n); }
      else { c.people.push(n); have.add(n.toLowerCase()); }
    }
    inp.value = ''; inp.focus();
    changed();
    say($('#peopleMsg'), dupes.length ? `Skipped (already listed or over 200): ${dupes.join(', ')}` : '', dupes.length ? 'err' : '');
  }
  function removePerson(name) {
    const c = cur.config;
    c.people = c.people.filter(p => p !== name);
    c.groups = c.groups.map(g => g.filter(x => x !== name)).filter(g => g.length > 1);
    sel = sel.filter(x => x !== name);
    changed();
  }
  function addGroup() {
    if (sel.length < 2) return;
    const g = [...sel].sort((a, b) => a.localeCompare(b)), key = g.join('\n');
    if (!cur.config.groups.some(x => x.join('\n') === key)) cur.config.groups.push(g);
    sel = []; changed();
  }

  function renderPeople() {
    const c = cur.config;
    $('#count').textContent = `${c.people.length} ${c.people.length === 1 ? 'person' : 'people'}`;
    $('#people').replaceChildren(...(c.people.length ? c.people.map(p =>
      h('li', { class: 'chip' }, p, h('button', { class: 'x', 'aria-label': 'Remove ' + p, onclick: () => removePerson(p) }, '×')))
      : [h('li', { class: 'empty' }, 'No one yet.')]));
    $('#picker').replaceChildren(...(c.people.length ? c.people.map(p =>
      h('button', { class: 'pick', 'aria-pressed': String(sel.includes(p)), onclick: () => {
        sel = sel.includes(p) ? sel.filter(x => x !== p) : [...sel, p]; renderPeople();
      } }, p)) : [h('span', { class: 'hint' }, 'Add people first.')]));
    const b = $('#block');
    b.disabled = sel.length < 2;
    b.textContent = sel.length < 2 ? 'Pick 2 or more names' : `Block these ${sel.length} from drawing each other`;
    $('#rules').replaceChildren(...(c.groups.length ? c.groups.map((g, i) =>
      h('li', {}, h('span', {}, g.flatMap((x, j) => j ? [h('span', { class: 'sep' }, '·'), x] : [x])),
        h('button', { class: 'link', onclick: () => { c.groups.splice(i, 1); changed(); } }, 'Remove')))
      : [h('li', { class: 'empty' }, 'No rules yet. Anyone can draw anyone.')]));
  }

  function renderShare() {
    const card = $('#shareCard'); if (!card) return;
    const c = cur.config, drawn = asg.length > 0, seen = asg.filter(a => a.first_viewed_at).length;
    const kids = [h('h2', {}, drawn ? 'Share' : 'Draw names',
      drawn ? h('small', {}, `${seen} of ${asg.length} opened`) : null)];

    if (!drawn) {
      kids.push(h('p', { class: 'hint' }, 'Drawing creates a private code and link for each person. You only see codes, not who has who.'),
        h('button', { class: 'btn big', id: 'drawBtn', onclick: () => doDraw() }, 'Draw names'));
    } else {
      if (c.drawnSig && c.drawnSig !== sig(c))
        kids.push(h('p', { class: 'warn' }, 'People or rules changed since the last draw. The codes below still use the old draw until you draw again.'));
      kids.push(h('p', { class: 'hint' }, 'Send each person their own message privately (text, Teams, email). Opening the link reveals their match.'),
        h('ul', { class: 'share' }, asg.map(a => h('li', {},
          h('span', { class: 'nm' }, h('b', {}, a.giver), h('code', {}, S.fmtCode(a.code))),
          h('span', { class: 'row' },
            h('span', { class: 'pill' + (a.first_viewed_at ? ' seen' : '') },
              a.first_viewed_at ? `Opened ${S.fmtWhen(a.first_viewed_at)}` : 'Not opened'),
            h('button', { class: 'btn2', onclick: e => copy(message(a), e.target) }, 'Copy message'),
            h('button', { class: 'btn2', onclick: e => copy(linkFor(a.code), e.target) }, 'Copy link'))))),
        h('div', { class: 'row', id: 'shareBtns' },
          h('button', { class: 'btn2', onclick: e => copy(asg.map(message).join('\n\n----------\n\n'), e.target) }, 'Copy all messages'),
          h('button', { class: 'btn2', onclick: refresh }, 'Refresh opened status'),
          h('button', { class: 'btn2', onclick: () => { confirming = seen ? 'redraw' : null; if (seen) renderShare(); else doDraw(); } }, 'Draw again')));
      if (confirming === 'redraw')
        kids.push(h('div', { class: 'confirm' },
          h('span', {}, `${seen} ${seen === 1 ? 'person has' : 'people have'} already looked. Drawing again gives everyone new codes and the old links stop working.`),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => { confirming = null; doDraw(); } }, 'Draw again anyway'),
            h('button', { class: 'btn2', onclick: () => { confirming = null; renderShare(); } }, 'Cancel'))));
      if (showPairs) {
        kids.push(h('ul', { class: 'pairs' }, showPairs.map(([g, r]) =>
          h('li', {}, h('span', {}, g), h('span', { class: 'arr' }, '→'), h('span', {}, r)))),
          h('button', { class: 'link', onclick: () => { showPairs = null; renderShare(); } }, 'Hide pairings'));
      } else {
        kids.push(h('details', {}, h('summary', { class: 'hint' }, 'See who has who (spoils it for you)'),
          h('button', { class: 'btn2', onclick: revealAll }, 'Show all pairings')));
      }
    }
    kids.push(h('div', { class: 'msg', id: 'shareMsg', role: 'status' }), h('div', { id: 'copyBox' }));
    card.replaceChildren(...kids);
  }

  function message(a) {
    const lines = [
      `Hi ${a.giver}! You're in the "${cur.title.trim() || 'Secret Santa'}" Secret Santa.`,
      `See who you're buying for: ${linkFor(a.code)}`,
      `(Or go to ${base} and enter code ${S.fmtCode(a.code)})`
    ];
    if (cur.note.trim()) lines.push(cur.note.trim());
    return lines.join('\n');
  }
  async function copy(text, btn) {
    if (await S.copyText(text, btn)) return;
    const ta = h('textarea', { rows: 6, readonly: true, class: 'copyta' });
    ta.value = text;
    $('#copyBox').replaceChildren(h('p', { class: 'hint' }, "Your browser blocked copying. Select and copy this instead:"), ta);
    ta.focus(); ta.select();
  }

  async function doDraw() {
    const c = cur.config, msg = $('#shareMsg');
    const r = S.draw(c.people, c.groups, c.noSwap);
    if (r.error) return say(msg, r.error, 'err');
    const btns = document.querySelectorAll('#shareCard button'); btns.forEach(b => { b.disabled = true; });
    say(msg, 'Drawing and encrypting...');
    try {
      await flushSave();
      const rows = await Promise.all(r.pairs.map(async ([giver, receiver]) => {
        const code = S.genCode();
        return { giver, code, ...(await S.seal(code, receiver)) };
      }));
      const { error } = await sb.rpc('replace_assignments', { p_drawing: cur.id, p_rows: rows });
      if (error) throw error;
      c.drawnSig = sig(c); cur.drawn_at = new Date().toISOString();
      await save();
      showPairs = null;
      await loadAsg();
      renderShare(); renderList();
      say($('#shareMsg'), `Done. ${rows.length} codes created. Send each person their message.`, 'ok');
    } catch (e) {
      renderShare(); fatal(e);
    }
  }
  async function refresh() { await loadAsg(); renderShare(); renderList(); }
  async function revealAll() {
    try { showPairs = await Promise.all(asg.map(async a => [a.giver, await S.open(a.code, a.cipher, a.iv)])); }
    catch (e) { return say($('#shareMsg'), 'Could not decrypt the pairings.', 'err'); }
    renderShare();
  }

  function renderDanger() {
    const card = $('#dangerCard');
    const kids = [h('h2', {}, 'Delete drawing'),
      h('p', { class: 'hint' }, 'Removes the drawing and every code in it. Links already sent stop working.')];
    if (confirming === 'delete') kids.push(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: doDelete }, `Delete "${cur.title || 'Untitled drawing'}"`),
      h('button', { class: 'btn2', onclick: () => { confirming = null; renderDanger(); } }, 'Cancel')));
    else kids.push(h('button', { class: 'btn2 danger', onclick: () => { confirming = 'delete'; renderDanger(); } }, 'Delete this drawing'));
    card.replaceChildren(...kids);
  }
  async function doDelete() {
    clearTimeout(saveTimer); saveTimer = null;
    const { error } = await sb.from('drawings').delete().eq('id', cur.id);
    if (error) return fatal(error);
    drawings = drawings.filter(d => d.id !== cur.id); cur = null;
    renderList();
    if (drawings.length) select(drawings[0].id); else renderEmpty();
  }

  window.addEventListener('beforeunload', e => { if (saveTimer) { save(); e.preventDefault(); } });
  init();
})();
