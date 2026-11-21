(() => {
  'use strict';

  const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const ranks = '23456789TJQKA';
  const actionLabel = { raise: 'Raise', call: 'Call', fold: 'Fold' };
  const headerPattern = /^PokerStars (?:Zoom |Home Game )?(?:Hand|Game) #(\d+):/gmi;
  const pageSize = 20;
  const session = { text: '', results: [], page: 0, message: '', revision: 0 };

  function chips(text) {
    const number = String(text).trim().replace(/^[$€£¥]/, '').replaceAll(',', '');
    return /^\d+(?:\.\d+)?$/.test(number) ? Number(number) : NaN;
  }

  function handClass(cards) {
    const valid = cards.length === 2 && cards.every(card => /^[2-9TJQKA][cdhs]$/.test(card));
    if (!valid || cards[0] === cards[1]) return null;
    const [high, low] = [...cards].sort((a, b) => ranks.indexOf(b[0]) - ranks.indexOf(a[0]));
    return high[0] + low[0] + (high[0] === low[0] ? '' : high[1] === low[1] ? 's' : 'o');
  }

  const rounded = value => Number(value.toFixed(4));
  const suits = { c: '♣', d: '♦', h: '♥', s: '♠' };

  function seatPositions(count) {
    if (count === 2) return ['SB', 'BB'];
    if (count <= 6) return positions.slice(6 - count);
    const early = Array.from({ length: count - 6 }, (_, i) => i ? 'UTG+' + i : 'UTG');
    return [...early, 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  }

  function replayHand(lines, setup, ordered, button, blinds, heroCards) {
    const bb = blinds.big.amount;
    const people = new Map(ordered.map(seat => [seat.name, seat]));
    const invested = Object.fromEntries(ordered.map(seat => [seat.position, 0]));
    const clockwise = [...ordered].sort((a, b) =>
      ((a.number - button + 11) % 11 || 11) - ((b.number - button + 11) % 11 || 11));
    const live = new Set(clockwise.map(seat => seat.position));
    const replay = { frames: [], streets: [], seats: ordered.map(seat => ({ position: seat.position, stack: rounded(seat.stack / bb) })) };
    let street = 'Preflop', board = [], pot = 0, paid = {}, streetInfo = null;
    const frame = (type, info, delta = 0) => {
      const before = rounded(pot);
      pot = rounded(pot + delta);
      replay.frames.push({ type, street, board, before, pot, delta: rounded(delta), ...info });
    };
    const post = (actor, amount, text, countsAsBet) => {
      if (!actor || !Number.isFinite(amount)) return false;
      const value = amount / bb, position = actor.position;
      invested[position] += value;
      if (countsAsBet) paid[position] = (paid[position] || 0) + value;
      frame('post', { position, text }, value);
      return true;
    };
    for (const line of setup) {
      const entry = line.match(/^(.+): posts (small blind|big blind|the ante|ante) (\S+)/i);
      if (entry && !post(people.get(entry[1]), chips(entry[3]), entry[2], !entry[2].includes('ante'))) {
        replay.warning = 'A forced payment could not be read.';
        return replay;
      }
    }
    for (const line of lines) {
      if (/^\*\*\* (?:SUMMARY|SHOW DOWN)/.test(line)) {
        if (line.includes('SUMMARY')) break;
        continue;
      }
      const marker = line.match(/^\*\*\* (FLOP|TURN|RIVER) \*\*\*(.*)$/);
      if (marker) {
        const cards = [...marker[2].matchAll(/\[([^\]]+)\]/g)].flatMap(m => m[1].split(/\s+/));
        const length = { FLOP: 3, TURN: 4, RIVER: 5 }[marker[1]];
        if (cards.length !== length || cards.some(card => !/^[2-9TJQKA][cdhs]$/.test(card)) ||
          new Set([...cards, ...heroCards]).size !== length + heroCards.length ||
          board.some((card, i) => card !== cards[i]) || (length > 3 && board.length !== length - 1)) {
          replay.warning = 'Replay stops before the inconsistent board.';
          break;
        }
        board = cards;
        street = marker[1][0] + marker[1].slice(1).toLowerCase();
        paid = {};
        const active = [...live];
        streetInfo = { street, board, pot: rounded(pot), active, start: replay.frames.length, bet: null,
          history: [], effective: Math.min(...active.map(position =>
            replay.seats.find(seat => seat.position === position).stack - invested[position])) };
        replay.streets.push(streetInfo);
        frame('street', { text: street + ' dealt' });
        continue;
      }
      if (/^\*\*\* (?:FIRST|SECOND|THIRD) (?:FLOP|TURN|RIVER)/.test(line)) {
        replay.warning = 'Replay ends where multiple runouts begin.'; break;
      }
      const returned = line.match(/^Uncalled bet \(([^)]+)\) returned to (.+)$/);
      if (returned) {
        const position = people.get(returned[2])?.position;
        const amount = chips(returned[1]) / bb;
        if (!position || !Number.isFinite(amount) || amount > (paid[position] || 0) + 1e-5) {
          replay.warning = 'Replay stops before an unrecognized bet return.'; break;
        }
        paid[position] -= amount;
        invested[position] -= amount;
        frame('return', { position, text: 'uncalled bet returned' }, -amount);
        continue;
      }
      const won = line.match(/^(.+) collected (\S+) from (?:.*\b)?pot(?:-\d+)?$/i);
      if (won) {
        const position = people.get(won[1])?.position, amount = chips(won[2]) / bb;
        if (position && Number.isFinite(amount) && amount <= pot + 1e-5) frame('award', { position, text: 'collected' }, -amount);
        continue;
      }
      const action = line.match(/^(.+): (folds|checks|calls|bets|raises)\b(.*)$/);
      if (!action) continue;
      const position = people.get(action[1])?.position, verb = action[2], detail = action[3].trim();
      const already = paid[position] || 0;
      const amount = verb === 'raises' ? chips(detail.match(/\bto (\S+)/)?.[1]) / bb - already
        : ['calls', 'bets'].includes(verb) ? chips(detail.split(' ')[0]) / bb : 0;
      if (!live.has(position) || !Number.isFinite(amount) || amount < 0 || amount + invested[position] > (people.get(action[1])?.stack / bb) + 1e-4) {
        replay.warning = 'Replay stops at an inconsistent betting amount or seat.'; break;
      }
      const allIn = /all-in/i.test(detail);
      const step = { position, text: verb + (detail ? ' ' + detail : ''), verb, total: rounded(already + amount), allIn };
      if (streetInfo) {
        const history = streetInfo.history;
        if (streetInfo.active.length === 2) {
          const [oop, ip] = streetInfo.active;
          if (!history.length && position === oop) step.node = 0;
          if (history.length === 1 && position === ip) step.node = history[0] === 'checks' ? 1 : history[0] === 'bets' ? 2 : undefined;
          if (history.length === 2 && history[0] === 'checks' && history[1] === 'bets' && position === oop) step.node = 3;
        }
        if (verb === 'bets' && streetInfo.bet === null) streetInfo.bet = rounded(amount);
        streetInfo.history.push(verb);
      }
      if (verb === 'folds') live.delete(position);
      paid[position] = already + amount;
      invested[position] += amount;
      frame('action', step, amount);
    }
    return replay;
  }

  function readHand(raw, id) {
    const lines = raw.split('\n').map(line => line.trim());
    const record = { id, log: [] };
    const skip = reason => ({ ...record, reason });
    if (!/Hold['’]?em No Limit/i.test(lines[0]) || /Tournament|Match #/i.test(lines[0])) {
      return skip("This hand uses a game outside no-limit hold’em cash.");
    }
    const holeIndex = lines.indexOf('*** HOLE CARDS ***');
    if (holeIndex < 0) return skip('The preflop betting round is missing.');
    const setup = lines.slice(1, holeIndex);
    const table = setup.map(line => line.match(/^Table .+ Seat #(\d+) is the button/i)).find(Boolean);
    if (!table) return skip('The button seat is missing.');
    const seated = [];
    const blinds = {};
    let hasAnte = false;
    for (const line of setup) {
      if (/: posts (?:the ante|ante)\b/i.test(line)) hasAnte = true;
      if (/: posts (?:.*dead|.*straddle|small & big)/i.test(line)) return skip('The hand has a dead blind or straddle.');
      const seat = line.match(/^Seat (\d+): (.+) \(([^\s]+) in chips\)(.*)$/i);
      if (seat && !/sitting out/i.test(seat[4])) {
        seated.push({ number: Number(seat[1]), name: seat[2], stack: chips(seat[3]) });
      }
      const blind = line.match(/^(.+): posts (small|big) blind (\S+)(.*)$/i);
      if (blind) {
        const kind = blind[2].toLowerCase();
        if (blinds[kind] || /all-in/i.test(blind[4])) return skip('Extra or all-in blind posts need a different model.');
        blinds[kind] = { name: blind[1], amount: chips(blind[3]) };
      }
    }
    if (seated.length < 2 || seated.length > 10) return skip('The active seats could not be determined.');
    if (!blinds.small || !blinds.big || !(blinds.big.amount > 0) || !(blinds.small.amount > 0)) {
      return skip('Both posted blinds are needed to calculate the stack in big blinds.');
    }
    if (seated.some(seat => !Number.isFinite(seat.stack) || seat.stack <= 0)) return skip('A starting stack is missing.');
    seated.sort((a, b) => a.number - b.number);
    const buttonIndex = seated.findIndex(seat => seat.number === Number(table[1]));
    if (buttonIndex < 0) return skip('The button is on an empty or inactive seat.');
    // Preflop action starts three active seats clockwise from the button.
    const first = seated.length === 2 ? buttonIndex : (buttonIndex + 3) % seated.length;
    const ordered = [...seated.slice(first), ...seated.slice(0, first)];
    const positionNames = seatPositions(ordered.length);
    ordered.forEach((seat, i) => { seat.position = positionNames[i]; });
    const players = new Map(ordered.map(seat => [seat.name, seat]));
    if (players.get(blinds.small.name)?.position !== 'SB' || players.get(blinds.big.name)?.position !== 'BB') {
      return skip('The active seats and posted blinds do not match.');
    }
    const streetEnd = lines.findIndex((line, i) => i > holeIndex && /^\*\*\*/.test(line));
    const preflop = lines.slice(holeIndex + 1, streetEnd === -1 ? lines.length : streetEnd);
    const dealt = preflop.map(line => line.match(/^Dealt to (.+) \[([^\]]+)\]$/)).find(Boolean);
    record.replay = replayHand(lines.slice(holeIndex + 1), setup, ordered, Number(table[1]), blinds,
      dealt ? dealt[2].split(/\s+/) : []);
    if (!dealt) return skip('Hero’s hole cards are missing.');
    const hero = players.get(dealt[1]);
    record.cards = dealt[2].split(/\s+/);
    record.hand = handClass(record.cards);
    if (!hero || !record.hand) return skip('Hero’s seat or two distinct hole cards could not be read.');
    record.hero = hero.position;
    if (seated.length < 3 || seated.length > 6) return skip('Preflop scoring supports tables with three to six players.');
    if (hasAnte) return skip('Preflop scoring assumes a cash game without antes.');
    const actions = [];
    for (const line of preflop) {
      const action = line.match(/^(.+): (folds|raises|calls|checks|bets)\b(.*)$/);
      if (!action) continue;
      const actor = players.get(action[1]);
      if (!actor) return skip('A preflop action belongs to an unrecognized seat.');
      actions.push({ actor, verb: action[2], detail: action[3].trim() });
      record.log.push(actor.position + ' · ' + action[2] + action[3]);
      if (actor === hero) break;
    }
    const decision = actions.at(-1);
    if (!decision || decision.actor !== hero) return skip('Hero has no recorded preflop decision.');
    const earlier = actions.slice(0, -1);
    if (earlier.some(action => action.verb === 'calls' || action.verb === 'checks')) return skip('A limp or cold call precedes hero.');
    const raises = earlier.filter(action => action.verb === 'raises');
    if (raises.length > 1) return skip('Hero faces a three-bet or higher raise.');
    if (earlier.some(action => !['folds', 'raises'].includes(action.verb))) return skip('The preceding action falls outside this model.');
    if (actions.some((action, i) => action.actor !== ordered[i])) return skip('The preflop action sequence is incomplete.');
    if (actions.some(action => /all-in/i.test(action.detail))) return skip('An all-in decision requires a different betting model.');
    const opener = raises[0];
    if (!opener && hero.position === 'BB') return skip('The unopened big blind has no decision.');
    if (!opener && decision.verb === 'calls') return skip('Open limping is outside the raise-first-in model.');
    const chosen = { folds: 'fold', calls: 'call', raises: 'raise' }[decision.verb];
    if (!chosen) return skip('This action falls outside the modeled choices.');
    const bigBlind = blinds.big.amount;
    const opposingStack = opener ? opener.actor.stack : Math.max(...ordered.slice(actions.length).map(seat => seat.stack));
    const stack = Math.min(hero.stack, opposingStack) / bigBlind;
    const openAction = opener || (chosen === 'raise' ? decision : null);
    const amount = openAction?.detail.match(/\bto (\S+)/i);
    const openSize = openAction ? chips(amount?.[1]) / bigBlind : 2.5;
    if (!Number.isFinite(openSize) || openSize < 2 || openSize >= stack || stack < 5 || stack > 1000) {
      return skip('The stack or open size falls outside the cash model.');
    }
    record.config = { model: 'cash', hero: hero.position, villain: opener?.actor.position || 'none',
      stack: Number(stack.toFixed(3)), openSize: Number(openSize.toFixed(3)) };
    record.chosen = chosen;
    record.smallBlindRatio = blinds.small.amount / bigBlind;
    return record;
  }

  function parse(text) {
    const source = String(text).replaceAll('\r', '').replaceAll('\uFEFF', '');
    const headers = [...source.matchAll(headerPattern)];
    const seen = new Set();
    const records = [];
    headers.forEach((header, i) => {
      if (seen.has(header[1])) return;
      seen.add(header[1]);
      const end = headers[i + 1]?.index ?? source.length;
      records.push(readHand(source.slice(header.index, end), header[1]));
    });
    return records;
  }

  function evaluate(record, cache = new Map()) {
    if (record.reason) return record;
    const key = JSON.stringify(record.config);
    if (!cache.has(key)) {
      if (cache.size >= 40) cache.delete(cache.keys().next().value);
      cache.set(key, globalThis.RangeEngine.solve(record.config));
    }
    const solution = cache.get(key);
    const combo = solution.hands[record.hand];
    const alternatives = solution.actions.filter(action => Number.isFinite(combo.ev[action.key]))
      .map(action => ({ key: action.key, size: action.size, ev: combo.ev[action.key], frequency: combo.frequencies[action.key] }))
      .sort((a, b) => b.ev - a.ev);
    const chosen = alternatives.find(action => action.key === record.chosen);
    if (!chosen || !alternatives.length) return { ...record, reason: 'The recorded action has no modeled EV.' };
    return { ...record, alternatives, best: alternatives[0].key, frequency: chosen.frequency,
      loss: Math.max(0, alternatives[0].ev - chosen.ev) };
  }

  function modeledRanges(replay, active) {
    const preflop = replay.frames.filter(frame => frame.street === 'Preflop' && frame.type === 'action');
    const raises = preflop.filter(frame => frame.verb === 'raises');
    const stack = Math.min(...active.map(position => replay.seats.find(seat => seat.position === position).stack));
    const readable = active.every(position => positions.includes(position));
    const cleanOpen = raises.length === 1 && active.includes(raises[0].position) &&
      preflop.slice(0, preflop.indexOf(raises[0])).every(frame => frame.verb === 'folds');
    if (cleanOpen && readable && stack >= 5 && stack <= 1000 && raises[0].total >= 2 && raises[0].total < stack) {
      const ranges = active.map(position => {
        const opens = position === raises[0].position;
        const { hands } = globalThis.RangeEngine.solve({ model: 'cash', hero: position,
          villain: opens ? 'none' : raises[0].position, stack, openSize: raises[0].total });
        return Object.values(hands).map(hand => [hand.name, hand.frequencies[opens ? 'raise' : 'call']])
          .filter(([, weight]) => weight > 0)
          .map(([name, weight]) => weight >= 100 ? name : name + ':' + Number(weight.toFixed(2)) + '%').join(', ');
      });
      if (ranges.every(Boolean)) return { ranges, note: 'Ranges use the preflop cash model’s ' + raises[0].position + ' open and opposing call frequencies.' };
    }
    const openRange = '55+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo';
    const callRange = '22-JJ, A2s-AQs, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, ATo-AQo, KJo+, QJo';
    const threeBet = 'TT+, AQs+, A5s, A4s:50%, KQs, AKo';
    const faceThreeBet = '77-QQ, AA:20%, AJs+, KQs, QJs:50%, JTs:50%, AQo:50%, AKo';
    const lastRaiser = raises.at(-1)?.position;
    const ranges = active.map(position => raises.length >= 2 ? (position === lastRaiser ? threeBet : faceThreeBet)
      : position === lastRaiser ? openRange : callRange);
    const line = raises.length >= 2 ? 'a reraised pot' : raises.length ? 'a raised pot' : 'a limped pot';
    return { ranges, note: 'Editable starting ranges approximate ' + line + ' using the recorded preflop actions.' };
  }

  function streetSpot(record, index) {
    const replay = record.replay, frame = replay?.frames[index];
    const street = replay?.streets.find(item => item.street === frame?.street);
    if (!street) return { reason: 'Street study becomes available on the flop.' };
    if (street.active.length !== 2 || !(street.effective > 0)) return { reason: 'Street study requires two live players with chips at the beginning of the street.' };
    if (!(street.pot > 0)) return { reason: 'The starting pot could not be read.' };
    const observed = street.bet !== null;
    const amount = observed ? street.bet : Math.min(street.pot * 0.5, street.effective);
    const size = rounded(100 * amount / street.pot);
    if (!(size > 0 && size <= 1000) || amount > street.effective + 1e-4) {
      return { reason: 'The observed bet exceeds the supported size or effective stack.' };
    }
    // Each street starts with the preflop model priors. Prior-street actions do
    // not reveal the players' actual ranges or uniquely determine their weights.
    const prior = street.prior || (street.prior = modeledRanges(replay, street.active));
    const decision = frame.node ?? 0;
    const note = prior.note + ' Adjust both ranges for prior-street actions. ' +
      (observed ? 'Bet size comes from the first recorded bet on this street.' : 'A bet size of ' + size + '% is assumed for this checked street.');
    return { config: { board: street.board.join(' '), pot: street.pot, size, stack: rounded(street.effective), oop: prior.ranges[0], ip: prior.ranges[1],
      quality: 'fast', lock: '', decision, note }, note, street };
  }

  const example = [
    'PokerStars Hand #100000001: Hold\'em No Limit ($0.50/$1.00 USD)',
    "Table 'Example' 6-max Seat #4 is the button",
    'Seat 1: North ($100 in chips)', 'Seat 2: East ($100 in chips)', 'Seat 3: West ($100 in chips)',
    'Seat 4: Button ($100 in chips)', 'Seat 5: Small ($100 in chips)', 'Seat 6: Hero ($100 in chips)',
    'Small: posts small blind $0.50', 'Hero: posts big blind $1', '*** HOLE CARDS ***',
    'Dealt to Hero [As Qs]', 'North: folds', 'East: folds', 'West: folds',
    'Button: raises $1.50 to $2.50', 'Small: folds', 'Hero: calls $1.50',
    '*** FLOP *** [Qd 8d 4c]', 'Hero: checks', 'Button: bets $2.75', 'Hero: calls $2.75',
    '*** TURN *** [Qd 8d 4c] [2s]', 'Hero: checks', 'Button: checks',
    '*** RIVER *** [Qd 8d 4c 2s] [Kc]', 'Hero: checks', 'Button: bets $8.25', 'Hero: folds',
    'Uncalled bet ($8.25) returned to Button', 'Button collected $11 from pot', '*** SUMMARY ***'
  ].join('\n');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, handler, className = 'button') {
    const control = element('button', className, label);
    control.type = 'button';
    control.addEventListener('click', handler);
    return control;
  }

  function replayer(hand, onPostflop, workers) {
    const replay = hand.replay;
    const box = element('section', 'an-replay');
    box.append(element('h3', '', 'Hand replay'));
    const bar = element('div', 'an-replay-bar');
    const jump = element('select');
    jump.setAttribute('aria-label', 'Replay street');
    jump.add(new Option('Preflop', '0'));
    replay.streets.forEach(street => jump.add(new Option(street.street, String(street.start))));
    const step = element('span', 'muted');
    const display = element('div', 'an-display');
    const controls = element('div', 'an-controls');
    const review = element('p', 'an-review');
    review.setAttribute('role', 'status');
    let index = replay.streets[0]?.start || 0, worker = null, pendingButton = null;
    const stop = () => {
      if (worker) { worker.terminate(); workers.delete(worker); worker = null; }
      if (pendingButton) { pendingButton.disabled = false; pendingButton = null; }
    };
    const previous = button('Previous action', () => move(index - 1));
    const next = button('Next action', () => move(index + 1));
    bar.append(jump, step);
    controls.append(previous, next);
    box.append(bar, display, controls, review);
    if (replay.warning) box.append(element('p', 'muted', replay.warning));
    jump.onchange = () => move(Number(jump.value));
    function reviewDecision(frame, config, trigger) {
      stop();
      try { worker = new Worker(new URL('./postflop-worker.js', document.baseURI)); }
      catch { review.textContent = 'A solver worker could not start on this device.'; return; }
      workers.add(worker);
      pendingButton = trigger;
      trigger.disabled = true;
      review.textContent = 'Solving this decision…';
      const fail = text => { review.textContent = text; trigger.disabled = false; stop(); };
      worker.onerror = () => fail('The solver worker could not finish.');
      worker.onmessage = ({ data }) => {
        if (data.progress) { review.textContent = data.progress; return; }
        if (data.error) { fail(data.error); return; }
        if (!data.result) return;
        const cards = [...hand.cards].sort().join('');
        const row = data.result.nodes[frame.node]?.rows.find(item => item.hand.match(/../g).sort().join('') === cards);
        if (!row) { fail('Hero’s exact cards have no reached row in the assumed ranges. Edit the ranges in street study to include this combination.'); return; }
        const first = frame.node < 2 ? 'bets' : 'calls';
        const choseFirst = frame.verb === first;
        const playedEV = choseFirst ? row.evA : row.evB;
        const loss = Math.max(row.evA, row.evB) - playedEV;
        const mix = 100 * (choseFirst ? row.frequency : 1 - row.frequency);
        review.textContent = 'Estimated loss ' + loss.toFixed(2) + ' bb · played action ' + mix.toFixed(1) + '% · ' +
          data.result.iterations + ' iterations. This solve models a single bet size and direct runout to showdown.';
        stop();
        trigger.disabled = false;
      };
      worker.postMessage(config);
    }
    function move(value) {
      stop();
      index = Math.max(0, Math.min(value, replay.frames.length - 1));
      review.textContent = '';
      const frame = replay.frames[index];
      jump.value = String(replay.streets.find(item => item.street === frame.street)?.start || 0);
      step.textContent = 'Step ' + (index + 1) + ' of ' + replay.frames.length;
      previous.disabled = index === 0;
      next.disabled = index === replay.frames.length - 1;
      controls.replaceChildren(previous, next);
      display.replaceChildren();
      const head = element('div', 'an-replay-bar');
      const board = element('div', 'an-board');
      if (!frame.board.length) board.append(element('span', 'muted', 'Preflop'));
      frame.board.forEach(card => board.append(element('span', 'an-card ' + (['d', 'h'].includes(card[1]) ? 'an-red' : ''), card[0] + suits[card[1]])));
      head.append(board, element('strong', '', 'Pot ' + frame.pot + ' bb'));
      const timeline = replay.frames.slice(0, index + 1);
      const seats = element('div', 'an-seats');
      replay.seats.forEach(seat => {
        const own = timeline.filter(f => f.position === seat.position);
        const contribution = rounded(own.filter(f => f.type !== 'award').reduce((n, f) => n + f.delta, 0));
        const winnings = own.filter(f => f.type === 'award').reduce((n, f) => n - f.delta, 0);
        const folded = own.some(f => f.verb === 'folds');
        const tile = element('div', 'an-seat' + (folded ? ' an-folded' : '') + (frame.position === seat.position ? ' an-active' : ''));
        tile.append(element('strong', '', seat.position + (seat.position === hand.hero ? ' · Hero' : '')),
          element('span', '', rounded(seat.stack - contribution + winnings) + ' bb'),
          element('small', '', folded ? 'Folded' : contribution + ' bb in'));
        seats.append(tile);
      });
      display.append(head, seats, element('p', 'an-current', (frame.position ? frame.position + ' · ' : '') + frame.text));
      if (frame.street === 'Preflop') return;
      const spot = streetSpot(hand, index);
      if (!spot.config) { display.append(element('p', 'muted', spot.reason)); return; }
      const { config, street } = spot;
      display.append(element('p', 'an-model-note', street.active.join(' vs ') + ' · ' + config.pot + ' bb street pot · ' + config.size + '% bet. ' + spot.note));
      if (onPostflop) controls.append(button('Study this street', () => onPostflop(config)));
      const supported = frame.node < 2 ? ['checks', 'bets'] : ['calls', 'folds'];
      if (hand.cards && frame.position === hand.hero && Number.isInteger(frame.node) && supported.includes(frame.verb)) {
        const analyze = button('Review decision EV', () => reviewDecision(frame, config, analyze));
        controls.append(analyze);
      }
    }
    move(index);
    return { box, stop() { if (worker) { stop(); review.textContent = 'Review stopped.'; } } };
  }

  function resultRow(hand, onStudy, onPostflop, workers) {
    const row = element('details', 'an-hand');
    const summary = element('summary');
    const title = element('span', 'an-row-title', hand.hand || 'Hand');
    const spot = hand.config ? hand.config.villain === 'none' ? hand.hero + ' unopened' : hand.hero + ' vs ' + hand.config.villain : hand.hero || 'Unscored';
    summary.append(title, element('span', 'an-id', spot + ' · #' + hand.id),
      element('strong', hand.reason ? 'muted' : 'an-loss', hand.reason ? 'Skipped' : hand.loss.toFixed(2) + ' bb'),
      element('span', 'an-expand', '+'));
    row.append(summary);
    const detail = element('div', 'an-detail');
    if (hand.reason) {
      detail.append(element('p', 'muted', hand.reason));
    } else {
      detail.append(element('p', '', 'Played ' + actionLabel[hand.chosen].toLowerCase() + ' · ' + hand.frequency.toFixed(1) + '% model frequency · ' + hand.config.stack + ' bb effective'));
      const table = element('table', 'an-table');
      const header = table.createTHead().insertRow();
      ['Action', 'Model frequency', 'Estimated EV'].forEach(label => header.append(element('th', '', label)));
      const body = table.createTBody();
      for (const action of hand.alternatives) {
        const tr = body.insertRow();
        const label = action.key === 'raise' ? 'Raise to ' + action.size + ' bb' : actionLabel[action.key];
        [label, action.frequency.toFixed(1) + '%', action.ev.toFixed(2) + ' bb'].forEach(value => tr.append(element('td', '', value)));
      }
      detail.append(table);
      if (Math.abs(hand.smallBlindRatio - 0.5) > 1e-6) detail.append(element('p', 'muted', 'The model assumes a 0.5 bb small blind. The hand used ' + Number(hand.smallBlindRatio.toFixed(3)) + ' bb.'));
    }
    if (hand.log.length) detail.append(element('p', 'an-log', hand.log.join('  /  ')));
    if (!hand.reason && onStudy) detail.append(button('Open in study', () => onStudy(hand.config, hand.hand)));
    if (hand.replay?.frames.length) {
      let player = null;
      row.addEventListener('toggle', () => {
        if (row.open && !player) { player = replayer(hand, onPostflop, workers); detail.append(player.box); }
        if (!row.open) player?.stop();
      });
    }
    row.append(detail);
    return row;
  }

  function addStyles() {
    if (document.getElementById('analyzer-styles')) return;
    const style = element('style');
    style.id = 'analyzer-styles';
    style.textContent = `
.analyzer{display:grid;gap:18px}.analyzer .an-panel{padding:clamp(18px,3vw,30px)}
.analyzer h2{margin:0 0 8px;font-size:1.27rem}.analyzer p{line-height:1.55;margin:8px 0 16px}
.analyzer textarea{display:block;width:100%;min-height:150px;resize:vertical;box-sizing:border-box;padding:14px;margin:15px 0;font:13px/1.6 Consolas,monospace;color:inherit;background:#101617;border:1px solid #343d3e;border-radius:8px}
.analyzer .an-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.analyzer .an-status{margin:12px 0 0}
.analyzer .an-row-title{font-weight:750;min-width:42px}.analyzer .an-id{flex:1;overflow-wrap:anywhere;color:#a5b3ad}
.analyzer .an-hand{border-top:1px solid #323a39}.analyzer summary{list-style:none;display:flex;align-items:center;gap:14px;cursor:pointer;padding:15px 0}
.analyzer summary::-webkit-details-marker{display:none}.analyzer .an-loss{color:#9ae8c3;white-space:nowrap;font-variant-numeric:tabular-nums}
.analyzer .an-expand{font-size:19px;color:#9aa7a2}.analyzer details[open] .an-expand{transform:rotate(45deg)}
.analyzer .an-detail{padding:0 0 18px}.analyzer .an-table{border-collapse:collapse;width:min(100%,560px);font-variant-numeric:tabular-nums}
.analyzer .an-table th,.analyzer .an-table td{padding:7px 4px;text-align:left}.analyzer .an-table th{font-size:12px;color:#9ba9a3}
.analyzer .an-log{font:13px/1.65 Consolas,monospace;color:#adbbb4}.analyzer .an-pager{margin-top:16px;display:flex;align-items:center;gap:12px}
.analyzer .an-replay{border-top:1px solid var(--border);margin-top:18px;padding-top:16px}
.analyzer .an-replay h3{font-size:1.04rem;margin:0 0 12px}.analyzer .an-replay-bar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.analyzer .an-replay select{padding:6px 12px}.analyzer .an-display{border:1px solid var(--border);background:var(--bg);border-radius:9px;padding:14px;margin:12px 0}
.analyzer .an-board,.analyzer .an-seats{display:flex;flex-wrap:wrap;gap:6px}.analyzer .an-board{min-height:30px;align-items:center}
.analyzer .an-card{border-radius:4px;background:#e4ebed;color:#19232d;padding:4px 6px;font:700 14px var(--mono)}.analyzer .an-red{color:#9d3336}
.analyzer .an-seats{margin:12px 0}.analyzer .an-seat{border:1px solid var(--border);border-radius:6px;padding:7px 10px;display:grid;gap:2px;min-width:72px}
.analyzer .an-seat span,.analyzer .an-seat small,.analyzer .an-model-note{font-size:12px;color:var(--muted)}.analyzer .an-folded{opacity:.62}.analyzer .an-active{border-color:var(--mint)}
.analyzer .an-current{margin:8px 0}.analyzer .an-model-note,.analyzer .an-review{margin:8px 0 0}
@media(max-width:550px){.analyzer summary{gap:8px}.analyzer .an-id{font-size:12px}.analyzer .an-row-title{min-width:31px}}
`;
    document.head.append(style);
  }

  function mount(container, { onStudy, onPostflop } = {}) {
    addStyles();
    const workers = new Set();
    const cleanup = () => { for (const worker of workers) worker.terminate(); workers.clear(); };
    const root = element('section', 'analyzer');
    const input = element('section', 'panel an-panel');
    const label = element('label', '', 'PokerStars hand histories');
    label.htmlFor = 'an-history';
    const heading = element('h2');
    heading.append(label);
    const area = element('textarea', 'input');
    area.id = label.htmlFor;
    area.spellcheck = false;
    area.placeholder = 'Paste English PokerStars cash hand histories here…';
    area.value = session.text;
    const files = element('input');
    files.type = 'file';
    files.accept = '.txt,.log,text/plain';
    files.multiple = true;
    files.hidden = true;
    const controls = element('div', 'an-controls');
    const status = element('p', 'an-status muted', session.message);
    status.setAttribute('role', 'status');
    const report = element('section', 'panel an-panel');
    const setMessage = message => { session.message = message; status.textContent = message; };

    function renderReport() {
      cleanup();
      report.replaceChildren();
      const total = session.results.length;
      report.hidden = !total;
      if (!total) return;
      const scored = session.results.filter(hand => !hand.reason);
      const sum = scored.reduce((value, hand) => value + hand.loss, 0);
      report.append(element('h2', '', 'Decision review'), element('p', 'muted',
        scored.length + ' scored · ' + (total - scored.length) + ' skipped · ' + sum.toFixed(2) + ' bb total estimated EV loss'));
      report.append(element('p', 'muted', 'Ranked by estimated EV loss against the preflop cash model. Each score compares the action type at the model’s bet size.'));
      const start = session.page * pageSize;
      session.results.slice(start, start + pageSize).forEach(hand => report.append(resultRow(hand, onStudy, onPostflop, workers)));
      if (total > pageSize) {
        const pager = element('div', 'an-pager');
        const change = delta => { session.page += delta; renderReport(); report.scrollIntoView({ block: 'start' }); };
        const previous = button('Previous', () => change(-1));
        const next = button('Next', () => change(1));
        previous.disabled = !start;
        next.disabled = start + pageSize >= total;
        pager.append(previous, element('span', 'muted', (session.page + 1) + ' of ' + Math.ceil(total / pageSize)), next);
        report.append(pager);
      }
    }

    async function run() {
      const revision = ++session.revision;
      const source = area.value;
      session.text = source;
      session.page = 0;
      session.results = [];
      renderReport();
      if (!source.trim()) { setMessage('Paste a hand history or choose a text file.'); return; }
      setMessage('Reading hands…');
      runButton.disabled = true;
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        const hands = parse(source);
        if (!hands.length) { setMessage('No PokerStars hand headers found. Look for lines beginning with “PokerStars Hand #”.'); return; }
        const cache = new Map();
        const scored = [];
        let lastYield = performance.now();
        for (const hand of hands) {
          if (revision !== session.revision) return;
          scored.push(evaluate(hand, cache));
          if (performance.now() - lastYield > 35) {
            setMessage('Reviewing hand ' + scored.length + ' of ' + hands.length + '…');
            await new Promise(resolve => setTimeout(resolve, 0));
            lastYield = performance.now();
          }
        }
        if (revision !== session.revision) return;
        session.results = scored.sort((a, b) => (b.loss ?? -1) - (a.loss ?? -1));
        setMessage('Reviewed ' + hands.length + (hands.length === 1 ? ' unique hand.' : ' unique hands.'));
        renderReport();
      } catch (error) {
        setMessage('The analysis could not finish. ' + error.message);
      } finally { runButton.disabled = false; }
    }

    const runButton = button('Analyze hands', run, 'button primary');
    controls.append(runButton, button('Import files', () => files.click()),
      button('Load example', () => { area.value = example; run(); }));
    area.addEventListener('input', () => {
      session.text = area.value;
      session.revision++;
      session.results = [];
      setMessage('');
      renderReport();
    });
    files.addEventListener('change', async () => {
      const chosen = [...files.files];
      if (!chosen.length) return;
      if (chosen.reduce((bytes, file) => bytes + file.size, 0) > 16 * 1024 * 1024) {
        setMessage('Select up to 16 MB of text files per review.');
        files.value = '';
        return;
      }
      try {
        const texts = await Promise.all(chosen.map(async file => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
          return new TextDecoder(encoding).decode(bytes);
        }));
        area.value = texts.join('\n');
        await run();
      } catch (error) { setMessage('The file could not be read. ' + error.message); }
      finally { files.value = ''; }
    });
    input.append(heading, element('p', 'muted', 'Replay cash hands, review preflop decisions, and study heads-up postflop spots. Hand histories are processed on this device.'),
      area, controls, files, status);
    root.append(input, report);
    container.replaceChildren(root);
    renderReport();
    return cleanup;
  }

  globalThis.RangeAnalyze = Object.freeze({ mount, parse, evaluate, streetSpot });
})();
