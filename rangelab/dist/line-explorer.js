
(() => {
  'use strict';

  const streetName = count => ({3: 'Flop', 4: 'Turn', 5: 'River'})[count];
  const suits = {s: '♠', h: '♥', d: '♦', c: '♣'};
  const deck = Array.from('AKQJT98765432').flatMap(rank => Object.keys(suits).map(suit => rank + suit));
  const fmt = value => Number(value.toFixed(3)).toLocaleString('en-US', {maximumFractionDigits: 3});
  const pct = value => (value * 100).toFixed(1) + '%';
  const shown = card => card[0] + suits[card[1]];
  const cardsOf = hand => [hand.slice(0, 2), hand.slice(2, 4)];
  const color = card => 'hd'.includes(card[1]) ? '#f49d95' : '#ccdde7';
  const actors = ['OOP', 'IP', 'IP', 'OOP'];
  const normalized = new WeakMap();
  function tree(result) {
    if (result.treeNodes) return result.treeNodes;
    if (normalized.has(result)) return normalized.get(result);
    const b = result.bet, bet = 'Bet ' + fmt(b) + ' bb';
    const leaf = (terminal, contributions) => ({terminal, contributions});
    const children = [
      [{node:2},{node:1}], [{node:3},leaf('showdown',[0,0])],
      [leaf('showdown',[b,b]),leaf('fold',[b,0])], [leaf('showdown',[b,b]),leaf('fold',[0,b])]
    ];
    const labels = ['OOP to act','IP facing a check','IP facing ' + fmt(b) + ' bb','OOP facing ' + fmt(b) + ' bb'];
    const nodes = result.nodes.map((node, i) => ({
      label: labels[i], player: actors[i] === 'IP' ? 1 : 0, actions: i < 2 ? [bet,'Check'] : ['Call','Fold'],
      contributions: [[0,0],[0,0],[b,0],[0,b]][i], children: children[i], reach: node.reach,
      frequencies: [node.frequency,1-node.frequency],
      rows: node.rows.map(r => ({hand:r.hand,weight:r.weight,frequencies:[r.frequency,1-r.frequency]}))
    }));
    normalized.set(result,nodes);
    return nodes;
  }
  function transition(nodes, steps) {
    if(!steps.length) return {node:0};
    const last=steps[steps.length-1];
    return nodes[last.node].children[last.action];
  }

  // Conditional joint reach factors into the two original range weights,
  // each actor's own action probabilities, and an indicator of legal cards.
  function conditionalRanges(result, steps) {
    const ranges = [new Map(), new Map()];
    const nodes=tree(result);
    for (const index of [0,1]) {
      const actions = steps.filter(step => nodes[step.node].player === index);
      if (!actions.length) continue;
      const firstRows = nodes[actions[0].node].rows;
      for (const row of firstRows) ranges[index].set(row.hand, row.weight);
      for (const action of actions) {
        const rows = new Map(nodes[action.node].rows.map(row => [row.hand, row.frequencies[action.action]]));
        for (const [hand, weight] of ranges[index]) {
          const p = rows.get(hand);
          const next = p === undefined ? 0 : weight * p;
          if (next > 1e-12) ranges[index].set(hand, next);
          else ranges[index].delete(hand);
        }
      }
    }
    return ranges;
  }

  function cardTotals(range) {
    const totals = new Map();
    let total = 0;
    for (const [hand, weight] of range) {
      total += weight;
      for (const card of cardsOf(hand)) totals.set(card, (totals.get(card) || 0) + weight);
    }
    return {totals, total};
  }

  // For a fixed combo, subtract the other range's one-card blockers, then
  // add back the identical combo (subtracted twice). A random next card is
  // drawn proportional to all surviving weighted private deals.
  function availableCards(ranges, board) {
    const blocked = new Map();
    let deals = 0;
    for (let i = 0; i < 2; i++) {
      const other = ranges[1-i];
      const {totals, total} = cardTotals(other);
      for (const [hand, weight] of ranges[i]) {
        const [a,b] = cardsOf(hand);
        const compatible = Math.max(0, total - (totals.get(a) || 0) - (totals.get(b) || 0) + (other.get(hand) || 0));
        const reach = weight * compatible;
        if (i === 0) deals += reach;
        blocked.set(a, (blocked.get(a) || 0) + reach);
        blocked.set(b, (blocked.get(b) || 0) + reach);
      }
    }
    return deck.filter(c => !board.includes(c)).map(card => [card, Math.max(0, deals - (blocked.get(card) || 0))])
      .filter(([,weight]) => deals > 0 && weight > deals * 1e-12);
  }

  function pickWeighted(cards) {
    const total = cards.reduce((sum,[,weight]) => sum + weight, 0);
    const target = Math.random() * total;
    let sum = 0;
    for (const [card,weight] of cards) {
      sum += weight;
      if (sum > target) return card;
    }
    return cards[cards.length - 1]?.[0];
  }

  function notation(range) {
    return Array.from(range, ([hand, weight]) => weight >= 1 ? hand : hand + ':' + weight.toFixed(12)).join(',');
  }

  function addStyle() {
    if (document.querySelector('#line-explorer-style')) return;
    const style = document.createElement('style'); style.id = 'line-explorer-style';
    style.textContent = `
      .rl-line {display:grid;gap:13px;border-top:1px solid var(--border);margin-top:17px;padding-top:17px;}
      .rl-line h2,.rl-line h3,.rl-line p,.rl-line details{margin:0;}
      .rl-line p,.rl-line small,.rl-line label{color:var(--muted);font-size:13px;line-height:1.5;}
      .rl-head,.rl-nav,.rl-controls,.rl-board,.rl-actions,.rl-trace{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
      .rl-head{justify-content:space-between;gap:10px;} .rl-stage{display:grid;gap:10px;background:#11171d;border:1px solid var(--border);padding:14px;border-radius:9px;}
      .rl-line .rl-card{display:inline-grid;place-content:center;font:600 16px var(--mono);min-width:35px;padding:6px;background:#26303a;border:1px solid #37434e;border-radius:5px;}
      .rl-line .rl-trace{font-size:12px;gap:6px;color:var(--muted);}.rl-trace b{font-weight:600;color:var(--mint);}
      .rl-actions button{justify-content:space-between;min-width:128px;}.rl-actions button strong{font:500 12px var(--mono);color:var(--muted);}
      .rl-actions button[data-action=bet],.rl-actions button[data-action=call]{border-color:#476858;}
      .rl-line .rl-controls label{display:inline-flex;gap:6px;align-items:center;}.rl-controls select,.rl-controls input{font-size:13px;min-width:0;}
      .rl-line input[type=number]{width:80px;padding:5px 7px;} .rl-line .rl-em{color:var(--mint);}
      .rl-line summary{cursor:pointer;font-size:13px;} .rl-line details[open] > div{margin-top:9px;}
      @media(max-width:500px){.rl-actions button{min-width:105px;}.rl-line .rl-card{min-width:29px;font-size:14px;}}
    `; document.head.append(style);
  }

  function mount(container, solvedInputs, rootResult) {
    addStyle();
    let sequence = [{input: {...solvedInputs}, result: rootResult, steps: [], prior: [], invested: 0}];
    let cursor = 0, worker = null, note = '', choice = '', active = true, candidates = [], ranges;
    let stack = rootResult.stack ?? Math.max(rootResult.bet, Number(solvedInputs.stack) || 100);
    let size = Number(solvedInputs.size);
    let generation = 0;
    const here = () => sequence[cursor];
    const push = frame => { sequence = sequence.slice(0, cursor + 1);sequence.push(frame);cursor++;choice='';note=''; };
    const button = (key, label, disabled = false) => '<button type="button" class="button compact" data-line="' + key + '"' + (disabled?' disabled':'') + '>' + label + '</button>';

    function pending(stopNote) {
      worker?.terminate();
      worker = null;
      generation++;
      note = stopNote || '';
    }

    function lineText(board, steps) {
      return '<b>' + streetName(board.length) + '</b>' + steps.map(step => '<span>' + step.actor + ' ' +
        step.label.toLowerCase() + '</span>').join(' · ');
    }

    function render() {
      const frame = here(), {result, steps} = frame;
      const board = result.board, nodes = tree(result), dest = transition(nodes,steps);
      const info=nodes[dest.node], paid=info?.contributions ?? dest.contributions;
      const folded=dest.terminal==='fold';
      const pot=result.pot + (folded ? 2*Math.min(...paid) : paid[0]+paid[1]);
      const remaining = Math.max(0, stack - frame.invested - Math.min(...paid));
      const history = frame.prior.map(p => lineText(p.board,p.steps)).concat(lineText(board,steps));
      const boardHTML = board.map(c=>'<span class="rl-card" style="color:'+color(c)+'">'+shown(c)+'</span>').join('');
      let body = '';
      ranges = null;candidates = [];
      if (info) {
        body = '<h3>' + info.label + '</h3><div class="rl-actions">' +
          info.actions.map((label,i)=>'<button type="button" class="button" data-action="'+i+'"'+(info.frequencies[i]<=1e-12||!info.reach?' disabled':'')+'>'+label+
            ' <strong>'+pct(info.frequencies[i])+'</strong></button>').join('')+'</div>';
      } else if (folded) {
        const folder = steps[steps.length-1].actor;
        body = '<h3>Hand complete</h3><p>'+(folder==='IP'?'OOP':'IP')+' wins the '+fmt(pot)+' bb pot. Any uncalled chips return to the bettor.</p>';
      } else if (board.length===5 || remaining<1e-9) {
        body = '<h3>'+(board.length===5?'Showdown':'All-in showdown')+'</h3><p>Betting is complete. The final pot is '+fmt(pot)+' bb.</p>';
      } else {
        const next = streetName(board.length+1).toLowerCase();
        ranges=conditionalRanges(result,steps);
        candidates=availableCards(ranges,board);
        if (!candidates.some(([card])=>card===choice)) choice=candidates[0]?.[0] || '';
        body='<h3>Choose the '+next+'</h3><p>'+ranges[0].size.toLocaleString()+' OOP and '+ranges[1].size.toLocaleString()+' IP combinations retain weight after this line. '+fmt(remaining)+' bb remains behind.</p>';
        if (!worker && candidates.length) {
          body += '<div class="rl-controls"><label>Card<select data-line-input="card">'+candidates.map(([card])=>'<option value="'+card+'"'+(card===choice?' selected':'')+'>'+shown(card)+'</option>').join('')+
            '</select></label><label>Bet size<input type="number" data-line-input="size" value="'+size+'" min="0.01" max="1000" step="any"> % pot</label></div><div class="rl-controls">'+
            button('solve','Solve '+next)+button('deal','Deal and solve')+'</div>';
        } else if(!worker) body += '<p>No board card has compatible private hands on this branch.</p>';
      }
      if (worker) body += '<div>'+button('cancel','Cancel solve')+'</div>';
      container.innerHTML='<section class="rl-line"><div class="rl-head"><h2>Line explorer</h2><div class="rl-nav">'+button('back','Back',cursor===0||!!worker)+
        button('forward','Next step',cursor>=sequence.length-1||!!worker)+button('replay','Replay line',cursor===0||!!worker)+'</div></div>'+
        '<div class="rl-trace" aria-label="Selected line">'+history.join('<span aria-hidden="true"> / </span>')+'</div>'+
        '<div class="rl-stage"><div class="rl-head"><div class="rl-board">'+boardHTML+'</div><strong>'+fmt(pot)+' bb pot</strong></div>'+
        body+'<p data-line-status class="rl-em" role="status"></p></div>'+
        '<details><summary>Line settings and model</summary><div class="rl-controls"><label>Starting effective stack behind <input data-line-input="stack" type="number" min="'+rootResult.bet+'" max="100000" step="any" value="'+stack+'"'+
        (sequence.length>1||rootResult.treeNodes?' disabled':'')+'> bb</label></div><p>Each next street re-solves with action-weighted ranges, a new pot, and bets capped at the remaining stack. Earlier streets assume a checkdown after their betting round. New streets use unlocked strategies and zero rake.</p></details></section>';
      container.querySelector('[data-line-status]').textContent = note;
    }

    function startNext(randomDeal) {
      const frame = here(), {result,steps}=frame;
      const dest=transition(tree(result),steps);
      if (worker || !candidates.length || dest.terminal!=='showdown') return;
      const value = container.querySelector('[data-line-input="size"]');
      if (!value.reportValidity() || !value.value || !(Number(value.value)>0)) return;
      size = Number(value.value);
      const card = randomDeal ? pickWeighted(candidates) : choice;
      const spent=frame.invested+dest.contributions[0];
      const pot=result.pot+dest.contributions[0]+dest.contributions[1];
      const effectiveSize=Math.min(size,100*(stack-spent)/pot);
      const input={...frame.input, board:[...result.board,card].join(' '),pot,size:effectiveSize,stack:stack-spent,lock:null,
        oop:notation(ranges[0]),ip:notation(ranges[1])};
      if (!input.oop || !input.ip) return;
      pending();
      const job=generation;
      try {
        worker = new Worker('./postflop-worker.js');
        worker.onmessage=({data})=>{
          if (!active || job!==generation) return;
          if (data.error) {pending(data.error);render();return;}
          if (data.result) {
            pending();
            push({input,result:data.result,steps:[],prior:[...frame.prior,{board:result.board,bet:result.bet,steps}],invested:spent});
            render();return;
          }
          if (data.progress) {note=data.progress;container.querySelector('[data-line-status]').textContent=note;}
        };
        worker.onerror=()=>{if(active&&job===generation){pending('The local solver could not complete this street.');render();}};
        worker.postMessage(input);
        note='Solving '+streetName(result.board.length+1).toLowerCase()+' on '+shown(card)+'…';
      } catch {pending('The local solver could not start.');}
      render();
    }

    const click = e => {
      const b=e.target.closest('button');if(!b||!container.contains(b))return;
      if(b.dataset.action){
        const frame=here(), nodes=tree(frame.result), node=transition(nodes,frame.steps).node;
        if(node===undefined||worker)return;
        const action=Number(b.dataset.action), info=nodes[node];
        if(!info.actions[action] || info.frequencies[action]<=1e-12 || !info.reach)return;
        const stackInput=container.querySelector('[data-line-input="stack"]');
        if(!stackInput.disabled && (!stackInput.reportValidity() || !stackInput.value))return;
        if(!stackInput.disabled)stack=Number(stackInput.value);
        push({...frame,steps:[...frame.steps,{node,action,label:info.actions[action],actor:info.player?'IP':'OOP'}]});render();return;
      }
      const action=b.dataset.line;
      if(action==='solve'||action==='deal'){startNext(action==='deal');return;}
      if(action==='cancel'){pending('Street solve canceled.');render();return;}
      if(worker)return;
      if(action==='back'&&cursor>0)cursor--;
      else if(action==='forward'&&cursor<sequence.length-1)cursor++;
      else if(action==='replay')cursor=0;
      else return;
      note='';choice='';render();
    };
    const change=e=>{
      const key=e.target.dataset.lineInput;
      if(key==='card')choice=e.target.value;
      if(key==='size'&&e.target.value&&e.target.validity.valid)size=Number(e.target.value);
      if(key==='stack'&&e.target.value&&e.target.validity.valid)stack=Number(e.target.value);
    };
    container.addEventListener('click',click);container.addEventListener('change',change);render();
    return ()=>{active=false;pending();sequence=[];container.removeEventListener('click',click);container.removeEventListener('change',change);};
  }
  globalThis.RangeLine = {mount};
})();
