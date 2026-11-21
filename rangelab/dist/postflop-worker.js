"use strict";
importScripts("./gpu.js", "./postflop-tree.js");

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const CARD = "([2-9TJQKA])([cdhs])";
const explicitCombo = new RegExp("^" + CARD + CARD + "$", "i");
const classToken = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i;
const edgeCap = 48000;

function cardId(rank, suit) {
  return RANKS.indexOf(rank.toUpperCase()) * 4 + SUITS.indexOf(suit.toLowerCase());
}
function cardName(id) { return RANKS[id >> 2] + SUITS[id & 3]; }

function parseBoard(text) {
  const compact = String(text).replace(/[\s,]+/g, "");
  if (!/^(?:[2-9TJQKA][cdhs]){3,5}$/i.test(compact)) throw Error("Enter 3, 4, or 5 cards, for example As 8d 4c.");
  const cards = compact.match(/../g).map(card => cardId(card[0], card[1]));
  if (new Set(cards).size !== cards.length) throw Error("Each board card must appear once.");
  return cards;
}

function parseRange(input, board, label) {
  const combos = new Map();
  const blocked = new Set(board);
  let weight = 1;
  function put(a, b) {
    if (a === b) throw Error(label + " contains a hand with two identical cards.");
    if (blocked.has(a) || blocked.has(b)) return;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    const key = hi * 52 + lo;
    if (!weight) combos.delete(key);
    else combos.set(key, { a: hi, b: lo, name: cardName(hi) + cardName(lo), weight });
  }
  function parseClass(raw) {
    const match = raw.match(classToken);
    if (!match) throw Error("Unrecognized range entry “" + raw + "”.");
    const hi = RANKS.indexOf(match[1].toUpperCase()), lo = RANKS.indexOf(match[2].toUpperCase());
    const suits = match[3].toLowerCase();
    if (lo > hi || (lo === hi && suits)) throw Error("Invalid hand class “" + raw + "”.");
    return { hi, lo, suits };
  }
  function addClass(hi, lo, suits) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (hi === lo && j >= i) continue;
      if (suits === "s" && i !== j || suits === "o" && i === j) continue;
      put(hi * 4 + i, lo * 4 + j);
    }
  }
  for (const entry of String(input).trim().split(/[,\s]+/).filter(Boolean)) {
    const [token, rawWeight, extra] = entry.split(":");
    weight = 1;
    if (rawWeight !== undefined) {
      if (extra !== undefined || !/^\d*\.?\d+%?$/.test(rawWeight)) throw Error("Use a weight such as AKs:50%.");
      weight = parseFloat(rawWeight) / (rawWeight.endsWith("%") ? 100 : 1);
      if (weight < 0 || weight > 1) throw Error("Range weights must be between 0% and 100%.");
    }
    if (/^(random|100%|\*)$/i.test(token)) {
      for (let a = 1; a < 52; a++) for (let b = 0; b < a; b++) put(a, b);
      continue;
    }
    const fixed = token.match(explicitCombo);
    if (fixed) { put(cardId(fixed[1], fixed[2]), cardId(fixed[3], fixed[4])); continue; }
    if (token.endsWith("+")) {
      const { hi, lo, suits } = parseClass(token.slice(0, -1));
      if (hi === lo) for (let k = hi; k < 13; k++) addClass(k, k, "");
      else for (let k = lo; k < hi; k++) addClass(hi, k, suits);
      continue;
    }
    const parts = token.split("-");
    const from = parseClass(parts[0]);
    if (parts.length === 1) { addClass(from.hi, from.lo, from.suits); continue; }
    if (parts.length !== 2) throw Error("Invalid interval “" + token + "”.");
    const to = parseClass(parts[1]);
    const dh = to.hi - from.hi, dl = to.lo - from.lo;
    if (from.suits !== to.suits || (dh && dl && dh !== dl) || (from.hi === from.lo) !== (to.hi === to.lo)) {
      throw Error("Use aligned intervals, for example 22-66, A2s-A5s, or 76s-T9s.");
    }
    for (let n = 0; n <= Math.max(Math.abs(dh), Math.abs(dl)); n++) {
      addClass(from.hi + n * Math.sign(dh), from.lo + n * Math.sign(dl), from.suits);
    }
  }
  if (!combos.size) throw Error(label + " has no available combinations on this board.");
  return [...combos.values()];
}

function legalDeals(oop, ip, limit = edgeCap) {
  const capacity = Math.min(oop.length * ip.length, limit);
  const oi = new Uint16Array(capacity), ij = new Uint16Array(capacity);
  let total = 0, state = 82131673;
  for (let i = 0; i < oop.length; i++) {
    const a = oop[i];
    for (let j = 0; j < ip.length; j++) {
      const b = ip[j];
      if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      let slot = total++;
      if (slot >= capacity) {
        // Uniformly sample legal private deals when the full range product is large.
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        slot = Math.floor((state >>> 0) / 4294967296 * total);
        if (slot >= capacity) continue;
      }
      oi[slot] = i; ij[slot] = j;
    }
  }
  if (!total) throw Error("The two ranges have no legal matchups on this board.");
  const n = Math.min(total, capacity);
  const cards = new Uint32Array(n * 4), weight = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = oop[oi[k]], b = ip[ij[k]];
    cards.set([a.a, a.b, b.a, b.b], k * 4);
    weight[k] = a.weight * b.weight;
  }
  return { n, total, oi, ij, weight, cards };
}

function makeNode(range) {
  const zeros = () => new Float64Array(range.length);
  return {
    range, strategy: zeros().fill(0.5), advantage: zeros(),
    actionRegret: zeros(), passRegret: zeros(), sum: zeros(), sumWeight: zeros(),
    valueA: zeros(), valueB: zeros(), reach: zeros()
  };
}

function solveTree(oop, ip, deals, equity, pot, bet, iterations, lock) {
  const nodes = [makeNode(oop), makeNode(ip), makeNode(ip), makeNode(oop)];
  const [open, stab, defendIP, defendOOP] = nodes;
  if (lock !== null) defendIP.strategy.fill(lock);
  const { n, oi, ij, weight } = deals;
  const half = pot / 2;
  const checked = Float64Array.from(equity, q => (q - 0.5) * pot);
  const called = Float64Array.from(equity, q => (q - 0.5) * (pot + 2 * bet));
  for (let iter = 1; iter <= iterations; iter++) {
    for (const node of nodes) node.advantage.fill(0);
    for (let k = 0; k < n; k++) {
      const i = oi[k], j = ij[k], w = weight[k];
      const lead = open.strategy[i], probe = stab.strategy[j];
      const ipCall = defendIP.strategy[j], oopCall = defendOOP.strategy[i];
      const call = called[k], check = checked[k];
      const oopLeadEV = ipCall * call + (1 - ipCall) * half;
      const oopFaceBetEV = oopCall * call - (1 - oopCall) * half;
      const oopCheckEV = probe * oopFaceBetEV + (1 - probe) * check;
      open.advantage[i] += w * (oopLeadEV - oopCheckEV);
      // Counterfactual reach excludes all of this player's earlier actions.
      stab.advantage[j] += w * (1 - lead) * (check - oopFaceBetEV);
      defendIP.advantage[j] += w * lead * (half - call);
      defendOOP.advantage[i] += w * probe * (call + half);
    }
    // Accumulate pre-update realization weights (OOP can only defend after checking).
    for (const node of nodes) for (let h = 0; h < node.range.length; h++) {
      const reach = node === defendOOP ? 1 - open.strategy[h] : 1;
      node.sum[h] += iter * reach * node.strategy[h];
      node.sumWeight[h] += iter * reach;
    }
    for (const node of nodes) {
      if (node === defendIP && lock !== null) continue;
      for (let h = 0; h < node.range.length; h++) {
        const p = node.strategy[h], d = node.advantage[h];
        const a = Math.max(0, node.actionRegret[h] + (1 - p) * d);
        const b = Math.max(0, node.passRegret[h] - p * d);
        node.actionRegret[h] = a; node.passRegret[h] = b;
        node.strategy[h] = a + b ? a / (a + b) : 0.5;
      }
    }
  }
  for (const node of nodes) for (let h = 0; h < node.range.length; h++) {
    if (node.sumWeight[h]) node.strategy[h] = node.sum[h] / node.sumWeight[h];
  }

  function accumulate(node, hand, reach, a, b) {
    node.reach[hand] += reach;
    node.valueA[hand] += reach * a;
    node.valueB[hand] += reach * b;
  }
  const defenseDelta = new Float64Array(oop.length);
  let totalWeight = 0;
  for (let k = 0; k < n; k++) {
    const i = oi[k], j = ij[k], w = weight[k], lead = open.strategy[i], probe = stab.strategy[j];
    const oopCall = defendOOP.strategy[i], ipCall = defendIP.strategy[j], call = called[k], check = checked[k];
    const leadEV = ipCall * call + (1 - ipCall) * half;
    const faceBetEV = oopCall * call - (1 - oopCall) * half;
    const checkEV = probe * faceBetEV + (1 - probe) * check;
    // Shift centered payoffs to incremental chips from each decision (fold EV = 0).
    accumulate(open, i, w, half + leadEV, half + checkEV);
    accumulate(stab, j, w * (1 - lead), half - faceBetEV, half - check);
    accumulate(defendIP, j, w * lead, half - call, 0);
    accumulate(defendOOP, i, w * (1 - lead) * probe, half + call, 0);
    defenseDelta[i] += w * probe * (half + call);
    totalWeight += w;
  }
  // OOP's best check line accounts for its own subsequent best response.
  const bestCheck = new Float64Array(oop.length);
  for (let k = 0; k < n; k++) {
    const i = oi[k], j = ij[k], probe = stab.strategy[j];
    bestCheck[i] += weight[k] * (half + probe * (defenseDelta[i] > 0 ? called[k] : -half) + (1 - probe) * checked[k]);
  }
  let optimalOOP = 0, optimalIP = 0;
  for (let i = 0; i < oop.length; i++) optimalOOP += Math.max(open.valueA[i], bestCheck[i]);
  for (let j = 0; j < ip.length; j++) {
    optimalIP += Math.max(stab.valueA[j], stab.valueB[j]);
    optimalIP += lock === null ? Math.max(0, defendIP.valueA[j]) : lock * defendIP.valueA[j];
  }
  const gap = Math.max(0, (optimalOOP + optimalIP) / totalWeight - pot);
  const details = nodes.map(node => {
    const rows = [];
    let reachSum = 0, actionSum = 0, valueSum = 0;
    for (let h = 0; h < node.range.length; h++) {
      const reach = node.reach[h];
      if (!reach) continue;
      const p = node.strategy[h], evA = node.valueA[h] / reach, evB = node.valueB[h] / reach;
      rows.push({ hand: node.range[h].name, weight: node.range[h].weight, frequency: p, evA, evB, reach: reach / totalWeight });
      actionSum += reach * p; valueSum += reach * (p * evA + (1 - p) * evB); reachSum += reach;
    }
    rows.sort((a, b) => b.frequency - a.frequency || b.evA - a.evA);
    return { rows, frequency: reachSum ? actionSum / reachSum : 0, ev: reachSum ? valueSum / reachSum : 0, reach: reachSum / totalWeight };
  });
  return { nodes: details, gap };
}

async function solve(config) {
  const board = parseBoard(config.board);
  const oop = parseRange(config.oop, board, "The out-of-position range");
  const ip = parseRange(config.ip, board, "The in-position range");
  const pot = Number(config.pot), size = Number(config.size);
  const lock = config.lock === null || config.lock === "" || config.lock === undefined ? null : Number(config.lock) / 100;
  if (!Number.isFinite(pot) || pot <= 0 || pot > 100000) throw Error("Choose a pot between 0 and 100,000 bb.");
  if (!Number.isFinite(size) || size <= 0 || size > 1000) throw Error("Choose a bet size between 0% and 1,000% of pot.");
  if (lock !== null && (!Number.isFinite(lock) || lock < 0 || lock > 1)) throw Error("A locked call frequency must be between 0% and 100%.");
  const quality = { fast: [100, 16], standard: [300, 48], deep: [800, 128] }[config.quality] || [300, 48];
  const advanced = config.tree === "advanced";
  const hasStack = config.stack !== undefined && config.stack !== null && config.stack !== "";
  const stack = hasStack ? Number(config.stack) : null, secondSize = Number(config.secondSize), raiseFactor = Number(config.raiseFactor);
  if ((hasStack || advanced) && (!Number.isFinite(stack) || stack < 0.01 || stack > 100000)) throw Error("Choose a stack between 0.01 and 100,000 bb.");
  if (advanced && (!Number.isFinite(secondSize) || secondSize <= 0 || secondSize > 1000)) throw Error("Choose a second bet size between 0% and 1,000% of pot.");
  if (advanced && (!Number.isFinite(raiseFactor) || raiseFactor < 2 || raiseFactor > 10)) throw Error("Choose a raise multiplier between 2 and 10.");
  const deals = legalDeals(oop, ip, advanced ? 16000 : edgeCap);
  self.postMessage({ progress: "Evaluating " + deals.n.toLocaleString() + " legal matchups…" });
  const { equities, backend, runs } = await RangeGPU.matchupEquities(deals.cards, board, quality[1]);
  self.postMessage({ progress: "Computing " + quality[0] + " strategy iterations…" });
  const bet = Math.min(pot * size / 100, stack ?? Infinity);
  const result = advanced
    ? solveAdvancedTree([oop, ip], deals, equities, { pot, stack, sizes: [size, secondSize], raiseFactor, iterations: quality[0], lock })
    : solveTree(oop, ip, deals, equities, pot, bet, quality[0], lock);
  return { ...result, board: board.map(cardName), backend, runs, matches: deals.n, legal: deals.total, iterations: quality[0], pot, stack, bet: advanced ? result.betSizes[0] : bet, lock };
}

self.onmessage = async event => {
  try { self.postMessage({ result: await solve(event.data) }); }
  catch (error) { self.postMessage({ error: error.message || "This spot could not be solved." }); }
};
