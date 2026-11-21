'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const dist = join(__dirname, '..', 'rangelab', 'dist');
require(join(dist, 'engine.js'));
require(join(dist, 'tournament.js'));

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
}

// Run the unmodified browser worker with its real imported scripts and force
// the deterministic CPU backend. No DOM, GPU hardware, or server is needed.
class LocalWorker {
  constructor() {
    const ctx = vm.createContext({ navigator: {}, console, performance, setTimeout, clearTimeout });
    ctx.self = ctx;
    ctx.postMessage = data => queueMicrotask(() => {
      if (!this.terminated) this.onmessage({ data });
    });
    ctx.importScripts = (...files) => files.forEach(file => {
      vm.runInContext(readFileSync(join(dist, file), 'utf8'), ctx, { filename: file });
    });
    vm.runInContext(readFileSync(join(dist, 'postflop-worker.js'), 'utf8'), ctx);
    this.dispatch = data => ctx.onmessage({ data });
  }
  postMessage(data) { this.dispatch(data); }
  terminate() { this.terminated = true; }
}

function solveBoard(input) {
  return new Promise((resolve, reject) => {
    const worker = new LocalWorker();
    worker.onmessage = ({ data }) => {
      if (data.error) reject(new Error(data.error));
      if (data.result) resolve(data.result);
    };
    worker.postMessage(input);
  });
}

const game = {
  board: 'As 8d 4c', pot: 6, size: 50, quality: 'fast', lock: null,
  oop: 'AA,TT,99,44,54s', ip: 'AKs,AKo,AQs,KK,77,32s'
};

const weighted = (rows, key) => rows.reduce((sum, h) => sum + h.combos * h[key] / 1326, 0);

test('class enumeration, compatible deals and sampled equity include pair and suit blockers', () => {
  const { n, names, matchups, equity, ties } = RangeEngine.matchupStats();
  const spot = RangeEngine.solve();
  assert.equal(n, 169);
  assert.equal(Object.values(spot.hands).reduce((sum, h) => sum + h.combos, 0), 1326);
  assert.equal(spot.hands.QQ.combos, 6);
  assert.equal(spot.hands.AQs.combos, 4);
  assert.equal(spot.hands.AQo.combos, 12);
  const aa = names.indexOf('AA'), kk = names.indexOf('KK');
  close(matchups[aa*n+aa] * 1225, 1);
  close(matchups[aa*n+kk] * 1225, 6);
  assert.ok(equity[aa*n+kk] > .79 && equity[aa*n+kk] < .84);
  assert.ok(ties[aa*n+aa] > .90 && ties[aa*n+aa] < 1);
  for (let i = 0; i < n; i++) {
    close(matchups.slice(i*n, (i+1)*n).reduce((s,p) => s+p, 0), 1);
    for (let j = 0; j < n; j++) {
      const k=i*n+j, rev=j*n+i;
      close(equity[k] + equity[rev], 1);
      close(ties[k], ties[rev]);
      assert.ok(equity[k] >= ties[k]/2 - 1e-5 && 1-equity[k] >= ties[k]/2 - 1e-5);
    }
  }
  const random = Object.fromEntries(names.map(name => [name, 1]));
  const both = RangeEngine.compareRanges(random, random);
  close(both.equity[0], 50, 1e-4);
  close(both.deals, 1326*1225, .1);
  assert.equal(RangeEngine.compareRanges({}, random).equity[0], null);
});

test('preflop mixes, EV, aggregate frequencies and node locks stay consistent', () => {
  for (const config of [{}, {hero:'CO',villain:'none'}, {model:'pushfold',hero:'SB',stack:10}, {model:'pushfold',hero:'BB',stack:10}]) {
    const spot=RangeEngine.solve(config);
    for (const [key, value] of Object.entries(spot.totals)) {
      const expected=Object.values(spot.hands).reduce((sum,h)=>sum+h.frequencies[key]*h.combos/1326,0);
      close(value, expected, .0051);
    }
    for (const h of Object.values(spot.hands)) {
      close(Object.values(h.frequencies).reduce((s,v)=>s+v,0),100);
      assert.equal(h.ev.fold, 0);
      for (const action of spot.actions) assert.ok(Number.isFinite(h.ev[action.key]));
    }
    if (config.model === 'pushfold') assert.ok(spot.nashGap < .001);
  }
  const locked=RangeEngine.solve({model:'pushfold',hero:'BB',stack:10,locks:{BB:{AA:.25}}});
  assert.equal(locked.hands.AA.frequencies.call, 25);
  const cash=RangeEngine.solve();
  const rfi=RangeEngine.solve({hero:'HJ',villain:'none'});
  assert.ok(cash.hands.AQs.frequencies.call > 0 && cash.hands.AQs.frequencies.raise > 0);
  assert.equal(rfi.hands.AA.ev.call, null);
});

test('winner-take-all blind confrontation recovers chip-EV strategies', () => {
  const result=RangeTournament.solve({sb:10,bb:10,others:[3,13],prizes:[100]});
  close(weighted(result.rows,'jam'),weighted(result.rows,'chipJam'),.15);
  close(weighted(result.rows,'call'),weighted(result.rows,'chipCall'),.15);
  close(result.values[0],100*10/36);
  assert.ok(result.gap < .001);
});

test('ICM payouts conserve prize equity, change bubble calls, and preserve flat-payout indifference', () => {
  const bubble=RangeTournament.solve({sb:10,bb:10,others:[3,13],prizes:[50,30,20]});
  close(bubble.values.reduce((s,v)=>s+v,0),100);
  close(bubble.values[0],bubble.values[1]);
  assert.ok(weighted(bubble.rows,'call') < weighted(bubble.rows,'chipCall') - 10);
  assert.ok(bubble.rows.find(h=>h.name==='AQs').callEV < 0);
  const flat=RangeTournament.solve({sb:10,bb:10,others:[3,13],prizes:[1,1,1,1]});
  for(const v of flat.values)close(v,25);
  for(const row of flat.rows) {
    close(row.jamEV,0);close(row.callEV,0);close(row.jam,50);close(row.call,50);
  }
});

test('river showdown pays a locked caller correctly and rejects duplicate cards', async () => {
  const input={...game, board:'Ac Ad Ah 7s 2c',oop:'As3s',ip:'KdQd',lock:100};
  const result=await solveBoard(input);
  assert.equal(result.runs,1);
  close(result.nodes[2].frequency,1);
  close(result.nodes[2].rows[0].evA,-3);
  close(result.nodes[0].rows[0].evA,9);
  assert.ok(result.nodes[0].frequency>.999);
  await assert.rejects(solveBoard({...input,board:'Ac Ac Ah 7s 2c'}),/once/);
  await assert.rejects(solveBoard({...input,oop:'As3s',ip:'AsKd'}),/legal matchups/);
});

test('advanced betting tree caps raises and returns coherent legal transitions for each node', async () => {
  const result=await solveBoard({...game, board:'As 8d 4c 7c 2h',tree:'advanced',stack:7,secondSize:100,raiseFactor:3});
  const nodes=result.treeNodes;
  assert.ok(nodes.length>4);
  assert.equal(nodes[0].actions.length,3);
  for(const node of nodes) {
    assert.equal(node.actions.length,node.children.length);
    if(node.reach>0)close(node.frequencies.reduce((s,v)=>s+v,0),1);
    for(const child of node.children) {
      const paid=nodes[child.node]?.contributions ?? child.contributions;
      assert.ok(paid.every(v=>v>=0 && v<=7));
      if(child.terminal==='showdown')close(paid[0],paid[1]);
    }
    for(const row of node.rows) {
      assert.ok(row.weight>0 && row.weight<=1);
      close(row.frequencies.reduce((s,v)=>s+v,0),1);
    }
  }
  assert.ok(nodes.some(node=>node.actions.includes('Raise to 7 bb')));
  assert.ok(result.gap>=0 && result.gap<.2);
});

// Drive the UI boundary without coupling poker tests to a browser package.
// Inputs and buttons are the only DOM operations the line component needs.
function mountLine(input, result) {
  let completed, lastInput;
  class RecordedWorker extends LocalWorker {
    postMessage(request) { lastInput=request;super.postMessage(request); }
  }
  const document={querySelector:()=>({})};
  const context=vm.createContext({document, Worker:RecordedWorker, console});
  vm.runInContext(readFileSync(join(dist,'line-explorer.js'),'utf8'),context);
  const listeners={};
  const control={value:'50',reportValidity:()=>true};
  const host={
    html:'',contains:()=>true,addEventListener:(name,listener)=>{listeners[name]=listener;},
    removeEventListener(){},querySelector(selector){
      return selector.includes('stack') ? {...control,disabled:true,value:String(input.stack||100)}
        : selector.includes('size') ? control : {};
    },
    set innerHTML(html){this.html=html;if(completed && lastInput && !html.includes('Cancel solve'))completed();},
    get innerHTML(){return this.html;}
  };
  const close=context.RangeLine.mount(host,input,result);
  function click(dataset){listeners.click({target:{closest:()=>({dataset})}});}
  return {
    close,host,control,
    act(index){click({action:String(index)});},
    navigate(name){click({line:name});},
    async nextStreet(){
      lastInput=null;
      const ready=new Promise(resolve=>{completed=resolve;});
      click({line:'deal'});await ready;completed=null;return lastInput;
    }
  };
}

test('multi-street explorer carries weighted ranges, matched bets, and the replayable branch', {timeout:10000}, async () => {
  const result=await solveBoard(game);
  const line=mountLine(game,result);
  line.act(0);line.act(0); // OOP bets three and IP calls.
  assert.match(line.host.innerHTML,/12 bb pot/);
  const turn=await line.nextStreet();
  assert.equal(turn.pot,12);
  assert.equal(turn.board.split(' ').length,4);
  assert.ok(turn.oop.includes(':') && turn.ip.includes(':'));
  line.act(1);line.act(1); // Check/check.
  const river=await line.nextStreet();
  assert.equal(river.pot,12);
  assert.equal(new Set(river.board.split(' ')).size,5);
  line.act(0);line.act(0);
  assert.match(line.host.innerHTML,/24 bb pot/);
  assert.match(line.host.innerHTML,/Showdown/);
  line.navigate('back');line.navigate('forward');
  assert.match(line.host.innerHTML,/Showdown/);
  line.navigate('replay');line.navigate('forward');line.act(1);
  assert.match(line.host.innerHTML,/wins the 6 bb pot/);
  line.close();
});

test('advanced line updates pot and remaining stacks after a raise and call', {timeout:10000}, async () => {
  const input={...game,tree:'advanced',stack:30,secondSize:100,raiseFactor:3};
  const result=await solveBoard(input), nodes=result.treeNodes;
  const line=mountLine(input,result);
  const bet=nodes[0].actions.indexOf('Bet 3 bb');
  line.act(bet);
  const facing=nodes[nodes[0].children[bet].node];
  const raise=facing.actions.indexOf('Raise to 9 bb');line.act(raise);
  const reply=nodes[facing.children[raise].node];
  line.act(reply.actions.indexOf('Call'));
  assert.match(line.host.innerHTML,/24 bb pot/);
  const turn=await line.nextStreet();
  assert.equal(turn.pot,24);assert.equal(turn.stack,21);assert.equal(turn.tree,'advanced');
  assert.match(line.host.innerHTML,/OOP · First to act/);
  line.close();
});
