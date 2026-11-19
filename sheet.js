/* SBAC Practice: Add & Subtract with Equivalent Fractions (Grade 5 FIAB) — sends each student's work to the class
   score sheet as they go and reads it back: for the teacher screen, and so a student can keep going on any device.
   Copied from the Grade 5 FIAB fractions practice site (the outbox), with the change made for Ms. Pudill's and
   Mrs. Krotki's classes on the Grade 5 Inferences site: every record names the student's teacher, the sheet keeps
   one tab per teacher, and every PIN goes to the sheet's script to be checked there (no PIN is in any page file).

   Every answer updates one row per attempt ("In progress", how many answered); the last answer makes it
   "Finished". Updates wait in an outbox on this device until the sheet says it has them. A lost send is
   checked, then sent again; the sheet only moves a row forward, so a late or repeated send never undoes
   newer work.

   SHEET_URL = the "Grade 5 Fractions Practice Scores" sheet's web app (apps-script/README.md). Left empty, the page
   is a PREVIEW: nothing is sent and nothing waits in the outbox; progress stays on this computer only. */
(function () {
  'use strict';

  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxvRgU1EtomM1EY5RhqEl_NmltjkJGSzhq6RZJQHzuB_0eTFvoHBf-iW9QA57ODCE4n/exec';
  const SITE = 'g5-fractions-pk';
  const OUTBOX_KEY = 'g5FracFiab_outbox_v1';
  const DEVICE_KEY = 'g5FracFiab_device_v1';
  const PAUSES = [1500, 3000, 4500];

  const read = () => {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; }
  };
  const write = list => {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch (e) { /* private window: nothing is kept */ }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // This computer's own id: the sheet counts wrong PINs per computer (5 in 10 minutes locks it out)
  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = `D-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return 'D-no-storage';
    }
  }

  // text/plain body: a simple request, so the browser sends it with no preflight
  async function post(body, ms = 20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(SHEET_URL, { method: 'POST', body: JSON.stringify({ site: SITE, ...body }), signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Did the sheet get (at least) this update?
  function landed(rec, c) {
    if (!c || !c.ok) return false;
    if (rec.status === 'Restarted') return !c.saved || c.status !== 'In progress';
    if (!c.saved) return false;
    if (rec.status === 'Finished') return c.status === 'Finished';
    return c.status !== 'In progress' || c.answered >= rec.answered;
  }

  async function sendUntilSaved(rec) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const r = await post({ action: 'save', ...rec });
        if (r.ok && r.saved) return true;
      } catch (e) { /* lost or failed: check below, then send again */ }
      if (attempt === PAUSES.length) return false;
      await wait(PAUSES[attempt]);
      try {
        if (landed(rec, await post({ action: 'check', saveId: rec.saveId, teacher: rec.teacher }))) return true;
      } catch (e) { /* send again */ }
    }
  }

  // One pass over the outbox, one send at a time. An update queued during the pass is
  // picked up too, and a send never removes a newer update of the same attempt.
  async function runFlush() {
    const tried = new Set();
    for (;;) {
      const next = read().find(r => !tried.has(`${r.saveId}:${r.rev}`));
      if (!next) return read().length;
      tried.add(`${next.saveId}:${next.rev}`);
      if (await sendUntilSaved(next)) write(read().filter(r => !(r.saveId === next.saveId && r.rev === next.rev)));
    }
  }

  let flushing = null;
  function flush() {
    if (!SHEET_URL) return Promise.resolve(0);
    if (!flushing) flushing = runFlush().finally(() => { flushing = null; });
    return flushing;
  }

  // The newest update of an attempt replaces any older one still waiting: it holds all of it.
  // Preview (no sheet): nothing is queued, so nothing made in a preview is ever sent later.
  let lastRev = 0;
  function queue(rec) {
    if (!SHEET_URL) return;
    lastRev = Math.max(Date.now(), lastRev + 1);
    write([...read().filter(r => r.saveId !== rec.saveId), { ...rec, rev: lastRev }]);
  }

  const isPending = saveId => read().some(r => r.saveId === saveId);
  const newSaveId = () => `S-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // A student's own unfinished attempts in their teacher's tab: { ok, places, finished } — throws if it can't be reached
  function loadPlaces(name, teacher) {
    if (!SHEET_URL) return Promise.resolve({ ok: true, places: [], finished: {} });
    return post({ action: 'resume', name, teacher }, 8000);
  }

  // One teacher's rows: { ok: true, rows } or { ok: false, error }. The PIN is checked by the sheet's
  // script, never here. verifyOnly: just "is this her PIN?" (to let a student retake, start over or skip ahead).
  function loadScores(teacher, pin, verifyOnly = false) {
    if (!SHEET_URL) return Promise.resolve({ ok: false, error: 'No sheet' });
    return post({ action: 'scores', teacher, pin, device: deviceId(), verifyOnly });
  }

  // Fix a misspelled name, with her PIN (checked by the sheet's script): every row of one name in HER class's tab
  // moves to the right name. { ok, moved } or { ok: false, error }.
  function renameStudent(teacher, pin, from, to) {
    if (!SHEET_URL) return Promise.resolve({ ok: false, error: 'No sheet' });
    return post({ action: 'rename', teacher, pin, device: deviceId(), from, to });
  }

  window.G5FracSheet = { connected: Boolean(SHEET_URL), queue, flush, isPending, newSaveId, loadPlaces, loadScores, renameStudent };
})();
