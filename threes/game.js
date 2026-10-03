// Threes game logic, kept free of DOM code so it can be tested in Node.
//
// Rules:
// - 4x4 board. 1 + 2 merge into 3; equal tiles of 3 or more merge into their sum.
// - A swipe moves each row (or column) at most one cell. In each line, the first tile
//   that can move (into an empty cell or a merge) moves, and every tile behind it follows.
// - After a move, the "next" tile enters on the edge you swiped away from, in a random
//   line that moved.
// - Next tiles come from a shuffled deck of four 1s, four 2s and four 3s. Once the
//   highest tile is 48+, there's a 1 in 21 chance of a bonus tile (6 up to highest / 8).
// - The game ends when no swipe moves anything. Each tile of 3 or more scores
//   3^(log2(value / 3) + 1); 1s and 2s score nothing.
(function (root) {
  'use strict';

  const SIZE = 4;
  const START_TILES = 9;
  const BONUS_CHANCE = 1 / 21;
  const BONUS_MIN_MAX_TILE = 48;
  const DIRS = {
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
  };

  function canMerge(a, b) {
    return a + b === 3 || (a === b && a >= 3);
  }

  function tileScore(value) {
    return value >= 3 ? Math.pow(3, Math.log2(value / 3) + 1) : 0;
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Cells of line `i` for a direction, ordered from the leading edge (where tiles move
  // toward) to the trailing edge (where new tiles enter).
  function lineCells(dir, i) {
    const cells = [];
    for (let k = 0; k < SIZE; k++) {
      if (dir === 'left') cells.push([i, k]);
      else if (dir === 'right') cells.push([i, SIZE - 1 - k]);
      else if (dir === 'up') cells.push([k, i]);
      else cells.push([SIZE - 1 - k, i]);
    }
    return cells;
  }

  function createGame(rand = Math.random) {
    const state = {
      grid: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
      deck: [],
      next: null, // { value, bonus }
      nextId: 1,
      moves: 0,
      over: false,
    };
    const empty = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) empty.push([r, c]);
    shuffle(empty, rand);
    for (let i = 0; i < START_TILES; i++) {
      const [r, c] = empty[i];
      state.grid[r][c] = { id: state.nextId++, value: drawFromDeck(state, rand) };
    }
    state.next = drawNext(state, rand);
    return state;
  }

  function drawFromDeck(state, rand) {
    if (!state.deck.length) state.deck = shuffle([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3], rand);
    return state.deck.pop();
  }

  function maxTile(state) {
    let max = 0;
    for (const row of state.grid) for (const t of row) if (t && t.value > max) max = t.value;
    return max;
  }

  function drawNext(state, rand) {
    const max = maxTile(state);
    if (max >= BONUS_MIN_MAX_TILE && rand() < BONUS_CHANCE) {
      const options = [];
      for (let v = 6; v <= max / 8; v *= 2) options.push(v);
      return { value: options[Math.floor(rand() * options.length)], bonus: true };
    }
    return { value: drawFromDeck(state, rand), bonus: false };
  }

  // Slide one line toward index 0. Returns null if nothing moves, otherwise the new
  // line plus any tile that was merged away (with the index it merged into).
  function slideLine(line) {
    for (let i = 1; i < SIZE; i++) {
      const tile = line[i];
      if (!tile) continue;
      const ahead = line[i - 1];
      if (ahead && !canMerge(ahead.value, tile.value)) continue;
      const out = line.slice();
      let consumed = null;
      if (ahead) {
        out[i - 1] = { id: ahead.id, value: ahead.value + tile.value };
        consumed = { tile, into: i - 1 };
      } else {
        out[i - 1] = tile;
      }
      for (let k = i; k < SIZE - 1; k++) out[k] = line[k + 1];
      out[SIZE - 1] = null;
      return { line: out, consumed };
    }
    return null;
  }

  function canMove(state, dir) {
    for (let i = 0; i < SIZE; i++) {
      if (slideLine(lineCells(dir, i).map(([r, c]) => state.grid[r][c]))) return true;
    }
    return false;
  }

  function isOver(state) {
    return !Object.keys(DIRS).some(d => canMove(state, d));
  }

  // Apply a swipe. Returns null if nothing moved; otherwise details for animation:
  // merged-away tiles (and where they went), merged tile ids, and the spawned tile.
  function move(state, dir, rand = Math.random) {
    if (state.over) return null;
    const moved = [];
    const consumed = [];
    const merged = [];
    for (let i = 0; i < SIZE; i++) {
      const cells = lineCells(dir, i);
      const result = slideLine(cells.map(([r, c]) => state.grid[r][c]));
      if (!result) continue;
      cells.forEach(([r, c], k) => { state.grid[r][c] = result.line[k]; });
      if (result.consumed) {
        const [r, c] = cells[result.consumed.into];
        consumed.push({ id: result.consumed.tile.id, r, c });
        merged.push(state.grid[r][c].id);
      }
      moved.push(i);
    }
    if (!moved.length) return null;

    const line = moved[Math.floor(rand() * moved.length)];
    const [r, c] = lineCells(dir, line)[SIZE - 1];
    const tile = { id: state.nextId++, value: state.next.value };
    state.grid[r][c] = tile;
    state.next = drawNext(state, rand);
    state.moves++;
    state.over = isOver(state);
    const { dr, dc } = DIRS[dir];
    return { consumed, merged, spawned: { id: tile.id, r, c, fromR: r - dr, fromC: c - dc } };
  }

  // Ids of tiles that a swipe would move, without changing the state (for drag previews).
  function movingTiles(state, dir) {
    const ids = [];
    for (let i = 0; i < SIZE; i++) {
      const line = lineCells(dir, i).map(([r, c]) => state.grid[r][c]);
      const result = slideLine(line);
      if (!result) continue;
      line.forEach((tile, k) => {
        if (tile && k > 0 && result.line[k - 1] !== null && result.line[k - 1].id === tile.id) ids.push(tile.id);
      });
      if (result.consumed) ids.push(result.consumed.tile.id);
    }
    return ids;
  }

  function score(state) {
    let total = 0;
    for (const row of state.grid) for (const t of row) if (t) total += tileScore(t.value);
    return total;
  }

  const api = { SIZE, DIRS, createGame, move, movingTiles, canMove, isOver, score, tileScore, maxTile, slideLine, canMerge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Threes = api;
})(this);
