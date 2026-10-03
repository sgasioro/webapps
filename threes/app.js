(() => {
  'use strict';

  const T = window.Threes;
  const STORAGE_KEY = 'threes.v1';
  const SLIDE_MS = 110; // keep in sync with --dur in style.css
  const SWIPE_MIN_PX = 24;
  const KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
  };

  const $ = id => document.getElementById(id);
  const layer = $('tiles');
  const tileEls = new Map(); // tile id -> element

  // ---------- Persistence ----------

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.state && Array.isArray(saved.state.grid) && saved.state.next) return saved;
    } catch (e) { /* start fresh */ }
    return { state: T.createGame(), best: 0, bestTile: 0 };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* storage blocked */ }
  }

  let store = load();

  // ---------- Rendering ----------

  function paint(el, value) {
    const digits = String(value).length;
    el.className = `tile v${Math.min(value, 3)} d${digits}${value >= 192 ? ' hot' : ''}`;
    el.firstChild.textContent = value;
  }

  function place(el, r, c) {
    el.style.setProperty('--r', r);
    el.style.setProperty('--c', c);
  }

  function pop(el) {
    el.firstChild.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 160, easing: 'ease-out' },
    );
  }

  function renderBoard(result) {
    const { grid } = store.state;
    const live = new Set();

    grid.forEach((row, r) => row.forEach((tile, c) => {
      if (!tile) return;
      live.add(tile.id);
      let el = tileEls.get(tile.id);
      if (!el) {
        el = document.createElement('div');
        el.appendChild(document.createElement('div')).className = 'face';
        paint(el, tile.value);
        const s = result && result.spawned.id === tile.id ? result.spawned : null;
        // New tiles from a move start just off the board and slide in.
        place(el, s ? s.fromR : r, s ? s.fromC : c);
        layer.appendChild(el);
        tileEls.set(tile.id, el);
        el.getBoundingClientRect(); // commit the start position before moving
      }
      place(el, r, c);
      if (result && result.merged.includes(tile.id)) {
        // Show the new value once the merging tile has slid on top of this one.
        setTimeout(() => { paint(el, tile.value); pop(el); }, SLIDE_MS);
      } else {
        paint(el, tile.value);
      }
    }));

    // Merged-away tiles slide onto their partner, then disappear.
    for (const gone of result ? result.consumed : []) {
      const el = tileEls.get(gone.id);
      if (!el) continue;
      tileEls.delete(gone.id);
      el.classList.add('leaving');
      place(el, gone.r, gone.c);
      setTimeout(() => el.remove(), SLIDE_MS);
    }

    // Anything else left over (e.g. after a new game) is removed outright.
    for (const [id, el] of tileEls) {
      if (!live.has(id)) { el.remove(); tileEls.delete(id); }
    }
  }

  function renderHud() {
    const { state } = store;
    const score = T.score(state);
    $('score').textContent = score.toLocaleString();
    $('best').textContent = Math.max(store.best, score).toLocaleString();

    const next = $('next');
    next.className = 'next-card ' + (state.next.bonus ? 'bonus' : `v${state.next.value}`);
    // Like the original, the preview shows only the colour; bonus tiles show "+".
    next.textContent = state.next.bonus ? '+' : '';

    const overlay = $('overlay');
    overlay.hidden = !state.over;
    if (state.over) {
      $('final').textContent = score.toLocaleString();
      const top = T.maxTile(state);
      $('detail').textContent = `Highest tile ${top} · ${state.moves} moves` +
        (score >= store.best && score > 0 ? ' · New best!' : ` · Best ${store.best.toLocaleString()}`);
    }
  }

  function render(result) {
    renderBoard(result);
    renderHud();
  }

  // ---------- Actions ----------

  function doMove(dir) {
    const result = T.move(store.state, dir);
    if (!result) return;
    if (store.state.over) {
      store.best = Math.max(store.best, T.score(store.state));
      store.bestTile = Math.max(store.bestTile, T.maxTile(store.state));
    }
    save();
    render(result);
  }

  function newGame() {
    const { state } = store;
    if (!state.over && state.moves > 0 && !confirm('Start a new game? This one will be lost.')) return;
    store.state = T.createGame();
    save();
    render(null);
  }

  // ---------- Input ----------

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    doMove(dir);
  });

  // Dragging anywhere in the game area previews ("peeks" at) the move: the tiles that
  // would move follow the finger up to one cell. Releasing far enough, or with a quick
  // flick, makes the move; otherwise the tiles slide back.
  const PEEK_START_PX = 6;
  const COMMIT_FRACTION = 0.35;
  const FLICK_PX_PER_MS = 0.5;
  const game = $('game');
  const boardEl = $('board');
  let drag = null; // { id, x, y, t, dir, ids, frac }

  function setPeek(ids, dir, frac) {
    const { dr, dc } = T.DIRS[dir];
    for (const id of ids) {
      const el = tileEls.get(id);
      if (!el) continue;
      el.style.setProperty('--pr', dr * frac);
      el.style.setProperty('--pc', dc * frac);
    }
  }

  function clearPeek() {
    if (drag && drag.ids) setPeek(drag.ids, drag.dir, 0);
    boardEl.classList.remove('dragging');
  }

  game.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || store.state.over) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, dir: null, ids: null, frac: 0 };
    game.setPointerCapture(e.pointerId);
  });

  game.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < PEEK_START_PX) return;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const dir = horizontal ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (dir !== drag.dir) {
      clearPeek();
      drag.dir = dir;
      drag.ids = T.movingTiles(store.state, dir);
      boardEl.classList.add('dragging');
    }
    // One cell of travel = tile size + gap.
    const sample = layer.querySelector('.tile');
    const gap = parseFloat(getComputedStyle(boardEl).getPropertyValue('--gap')) || 0;
    const step = sample ? (horizontal ? sample.offsetWidth : sample.offsetHeight) + gap : 80;
    drag.frac = Math.min(1, Math.abs(horizontal ? dx : dy) / step);
    setPeek(drag.ids, dir, drag.frac);
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const { dir, ids, frac } = drag;
    const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    const speed = dist / Math.max(1, e.timeStamp - drag.t);
    clearPeek();
    drag = null;
    if (cancelled || !dir || !ids.length) return;
    // Clearing the peek and placing tiles in their new cells happen in the same frame,
    // so tiles animate on from wherever the finger left them.
    if (frac >= COMMIT_FRACTION || (speed >= FLICK_PX_PER_MS && dist >= SWIPE_MIN_PX)) doMove(dir);
  }
  game.addEventListener('pointerup', e => endDrag(e, false));
  game.addEventListener('pointercancel', e => endDrag(e, true));

  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="new"]')) newGame();
  });

  // ---------- Start ----------

  document.querySelector('.slots').innerHTML = '<div></div>'.repeat(T.SIZE * T.SIZE);
  save();
  render(null);
})();
