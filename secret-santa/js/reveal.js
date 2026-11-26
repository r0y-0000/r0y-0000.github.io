(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const S = window.Santa;
  const sb = S.client();
  const say = (el, t, kind) => { el.className = 'msg ' + (kind || ''); el.textContent = t || ''; };
  let pending = null;

  function show(id) { for (const s of ['entry', 'gate', 'result']) $('#' + s).hidden = s !== id; }

  if (!sb) say($('#msg'), 'This site is not set up yet: config.js still has placeholder values.', 'err');

  async function reveal(raw, msgEl, btn) {
    const code = S.normCode(raw);
    if (!S.isCode(code)) { show('entry'); return say($('#msg'), 'Codes are 12 letters and numbers. Check it for typos.', 'err'); }
    if (!sb) return;
    btn.disabled = true; say(msgEl, 'Checking the list twice... 🎅');
    try {
      const { data, error } = await sb.rpc('reveal', { p_code: code });
      if (error) throw error;
      if (!data) { show('entry'); return say($('#msg'), "That code isn't on Santa's list. Check it, or ask your organizer for a new one.", 'err'); }
      const receiver = await S.open(code, data.cipher, data.iv);
      $('#title').textContent = data.title;
      $('#to').textContent = `🎅 ${data.giver}, you're buying for`;
      $('#recv').textContent = receiver;
      $('#note').textContent = data.note || '';
      $('#seen').textContent = data.first_viewed_at
        ? `This code was first opened ${S.fmtWhen(data.first_viewed_at)}. If that wasn't you, tell your organizer.`
        : 'Remember the name, then hide it. 🤫';
      say(msgEl, '');
      show('result');
      $('#hide').focus();
    } catch (e) {
      console.error(e);
      say(msgEl, "Couldn't reach Santa's workshop. Try again in a moment.", 'err');
    } finally {
      btn.disabled = false;
    }
  }

  $('#codeForm').addEventListener('submit', e => { e.preventDefault(); reveal($('#codeIn').value, $('#msg'), $('#go')); });
  $('#unwrap').addEventListener('click', () => reveal(pending, $('#gateMsg'), $('#unwrap')));
  function reset() {
    pending = null;
    $('#recv').textContent = ''; $('#codeIn').value = '';
    history.replaceState(null, '', location.pathname);
    show('entry'); say($('#msg'), ''); $('#codeIn').focus();
  }
  $('#other').addEventListener('click', reset);
  $('#hide').addEventListener('click', reset);

  function fromHash() {
    const c = decodeURIComponent(location.hash.slice(1));
    if (!c) return;
    if (!S.isCode(S.normCode(c))) { show('entry'); $('#codeIn').value = c; return say($('#msg'), 'That link looks incomplete. Check the code and try again.', 'err'); }
    pending = c; say($('#gateMsg'), ''); show('gate'); $('#unwrap').focus();
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
