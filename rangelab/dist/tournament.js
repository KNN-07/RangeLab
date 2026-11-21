(function tournamentModule(){
  'use strict';
  const initial={sb:12,bb:16,others:[7,25],prizes:[50,30,20]};
  // Dynamic programming over finish orders. A mask contains the players
  // who already finished in the highest-paid places.
  function icm(stacks,prizes) {
    const n=stacks.length,states=1<<n,probability=new Float64Array(states),values=new Float64Array(n);
    probability[0]=1;
    for(let mask=0;mask<states-1;mask++){
      if(!probability[mask])continue;
      const remaining=[];
      let chips=0;
      for(let p=0;p<n;p++)if(!(mask&(1<<p))){remaining.push(p);chips+=stacks[p];}
      const place=n-remaining.length;
      if(place>=prizes.length || prizes[place]===0)continue;
      for(const p of remaining){
        const chance=probability[mask]*(chips?stacks[p]/chips:1/remaining.length);
        values[p]+=prizes[place]*chance;
        probability[mask|(1<<p)]+=chance;
      }
    }
    return values;
  }
  function solve({sb,bb,others,prizes}) {
    const stacks=[sb,bb,...others];
    if(stacks.length>9 || stacks.some(v=>!Number.isFinite(v)||v<=0)||Math.min(sb,bb)<2)throw Error('Use 2–9 positive stacks, with at least 2 bb in each blind.');
    if(!prizes.length || prizes.length>stacks.length || prizes.some((v,i)=>!Number.isFinite(v)||v<0||(i && v>prizes[i-1])) || prizes[0]<=0)throw Error('Enter payouts from highest to lowest, one per paid place.');
    const total=prizes.reduce((a,b)=>a+b,0);
    const shares=prizes.map(x=>x*100/total);
    const effective=Math.min(sb,bb);
    const settled=(s,b)=>icm([s,b,...others],shares);
    const sbFolds=settled(sb-.5,bb+.5),bbFolds=settled(sb+1,bb-1);
    const sbWins=settled(sb+effective,bb-effective),sbLoses=settled(sb-effective,bb+effective),split=settled(sb,bb);
    const {n,names,matchups,equity,ties}=RangeEngine.matchupStats();
    const sbKernel=new Float64Array(n*n),bbKernel=new Float64Array(n*n);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const k=i*n+j,t=ties[k],w=Math.max(0,Math.min(1-t,equity[k]-t/2)),l=1-t-w;
      const sbCalled=w*sbWins[0]+l*sbLoses[0]+t*split[0];
      const bbCalled=w*sbWins[1]+l*sbLoses[1]+t*split[1];
      sbKernel[k]=matchups[k]*(sbCalled-bbFolds[0]);
      bbKernel[j*n+i]=matchups[j*n+i]*(bbCalled-bbFolds[1]);
    }
    const active=new Float64Array(2*n).fill(.5),actionRegret=new Float64Array(2*n),foldRegret=new Float64Array(2*n);
    const avg=new Float64Array(2*n),advantage=new Float64Array(2*n);
    const iterations=600,weight=iterations*(iterations+1)/2;
    function advantageFor(policy){
      for(let i=0;i<n;i++){
        let jam=bbFolds[0]-sbFolds[0],call=0;
        for(let j=0;j<n;j++){jam+=sbKernel[i*n+j]*policy[n+j];call+=bbKernel[i*n+j]*policy[j];}
        advantage[i]=Math.abs(jam)<1e-12?0:jam;
        advantage[n+i]=Math.abs(call)<1e-12?0:call;
      }
    }
    for(let t=1;t<=iterations;t++){
      advantageFor(active);
      for(let k=0;k<2*n;k++){
        const p=active[k],delta=advantage[k];
        avg[k]+=t*p;
        actionRegret[k]=Math.max(0,actionRegret[k]+(1-p)*delta);
        foldRegret[k]=Math.max(0,foldRegret[k]-p*delta);
        const sum=actionRegret[k]+foldRegret[k];
        active[k]=sum?actionRegret[k]/sum:.5;
      }
    }
    for(let k=0;k<2*n;k++)avg[k]/=weight;
    advantageFor(avg);
    const chipSB=RangeEngine.solve({model:'pushfold',hero:'SB',stack:effective});
    const chipBB=RangeEngine.solve({model:'pushfold',hero:'BB',stack:effective});
    let gap=0;
    const rows=names.map((name,i)=>{
      let facing=0;
      for(let j=0;j<n;j++)facing+=matchups[i*n+j]*avg[j];
      const combos=chipSB.hands[name].combos;
      gap+=(Math.max(advantage[i],0)-avg[i]*advantage[i]+Math.max(advantage[n+i],0)-avg[n+i]*advantage[n+i])*combos/1326;
      return {name,combos,jam:100*avg[i],call:100*avg[n+i],chipJam:chipSB.hands[name].frequencies.raise,chipCall:chipBB.hands[name].frequencies.call,jamEV:advantage[i],callEV:facing?advantage[n+i]/facing:0};
    });
    return {rows,gap:Math.max(0,gap),values:Array.from(split),effective,iterations,shares};
  }
  function mount(root){
    const style=document.createElement('style');
    style.textContent='.icm-layout{display:grid;grid-template-columns:minmax(245px,.72fr) minmax(0,1.7fr);gap:17px;align-items:start}.icm-layout h2{margin-bottom:16px}.icm-layout .matrix{padding:0;margin:14px 0}.icm-layout .cell{height:clamp(23px,2.6vw,39px)}.icm-layout .metric{min-width:0}.icm-seats{display:flex;flex-wrap:wrap;gap:10px 16px;margin:12px 0;color:var(--muted);font-size:13px}.icm-layout .notice{margin:12px 0}@media(max-width:850px){.icm-layout{grid-template-columns:minmax(0,1fr)}}';
    root.innerHTML=`<div class="icm-layout"><form class="panel panel-pad"><h2>Final table setup</h2><div class="field-grid"><label class="field">Small blind stack (bb)<input type="number" name="sb" min="2" max="1000" step="any" required></label><label class="field">Big blind stack (bb)<input type="number" name="bb" min="2" max="1000" step="any" required></label></div><label class="field">Other stacks (bb)<input type="text" name="others" placeholder="7, 25"><small>Enter the stacks of players who folded to the blinds.</small></label><label class="field">Prize payouts, largest first<input type="text" name="prizes" required><small>Cash amounts or percentages. Unpaid places receive zero.</small></label><button type="submit" class="button primary">Solve tournament spot</button><p class="helptext" role="status" style="margin-top:12px"></p></form><section class="panel panel-pad" data-output></section></div>`;
    root.prepend(style);
    const form=root.querySelector('form'),out=root.querySelector('[data-output]'),status=form.querySelector('[role=status]');
    let params=initial;
    try{params=JSON.parse(localStorage.getItem('rangeLab:tournament'))||initial;}catch{}
    for(const key of ['sb','bb','others','prizes'])form.elements[key].value=Array.isArray(params[key])?params[key].join(', '):params[key];
    let result=null,role='jam',pick='AQs';
    function paint(){
      const key=role,chipKey=key==='jam'?'chipJam':'chipCall',evKey=key==='jam'?'jamEV':'callEV';
      const h=result.rows.find(h=>h.name===pick);
      const mean=k=>result.rows.reduce((s,h)=>s+h[k]*h.combos/1326,0);
      const fmt=n=>n.toFixed(1)+'%';
      out.innerHTML=`<div class="range-total-heading"><h2 style="margin:0">Tournament range</h2><select aria-label="Tournament decision"><option value="jam" ${key==='jam'?'selected':''}>SB · Open shove</option><option value="call" ${key==='call'?'selected':''}>BB · Call shove</option></select></div><div class="metrics"><div class="metric"><strong>${fmt(mean(key))}</strong><small>ICM ${key==='jam'?'shove':'call'}</small></div><div class="metric"><strong>${fmt(mean(chipKey))}</strong><small>Chip EV ${key==='jam'?'shove':'call'}</small></div><div class="metric"><strong>${result.effective} bb</strong><small>Effective stack</small></div></div><div class="matrix">${result.rows.map(h=>`<button class="cell ${h[key]<50?'neutral':''} ${h.name===pick?'selected':''}" aria-pressed="${h.name===pick}" data-icm-hand="${h.name}" title="${h.name}: ${fmt(h[key])}" style="background:linear-gradient(90deg,var(--${key==='jam'?'raise':'call'}) ${h[key]}%, var(--fold) ${h[key]}%)">${h.name}</button>`).join('')}</div><div class="notice"><b>${h.name}</b> · ${key==='jam'?'Shove':'Call'} ${fmt(h[key])} with ICM · ${fmt(h[chipKey])} with chip EV<br>Action value over folding: ${h[evKey].toFixed(3)} percentage points of the prize pool.</div><h3>Current ICM value</h3><div class="icm-seats">${result.values.map((v,i)=>`<span>${i===0?'SB':i===1?'BB':'Seat '+(i+1)} <b>${v.toFixed(2)}%</b></span>`).join('')}</div><p class="helptext">Folded players keep their stacks. The small blind can shove or fold, and the big blind can call or fold. The model uses 0.5/1 blinds, zero ante, standard ICM payouts, and sampled showdown probabilities. The total unilateral improvement available in this model is ${result.gap.toFixed(5)} prize-pool percentage points per deal.</p>`;
      out.querySelector('select').onchange=e=>{role=e.target.value;paint();};
      out.querySelector('.matrix').onclick=e=>{const next=e.target.closest('[data-icm-hand]');if(next){pick=next.dataset.icmHand;paint();out.querySelector(`[data-icm-hand="${pick}"]`).focus();}};
    }
    function run(){
      const numbers=s=>s.trim()?s.trim().split(/[\s,]+/).map(Number):[];
      try{
        const input={sb:Number(form.elements.sb.value),bb:Number(form.elements.bb.value),others:numbers(form.elements.others.value),prizes:numbers(form.elements.prizes.value)};
        result=solve(input);paint();status.textContent='Solved with 600 regret-matching iterations.';
        try{localStorage.setItem('rangeLab:tournament',JSON.stringify(input));}catch{}
      }catch(error){status.textContent=error.message;}
    }
    form.onsubmit=e=>{e.preventDefault();run();};run();
  }
  globalThis.RangeTournament={solve,mount,icm};
})();
