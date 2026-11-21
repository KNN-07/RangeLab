
(() => {
  'use strict';

  const tabs = {breakdown: 'Range breakdown', compare: 'Range comparison', flop: 'Flop reports'};
  const families = {all: 'All hands', pair: 'Pocket pairs', suited: 'Suited hands', offsuit: 'Offsuit hands'};
  const defaultBoards = 'As 8d 4c\nKh Qh 7s\n9c 8c 7d\n6h 6s 2d\nJd 5d 2d\nAh Kc Td';
  const format = (v, places = 1) => Number(v).toLocaleString('en-US', {minimumFractionDigits: places, maximumFractionDigits: places});
  const percent = v => format(v) + '%';
  const bb = v => (v > 0 ? '+' : '') + format(v, 2);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const group = h => h.name.length === 2 ? 'pair' : h.name.endsWith('s') ? 'suited' : 'offsuit';
  const policyEV = h => Object.entries(h.ev).reduce((total, [key, v]) => total + (v ?? 0) * h.frequencies[key] / 100, 0);
  const rangeText = weights => Object.entries(weights).filter(([, w]) => w > 0).map(([name, w]) => w === 1 ? name : name + ':' + Number((w * 100).toFixed(2)) + '%').join(',');
  const colors = {raise: 'var(--raise)', call: 'var(--call)', fold: 'var(--fold)'};

  function weightsFor(solution, key) {
    return Object.fromEntries(Object.values(solution.hands).map(h => [h.name, (key === 'continue' ? 100 - h.frequencies.fold : h.frequencies[key]) / 100]));
  }

  function comparedSpot(config) {
    if (config.model === 'pushfold') return RangeEngine.solve({...config, hero: config.villain});
    if (config.villain === 'none') return RangeEngine.solve({...config, hero: 'BB', villain: config.hero});
    return RangeEngine.solve({...config, hero: config.villain, villain: 'none'});
  }

  function options(solution) {
    const list = solution.actions.filter(a => a.key !== 'fold').map(a => [a.key, a.label]);
    if (list.length > 1) list.unshift(['continue', 'Raise or call']);
    return [...list, ['fold', 'Fold']];
  }

  function groupStats(list, actions) {
    const combos = list.reduce((sum, h) => sum + h.combos, 0);
    const denom = combos || 1;
    return {
      combos,
      ev: list.reduce((sum, h) => sum + policyEV(h) * h.combos, 0) / denom,
      equity: list.reduce((sum, h) => sum + h.equity * h.combos, 0) / denom,
      mix: Object.fromEntries(actions.map(a => [a.key, list.reduce((sum, h) => sum + h.combos * h.frequencies[a.key], 0) / denom]))
    };
  }

  function download(filename, content, mime = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], {type: mime}));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function select(name, label, choices, selected) {
    return '<label class="rr-select"><span>' + escape(label) + '</span><select data-control="' + name + '">' +
      choices.map(([key, value]) => '<option value="' + escape(key) + '"' + (key === selected ? ' selected' : '') + '>' + escape(value) + '</option>').join('') +
      '</select></label>';
  }

  function bar(mix, actions) {
    return '<div class="rr-bar" aria-hidden="true">' + actions.map(a => '<i style="background:' + colors[a.key] + ';width:' + mix[a.key] + '%"></i>').join('') + '</div>';
  }

  function ensureStyles() {
    if (document.getElementById('range-report-styles')) return;
    const el = document.createElement('style');
    el.id = 'range-report-styles';
    el.textContent = `
      .rr { display:grid; gap:16px; } .rr-top,.rr-row,.rr-actions { display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap; }
      .rr-top .segments { max-width:100%; flex-wrap:wrap; } .rr-top .segments button { padding:7px 12px; }
      .rr .panel-pad { display:grid;gap:16px;min-width:0; } .rr p { color:var(--muted);font-size:14px;line-height:1.55; }
      .rr-select { display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted); }
      .rr select { max-width:100%;font-size:14px; } .rr-actions { justify-content:flex-start;gap:8px; }
      .rr-kpis { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px; }
      .rr-kpis>div { padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px; }
      .rr small {font-size:12px;color:var(--muted);} .rr-kpis strong {display:block;margin-top:4px;font:600 24px var(--mono);}
      .rr-scroll { overflow-x:auto; } .rr table { border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums; }
      .rr th,.rr td { padding:11px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border); }
      .rr th { font-weight:500;font-size:12px;color:var(--muted); } .rr th:first-child,.rr td:first-child {padding-left:0;text-align:left;}
      .rr tbody tr:last-child td {border-bottom:0;} .rr td button.rr-link {background:none;border:0;color:var(--mint);font-family:var(--mono);padding:2px 0; }
      .rr-bar {display:flex;width:100%;min-width:65px;height:8px;overflow:hidden;border-radius:3px;background:#26303b;} .rr-bar i {display:block;height:100%;}
      .rr-panes { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px; } .rr-matrix { display:grid;grid-template-columns:repeat(13,minmax(0,1fr));gap:2px; }
      .rr-cell {border:0;border-radius:2px;padding:0;aspect-ratio:1.45;min-width:0;font:600 clamp(9px,.85vw,14px) var(--mono);}
      .rr-cell:hover {outline:1px solid white;} .rr-result-bar {height:18px;border-radius:4px;overflow:hidden;display:flex;} .rr-result-bar span {height:100%;}
      .rr textarea {display:block;min-height:135px;width:100%;font:14px/1.5 var(--mono);padding:10px;resize:vertical;}
      .rr .rr-form {display:grid;grid-template-columns:minmax(200px,1fr) minmax(190px,1.5fr);gap:20px;align-items:start;}
      .rr .rr-form>div {display:grid;gap:12px;} .rr .rr-form label {display:grid;gap:7px;font-size:14px;}
      .rr .rr-status {font-size:13px;color:var(--mint);} .rr input[type=text] {padding:7px 10px;max-width:135px;font-size:14px;}
      @media(max-width:850px){.rr-panes{grid-template-columns:1fr;}.rr-cell{aspect-ratio:1.7;font-size:clamp(10px,1.8vw,14px);}}
      @media(max-width:580px){.rr .panel-pad{padding:14px;}.rr .rr-form{grid-template-columns:1fr;}.rr-kpis{gap:5px}.rr-kpis>div{padding:10px}.rr-kpis strong{font-size:18px}.rr-top .segments button{padding:6px 7px}.rr th,.rr td{padding:8px 7px;}}
    `;
    document.head.append(el);
  }

  const mounted = new WeakMap();
  function mount(container, {solution, config, onStudy}) {
    ensureStyles();
    mounted.get(container)?.();
    config = solution.config;
    const other = comparedSpot(config);
    const all = Object.values(solution.hands);
    const heroOpts = options(solution);
    const otherOpts = options(other);
    const state = {
      tab: 'breakdown', group: 'all', sort: 'ev', page: 0, query: '', heroKey: heroOpts[0][0],
      otherKey: otherOpts[0][0], boards: defaultBoards, size: '50', flops: [], running: false, status: ''
    };
    let worker = null;
    let active = true;
    const filtered = () => all.filter(h => (state.group === 'all' || group(h) === state.group) && h.name.toLowerCase().includes(state.query.toLowerCase()));
    const title = '<strong>' + config.hero + '</strong>' + (config.villain === 'none' ? ' opening range' : ' facing ' + config.villain + (config.model === 'pushfold' ? ' · shove/fold' : ' · ' + config.openSize + ' bb open'));
    const wrap = (title, contents) => '<section class="panel panel-pad">' + title + contents + '</section>';
    const heading = t => '<h2>' + t + '</h2>';
    const btn = (action, label, classes = '') => '<button class="button ' + classes + '" data-act="' + action + '">' + label + '</button>';
    const outputPct = v => v === null ? '—' : percent(v);

    function handList() {
      const rows = filtered();
      rows.sort((a,b) => state.sort === 'rank' ? a.row - b.row || a.col - b.col
        : state.sort === 'equity' ? b.equity - a.equity : policyEV(b) - policyEV(a));
      const end = Math.max(0, Math.ceil(rows.length / 12) - 1);
      state.page = Math.min(state.page, end);
      const table = '<div class="rr-scroll"><table><thead><tr><th>Hand</th><th>Combos</th><th>Equity</th>' +
        solution.actions.map(a => '<th>' + a.label + '</th>').join('') + '<th>Strategy EV</th></tr></thead><tbody>' +
        rows.slice(state.page*12, state.page*12+12).map(h => '<tr><td><button type="button" class="rr-link" data-hand="' + h.name +
          '" data-side="hero">' + h.name + '</button></td><td>' + h.combos + '</td><td>' + percent(h.equity) + '</td>' +
          solution.actions.map(a => '<td>' + percent(h.frequencies[a.key]) + '</td>').join('') + '<td>' + bb(policyEV(h)) + ' bb</td></tr>').join('') +
        '</tbody></table></div>';
      return rows.length ? table + '<div class="rr-row"><small>' + (state.page*12+1) + '–' + Math.min(rows.length,state.page*12+12) +
        ' of ' + rows.length + ' hands</small><div class="rr-actions"><button class="button compact" data-act="prev" ' +
        (!state.page ? 'disabled' : '') + '>Previous</button><button class="button compact" data-act="next" ' + (state.page >= end ? 'disabled' : '') + '>Next</button></div></div>'
        : '<p>No hands match this filter.</p>';
    }

    function breakdown() {
      const selected = all.filter(h => state.group === 'all' || state.group === group(h));
      const stats = groupStats(selected, solution.actions);
      const summary = '<div class="rr-row">' + heading('Preflop strategy') + select('group','Hand type',Object.entries(families),state.group) + '</div>' +
        '<p>' + title + ' · ' + config.stack + ' bb effective · ' + escape(solution.modelLabel) + '</p>' +
        '<div class="rr-kpis"><div><small>Combinations</small><strong>' + format(stats.combos,0) + '</strong></div><div><small>Hand classes</small><strong>' +
        selected.length + '</strong></div><div><small>Mean strategy EV</small><strong>' + bb(stats.ev) + ' <small>bb</small></strong></div></div>' +
        '<div class="rr-scroll"><table><thead><tr><th>Group</th><th>Action mix</th>' + solution.actions.map(a=>'<th>' + a.label + '</th>').join('') +
        '<th>Mean EV</th></tr></thead><tbody>' + Object.entries(families).filter(([key])=> state.group==='all' || key===state.group).map(([key, name]) => {
          const v = groupStats(key==='all' ? all : all.filter(h=>group(h)===key),solution.actions);
          return '<tr><td>' + name + '</td><td>' + bar(v.mix,solution.actions) + '</td>' + solution.actions.map(a=>'<td>' + percent(v.mix[a.key]) + '</td>').join('') +
            '<td>' + bb(v.ev) + ' bb</td></tr>';
        }).join('') + '</tbody></table></div><p>Frequencies use combination counts within each group. Strategy EV averages the value of each action at its played frequency, measured from the decision. Folding earns 0 bb.</p>';
      return wrap('',summary) + wrap('', '<div class="rr-row">' + heading('Hand detail') +
        '<div class="rr-actions"><input type="text" data-search placeholder="Find a hand" aria-label="Find a hand" value="' + escape(state.query) + '">' +
        select('sort','Sort',[['ev','Strategy EV'],['equity','Equity'],['rank','Matrix order']], state.sort) +
        btn('csv','Export CSV','compact') + '</div></div><div data-hand-list>' + handList() + '</div>');
    }

    function compare() {
      const ranges = [weightsFor(solution,state.heroKey), weightsFor(other,state.otherKey)];
      const result = RangeEngine.compareRanges(ranges[0],ranges[1]);
      const panels = [solution,other].map((s,i) => {
        const side = i ? 'other' : 'hero', choices = i ? otherOpts : heroOpts, key = i ? state.otherKey : state.heroKey;
        const range = ranges[i], combos = Object.values(s.hands).reduce((sum,h) => sum + h.combos * range[h.name], 0);
        const color = i ? '#efaa82' : '#83e0b9';
        const mesh = s.matrix.flat().map(h => {
          const w = range[h.name];
          return '<button class="rr-cell" data-side="' + side + '" data-hand="' + h.name + '" style="background:color-mix(in srgb,' + color + ' ' + (w*100).toFixed(1) +
            '%,#242b35);color:' + (w > .45 ? '#10211b' : '#c1cdd6') + '" title="' + h.name + ' · ' + percent(w*100) + '">' + h.name + '</button>';
        }).join('');
        return wrap('', '<div class="rr-row">' + heading(s.config.hero + ' range') + select(side+'Key','Action',choices,key) + '</div><div class="rr-matrix">' + mesh +
          '</div><div class="rr-row"><small>' + format(combos) + ' weighted combos · ' + percent(combos / 1326 * 100) +
          ' of hands</small>' + btn('txt-'+side,'Export range','compact') + '</div>');
      }).join('');
      const ea=result.equity[0];
      return wrap('',heading('Head-to-head equity') + '<div class="rr-row"><strong>' + config.hero + ' · ' + outputPct(ea) + '</strong><strong>' +
        other.config.hero + ' · ' + outputPct(result.equity[1]) + '</strong></div><div class="rr-result-bar"><span style="width:'+(ea??0)+
        '%;background:#83e0b9"></span><span style="width:'+(result.equity[1]??0)+'%;background:#efaa82"></span></div><p>' +
        (ea === null ? 'These ranges have no compatible deals.' : 'Showdown equity weights disjoint deals by both range frequencies and splits ties equally. Darker matrix cells enter the selected range less often.') +
        '</p>') + '<div class="rr-panes">' + panels + '</div>';
    }

    function postflopSetup() {
      const opener = config.villain === 'none' ? solution : other;
      const defender = config.villain === 'none' ? other : solution;
      if (config.model === 'pushfold' || config.openSize >= config.stack || !defender.actions.some(a=>a.key==='call')) return null;
      const order = ['SB','BB','UTG','HJ','CO','BTN'];
      const openerIP = order.indexOf(opener.config.hero)>order.indexOf(defender.config.hero);
      const open = rangeText(weightsFor(opener,'raise')), call = rangeText(weightsFor(defender,'call'));
      const players = [opener.config.hero,defender.config.hero];
      const pot = config.openSize*2 + (players.includes('BB')?0:1) + (players.includes('SB')?0:.5);
      return {oop:openerIP?call:open, ip:openerIP?open:call, pot, players:openerIP?players.reverse():players};
    }

    function flop() {
      const setup=postflopSetup();
      if (!setup) return wrap('', heading('Flop reports') + '<p>This spot ends preflop when the all-in is called. Choose a cash-game spot with chips behind to compare flops.</p>' + btn('cash','Study a cash spot','compact'));
      const results=state.flops.map(r=>'<tr><td class="mono">' + escape(r.board.join(' ')) + '</td><td>' + percent(r.nodes[0].frequency*100) +
        '</td><td>' + (r.nodes[1].reach>0?percent(r.nodes[1].frequency*100):'—') + '</td><td>' + (r.nodes[2].reach>0?percent(r.nodes[2].frequency*100):'—') +
        '</td><td>' + bb(r.nodes[0].ev) + ' bb</td><td>' + format(r.gap,3) + ' bb</td></tr>').join('');
      return wrap('',heading('Compare flops')+'<p>'+setup.players[0]+' plays out of position against '+setup.players[1]+' after a single raise and call. Each board uses the spot’s weighted ranges, a '+format(setup.pot)+' bb pot, and one bet per line before showdown.</p>'+
        '<div class="rr-form"><label>Flops, one per line<textarea data-control="boards" '+(state.running?'disabled':'')+'>'+escape(state.boards)+'</textarea></label><div>' +
        select('size','Bet size',[['25','25% pot'],['33','33% pot'],['50','50% pot'],['75','75% pot'],['100','100% pot']],state.size) +
        '<p>Enter up to 12 flops. Each fast solve runs 100 CFR+ iterations with 16 sampled runouts per private matchup.</p><div class="rr-actions">' +
        (state.running?btn('cancel','Stop report'):btn('run','Run report','primary'))+'</div></div></div><div class="rr-status" role="status">'+escape(state.status)+'</div>') +
        (results ? wrap('', '<div class="rr-row">'+heading('Board results')+btn('boards-csv','Export CSV','compact')+'</div><div class="rr-scroll"><table><thead><tr><th>Board</th><th>OOP bet</th><th>IP bet vs check</th><th>IP call vs bet</th><th>OOP EV</th><th>Nash gap</th></tr></thead><tbody>'+results+'</tbody></table></div><p>Action frequencies are conditional on reaching each node. OOP EV includes the starting pot won. The Nash gap measures both players’ best-response improvements within this sampled tree.</p>') : '');
    }

    function render() {
      container.innerHTML='<div class="rr"><div class="rr-top"><div class="segments" aria-label="Report type">'+Object.entries(tabs).map(([key,label])=>
        '<button data-tab="'+key+'" aria-pressed="'+(state.tab===key)+'">'+label+'</button>').join('')+'</div></div>' +
        (state.tab==='breakdown'?breakdown():state.tab==='compare'?compare():flop())+'</div>';
      if(state.running) container.querySelector('[data-control="size"]')?.setAttribute('disabled','');
    }

    function stop(message) {
      worker?.terminate(); worker=null; state.running=false; state.status=message;
    }

    function runReport() {
      const setup=postflopSetup();
      const boards=state.boards.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if(!setup) return;
      if(!boards.length || boards.length>12) {state.status='Enter between 1 and 12 flops.';render();return;}
      for(const b of boards){
        const compact=b.replace(/[\s,]+/g,'').toLowerCase();
        if(!/^(?:[2-9tjqka][cdhs]){3}$/.test(compact) || new Set(compact.match(/../g)).size!==3){
          state.status='Enter three distinct cards per flop. Check '+b+'.';render();return;
        }
      }
      const maxSize=(config.stack-config.openSize)/setup.pot*100;
      if(Number(state.size)>maxSize){state.status='This bet exceeds the remaining stack. Choose a smaller bet size.';render();return;}
      stop('Starting report…'); state.flops=[]; state.running=true;render();
      const next=()=>{ const board=boards[state.flops.length];worker.postMessage({...setup, board, size:Number(state.size), quality:'fast',lock:null}); };
      try {
        worker=new Worker('./postflop-worker.js');
        worker.onmessage=({data})=>{
          if(!active || !container.isConnected){stop('');return;}
          if(data.error){stop(data.error);render();return;}
          if(data.result){
            state.flops.push(data.result);
            if(state.flops.length===boards.length){stop('Completed '+boards.length+' board'+(boards.length===1?'':'s')+'.');render();}
            else {state.status='Solving board '+(state.flops.length+1)+' of '+boards.length+'…';render();next();}
          }else if(data.progress){state.status='Board '+(state.flops.length+1)+' of '+boards.length+' · '+data.progress; const status=container.querySelector('.rr-status');if(status)status.textContent=state.status;}
        };
        worker.onerror=()=>{stop('The board solver could not start. Open the app from localhost or its installed icon.');render();};
        next();
      } catch {stop('The board solver could not start. Open the app from localhost or its installed icon.');render();}
    }

    const click=e=>{
      const button=e.target.closest('button'); if(!button || !container.contains(button)) return;
      const {act,tab,hand,side}=button.dataset;
      if(tab){if(state.running)stop('Report stopped.');state.tab=tab;render();return;}
      if(hand){onStudy?.(side==='other'?other.config:config,hand);return;}
      if(act==='next'||act==='prev'){state.page+=act==='next'?1:-1;render();}
      if(act==='csv'){
        const headers=['Hand','Combinations','Hand type','Showdown equity (%)',...solution.actions.flatMap(a=>[a.label+' (%)',a.label+' EV (bb)']),'Strategy EV (bb)'];
        const rows=filtered().map(h=>[h.name,h.combos,families[group(h)],h.equity,...solution.actions.flatMap(a=>[h.frequencies[a.key],h.ev[a.key]]),policyEV(h).toFixed(4)]);
        download('rangelab-'+config.hero+'-preflop.csv',[headers,...rows].map(row=>row.join(',')).join('\r\n'),'text/csv;charset=utf-8');
      }
      if(act?.startsWith('txt-')){const hero=act==='txt-hero',s=hero?solution:other,key=hero?state.heroKey:state.otherKey;
        download('rangelab-'+s.config.hero+'-'+key+'.txt',rangeText(weightsFor(s,key)));}
      if(act==='run')runReport();
      if(act==='cancel'){stop('Report stopped. Completed boards are shown below.');render();}
      if(act==='cash'){onStudy?.({...RangeEngine.DEFAULT_CONFIG},'AQs');}
      if(act==='boards-csv'){const rows=state.flops.map(r=>[r.board.join(' '),r.nodes[0].frequency*100,r.nodes[1].reach?r.nodes[1].frequency*100:'',r.nodes[2].reach?r.nodes[2].frequency*100:'',r.nodes[0].ev,r.gap,r.pot,r.bet,r.matches,r.runs,r.iterations]);
        download('rangelab-flop-report.csv',[['Board','OOP bet (%)','IP bet vs check (%)','IP call vs bet (%)','OOP EV (bb)','Nash gap (bb)','Pot (bb)','Bet (bb)','Sampled matchups','Runouts per matchup','Iterations'],...rows].map(row=>row.join(',')).join('\r\n'),'text/csv;charset=utf-8');}
    };
    const change=e=>{
      const key=e.target.dataset.control;
      if(!['group','sort','heroKey','otherKey','boards','size'].includes(key))return;
      state[key]=e.target.value;state.page=0;
      // A textarea commits on blur. Keep the next button in the document so
      // someone editing boards can start the report with a single click.
      if(key==='boards')return;
      if(key==='size'){state.status='';state.flops=[];}
      render();
    };
    const input=e=>{
      if(e.target.matches('[data-search]')){state.query=e.target.value.trim();state.page=0;container.querySelector('[data-hand-list]').innerHTML=handList();}
      if(e.target.dataset.control==='boards'){
        state.boards=e.target.value;
        if(state.flops.length||state.status){
          state.flops=[];state.status='';
          container.querySelector('.rr-status').textContent='';
          container.querySelector('[data-act="boards-csv"]')?.closest('section')?.remove();
        }
      }
    };
    container.addEventListener('click',click);container.addEventListener('change',change);container.addEventListener('input',input);
    function cleanup(){active=false;stop('');container.removeEventListener('click',click);container.removeEventListener('change',change);container.removeEventListener('input',input);}
    mounted.set(container,cleanup);render();return cleanup;
  }
  globalThis.RangeReports={mount};
})();
