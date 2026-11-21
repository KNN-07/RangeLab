"use strict";

// A public, finite betting tree. Private hands retain their individual strategy
// at every reached information set. Leaf payoffs are affine in showdown equity.
function solveAdvancedTree(ranges, deals, equities, settings) {
  const { pot, stack, sizes, raiseFactor, iterations, lock } = settings;
  const half = pot / 2, nodes = [];
  const amt = n => Number(n.toFixed(2));
  const betSizes = [...new Set(sizes.map(p => Math.min(stack, amt(pot * p / 100))).filter(v => v > 0))].sort((a, b) => a - b);
  if (!betSizes.length) throw Error("Bet sizes must be at least 0.01 bb after rounding.");
  function node(player, label, paid, parent = -1, branch = -1) {
    const id = nodes.length;
    nodes.push({ player, label, paid, parent, branch, contributions: [0, 0], actions: [], locked: false });
    return id;
  }
  const leaf = (label, constant, coefficient = 0) => ({ label, child: -1, constant, coefficient });
  const showdown = (label, paid) => leaf(label, -half - paid, pot + 2 * paid);
  const fold = (actor, paid) => leaf("Fold", actor === 0 ? -half - paid : half + paid);
  const child = (label, id) => ({ label, child: id });
  const actorName = p => p === 0 ? "OOP" : "IP";
  function facingBet(bettor, amount, prefix, parent, branch) {
    const actor = 1 - bettor;
    const id = node(actor, prefix + " · " + actorName(actor) + " faces " + amt(amount) + " bb", 0, parent, branch);
    const n = nodes[id];
    n.contributions[bettor] = amount;
    n.actions.push(fold(actor, 0), showdown("Call", amount));
    const raise = Math.min(stack, amt(amount * raiseFactor));
    if (raise > amount) {
      const reply = node(bettor, prefix + " · " + actorName(bettor) + " faces raise to " + raise + " bb (" + amt(amount) + " bb bet)", amount, id, 2);
      nodes[reply].contributions[bettor] = amount;
      nodes[reply].contributions[actor] = raise;
      nodes[reply].actions.push(fold(bettor, amount), showdown("Call", raise));
      n.actions.push(child("Raise to " + raise + " bb", reply));
    }
    n.locked = bettor === 0 && lock !== null;
    return id;
  }
  const root = node(0, "OOP · First to act", 0);
  const ipFirst = node(1, "IP · Facing a check", 0, root, 0);
  nodes[root].actions.push(child("Check", ipFirst));
  nodes[ipFirst].actions.push(showdown("Check", 0));
  for (const b of betSizes) {
    const k = nodes[ipFirst].actions.length;
    nodes[ipFirst].actions.push(child("Bet " + b + " bb", facingBet(1, b, "After check", ipFirst, k)));
  }
  for (const b of betSizes) {
    const k = nodes[root].actions.length;
    nodes[root].actions.push(child("Bet " + b + " bb", facingBet(0, b, "Opening bet", root, k)));
  }
  for (const n of nodes) {
    n.count = n.actions.length;
    n.numHands = ranges[n.player].length;
    const length = n.count * n.numHands;
    n.strategy = new Float64Array(length).fill(1 / n.count);
    n.regret = new Float64Array(length);
    n.delta = new Float64Array(length);
    n.sum = new Float64Array(length);
    n.avgWeight = new Float64Array(n.numHands);
    n.reach = [new Float64Array(ranges[0].length), new Float64Array(ranges[1].length)];
    if (n.locked) for (let h = 0; h < n.numHands; h++) {
      const start = h * n.count;
      n.strategy[start] = 1 - lock;
      n.strategy[start + 1] = lock;
      if (n.count === 3) n.strategy[start + 2] = 0;
    }
  }
  function updateReach() {
    for (const n of nodes) {
      if (n.parent === -1) { n.reach[0].fill(1); n.reach[1].fill(1); continue; }
      const p = nodes[n.parent];
      n.reach[1 - p.player].set(p.reach[1 - p.player]);
      for (let h = 0; h < p.numHands; h++) {
        n.reach[p.player][h] = p.reach[p.player][h] * p.strategy[h * p.count + n.branch];
      }
    }
  }
  const { n: edgeCount, oi, ij, weight } = deals;
  const values = new Float64Array(nodes.length);
  const actionValues = new Float64Array(4);
  function evaluate(collectOutput) {
    for (let edge = 0; edge < edgeCount; edge++) {
      const i = oi[edge], j = ij[edge], eq = equities[edge], w = weight[edge];
      for (let v = nodes.length - 1; v >= 0; v--) {
        const n = nodes[v], p = n.player, hand = p ? j : i, opponent = p ? i : j;
        const start = hand * n.count, sign = 1 - 2 * p;
        let value = 0;
        for (let a = 0; a < n.count; a++) {
          const action = n.actions[a];
          const payoff = action.child >= 0 ? values[action.child] : action.constant + eq * action.coefficient;
          actionValues[a] = payoff;
          value += n.strategy[start + a] * payoff;
        }
        values[v] = value;
        const counterReach = w * n.reach[1 - p][opponent];
        if (collectOutput) {
          const reach = counterReach * n.reach[p][hand];
          n.avgWeight[hand] += reach;
          for (let a = 0; a < n.count; a++) n.delta[start + a] += reach * (sign * actionValues[a] + half + n.paid);
        } else if (!n.locked) {
          for (let a = 0; a < n.count; a++) n.delta[start + a] += counterReach * sign * (actionValues[a] - value);
        }
      }
    }
  }
  for (let t = 1; t <= iterations; t++) {
    updateReach();
    for (const n of nodes) n.delta.fill(0);
    evaluate(false);
    for (const n of nodes) for (let h = 0; h < n.numHands; h++) {
      const start = h * n.count, rw = t * n.reach[n.player][h];
      n.avgWeight[h] += rw;
      let total = 0;
      for (let a = 0; a < n.count; a++) {
        const k = start + a;
        n.sum[k] += rw * n.strategy[k];
        total += n.regret[k] = Math.max(0, n.regret[k] + n.delta[k]);
      }
      if (!n.locked) for (let a = 0; a < n.count; a++) {
        n.strategy[start + a] = total ? n.regret[start + a] / total : 1 / n.count;
      }
    }
  }
  for (const n of nodes) {
    for (let h = 0; h < n.numHands; h++) if (n.avgWeight[h]) for (let a = 0; a < n.count; a++) {
      const k = h * n.count + a;
      n.strategy[k] = n.sum[k] / n.avgWeight[h];
    }
    n.avgWeight.fill(0); n.delta.fill(0);
  }
  updateReach();
  evaluate(true);
  const totalWeight = weight.reduce((a, b) => a + b, 0);
  function bestResponse(player) {
    const best = nodes.map(() => new Float64Array(edgeCount));
    const sign = 1 - 2 * player;
    for (let v = nodes.length - 1; v >= 0; v--) {
      const n = nodes[v], optimize = n.player === player && !n.locked;
      const advantages = new Float64Array(n.strategy.length), pick = new Uint8Array(n.numHands);
      if (optimize) {
        for (let e = 0; e < edgeCount; e++) {
          const hand = player ? ij[e] : oi[e], opp = player ? oi[e] : ij[e];
          const rw = weight[e] * n.reach[1 - player][opp];
          const start = hand * n.count;
          for (let a = 0; a < n.count; a++) {
            const act = n.actions[a], val = act.child >= 0 ? best[act.child][e] : act.constant + equities[e] * act.coefficient;
            advantages[start + a] += rw * sign * val;
          }
        }
        for (let h = 0; h < n.numHands; h++) for (let a = 1; a < n.count; a++) {
          if (advantages[h * n.count + a] > advantages[h * n.count + pick[h]]) pick[h] = a;
        }
      }
      for (let e = 0; e < edgeCount; e++) {
        const hand = n.player ? ij[e] : oi[e], start = hand * n.count;
        for (let a = 0; a < n.count; a++) {
          if (optimize && a !== pick[hand]) continue;
          const act = n.actions[a], val = act.child >= 0 ? best[act.child][e] : act.constant + equities[e] * act.coefficient;
          best[v][e] += optimize ? val : n.strategy[start + a] * val;
        }
      }
    }
    return best[0].reduce((sum, val, k) => sum + weight[k] * sign * val, 0) / totalWeight;
  }
  const gap = Math.max(0, bestResponse(0) + bestResponse(1));
  const treeNodes = nodes.map(n => {
    const frequencies = Array(n.count).fill(0), rows = [];
    let total = 0, ev = 0;
    for (let h = 0; h < n.numHands; h++) {
      const reach = n.avgWeight[h], start = h * n.count;
      if (!reach) continue;
      const hand = ranges[n.player][h], freq = [], evs = [];
      for (let a = 0; a < n.count; a++) {
        freq.push(n.strategy[start + a]); evs.push(n.delta[start + a] / reach);
        frequencies[a] += reach * freq[a]; ev += reach * freq[a] * evs[a];
      }
      rows.push({ hand: hand.name, weight: hand.weight, reach: reach / totalWeight, frequencies: freq, evs });
      total += reach;
    }
    const children = n.actions.map(a => {
      if (a.child >= 0) return { node: a.child };
      if (a.label === "Fold") return { terminal: "fold", contributions: n.contributions.slice() };
      const matched = (a.coefficient - pot) / 2;
      return { terminal: "showdown", contributions: [matched, matched] };
    });
    return { label: n.label, player: n.player, contributions: n.contributions, children, actions: n.actions.map(a => a.label), frequencies: frequencies.map(f => total ? f / total : 0),
      ev: total ? ev / total : 0, reach: total / totalWeight, rows };
  });
  return { treeNodes, gap, stack, sizes, betSizes, raiseFactor };
}
