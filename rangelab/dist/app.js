(function bootRangeLab() {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const main = $('#main');
  const dialog = $('#dialog');
  const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const positionNames = {UTG:'Under the gun', HJ:'Hijack', CO:'Cutoff', BTN:'Button', SB:'Small blind', BB:'Big blind'};
  const routes = {
    study: ['Study', 'grid'], postflop: ['Solver', 'sliders'], train: ['Trainer', 'target'],
    analyze: ['Analyze', 'activity'], reports: ['Reports', 'chart']
  };
  const paths = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    chart:'<path d="M3 20h18M6 16v-5m5 5V5m5 11v-8"/>',
    sliders:'<path d="M3 6h8m5 0h5M3 12h3m5 0h10M3 18h10m5 0h3"/><circle cx="13.5" cy="6" r="2.5"/><circle cx="8.5" cy="12" r="2.5"/><circle cx="15.5" cy="18" r="2.5"/>',
    bookmark:'<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
    spade:'<path d="M12 2c-2 3-8 6.5-8 11a4.5 4.5 0 0 0 7.3 3.5c0 2-1.4 3.4-2.3 4.5h6c-1-1.1-2.3-2.5-2.3-4.5A4.5 4.5 0 0 0 20 13c0-4.5-6-8-8-11z"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3.5 3.5 0 0 1 0 6m2.5 3a4.5 4.5 0 0 1 2.5 4v2"/>',
    chips:'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v4c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 10v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4M4 14v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4"/>',
    line:'<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 7v10m0-3c0-5 14-1 14-7"/>',
    table:'<rect x="2" y="5" width="20" height="14" rx="7"/><path d="M8 9h8m-8 6h8"/>',
    cards:'<path d="m6 17-2-1.1a1.5 1.5 0 0 1-.7-2L8 4a1.5 1.5 0 0 1 2-.7l2 1"/><rect x="9" y="5" width="11" height="16" rx="2"/><path d="m14.5 10 2 3-2 3-2-3z"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
    cpu:'<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3m-3-3 3 3-3 3M3 18h3c2.5 0 4.5-3 6-6s4-6 6-6h3m-3-3 3 3-3 3"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    play:'<path d="m7 4 13 8-13 8z"/>',
    book:'<path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v15"/>'
  };
  const icon = (name, cls='') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(`rangeLab:${key}`)) ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(`rangeLab:${key}`, JSON.stringify(value)); return true; }
    catch { toast('Browser storage is unavailable. Changes apply for this session.'); return false; }
  };
  const color = key => `var(--${key})`;
  const swatch = key => `<i class="swatch" style="background:${color(key)}"></i>`;
  const pct = n => `${n.toFixed(1)}%`;
  const bb = n => `${Number(n.toFixed(2))} bb`;
  const typeOf = name => name.endsWith('s') ? 'Suited' : name.endsWith('o') ? 'Offsuit' : 'Pairs';
  const describeHand = name => typeOf(name) === 'Pairs' ? 'Pocket pair' : `${typeOf(name)} hand`;
  const route = () => Object.hasOwn(routes,location.hash.slice(1)) ? location.hash.slice(1) : 'study';
  const configDefault = {model:'cash',hero:'BB',villain:'BTN',stack:100,openSize:2.5};
  let solution = RangeEngine.solve(read('spot',configDefault));
  let config = solution.config;
  let selected = read('hand','AQs');
  if (!solution.hands[selected]) selected = 'AQs';
  let filter = 'All hands', metric = 'Strategy';
  let saved = read('saved',[]);
  let history = read('training',[]);
  let drill = null, focus = 'All hands', drillKinds = 'Any decision';
  let device = {available:false, backend:'CPU',reason:'Checking WebGPU availability.'};
  let toastTimer;
  let moduleCleanup = null;
  let pendingPostflop = null;
  let solverMode = 'Postflop';
  function openPostflop(input) {
    solverMode = 'Postflop';
    pendingPostflop = input;
    if (route() === 'postflop') render();
    else location.hash = 'postflop';
  }
  function toast(msg) {
    const element = $('#toast');
    element.textContent = msg;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
  }
  const btn = (id, text, glyph, primary=false) => `<button class="button${primary?' primary':''}" id="${id}">${glyph?icon(glyph):''}${text}</button>`;
  function showDialog(title, contents) {
    if (dialog.open) dialog.close();
    $('#dialog-body').innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${escape(title)}</h2><button class="icon-button" id="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-content">${contents}</div>`;
    dialog.setAttribute('aria-labelledby','dialog-title');
    $('#close-dialog').onclick = () => dialog.close();
    dialog.showModal();
  }
  dialog.addEventListener('click', e => {
    if(e.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if(e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) dialog.close();
  });
  function updateSolution(next, hand=selected) {
    solution = RangeEngine.solve(next);
    config = solution.config;
    selected = solution.hands[hand] ? hand : 'AQs';
    write('spot',config); write('hand',selected);
    drill = null;
  }
  function openStudy(next, hand) {
    updateSolution(next,hand);
    filter = 'All hands';
    if(dialog.open) dialog.close();
    if (route() !== 'study') location.hash = 'study'; else render();
  }
  const shortSpot = () => config.model === 'pushfold'
    ? (config.hero === 'SB' ? 'SB first to act' : 'BB vs SB shove')
    : config.villain === 'none' ? `${config.hero} first to act` : `${config.hero} vs ${config.villain} open`;
  function tags() {
    const items = [['spade','No-limit Hold’em'],['users',config.model === 'cash' ? '6-max cash' : 'Heads-up push/fold'],['chips',`${config.stack} bb effective`]];
    return `<div class="game-tags">${items.map(([glyph,name])=>`<span>${icon(glyph)}${name}</span>`).join('<i></i>')}</div>`;
  }
  function heading(section,title,sub,actions='') {
    return `<div class="breadcrumb"><span>Workspace</span>${icon('chevron')}<span>${section}</span></div><div class="page-head"><div><h1>${title}</h1>${sub}</div>${actions?`<div class="head-actions">${actions}</div>`:''}</div>`;
  }
  function line() {
    const order = config.model === 'cash' ? positions : ['SB','BB'];
    const foldTo = order.slice(0,order.indexOf(config.hero)+1);
    return foldTo.map(pos => {
      if(pos === config.hero) return {pos,status:'Decision',className:'is-hero'};
      if(pos === config.villain) return {pos,status:config.model === 'pushfold' ? `Shove ${bb(config.stack)}` : `Raise ${bb(config.openSize)}`, className:'is-raise'};
      return {pos,status:'Fold', className:''};
    });
  }
  function lineHTML() {
    return `<div class="panel action-line"><span class="line-label">${icon('line')}Action line</span><div class="line-steps">${line().map(s=>`<span class="line-step ${s.className}"><span class="pos">${s.pos}</span><span class="state">${s.status}</span></span>`).join(icon('chevron'))}</div></div>`;
  }
  function potSize() {
    if (config.model === 'pushfold') return config.hero === 'SB' ? 1.5 : config.stack+1;
    if (config.villain === 'none') return 1.5;
    return 1.5+config.openSize-(config.villain==='SB'?.5:0);
  }
  function tableHTML() {
    const loc = [[50,85],[12,66],[16,22],[50,13],[84,22],[88,66]];
    const list = config.model === 'cash' ? positions : ['SB','BB'];
    const steps = line();
    const seats = list.map((pos,i) => {
      const offset = (i-list.indexOf(config.hero)+list.length)%list.length;
      const [x,y] = loc[list.length === 2 ? offset*3 : offset];
      const info = steps.find(s=>s.pos===pos);
      const isHero = pos === config.hero;
      const isVillain = pos === config.villain;
      const status = isHero ? 'Hero' : info?.status === 'Fold' ? 'Folded' : info?.status ?? 'Waiting';
      const dealer = (config.model === 'cash' ? pos==='BTN' : pos==='SB') ? '<i class="dealer">D</i>' : '';
      return `<div class="seat ${isHero?'hero':isVillain?'villain':''}" style="left:${x}%;top:${y}%"><span class="seat-name">${pos}</span>${dealer}<span class="seat-action">${status}</span></div>`;
    }).join('');
    return `<section class="panel table-panel"><div class="panel-head"><div class="heading">${icon('table','title-icon')}<h2>Table view</h2></div><span class="street-tag">Preflop</span></div><div class="table-stage" role="img" aria-label="${shortSpot()}, pot ${bb(potSize())}"><div class="felt"></div><div class="pot">${icon('chips')}<span>Pot ${bb(potSize())}</span></div>${seats}</div><div class="table-foot"><span>Hero position <b>${positionNames[config.hero]}</b></span><span>Stack <b>${bb(config.stack)}</b></span></div></section>`;
  }
  function playingCards(name) {
    const suits = name.endsWith('s') ? ['♠','♠'] : ['♠','♥'];
    return `<span class="cards" aria-label="${name} example suits">${[name[0],name[1]].map((rank,i)=>`<span class="playing-card${suits[i]==='♥'?' red':''}"><b>${rank}</b><i>${suits[i]}</i></span>`).join('')}</span>`;
  }
  function gradient(h) {
    if(metric !== 'Strategy') {
      const ev = Math.max(...Object.values(h.ev).filter(Number.isFinite));
      const q = metric === 'Equity' ? h.equity/100 : Math.min(1,Math.log(1+ev)/Math.log(1+Math.max(.001,...Object.values(solution.hands).map(o=>Math.max(...Object.values(o.ev).filter(Number.isFinite))))));
      const a=[56,68,84], b=[148,225,185];
      return {paint:`rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*q)).join(',')})`, neutral:q<.45};
    }
    let start=0;
    const parts=[];
    for(const {key} of solution.actions) {
      const f=h.frequencies[key];
      if(f<=0) continue;
      parts.push(`${color(key)} ${start}% ${start+f}%`); start+=f;
    }
    return {paint:parts.length===1 ? color(solution.actions.find(a=>h.frequencies[a.key]>0).key) : `linear-gradient(90deg,${parts.join(',')})`,neutral:h.frequencies.fold>=57};
  }
  function eligible(h,f=filter) { return f === 'All hands' || typeOf(h.name) === f; }
  function matrixHTML() {
    return solution.matrix.flat().map(h=>{
      const {paint,neutral}=gradient(h);
      const tip=solution.actions.map(a=>`${a.label} ${pct(h.frequencies[a.key])}`).join(', ');
      const valueTip = metric === 'Equity' ? `Equity ${pct(h.equity)}` : metric === 'EV' ? `Best EV ${bb(Math.max(...Object.values(h.ev).filter(Number.isFinite)))}` : tip;
      const muted = !eligible(h);
      return `<button class="cell ${neutral?'neutral ':''}${muted?'dim ':''}${selected===h.name?'selected':''}" data-hand="${h.name}" title="${h.name} · ${valueTip}" aria-label="${h.name}, ${valueTip}" aria-pressed="${selected===h.name}" tabindex="${selected===h.name?0:-1}" style="background:${paint}">${h.name}</button>`;
    }).join('');
  }
  function averageTotals(list) {
    const combos=list.reduce((sum,h)=>sum+h.combos,0);
    return {combos, frequencies:Object.fromEntries(solution.actions.map(({key})=>[key,list.reduce((sum,h)=>sum+h.combos*h.frequencies[key],0)/combos]))};
  }
  function stripe(actions,frequencies) {
    return `<div class="stripe">${actions.map(a=>`<span style="width:${frequencies[a.key]}%;background:${color(a.key)}"></span>`).join('')}</div>`;
  }
  function totalHTML() {
    const list=Object.values(solution.hands).filter(h=>eligible(h));
    const {combos,frequencies}=averageTotals(list);
    return `<div class="range-total-heading"><span class="smallcap">${filter==='All hands'?'Range strategy':`${filter} strategy`}</span><span class="subcount">${combos.toLocaleString()} combos</span></div>${stripe(solution.actions,frequencies)}<div class="range-values">${solution.actions.map(a=>`<div>${swatch(a.key)}${a.label}<b>${pct(frequencies[a.key])}</b></div>`).join('')}</div>`;
  }
  function handHTML() {
    const h=solution.hands[selected];
    return `<div class="panel-head"><div class="heading">${icon('cards','title-icon')}<h2>Hand inspector</h2></div><button class="icon-button" id="hand-details" aria-label="View hand EV details" title="View hand EV details">${icon('info')}</button></div><div class="hand-summary">${playingCards(h.name)}<div><strong class="hand-name">${h.name}</strong><p>${describeHand(h.name)} · ${h.combos} combos</p></div></div><div class="action-list">${solution.actions.map(a=>`<div class="action-line-stat"><span class="name" title="${a.size?bb(a.size):'No chips invested'}">${swatch(a.key)}${a.label}${a.key==='raise'&&a.size?` ${bb(a.size)}`:''}</span><span class="track"><i style="background:${color(a.key)};width:${h.frequencies[a.key]}%"></i></span><strong>${pct(h.frequencies[a.key])}</strong></div>`).join('')}</div><div class="hand-bottom"><span>Range equity <b class="mono">${pct(h.equity)}</b></span><button class="text-btn" id="equity-btn">Equity calculator</button></div>`;
  }
  function changeHand(name, moveFocus=false) {
    if(!solution.hands[name]) return;
    selected=name; write('hand',selected);
    const previously=$('.cell.selected');
    if(previously) { previously.classList.remove('selected'); previously.tabIndex=-1; previously.setAttribute('aria-pressed','false'); }
    const next=$(`[data-hand="${name}"]`);
    next.classList.add('selected'); next.tabIndex=0; next.setAttribute('aria-pressed','true');
    if(moveFocus) next.focus();
    $('#inspector').innerHTML=handHTML(); bindHand();
  }
  function bindHand() {
    $('#equity-btn').onclick=equityDialog;
    $('#hand-details').onclick=()=>{
      const h=solution.hands[selected];
      showDialog(`${selected} action values`,`<p>${escape(solution.modelLabel)}. Values are measured from the current decision in big blinds.</p><table class="data-table"><thead><tr><th>Action</th><th>Frequency</th><th>EV</th></tr></thead><tbody>${solution.actions.map(a=>`<tr><td>${a.label}${a.size?` ${bb(a.size)}`:''}</td><td>${pct(h.frequencies[a.key])}</td><td>${h.ev[a.key].toFixed(3)}</td></tr>`).join('')}</tbody></table>`);
    };
  }
  function studyShortcuts() {
    const panel = document.createElement('div');
    panel.className = 'panel study-shortcuts';
    const canFlop = config.model === 'cash' && config.openSize < config.stack;
    panel.innerHTML = (canFlop ? '<button type="button" id="explore-flop">' + icon('cards') + '<span><b>Explore a flop</b><small>Carry ranges into the solver</small></span></button>' : '') +
      '<button type="button" id="train-here">' + icon('target') + '<span><b>Train this spot</b><small>Practice your next decision</small></span></button>';
    $('.side-stack').append(panel);
    if (canFlop) $('#explore-flop').onclick = flopDialog;
    $('#train-here').onclick = () => {drill=null; location.hash='train';};
  }
  function flopDialog() {
    const opener = config.villain === 'none' ? config.hero : config.villain;
    const caller = config.villain === 'none' ? 'BB' : config.hero;
    const pot = 2*config.openSize + (opener==='SB'||caller==='SB'?0:.5) + (caller==='BB'?0:1);
    showDialog('Explore a flop','<form id="flop-form"><p>' + opener + ' opens to ' + bb(config.openSize) + ', ' + caller + ' calls, and the other players fold. The solver will start with those action-weighted ranges and a ' + bb(pot) + ' pot.</p><label class="field">Flop cards<input type="text" id="flop-board" value="As 8d 4c" required><small>Enter three cards. Use c, d, h, or s for suit.</small></label><div class="dialog-actions"><button class="button primary" type="submit">Open solver</button></div></form>');
    const board = $('#flop-board');
    board.oninput=()=>board.setCustomValidity('');
    $('#flop-form').onsubmit=e=>{
      e.preventDefault();
      const cards=board.value.replace(/[ ,]+/g,'').match(/../g)||[];
      if(cards.length!==3 || !/^(?:[2-9TJQKA][cdhs]){3}$/i.test(board.value.replace(/[ ,]+/g,'')) || new Set(cards.map(c=>c.toLowerCase())).size!==3){
        board.setCustomValidity('Enter three different cards, for example As 8d 4c.');board.reportValidity();return;
      }
      const open=RangeEngine.solve({...config,hero:opener,villain:'none'});
      const defend=RangeEngine.solve({...config,hero:caller,villain:opener});
      const rangeText=(sol,key)=>Object.values(sol.hands).filter(h=>h.frequencies[key]>0).map(h=>h.name+':'+h.frequencies[key]+'%').join(', ');
      const postOrder=['SB','BB','UTG','HJ','CO','BTN'];
      const callerOOP=postOrder.indexOf(caller)<postOrder.indexOf(opener);
      const openRange=rangeText(open,'raise'),callRange=rangeText(defend,'call');
      if(!openRange||!callRange){toast('This spot has no calling range to take to a flop.');return;}
      dialog.close();
      openPostflop({board:cards.join(' '),pot:String(pot),size:'50',oop:callerOOP?callRange:openRange,ip:callerOOP?openRange:callRange,quality:'standard',lock:'',tree:'standard',stack:String(config.stack-config.openSize)});
    };
  }
  function renderStudy() {
    const description=config.model==='pushfold'
      ? (config.hero==='SB'?'Small blind shove or fold against the big blind.':'Big blind response to a small blind shove.')
      : config.villain==='none' ? `${positionNames[config.hero]} opening range in an unraised pot.` : `${positionNames[config.hero]} response to a ${positionNames[config.villain].toLowerCase()} open.`;
    main.innerHTML=heading('Study','Strategy explorer',tags(),btn('save','Save spot','bookmark')+btn('configure','Configure spot','sliders',true))+lineHTML()+`<div class="workspace"><section class="panel matrix-panel"><div class="panel-head"><div><h2>Range matrix</h2><p>${description}</p></div><select id="metric" class="mode-select" aria-label="Matrix color metric">${['Strategy','Equity','EV'].map(v=>`<option ${v===metric?'selected':''}>${v}</option>`).join('')}</select></div><div class="matrix-tools"><div class="segments" aria-label="Hand class filter">${['All hands','Pairs','Suited','Offsuit'].map(v=>`<button data-filter="${v}" aria-pressed="${v===filter}">${v}</button>`).join('')}</div>${metric==='Strategy'?`<span class="subcount">${Object.values(solution.hands).filter(h=>eligible(h)).length} hands</span>`:'<span class="heat-legend">Low<i></i>High</span>'}</div><div class="matrix" id="matrix" role="group" aria-label="Starting hand matrix, use arrow keys to navigate">${matrixHTML()}</div><div class="range-total">${totalHTML()}</div></section><div class="side-stack">${tableHTML()}<section class="panel hand-panel" id="inspector">${handHTML()}</section></div></div><div class="module-foot"><button class="text-btn" id="model-info">${icon('info')}${escape(solution.modelLabel)}</button><span>Frequencies weighted by hand combinations</span></div>`;
    $('#configure').onclick=configure;
    $('#save').onclick=saveDialog;
    $('#model-info').onclick=engineDialog;
    $('#metric').onchange=e=>{metric=e.target.value;renderStudy();};
    main.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>{
      filter=el.dataset.filter;
      if(!eligible(solution.hands[selected])) selected=Object.values(solution.hands).find(h=>eligible(h)).name;
      renderStudy();
    });
    $('#matrix').onclick=e=>{const name=e.target.closest('[data-hand]')?.dataset.hand;if(name) {if(!eligible(solution.hands[name])) {filter='All hands';renderStudy();} changeHand(name);}};
    $('#matrix').onkeydown=e=>{
      const d={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[e.key];
      if(!d)return;
      e.preventDefault(); const h=solution.hands[selected];
      let row=h.row,col=h.col;
      while(true){row+=d[0];col+=d[1];const n=solution.matrix[row]?.[col];if(!n)break;if(eligible(n)){changeHand(n.name,true);break;}}
    };
    bindHand();
    studyShortcuts();
  }
  function options(items,value) {
    return items.map(item=>{const [v,l]=Array.isArray(item)?item:[item,item];return `<option value="${escape(v)}"${v===value?' selected':''}>${escape(l)}</option>`;}).join('');
  }
  function configure() {
    showDialog('Configure spot',`<form id="spot-form"><label class="field">Preflop model<select id="model">${options([['cash','Six-max cash · study estimates'],['pushfold','Heads-up push/fold · CFR+ solver']],config.model)}</select></label><div class="field-grid"><label class="field">Hero position<select id="hero"></select></label><label class="field">Facing<select id="villain"></select></label><label class="field">Effective stack (bb)<input type="number" id="stack" min="1" max="1000" step=".5" required></label><label class="field" id="size-field">Open size (bb)<input type="number" id="open-size" min="2" step=".1" required></label></div><div id="lock-controls"></div><div class="notice" id="model-help"></div><div class="dialog-actions"><button type="button" class="button ghost" id="cancel">Cancel</button><button class="button primary" type="submit">Apply spot</button></div></form>`);
    const model=$('#model'),hero=$('#hero'),villain=$('#villain'),stack=$('#stack'),size=$('#open-size');
    const redrawFacing=(preferred)=>{
      if(model.value==='pushfold') {
        villain.innerHTML=options(hero.value==='SB'?[['BB','Unopened pot']]:[['SB','Small blind shove']]);villain.disabled=true;
      } else {
        const before=positions.slice(0,positions.indexOf(hero.value));
        const choices=before.map(p=>[p,`${positionNames[p]} open`]);
        if(hero.value!=='BB') choices.unshift(['none','Unopened pot']);
        villain.disabled=false;villain.innerHTML=options(choices,preferred ?? (choices.some(([p])=>p==='BTN')?'BTN':choices[0][0]));
      }
    };
    const redraw=(initial)=>{
      const isPush=model.value==='pushfold';
      hero.innerHTML=options((isPush?['SB','BB']:positions).map(p=>[p,`${positionNames[p]} (${p})`]),initial?config.hero:isPush?'SB':'BB');
      redrawFacing(initial?config.villain:undefined);
      stack.min=isPush?'1':'5'; stack.value=initial?config.stack:isPush?'10':'100';
      size.value=initial?config.openSize:'2.5';size.max=stack.value;size.disabled=isPush;
      $('#size-field').style.display=isPush?'none':'flex';
      $('#model-help').textContent=isPush?'CFR+ solves the heads-up shove-or-fold game with equal stacks and 0.5/1 blinds.':'Position-based opening ranges, sampled showdown equity, and estimated postflop realization determine these cash-game frequencies.';
      $('#lock-controls').innerHTML=isPush?`<details><summary>Opponent nodelocks</summary><label class="field">Locked hand frequencies<input type="text" id="lock-input" placeholder="AA:100, AQs:50"><small>Set the opponent’s shove or call frequency for individual hands, from 0 to 100%.</small></label></details>`:'';
      if(isPush) loadLocks();
    };
    function loadLocks(){
      const input=$('#lock-input');
      if(input)input.value=Object.entries(config.locks?.[hero.value==='SB'?'BB':'SB']||{}).map(([k,v])=>`${k}:${Math.round(v*100)}`).join(', ');
    }
    redraw(true);
    model.onchange=()=>redraw(false);
    hero.onchange=()=>{redrawFacing();loadLocks();};
    stack.oninput=()=>size.max=stack.value;
    $('#cancel').onclick=()=>dialog.close();
    $('#spot-form').onsubmit=e=>{
      e.preventDefault();
      const locks={}; const lockInput=$('#lock-input');
      if(lockInput && lockInput.value.trim()) {
        const other=hero.value==='SB'?'BB':'SB';locks[other]={};
        for(const part of lockInput.value.split(',')){
          const match=/^\s*([AKQJT2-9]{2}[so]?)\s*:\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(part);
          if(!match || !solution.hands[match[1]] || Number(match[2])>100){lockInput.setCustomValidity('Use a hand and percentage for each lock, for example AA:100, AQs:50.');lockInput.reportValidity();lockInput.oninput=()=>lockInput.setCustomValidity('');return;}
          locks[other][match[1]]=Number(match[2])/100;
        }
      }
      updateSolution({model:model.value,hero:hero.value,villain:villain.value,stack:Number(stack.value),openSize:Number(size.value),locks});
      dialog.close();render();
    };
  }
  function sameSpot(a,b) {
    return ['model','hero','villain','stack','openSize'].every(k=>a[k]===b[k]) && JSON.stringify(a.locks||{})===JSON.stringify(b.locks||{});
  }
  function saveDialog() {
    showDialog('Save this spot',`<form id="save-form"><label class="field">Spot name<input type="text" id="save-name" maxlength="90" value="${shortSpot()} · ${bb(config.stack)}" required></label><p>The spot and selected hand are saved to this browser’s library.</p><div class="dialog-actions"><button type="submit" class="button primary">Save spot</button></div></form>`);
    $('#save-form').onsubmit=e=>{e.preventDefault();const name=$('#save-name').value.trim();if(!name)return;
      const item={id:crypto.randomUUID(),name,config,hand:selected,focus,drillKinds};
      saved=[item,...saved];write('saved',saved);dialog.close();toast('Spot saved to your library.');};
  }
  function library() {
    showDialog('Saved spots',saved.length?`<div>${saved.map((s,i)=>`<div class="list-row"><div><strong>${escape(s.name)}</strong><small>${escape(s.hand)} · ${escape(s.config.hero)} · ${escape(bb(s.config.stack))}</small></div><div class="row"><button class="button compact" data-open="${i}">Study</button><button class="icon-button" data-drill="${i}" aria-label="Train saved spot" title="Train saved spot">${icon('target')}</button><button class="icon-button" data-remove="${i}" aria-label="Remove saved spot">${icon('trash')}</button></div></div>`).join('')}</div>`:'<p>Your saved spots will appear here. Save the current spot from the explorer to revisit it or use it as a drill.</p>');
    dialog.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const s=saved[Number(b.dataset.open)];openStudy(s.config,s.hand);});
    dialog.querySelectorAll('[data-drill]').forEach(b=>b.onclick=()=>{const s=saved[Number(b.dataset.drill)];updateSolution(s.config,s.hand);focus=s.focus||'All hands';drillKinds=s.drillKinds||'Any decision';dialog.close();if(route()==='train')render();else location.hash='train';});
    dialog.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{saved.splice(Number(b.dataset.remove),1);write('saved',saved);library();});
  }
  function engineDialog() {
    const offline=window.RangePWA?.state().offlineReady;
    showDialog('Engine details',`<h3>${escape(solution.modelLabel)}</h3><p>${escape(solution.description)}</p>${solution.nashGap!==undefined?`<p>Estimated best-response gap within the model: ${solution.nashGap.toFixed(5)} bb per hand.</p>`:''}<h3>Equity calculations</h3><p>${device.available?'WebGPU is available for Monte Carlo hand equity.':'The CPU runs Monte Carlo hand equity on this device.'}</p><h3>Offline access</h3><p>${offline?'The app is cached on this device.':'Open this app over HTTPS or localhost and allow the offline cache to finish.'}</p>`);
  }
  function equityDialog() {
    const name=selected;
    showDialog(`${name} equity calculator`,`<div class="hand-summary" style="padding-left:0">${playingCards(name)}<div><strong class="hand-name">${name}</strong><p>Against one random hand</p></div></div><label class="field">Simulated boards<select id="samples">${options([['4096','4,096'],['16384','16,384'],['65536','65,536'],['262144','262,144']],'16384')}</select></label><div class="notice" id="eq-output" aria-live="polite">Deal random boards to estimate wins, ties, and losses.</div><div class="dialog-actions">${btn('run-equity','Run simulation','play',true)}</div>`);
    $('#run-equity').onclick=async()=>{
      const button=$('#run-equity'),output=$('#eq-output');button.disabled=true;output.textContent='Simulating boards…';
      try {
        const result=await RangeGPU.estimate(name,Number($('#samples').value));
        output.innerHTML=`<strong>${pct(result.equity)} equity</strong><br>Win ${pct(result.win)} · Tie ${pct(result.tie)} · Lose ${pct(result.loss)}<br>${result.samples.toLocaleString()} deals · ${escape(result.backend)} · ${Math.round(result.elapsedMs)} ms`;
      }catch(error){output.textContent=`Simulation failed. ${error.message}`;}
      button.disabled=false;
    };
  }
  function nextDrill() {
    let list=Object.values(solution.hands).filter(h=>eligible(h,focus));
    if(drillKinds==='Mixed hands')list=list.filter(h=>solution.actions.filter(a=>h.frequencies[a.key]>=5).length>=2);
    if(!list.length) {drill=null;return;}
    const total=list.reduce((n,h)=>n+h.combos,0);let pick=Math.random()*total;
    const h=list.find(h=>(pick-=h.combos)<0)||list.at(-1);
    drill={name:h.name,choice:null};
  }
  function renderTrain() {
    if(!drill)nextDrill();
    const h=drill?solution.hands[drill.name]:null;
    const compatible=history.filter(s=>sameSpot(config,s.config));
    const avg=compatible.length?compatible.reduce((sum,h)=>sum+h.loss,0)/compatible.length:0;
    const correct=compatible.filter(h=>h.supported).length;
    const response=drill?.choice!==null && !!h;
    main.innerHTML=heading('Trainer','Decision trainer',tags(),btn('save','Save drill','bookmark')+btn('configure','Configure spot','sliders',true))+lineHTML()+`<div class="workspace"><section class="panel drill"><span class="street-tag">Preflop decision</span><h2>${shortSpot()}</h2><p class="muted small">${bb(config.stack)} effective · Pot ${bb(potSize())}</p>${h?`${playingCards(h.name)}<h3>${h.name}</h3><p class="muted small">${describeHand(h.name)} · You are ${config.hero}</p><div class="drill-choices">${solution.actions.map(a=>`<button class="button" data-choice="${a.key}" ${response?'disabled':''}>${swatch(a.key)}${a.label} ${a.size?bb(a.size):''}</button>`).join('')}</div>`:'<div class="notice" style="margin-top:20px">This spot has no hands matching these drill filters. Choose a broader hand group.</div>'}${response?`<div class="notice drill-result"><b>${drill.supported?'Action in range':'Outside the model range'}</b><br>${pct(h.frequencies[drill.choice])} frequency · ${bb(drill.loss)} estimated EV loss<br>${solution.actions.map(a=>`${a.label} ${pct(h.frequencies[a.key])}`).join(' · ')}</div><div class="drill-choices">${btn('review-hand','Study hand','book')}${btn('next-hand','Next hand','shuffle',true)}</div>`:''}</section><div class="side-stack"><section class="panel panel-pad"><h2>Drill settings</h2><div style="margin-top:16px"><label class="field">Hand group<select id="drill-filter">${options(['All hands','Pairs','Suited','Offsuit'],focus)}</select></label><label class="field">Decision type<select id="drill-kind">${options(['Any decision','Mixed hands'],drillKinds)}</select></label></div><span class="small muted">${escape(solution.modelLabel)}</span></section><section class="panel panel-pad"><h2>Spot performance</h2><div class="metrics"><div class="metric"><strong>${compatible.length}</strong><small>Decisions</small></div><div class="metric"><strong>${compatible.length?Math.round(100*correct/compatible.length)+'%':'—'}</strong><small>In range¹</small></div><div class="metric"><strong>${avg.toFixed(2)}</strong><small>Avg loss (bb)</small></div></div><p class="helptext">¹ Actions played at least 1% by this model. Stats include previous visits on this device.</p></section></div></div>${history.length?`<section class="panel panel-pad" style="margin-top:16px"><h2>Recent decisions</h2><div class="scroll-x"><table class="data-table"><thead><tr><th>Hand</th><th>Position</th><th>Your action</th><th>Model frequency</th><th>EV loss</th><th></th></tr></thead><tbody>${history.slice(0,10).map((r,i)=>`<tr><td>${escape(r.hand)}</td><td>${escape(r.config.hero)}</td><td>${escape(r.label)}</td><td>${pct(r.frequency)}</td><td>${bb(r.loss)}</td><td><button class="text-btn" data-review="${i}">Study</button></td></tr>`).join('')}</tbody></table></div></section>`:''}`;
    $('#configure').onclick=configure; $('#save').onclick=saveDialog;
    $('#drill-filter').onchange=e=>{focus=e.target.value;nextDrill();renderTrain();};
    $('#drill-kind').onchange=e=>{drillKinds=e.target.value;nextDrill();renderTrain();};
    main.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{
      if(drill.choice!==null)return;
      const key=b.dataset.choice,frequency=h.frequencies[key];
      const loss=Math.max(...solution.actions.map(a=>h.ev[a.key]))-h.ev[key];
      Object.assign(drill,{choice:key,supported:frequency>=1,loss});
      history=[{config,hand:h.name,label:solution.actions.find(a=>a.key===key).label,frequency,loss,supported:drill.supported,date:Date.now()},...history].slice(0,5000);write('training',history);renderTrain();
    });
    if(response){$('#next-hand').onclick=()=>{nextDrill();renderTrain();};$('#review-hand').onclick=()=>openStudy(config,h.name);}
    main.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>{const r=history[Number(b.dataset.review)];openStudy(r.config,r.hand);});
  }
  function renderModule(name) {
    const details = {
      postflop:['Custom solver','Solve a heads-up betting decision on your own board.','RangePostflop'],
      analyze:['Hand history analyzer','Replay hands and review the expected value of your decisions.','RangeAnalyze'],
      reports:['Range reports','Compare ranges, inspect hand classes, and export strategy data.','RangeReports']
    };
    const [title,subtitle,key]=details[name];
    const modePicker = name === 'postflop' ? '<div class="segments solver-modes" aria-label="Solver model">'+['Postflop','Tournament ICM'].map(v=>'<button data-solver-mode="'+v+'" aria-pressed="'+(v===solverMode)+'">'+v+'</button>').join('')+'</div>' : '';
    const activeSubtitle = name === 'postflop' && solverMode === 'Tournament ICM' ? 'Compare chip EV and prize-pool equity when the final table folds to the blinds.' : subtitle;
    main.innerHTML=heading(routes[name][0],title,`<p>${activeSubtitle}</p>`,name==='reports'?btn('configure','Configure spot','sliders',true):modePicker)+'<div id="module"></div>';
    main.querySelectorAll('[data-solver-mode]').forEach(b=>b.onclick=()=>{solverMode=b.dataset.solverMode;render();});
    if(name==='reports')$('#configure').onclick=configure;
    const target=$('#module');
    if (name==='postflop' && solverMode==='Tournament ICM') {
      RangeTournament.mount(target);
      return;
    }
    if(window[key]) {
      const context = name === 'postflop' ? (pendingPostflop || {}) :
        {solution,config,onStudy:openStudy,onPostflop:openPostflop,trainingHistory:history};
      pendingPostflop = null;
      const ret=window[key].mount(target,context);
      if(typeof ret==='function')moduleCleanup=ret;
    } else target.innerHTML='<div class="panel panel-pad">This module could not load. Refresh the app to retry.</div>';
  }
  function render() {
    if(moduleCleanup){moduleCleanup();moduleCleanup=null;}
    const active=route();document.title=`${routes[active][0]} · RangeLab`;
    $('#nav').innerHTML=Object.entries(routes).map(([k,[title,glyph]])=>`<a class="nav-link${k===active?' active':''}" ${k===active?'aria-current="page"':''} href="#${k}">${icon(glyph)}${title}</a>`).join('');
    if(active==='study')renderStudy();else if(active==='train')renderTrain();else renderModule(active);
  }
  $('#engine-info').onclick=engineDialog;
  $('#library').innerHTML=icon('bookmark'); $('#library').onclick=library;
  $('#install').innerHTML=icon('download');
  $('#install').onclick=async()=>{
    const result=await window.RangePWA?.install();
    if(result==='manual'||!result)showDialog('Install RangeLab','<p>In Edge or Chrome, open the browser menu and choose <b>Install RangeLab</b> or <b>Install page as app</b>. On iPhone or iPad, open the Share menu in Safari and choose <b>Add to Home Screen</b>.</p><p>After its first online load, RangeLab can open in its own window and run offline.</p>');
    else if(result==='installed'||result==='accepted')toast(result==='installed'?'RangeLab is already installed.':'Installation accepted.');
  };
  window.addEventListener('hashchange',()=>{if(dialog.open)dialog.close();render();window.scrollTo(0,0);});
  render();
  window.RangeGPU?.detect().then(status=>{device=status;$('#engine-status').textContent=status.available?'WebGPU ready':'CPU ready';}).catch(()=>{$('#engine-status').textContent='CPU ready';});
})();
