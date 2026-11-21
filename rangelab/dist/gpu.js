/* Heads-up showdown equity. A trial deals a random opponent and shared board.
   Fixed representative suits are equivalent under a uniformly random deal. */
(() => {
  "use strict";

  const ranks = "23456789TJQKA";
  const maxSamples = 1000000;
  const workgroupSize = 64;
  const sampleSeed = 0x92ed14a7;
  const now = () => globalThis.performance.now();
  let runtimePromise;

  function holeCards(name) {
    if (typeof name !== "string" || !/^[2-9TJQKA]{2}[so]?$/.test(name)) {
      throw new RangeError("Select a starting hand such as AA, AKs, or AKo.");
    }
    const high = ranks.indexOf(name[0]);
    const low = ranks.indexOf(name[1]);
    if (high < low || (high === low) !== (name.length === 2)) {
      throw new RangeError("Invalid starting hand class.");
    }
    return [high * 4, low * 4 + (name[2] === "s" ? 0 : 1)];
  }

  // One mask per multiplicity and suit: [any, pairs, trips, quads, s0..s3].
  function addCard(holding, card) {
    const bit = 1 << (card >>> 2);
    holding[3] |= holding[2] & bit;
    holding[2] |= holding[1] & bit;
    holding[1] |= holding[0] & bit;
    holding[0] |= bit;
    holding[4 + (card & 3)] |= bit;
  }

  const highest = mask => 31 - Math.clz32(mask);

  function topFive(mask) {
    let count = 0;
    let scan = mask;
    while (scan) {
      scan &= scan - 1;
      count++;
    }
    while (count-- > 5) mask &= mask - 1;
    return mask;
  }

  function straightHigh(mask) {
    const runs = mask & (mask << 1) & (mask << 2) & (mask << 3) & (mask << 4);
    if (runs) return highest(runs);
    return (mask & 0x100f) === 0x100f ? 3 : 0;
  }

  // Integer comparison orders category, paying ranks, and all five kickers.
  const category = 0x10000000;
  const majorRank = 0x100000;
  const minorRank = 0x10000;

  function score(holding) {
    const [all, pairs, trips, quads] = holding;
    let flush = 0;
    for (let suit = 4; suit < 8; suit++) {
      const mask = holding[suit];
      // Four lowest-bit removals leave a nonzero mask iff there are >=5 cards.
      let tail = mask & (mask - 1);
      tail &= tail - 1;
      tail &= tail - 1;
      tail &= tail - 1;
      if (tail) flush = mask;
    }
    if (flush) {
      const high = straightHigh(flush);
      if (high) return 8 * category + high;
    }
    if (quads) return 7 * category + highest(quads) * majorRank + highest(all ^ quads);
    if (trips) {
      const high = highest(trips);
      const rest = pairs ^ (1 << high);
      if (rest) return 6 * category + high * majorRank + highest(rest);
    }
    if (flush) return 5 * category + topFive(flush);
    const straight = straightHigh(all);
    if (straight) return 4 * category + straight;
    if (trips) {
      const kickers = all ^ trips;
      const first = highest(kickers);
      return 3 * category + highest(trips) * majorRank + first * minorRank + highest(kickers ^ (1 << first));
    }
    if (pairs) {
      const first = highest(pairs);
      const otherPairs = pairs ^ (1 << first);
      if (otherPairs) {
        const second = highest(otherPairs);
        return 2 * category + first * majorRank + second * minorRank + highest(all ^ (1 << first) ^ (1 << second));
      }
      let kickers = all ^ pairs;
      // A lone pair in seven cards has exactly five distinct kickers.
      kickers &= kickers - 1;
      kickers &= kickers - 1;
      return category + first * majorRank + kickers;
    }
    return topFive(all);
  }

  // PCG RXS-M-XS integer permutation, matching the shader's u32 arithmetic.
  function permute(input) {
    const state = (Math.imul(input, 747796405) + 2891336453) >>> 0;
    const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737);
    return ((word >>> 22) ^ word) >>> 0;
  }

  async function simulateCPU(hero, samples) {
    const counts = [0, 0, 0];
    const board = new Uint32Array(8);
    const player = new Uint32Array(8);
    const opponent = new Uint32Array(2);
    const initialLow = hero.reduce((bits, card) => card < 32 ? bits | (1 << card) : bits, 0);
    const initialHigh = hero.reduce((bits, card) => card >= 32 ? bits | (1 << (card - 32)) : bits, 0);
    let sliceStart = now();
    for (let trial = 0; trial < samples; trial++) {
      let seed = (Math.imul(trial, 2654435761) + sampleSeed) >>> 0;
      let seenLow = initialLow;
      let seenHigh = initialHigh;
      board.fill(0);
      for (let index = 0; index < 7;) {
        const roll = permute(seed++);
        // 2^32 mod 52 = 48. Reject that prefix to avoid modulo bias.
        if (roll < 48) continue;
        const card = roll % 52;
        const bit = 1 << (card & 31);
        if (card < 32) {
          if (seenLow & bit) continue;
          seenLow |= bit;
        } else {
          if (seenHigh & bit) continue;
          seenHigh |= bit;
        }
        if (index < 2) opponent[index] = card;
        else addCard(board, card);
        index++;
      }
      player.set(board);
      addCard(player, hero[0]);
      addCard(player, hero[1]);
      addCard(board, opponent[0]);
      addCard(board, opponent[1]);
      const playerScore = score(player);
      const opponentScore = score(board);
      counts[playerScore > opponentScore ? 0 : playerScore === opponentScore ? 1 : 2]++;
      if ((trial & 255) === 255 && now() - sliceStart >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0));
        sliceStart = now();
      }
    }
    return counts;
  }

  const shader = /* wgsl */ `
struct Parameters { heroA: u32, heroB: u32, samples: u32, seed: u32 }
struct Holding { ranks: u32, pairs: u32, trips: u32, quads: u32, suits: array<u32, 4> }
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage, read_write> totals: array<atomic<u32>, 3>;
var<workgroup> localTotals: array<atomic<u32>, 3>;

fn addCard(holding: ptr<function, Holding>, card: u32) {
  let bit = 1u << (card >> 2u);
  (*holding).quads |= (*holding).trips & bit;
  (*holding).trips |= (*holding).pairs & bit;
  (*holding).pairs |= (*holding).ranks & bit;
  (*holding).ranks |= bit;
  (*holding).suits[card & 3u] |= bit;
}

fn highest(mask: u32) -> u32 { return 31u - countLeadingZeros(mask); }
fn topFive(mask: u32) -> u32 {
  var bits = mask;
  while (countOneBits(bits) > 5u) { bits &= bits - 1u; }
  return bits;
}
fn straightHigh(mask: u32) -> u32 {
  let runs = mask & (mask << 1u) & (mask << 2u) & (mask << 3u) & (mask << 4u);
  if (runs != 0u) { return highest(runs); }
  return select(0u, 3u, (mask & 0x100fu) == 0x100fu);
}
fn score(h: Holding) -> u32 {
  let cat = 0x10000000u;
  let major = 0x100000u;
  let minor = 0x10000u;
  var flush = 0u;
  for (var i = 0u; i < 4u; i++) {
    if (countOneBits(h.suits[i]) >= 5u) { flush = h.suits[i]; }
  }
  if (flush != 0u) {
    let sf = straightHigh(flush);
    if (sf != 0u) { return 8u * cat + sf; }
  }
  if (h.quads != 0u) { return 7u * cat + highest(h.quads) * major + highest(h.ranks ^ h.quads); }
  if (h.trips != 0u) {
    let top = highest(h.trips);
    let rest = h.pairs ^ (1u << top);
    if (rest != 0u) { return 6u * cat + top * major + highest(rest); }
  }
  if (flush != 0u) { return 5u * cat + topFive(flush); }
  let straight = straightHigh(h.ranks);
  if (straight != 0u) { return 4u * cat + straight; }
  if (h.trips != 0u) {
    let kickers = h.ranks ^ h.trips;
    let first = highest(kickers);
    return 3u * cat + highest(h.trips) * major + first * minor + highest(kickers ^ (1u << first));
  }
  if (h.pairs != 0u) {
    let first = highest(h.pairs);
    let other = h.pairs ^ (1u << first);
    if (other != 0u) {
      let second = highest(other);
      return 2u * cat + first * major + second * minor + highest(h.ranks ^ (1u << first) ^ (1u << second));
    }
    var kickers = h.ranks ^ h.pairs;
    kickers &= kickers - 1u;
    kickers &= kickers - 1u;
    return cat + first * major + kickers;
  }
  return topFive(h.ranks);
}
fn permute(input: u32) -> u32 {
  let state = input * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn trial(index: u32) -> u32 {
  var seed = index * 2654435761u + params.seed;
  var seen: array<u32, 2>;
  seen[params.heroA >> 5u] |= 1u << (params.heroA & 31u);
  seen[params.heroB >> 5u] |= 1u << (params.heroB & 31u);
  var opponent: array<u32, 2>;
  var board: Holding;
  var i = 0u;
  while (i < 7u) {
    let roll = permute(seed);
    seed++;
    if (roll < 48u) { continue; }
    let card = roll % 52u;
    let piece = card >> 5u;
    let bit = 1u << (card & 31u);
    if ((seen[piece] & bit) != 0u) { continue; }
    seen[piece] |= bit;
    if (i < 2u) { opponent[i] = card; } else { addCard(&board, card); }
    i++;
  }
  var player = board;
  addCard(&player, params.heroA);
  addCard(&player, params.heroB);
  addCard(&board, opponent[0]);
  addCard(&board, opponent[1]);
  let a = score(player);
  let b = score(board);
  return select(select(2u, 1u, a == b), 0u, a > b);
}
@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  if (lane < 3u) { atomicStore(&localTotals[lane], 0u); }
  workgroupBarrier();
  if (id.x < params.samples) { atomicAdd(&localTotals[trial(id.x)], 1u); }
  workgroupBarrier();
  if (lane < 3u) { atomicAdd(&totals[lane], atomicLoad(&localTotals[lane])); }
}`;

  function cpu(reason) {
    return { available: false, backend: "CPU", reason };
  }

  async function openRuntime() {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) return cpu("This browser has no WebGPU interface.");
    let device;
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return cpu("No WebGPU adapter is available.");
      device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: shader, label: "Hold’em showdown evaluator" });
      const pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "simulate" }
      });
      const runtime = { available: true, backend: "WebGPU", reason: "", device, pipeline };
      device.lost.then(info => {
        if (info.reason !== "destroyed") runtimePromise = undefined;
      });
      return runtime;
    } catch (error) {
      device?.destroy();
      return cpu(error.message || "The GPU could not initialize.");
    }
  }

  function runtime() {
    runtimePromise ??= openRuntime();
    return runtimePromise;
  }

  async function detect() {
    const { available, backend, reason } = await runtime();
    return { available, backend, reason };
  }

  async function simulateGPU({ device, pipeline }, hero, samples) {
    const buffers = [];
    function buffer(size, usage) {
      const result = device.createBuffer({ size, usage });
      buffers.push(result);
      return result;
    }
    try {
      const params = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const totals = buffer(12, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const readback = buffer(12, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      device.queue.writeBuffer(params, 0, new Uint32Array([...hero, samples, sampleSeed]));
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: totals } }]
      });
      const commands = device.createCommandEncoder();
      const pass = commands.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(samples / workgroupSize));
      pass.end();
      commands.copyBufferToBuffer(totals, 0, readback, 0, 12);
      device.queue.submit([commands.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const counts = Array.from(new Uint32Array(readback.getMappedRange()));
      readback.unmap();
      if (counts[0] + counts[1] + counts[2] !== samples) throw new Error("Incomplete GPU result.");
      return counts;
    } finally {
      for (const item of buffers) item.destroy();
    }
  }

  async function estimate(name, samples = 16384) {
    const hero = holeCards(name);
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > maxSamples) {
      throw new RangeError("Choose between 1 and 1,000,000 simulations.");
    }
    const start = now();
    const active = await runtime();
    let backend = active.backend;
    let counts;
    if (active.available) {
      try {
        counts = await simulateGPU(active, hero, samples);
      } catch {
        backend = "CPU";
      }
    }
    counts ??= await simulateCPU(hero, samples);
    const [wins, ties, losses] = counts;
    return {
      samples, wins, ties, losses, backend,
      equity: (wins + ties / 2) * 100 / samples,
      win: wins * 100 / samples, tie: ties * 100 / samples, loss: losses * 100 / samples,
      elapsedMs: Math.round(now() - start)
    };
  }

  // The postflop worker batches the same evaluator over distinct private deals.
  // Ranks, hand comparison and deal sampling stay identical across backends.
  const matchupShader = shader.slice(0, shader.indexOf("fn trial("))
    .replace(/struct Parameters \{[^\n]+\}/, "struct Parameters { board: array<vec4<u32>, 2>, count: u32, deals: u32, runs: u32, seed: u32 }")
    .replace(/@group\(0\) @binding\(1\)[^\n]+\n[^\n]+/, `
@group(0) @binding(1) var<storage, read> deals: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read_write> scores: array<u32>;`) + `
fn showdown(board: Holding, cards: vec4<u32>) -> u32 {
  var a = board;
  var b = board;
  addCard(&a, cards.x); addCard(&a, cards.y);
  addCard(&b, cards.z); addCard(&b, cards.w);
  let sa = score(a); let sb = score(b);
  return select(select(0u, 1u, sa == sb), 2u, sa > sb);
}
@compute @workgroup_size(64)
fn evaluate(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.deals) { return; }
  let cards = deals[id.x];
  var board: Holding;
  var blocked: array<u32, 2>;
  for (var i = 0u; i < 4u; i++) {
    let card = cards[i]; blocked[card >> 5u] |= 1u << (card & 31u);
  }
  for (var i = 0u; i < params.count; i++) {
    let card = params.board[i >> 2u][i & 3u];
    blocked[card >> 5u] |= 1u << (card & 31u);
    addCard(&board, card);
  }
  var sum = 0u;
  if (params.count == 5u) {
    sum = showdown(board, cards);
  } else if (params.count == 4u) {
    for (var card = 0u; card < 52u; card++) {
      if ((blocked[card >> 5u] & (1u << (card & 31u))) != 0u) { continue; }
      var complete = board;
      addCard(&complete, card);
      sum += showdown(complete, cards);
    }
  } else {
    var seed = id.x * 2654435761u + params.seed;
    for (var run = 0u; run < params.runs; run++) {
      var seen = blocked;
      var complete = board;
      var dealt = 0u;
      while (dealt < 2u) {
        let roll = permute(seed); seed++;
        if (roll < 48u) { continue; }
        let card = roll % 52u; let bit = 1u << (card & 31u);
        if ((seen[card >> 5u] & bit) != 0u) { continue; }
        seen[card >> 5u] |= bit;
        addCard(&complete, card); dealt++;
      }
      sum += showdown(complete, cards);
    }
  }
  scores[id.x] = sum;
}`;

  async function gpuMatchups(active, cards, board, runs) {
    const { device } = active;
    active.matchupPipeline ??= device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: matchupShader }), entryPoint: "evaluate" }
    });
    const pipeline = await active.matchupPipeline;
    const allocated = [];
    const make = (size, usage) => {
      const buf = device.createBuffer({ size, usage });
      allocated.push(buf);
      return buf;
    };
    try {
      const n = cards.length / 4;
      const config = new Uint32Array(12);
      config.set(board);
      config.set([board.length, n, runs, sampleSeed], 8);
      const uniform = make(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const input = make(cards.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const output = make(n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const staging = make(n * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(uniform, 0, config);
      device.queue.writeBuffer(input, 0, cards);
      const commands = device.createCommandEncoder();
      const pass = commands.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [uniform, input, output].map((buffer, binding) => ({ binding, resource: { buffer } }))
      }));
      pass.dispatchWorkgroups(Math.ceil(n / workgroupSize));
      pass.end();
      commands.copyBufferToBuffer(output, 0, staging, 0, n * 4);
      device.queue.submit([commands.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const scores = new Uint32Array(staging.getMappedRange()).slice();
      staging.unmap();
      return scores;
    } finally {
      allocated.forEach(buffer => buffer.destroy());
    }
  }

  function cpuMatchups(cards, board, runs) {
    const base = new Uint32Array(8), complete = new Uint32Array(8);
    const a = new Uint32Array(8), b = new Uint32Array(8);
    let boardLow = 0, boardHigh = 0;
    for (const card of board) {
      addCard(base, card);
      if (card < 32) boardLow |= 1 << card;
      else boardHigh |= 1 << (card - 32);
    }
    const result = new Uint32Array(cards.length / 4);
    for (let deal = 0; deal < result.length; deal++) {
      const start = deal * 4;
      let low = boardLow, high = boardHigh;
      for (let j = start; j < start + 4; j++) {
        const card = cards[j];
        if (card < 32) low |= 1 << card;
        else high |= 1 << (card - 32);
      }
      function showdown() {
        a.set(complete); b.set(complete);
        addCard(a, cards[start]); addCard(a, cards[start + 1]);
        addCard(b, cards[start + 2]); addCard(b, cards[start + 3]);
        const va = score(a), vb = score(b);
        return va > vb ? 2 : va === vb ? 1 : 0;
      }
      if (board.length === 5) {
        complete.set(base);
        result[deal] = showdown();
      } else if (board.length === 4) {
        for (let card = 0; card < 52; card++) {
          if ((card < 32 ? low : high) & (1 << (card & 31))) continue;
          complete.set(base); addCard(complete, card);
          result[deal] += showdown();
        }
      } else {
        let seed = (Math.imul(deal, 2654435761) + sampleSeed) >>> 0;
        for (let run = 0; run < runs; run++) {
          let seenLow = low, seenHigh = high;
          complete.set(base);
          for (let dealt = 0; dealt < 2;) {
            const roll = permute(seed++);
            if (roll < 48) continue;
            const card = roll % 52, bit = 1 << (card & 31);
            if ((card < 32 ? seenLow : seenHigh) & bit) continue;
            if (card < 32) seenLow |= bit;
            else seenHigh |= bit;
            addCard(complete, card); dealt++;
          }
          result[deal] += showdown();
        }
      }
    }
    return result;
  }

  // Internal bulk API, used in the postflop worker with blocker-checked deals.
  async function matchupEquities(cards, board, flopSamples) {
    const active = await runtime();
    const runs = board.length === 3 ? flopSamples : board.length === 4 ? 44 : 1;
    let backend = "CPU", points;
    if (active.available) {
      try {
        points = await gpuMatchups(active, cards, board, runs);
        backend = "WebGPU";
      } catch { /* Device loss and rejected pipelines use the CPU evaluator. */ }
    }
    points ??= cpuMatchups(cards, board, runs);
    return { equities: Float32Array.from(points, value => value / (2 * runs)), backend, runs };
  }

  globalThis.RangeGPU = Object.freeze({ detect, estimate, matchupEquities });
})();
