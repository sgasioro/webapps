// Round logic for the name ranker, kept free of DOM code so it can be tested in Node.
//
// A round only orders your top K names and finds the names to retire, rather than
// fully sorting the pool:
// - Names are paired for a first matchup. First-round losers are paired again, and
//   anyone who loses both matchups without winning one later is retired (up to a quarter
//   of the pool).
// - A knockout bracket over the pool finds #1. #1's slot is then emptied and the bracket
//   replayed; earlier results are reused, so only names that lost to #1 play again for #2.
//   Repeat until the top K are known.
// - Everyone else is "still in the running", unordered.
// - Picking "neither" puts both names out: they lose to everyone else without asking,
//   and are retired at the end (on top of the quarter-of-the-pool limit).
//
// A round in progress is just { pool, picks: [[winner, loser] or { neither: [a, b] }, ...] }.
// The next matchup is found by replaying the algorithm against the picks so far, so undo
// is dropping a pick.
(function (root) {
  'use strict';

  class NeedPick {
    constructor(a, b) { this.a = a; this.b = b; }
  }

  const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

  // Returns { done: false, a, b } for the next matchup, or
  // { done: true, top, middle, retired } once the round is decided.
  function step(pool, picks, k) {
    const rejected = new Set(picks.flatMap(p => p.neither || []));
    const pairs = picks.filter(p => !p.neither);
    const winners = new Map(pairs.map(([w, l]) => [pairKey(w, l), w]));
    const better = (a, b) => {
      // Rejected names lose without a matchup; between two, the first goes through.
      if (rejected.has(a) || rejected.has(b)) return rejected.has(a) && !rejected.has(b) ? b : a;
      const w = winners.get(pairKey(a, b));
      if (w === undefined) throw new NeedPick(a, b);
      return w;
    };
    const loser = (a, b) => (better(a, b) === a ? b : a);

    try {
      // First matchups, then first-round losers against each other.
      const firstLosers = [];
      for (let i = 0; i + 1 < pool.length; i += 2) firstLosers.push(loser(pool[i], pool[i + 1]));
      const retired = [];
      for (let i = 0; i + 1 < firstLosers.length; i += 2) retired.push(loser(firstLosers[i], firstLosers[i + 1]));

      // Knockout bracket with fixed slots; placed names leave an empty slot (a bye).
      const slots = pool.slice();
      const top = [];
      while (top.length < Math.min(k, pool.length - rejected.size)) {
        let round = slots;
        while (round.length > 1) {
          const next = [];
          for (let i = 0; i < round.length; i += 2) {
            const a = round[i], b = round[i + 1];
            next.push(a == null ? (b == null ? null : b) : b == null ? a : better(a, b));
          }
          round = next;
        }
        top.push(round[0]);
        slots[slots.indexOf(round[0])] = null;
      }

      // A name that lost twice but later won a bracket matchup (or made the top) is spared.
      const placed = new Set(top);
      const wonOnce = new Set(pairs.map(([w]) => w));
      const out = retired.filter(n => !placed.has(n) && !wonOnce.has(n) && !rejected.has(n))
        .concat(pool.filter(n => rejected.has(n)));
      const outSet = new Set(out);
      return { done: true, top, middle: pool.filter(n => !placed.has(n) && !outSet.has(n)), retired: out };
    } catch (e) {
      if (e instanceof NeedPick) return { done: false, a: e.a, b: e.b };
      throw e;
    }
  }

  // Upper bound on picks for a round: first matchups, the losers' matchups, the rest of
  // the bracket, then at most (depth - 1) new matchups per extra top place.
  function maxPicks(n, k) {
    if (n < 2) return 0;
    const first = Math.floor(n / 2);
    const depth = Math.ceil(Math.log2(n));
    return first + Math.floor(first / 2) + (n - 1 - first) + (Math.min(k, n) - 1) * Math.max(0, depth - 1);
  }

  const api = { step, maxPicks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NameRound = api;
})(this);
