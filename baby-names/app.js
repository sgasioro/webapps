(() => {
  'use strict';

  const STORAGE_KEY = 'babyNameRanker.v1';
  const POOL_SIZES = [8, 16, 24, 32];
  // Share of each round that finishes on top (carried forward) or bottom (retired).
  const QUARTER = 0.25;
  // Share of a new round reserved for past favorites.
  const FAVORITE_SHARE = 1 / 3;

  const BASE = {
    boy: dedupe(window.BASE_NAMES.boy.split(/\s+/)),
    girl: dedupe(window.BASE_NAMES.girl.split(/\s+/)),
  };

  // ---------- Persistence ----------

  function emptyGenderData() {
    // stats: { [name]: { seen, total, best, tops } } — total is the sum of per-round scores (0..1)
    return { stats: {}, retired: {}, custom: [], session: null, lastResult: null, rounds: 0 };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && raw.data) {
        raw.data.boy = { ...emptyGenderData(), ...raw.data.boy };
        raw.data.girl = { ...emptyGenderData(), ...raw.data.girl };
        return raw;
      }
    } catch (e) { /* fall through to a fresh store */ }
    return { gender: 'girl', poolSize: 16, data: { boy: emptyGenderData(), girl: emptyGenderData() } };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked */ }
  }

  let db = load();
  let view = gd().session ? 'compare' : 'home';

  function gd() { return db.data[db.gender]; }

  // ---------- Helpers ----------

  function dedupe(list) {
    const seen = new Set();
    return list.map(s => s.trim()).filter(s => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function allNames() { return dedupe(BASE[db.gender].concat(gd().custom)); }
  function avg(stat) { return stat.seen ? stat.total / stat.seen : 0; }

  function favorites() {
    const g = gd();
    return Object.entries(g.stats)
      .filter(([name]) => !g.retired[name])
      .sort((a, b) => avg(b[1]) - avg(a[1]) || b[1].seen - a[1].seen);
  }

  function counts() {
    const g = gd();
    const names = allNames();
    const retired = names.filter(n => g.retired[n]).length;
    const unseen = names.filter(n => !g.stats[n] && !g.retired[n]).length;
    return { total: names.length, retired, unseen, active: names.length - retired };
  }

  // ---------- Round setup ----------

  function buildPool(size) {
    const g = gd();
    const eligible = allNames().filter(n => !g.retired[n]);
    const favs = favorites().filter(([, s]) => avg(s) >= 0.5).map(([n]) => n);
    const pool = favs.slice(0, Math.round(size * FAVORITE_SHARE));
    const inPool = new Set(pool);

    // Fill with names never seen before, then with previously-seen middling names.
    for (const n of shuffle(eligible.filter(n => !g.stats[n]))) {
      if (pool.length >= size) break;
      pool.push(n); inPool.add(n);
    }
    for (const [n] of favorites()) {
      if (pool.length >= size) break;
      if (!inPool.has(n)) { pool.push(n); inPool.add(n); }
    }
    return shuffle(pool);
  }

  function startRound() {
    const pool = buildPool(db.poolSize);
    if (pool.length < 2) { alert('Not enough active names left. Restore some retired names or add your own.'); return; }
    // Bottom-up merge sort driven by the user's picks. Each run is sorted best-first.
    gd().session = { pool, queue: pool.map(n => [n]), a: [], b: [], out: [], done: 0, undo: [] };
    advance(gd().session);
    gd().lastResult = null;
    view = 'compare';
    save(); render();
  }

  // Load the next pair of runs to merge, if the current merge is finished.
  function advance(s) {
    if (!s.a.length && !s.b.length && s.queue.length >= 2) {
      s.a = s.queue.shift();
      s.b = s.queue.shift();
      s.out = [];
    }
  }

  function isFinished(s) { return s.queue.length === 1 && !s.a.length && !s.b.length; }

  // Worst-case number of comparisons for the whole round.
  function maxComparisons(n) {
    const q = Array(n).fill(1);
    let total = 0;
    while (q.length > 1) {
      const m = q.shift() + q.shift();
      total += m - 1;
      q.push(m);
    }
    return total;
  }

  function choose(side) {
    const s = gd().session;
    if (!s || isFinished(s)) return;
    s.undo.push(JSON.stringify({ queue: s.queue, a: s.a, b: s.b, out: s.out, done: s.done }));
    s.out.push(side === 'a' ? s.a.shift() : s.b.shift());
    s.done++;
    if (!s.a.length || !s.b.length) {
      s.queue.push(s.out.concat(s.a, s.b));
      s.a = []; s.b = []; s.out = [];
      advance(s);
    }
    if (isFinished(s)) finishRound();
    save(); render();
  }

  function undo() {
    const s = gd().session;
    if (!s || !s.undo.length) return;
    Object.assign(s, JSON.parse(s.undo.pop()));
    save(); render();
  }

  function abandonRound() {
    if (!confirm('Abandon this round? Nothing from it will be saved.')) return;
    gd().session = null;
    view = 'home';
    save(); render();
  }

  function finishRound() {
    const g = gd();
    const ranking = g.session.queue[0];
    const n = ranking.length;
    const cut = Math.floor(n * QUARTER);
    const retiredNow = [];
    ranking.forEach((name, i) => {
      const score = n > 1 ? 1 - i / (n - 1) : 1;
      const st = g.stats[name] || (g.stats[name] = { seen: 0, total: 0, best: 0, tops: 0 });
      st.seen++;
      st.total += score;
      st.best = Math.max(st.best, score);
      if (i < cut) st.tops++;
      if (i >= n - cut) { g.retired[name] = true; retiredNow.push(name); }
    });
    g.rounds++;
    g.lastResult = { ranking, cut, retiredNow, round: g.rounds };
    g.session = null;
    view = 'results';
  }

  // ---------- History management ----------

  function restore(name) {
    delete gd().retired[name];
    save(); render();
  }

  function retire(name) {
    gd().retired[name] = true;
    save(); render();
  }

  function addCustom(raw) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const display = name.charAt(0).toUpperCase() + name.slice(1);
    const exists = allNames().find(n => n.toLowerCase() === display.toLowerCase());
    if (exists) {
      if (gd().retired[exists]) restore(exists);
      else alert(`${exists} is already in the list.`);
      return;
    }
    gd().custom.push(display);
    save(); render();
  }

  function resetGender() {
    if (!confirm(`Erase all ${db.gender} name history, favorites, and retired names?`)) return;
    db.data[db.gender] = emptyGenderData();
    view = 'home';
    save(); render();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `baby-names-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importData(file) {
    file.text().then(text => {
      const data = JSON.parse(text);
      if (!data || !data.data || !data.data.boy || !data.data.girl) throw new Error('bad file');
      localStorage.setItem(STORAGE_KEY, text);
      db = load();
      view = gd().session ? 'compare' : 'home';
      render();
    }).catch(() => alert('That file doesn’t look like a Name Ranker export.'));
  }

  // ---------- Rendering ----------

  const app = document.getElementById('app');

  function render() {
    document.body.dataset.gender = db.gender;
    document.querySelectorAll('.gender-toggle button').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.gender === db.gender));
    });
    if (view === 'compare' && gd().session) renderCompare();
    else if (view === 'results' && gd().lastResult) renderResults();
    else { view = 'home'; renderHome(); }
  }

  function renderHome() {
    const g = gd();
    const c = counts();
    const favs = favorites().slice(0, 15);
    const retired = allNames().filter(n => g.retired[n]).sort();
    const label = db.gender === 'boy' ? 'boy' : 'girl';

    app.innerHTML = `
      <section class="card">
        <h2>Rank ${label} names</h2>
        <p class="muted small">Pick your favorite of two names until the round is fully ranked.
          The top quarter of each round carries into future rounds; the bottom quarter is retired.</p>
        <div class="stats">
          <div class="stat"><b>${c.unseen}</b><span>unseen</span></div>
          <div class="stat"><b>${favorites().length}</b><span>in play</span></div>
          <div class="stat"><b>${c.retired}</b><span>retired</span></div>
        </div>
        <div class="row" style="justify-content: space-between">
          <div class="row">
            <span class="small muted">Names per round</span>
            <div class="segmented">
              ${POOL_SIZES.map(n => `<button type="button" data-size="${n}" aria-pressed="${n === db.poolSize}">${n}</button>`).join('')}
            </div>
          </div>
          <button type="button" class="btn primary" data-action="start">Start round ${g.rounds + 1}</button>
        </div>
        <p class="small muted" style="margin-bottom:0">Up to ${maxComparisons(db.poolSize)} picks.</p>
      </section>

      ${favs.length ? `
      <section class="card">
        <h2>Favorites so far</h2>
        <ol class="ranking">
          ${favs.map(([name, st], i) => `
            <li>
              <span class="pos">${i + 1}</span>
              <span class="name">${esc(name)}</span>
              <span class="small muted">${st.seen} round${st.seen === 1 ? '' : 's'}</span>
              <span class="bar" title="Average ${Math.round(avg(st) * 100)}%"><div style="width:${Math.round(avg(st) * 100)}%"></div></span>
              <button type="button" class="btn link small" data-retire="${esc(name)}" title="Retire">✕</button>
            </li>`).join('')}
        </ol>
      </section>` : ''}

      <section class="card">
        <h2>Add a name</h2>
        <form class="row" data-form="add">
          <input type="text" name="name" placeholder="A name you love that isn’t on the list" autocomplete="off">
          <button type="submit" class="btn">Add</button>
        </form>
        ${g.custom.length ? `<p class="small muted" style="margin-bottom:0">Your additions: ${g.custom.map(esc).join(', ')}</p>` : ''}
      </section>

      ${retired.length ? `
      <section class="card">
        <details>
          <summary>Retired names (${retired.length})</summary>
          <div class="retired-list">
            ${retired.map(n => `<span class="chip">${esc(n)}<button type="button" data-restore="${esc(n)}" title="Bring back">↺</button></span>`).join('')}
          </div>
        </details>
      </section>` : ''}

      <footer class="tools">
        <button type="button" class="btn small" data-action="export">Export history</button>
        <label class="btn small">Import<input type="file" accept="application/json" data-action="import" hidden></label>
        <button type="button" class="btn small" data-action="reset">Reset ${label} history</button>
      </footer>
    `;
  }

  function renderCompare() {
    const s = gd().session;
    const max = maxComparisons(s.pool.length);
    const pct = Math.min(100, Math.round((s.done / max) * 100));
    app.innerHTML = `
      <section>
        <div class="row" style="justify-content: space-between">
          <span class="small muted">Pick ${s.done + 1} · at most ${max}</span>
          <span class="row">
            <button type="button" class="btn link small" data-action="undo" ${s.undo.length ? '' : 'disabled'}>Undo</button>
            <button type="button" class="btn link small" data-action="abandon">Abandon</button>
          </span>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="versus">
          <button type="button" class="choice" data-choose="a">${esc(s.a[0])}</button>
          <span class="or">or</span>
          <button type="button" class="choice" data-choose="b">${esc(s.b[0])}</button>
        </div>
        <p class="hint small muted">Keyboard: ← / → to pick, Backspace to undo</p>
      </section>
    `;
  }

  function renderResults() {
    const r = gd().lastResult;
    app.innerHTML = `
      <section class="card">
        <h2>Round ${r.round} results</h2>
        <ol class="ranking">
          ${r.ranking.map((name, i) => {
            const isCut = r.retiredNow.includes(name);
            const isTop = i < r.cut;
            return `
            <li class="${isCut ? 'cut' : ''}">
              <span class="pos">${i + 1}</span>
              <span class="name">${esc(name)}</span>
              ${isTop ? '<span class="tag keep">carries forward</span>' : ''}
              ${isCut ? `<span class="tag cut">retired</span><button type="button" class="btn link small" data-restore="${esc(name)}">keep</button>` : ''}
            </li>`;
          }).join('')}
        </ol>
      </section>
      <div class="row" style="justify-content: center">
        <button type="button" class="btn" data-action="home">See all favorites</button>
        <button type="button" class="btn primary" data-action="start">Next round</button>
      </div>
    `;
  }

  // ---------- Events ----------

  document.querySelector('.gender-toggle').addEventListener('click', e => {
    const btn = e.target.closest('button[data-gender]');
    if (!btn || btn.dataset.gender === db.gender) return;
    db.gender = btn.dataset.gender;
    view = gd().session ? 'compare' : 'home';
    save(); render();
  });

  app.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.choose) return choose(t.dataset.choose);
    if (t.dataset.size) { db.poolSize = Number(t.dataset.size); save(); return render(); }
    if (t.dataset.restore) {
      const r = gd().lastResult;
      if (r) r.retiredNow = r.retiredNow.filter(n => n !== t.dataset.restore);
      return restore(t.dataset.restore);
    }
    if (t.dataset.retire) return retire(t.dataset.retire);
    switch (t.dataset.action) {
      case 'start': return startRound();
      case 'undo': return undo();
      case 'abandon': return abandonRound();
      case 'home': view = 'home'; return render();
      case 'export': return exportData();
      case 'reset': return resetGender();
    }
  });

  app.addEventListener('change', e => {
    if (e.target.dataset.action === 'import' && e.target.files[0]) importData(e.target.files[0]);
  });

  app.addEventListener('submit', e => {
    if (e.target.dataset.form !== 'add') return;
    e.preventDefault();
    addCustom(e.target.elements.name.value);
  });

  document.addEventListener('keydown', e => {
    if (view !== 'compare' || e.target.matches('input')) return;
    if (e.key === 'ArrowLeft') choose('a');
    else if (e.key === 'ArrowRight') choose('b');
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); undo(); }
  });

  render();
})();
