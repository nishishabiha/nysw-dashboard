(function(root){
function create(DATA, getST){
const ST=new Proxy({},{get:(_,k)=>getST()[k]});
const clamp = (x,a=0,b=1) => Math.min(b, Math.max(a, x));
const fmtD = d => d ? new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
const fmtDY = d => d ? new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
const dayDiff = (a,b) => Math.round((new Date(a+'T12:00:00') - new Date(b+'T12:00:00'))/864e5);
const pct = x => x==null ? '—' : Math.round(x*100)+'%';
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const clone = o => JSON.parse(JSON.stringify(o));

const GROUPS = {care:'Lab care & reporting', growth:'Harvest & growth', teach:'Teacher & student engagement', lead:'Leadership & relationships'};
const DEFAULT_CFG = {
  settings:{
    asOf: DATA.meta.asOf, evalThrough: DATA.meta.evalThrough,
    graceWeeks:1, cadenceAware:true, minConfidence:35,
    harvestRampStart:'2026-11-01', harvestRampEnd:'2027-01-15', harvestWarn:'2026-12-01', harvestDue:'2027-01-01',
    amvAnnualTarget:3, amvMilestones:['2026-12-15','2027-03-01','2027-06-01'],
    bands:{A:90,B:80,C:70,D:60},
    staleDays:21, offlineStreak:3, missedStreak:2
  },
  kpis:[
    {id:'completion',g:'care',label:'Weekly asset completion',src:'GST Schedule + GST Asset',w:18,floor:.5,target:.95,on:true,unit:'%',hint:'Scheduled visit weeks with an asset logged. Cadence-aware (every-other-week / monthly schools are not penalized for off weeks) and make-up visits within the grace window count.'},
    {id:'systems',g:'care',label:'Systems running',src:'GST Asset',w:7,floor:.6,target:1,on:true,unit:'%',hint:'Share of GST reports with no system marked "not running".'},
    {id:'pests',g:'care',label:'Pest- & leak-free visits',src:'GST Asset',w:3,floor:.6,target:.97,on:true,unit:'%',hint:'Share of reports with no pest or leak issue.'},
    {id:'seedlings',g:'care',label:'Seedlings planted',src:'GST Asset',w:4,floor:.2,target:.8,on:true,unit:'%',hint:'Share of answered "Are seedlings planted?" that are Yes.'},
    {id:'labrating',g:'care',label:'Lab impression & cleanliness',src:'Area Manager Visit',w:6,floor:2,target:4.5,on:true,unit:'/5',hint:'Mean of AM overall impression and cleanliness (1-5). Only when an AMV exists.'},
    {id:'harvest',g:'growth',label:'Harvests logged this year',src:'GST Asset',w:14,floor:0,target:3,on:true,unit:'#',hint:'Distinct harvest days logged. Points phase in between the ramp dates, so harvest cannot drag a grade down before crops are ready.'},
    {id:'teacherconv',g:'teach',label:'Teacher conversation at visits',src:'GST Asset',w:6,floor:.3,target:.85,on:true,unit:'%',hint:'Yes = 1, spoke on phone/text = 0.5, No = 0.'},
    {id:'training',g:'teach',label:'Training follow-through',src:'Ed Team + Schedule',w:10,floor:.4,target:1,on:true,unit:'%',hint:'Completed sessions vs sessions completed + no-shows + scheduled "TT" visits with no training logged.'},
    {id:'curriculum',g:'teach',label:'Curriculum in use',src:'Area Manager Visit',w:4,floor:.5,target:1,on:true,unit:'%',hint:'AMV: "Is the teacher using the curriculum?" Yes=1, has questions=0.5.'},
    {id:'edrubric',g:'teach',label:'Ed team pedagogy rubric',src:'Ed Team',w:4,floor:1,target:3.5,on:true,unit:'/4',hint:'Mean of the five domains on the latest session that was scored (1-4).'},
    {id:'teacherinv',g:'teach',label:'Teacher involvement (AM rating)',src:'Area Manager Visit',w:4,floor:2,target:4.5,on:true,unit:'/5',hint:'AMV teacher involvement/communication rating (1-5).'},
    {id:'principal',g:'lead',label:'Principal / AP engagement',src:'Area Manager Visit',w:12,floor:.25,target:.9,on:true,unit:'%',hint:'In-person with Principal = 1, Assistant Principal = 0.75, none but follow-up email = 0.4, none = 0.'},
    {id:'amcadence',g:'lead',label:'Area manager visit pace',src:'Area Manager Visit',w:8,floor:0,target:1,on:true,unit:'%',hint:'AM visits vs the milestones due so far (3 per year). Counted only once a milestone is due or a visit exists.'}
  ]
};
const KDEF = id => DEFAULT_CFG.kpis.find(k => k.id===id);

const activeCfg = () => ST.rubrics[ST.rubrics.length-1].cfg;
function schoolView(s){ // apply local overrides
  const o = ST.ov[s.code]||{};
  return Object.assign({}, s, {amEff: o.am || s.am || 'Unassigned', excluded: !!o.excl, amOv: !!o.am});
}
function rampFrac(set){ const a=dayDiff(set.asOf,set.harvestRampStart), b=dayDiff(set.harvestRampEnd,set.harvestRampStart); return clamp(a/b); }
function completion(s,set){
  const W = s.weeks.filter(w => w.w <= set.evalThrough);
  const win = set.cadenceAware ? (s.cadence==='EOW'?1:s.cadence==='Monthly'?3:0) : 0;
  let den=0, ok=0, late=0, exc=0, trail=0; const cells=[];
  W.forEach((w,i)=>{
    if(!w.s){ cells.push({w:w.w, st: w.d?'ok':'none'}); return; }
    if(w.d){den++;ok++;trail=0;cells.push({w:w.w,st:'ok'});return;}
    let lateOK=false;
    for(let g=1;g<=set.graceWeeks;g++){ const n=W[i+g]; if(n && n.d >= (n.s?2:1)){lateOK=true;break;} }
    let ex=false;
    for(let g=1;g<=win;g++){ if((W[i-g]&&W[i-g].d)||(W[i+g]&&W[i+g].d)){ex=true;break;} }
    if(lateOK){den++;late++;ok++;trail=0;cells.push({w:w.w,st:'late'});return;}
    if(ex){exc++;cells.push({w:w.w,st:'exc'});return;}
    den++;trail++;cells.push({w:w.w,st:'miss'});
  });
  return {den, ok, late, exc, trail, rate: den>=2 ? ok/den : null, cells, missed: cells.filter(c=>c.st==='miss').map(c=>c.w)};
}
function harvestInfo(s){
  const days = [...new Set(s.harvest.map(h=>h.d))];
  const lbs = s.harvest.reduce((a,h)=>a+(h.lb||0),0);
  return {n:days.length, lbs, last: days.sort().pop()||null, amb: s.harvest.some(h=>h.amb)};
}
function stageOf(s,set,H){
  const asOf=set.asOf;
  if(H.n>0){ return {i: (H.last && dayDiff(asOf,H.last)<=35) ? 4 : 3, label: (H.last && dayDiff(asOf,H.last)<=35)?'Harvesting':'Harvested'}; }
  const nh = s.agg.nextHarvest;
  if(s.agg.lastSeed==='No' && s.agg.seedYes===0) return {i:0,label:'Not planted'};
  if(nh && dayDiff(nh,asOf)<-14) return {i:2,label:'Harvest overdue',warn:true};
  if(nh && dayDiff(nh,asOf)<=21) return {i:3,label:'Harvest soon'};
  if(s.agg.seedYes>0) return {i:s.agg.seedYes>=3?2:1,label: s.agg.seedYes>=3?'Growing':'Seedlings'};
  return {i:-1,label:'No growth data'};
}
const PMAP = v => !v?null : /^Yes - Principal/.test(v)?1 : /^Yes - Vice/.test(v)?.75 : null;
function kpiValues(s,cfg){
  const set=cfg.settings, a=s.agg, out={};
  const C=completion(s,set); out.completion={v:C.rate, disp: C.den? `${C.ok}/${C.den} weeks`+(C.late?` (${C.late} late)`:'')+(C.exc?`, ${C.exc} off-cycle`:''):'no schedule', avail:C.rate!=null};
  out.systems={v:a.n>=2?1-a.offN/a.n:null, disp:`${a.n-a.offN}/${a.n} reports clean`, avail:a.n>=2};
  out.pests={v:a.n>=2?clamp(1-(a.pestN+a.leakN)/a.n):null, disp:`${a.pestN} pest, ${a.leakN} leak`, avail:a.n>=2};
  const sk=a.seedYes+a.seedNo; out.seedlings={v:sk>=2?a.seedYes/sk:null, disp:`${a.seedYes}/${sk} yes`, avail:sk>=2};
  const A=s.amv; const imp=[], inv=[], cur=[], pr=[];
  A.forEach(x=>{ const m=avg([x.imp,x.clean].filter(z=>z!=null)); if(m!=null) imp.push(m); if(x.inv!=null) inv.push(x.inv);
    if(x.curr) cur.push(x.curr==='Yes'?1:x.curr==='No'?0:.5);
    let p=PMAP(x.pconv); if(p==null&&x.pconv){ p = x.fu==='Yes'?.4:0; } if(p!=null) pr.push(p); });
  out.labrating={v:avg(imp), disp:imp.length?avg(imp).toFixed(1)+' / 5':'no AMV', avail:imp.length>0};
  out.teacherinv={v:avg(inv), disp:inv.length?avg(inv).toFixed(1)+' / 5':'no AMV', avail:inv.length>0};
  out.curriculum={v:avg(cur), disp:cur.length?pct(avg(cur)):'no AMV', avail:cur.length>0};
  out.principal={v:avg(pr), disp:pr.length?pct(avg(pr)):'no AMV', avail:pr.length>0};
  const H=harvestInfo(s), rf=rampFrac(set);
  out.harvest={v:H.n, disp:`${H.n} harvest${H.n===1?'':'s'}`+(H.lbs?` · ${H.lbs.toFixed(1)} lb`:''), avail:a.n>0 && rf>0, rf};
  const tc=(a.convYes+.5*a.convPhone)/(a.n||1); out.teacherconv={v:a.n>=2?tc:null, disp:`${a.convYes} in-person, ${a.convPhone} phone, ${a.convNo} none`, avail:a.n>=2};
  // training
  const done=s.ed.filter(e=>!e.ns && e.sess && !/^PD/i.test(e.sess)).length;
  const gdone=s.gtr.filter(g=>!s.ed.some(e=>e.d && Math.abs(dayDiff(e.d,g.d))<=3)).length;
  const ns=s.ed.filter(e=>e.ns).length;
  const ttw=(s.tt||[]).filter(w=>w<=set.evalThrough);
  const ttLogged=ttw.filter(w=>{const d0=w, d1=new Date(new Date(w+'T12:00:00').getTime()+9*864e5).toISOString().slice(0,10);
     return s.ed.some(e=>!e.ns&&e.d&&e.d>=d0&&e.d<=d1) || s.gtr.some(g=>g.d>=d0&&g.d<=d1);}).length;
  const ttUnlogged=Math.max(0,ttw.length-ttLogged);
  const tden=Math.max(ttw.length, done+gdone+ns);
  out.training={v:tden>0?Math.min(done+gdone,tden)/tden:null, disp:`${done+gdone} done, ${ns} no-show, ${ttUnlogged} TT w/o asset`, avail:tden>0, done:done+gdone, ns, ttUnlogged, ttw:ttw.length};
  // rubric
  let rub=null; for(let i=s.ed.length-1;i>=0;i--){ const vals=Object.values(s.ed[i].rub||{}).filter(x=>x!=null); if(vals.length){rub=avg(vals);break;} }
  out.edrubric={v:rub, disp:rub!=null?rub.toFixed(1)+' / 4':'not scored', avail:rub!=null};
  // AM pace
  const passed=set.amvMilestones.filter(m=>m<=set.asOf).length, cnt=A.length;
  out.amcadence={v:(passed>0||cnt>0)?Math.min(1,cnt/Math.max(1,passed)):null, disp:`${cnt} visit${cnt===1?'':'s'}; ${passed} of ${set.amvAnnualTarget} milestones due`, avail:(passed>0||cnt>0), cnt, passed};
  out._C=C; out._H=H;
  return out;
}
function evalSchool(s,cfg){
  const set=cfg.settings, KV=kpiValues(s,cfg); let earned=0, avail=0, total=0; const rows=[];
  cfg.kpis.forEach(k=>{
    if(!k.on) return;
    const x=KV[k.id]; let w=k.w; if(k.id==='harvest') w=k.w*(x.rf??rampFrac(set));
    total+=k.w;
    let pts=null;
    if(x.avail && x.v!=null){ pts = w*clamp((x.v-k.floor)/((k.target-k.floor)||1)); earned+=pts; avail+=w; }
    rows.push({k, x, w, pts});
  });
  const score = avail>0 ? 100*earned/avail : null, conf = total? avail/total : 0;
  const prov = conf*100 < set.minConfidence;
  let grade='—'; if(score!=null){ const b=set.bands; grade = score>=b.A?'A':score>=b.B?'B':score>=b.C?'C':score>=b.D?'D':'F'; }
  return {KV, rows, score, conf, prov, grade, C:KV._C, H:KV._H, stage:stageOf(s,set,KV._H)};
}
function alertsFor(s,E,cfg){
  const set=cfg.settings, a=s.agg, out=[], asOf=set.asOf, K=E.KV;
  const add=(rule,sev,title,detail,action,sig)=>out.push({rule,sev,title,detail,action,sig:sig||detail,code:s.code});
  if(E.C.trail>=set.missedStreak) add('missed','high',`Missed ${E.C.trail} scheduled weeks in a row`, `Weeks of ${E.C.missed.slice(-E.C.trail).map(fmtD).join(', ')} have no GST asset.`, 'Confirm the school was visited; if so ask the GST to file the asset, otherwise check access/scheduling.', 'm'+E.C.trail+E.C.missed.slice(-1));
  if(s.onSchedule && s.lastVisit && dayDiff(asOf,s.lastVisit)>=set.staleDays && E.C.trail<set.missedStreak) add('stale','med',`No GST visit logged in ${dayDiff(asOf,s.lastVisit)} days`,`Last visit ${fmtDY(s.lastVisit)}.`,'Check whether the schedule changed or the asset is late.', 's'+s.lastVisit);
  Object.entries(a.offStreaks).forEach(([sys,n])=>{ if(n>=set.offlineStreak) add('offline','high',`${sys} not running on ${n} reports in a row`,`Reported down at every GST visit since ${fmtD(s.reports[Math.max(0,s.reports.length-n)]?.d)}.`,'Open a maintenance work order or escalate to the GST lead.', 'o'+sys+n); });
  if(a.pestStreak>=2) add('pest','med',`Pests reported on ${a.pestStreak} visits in a row`,a.pestKinds.join(', '),'Review pest plan with GST; consider spot visit.', 'p'+a.pestStreak);
  if(a.leakStreak>=2) add('leak','med',`Leaks reported on ${a.leakStreak} visits in a row`,'','Dispatch repair; confirm a fix date with the teacher.', 'l'+a.leakStreak);
  const Hn=E.H.n;
  if(Hn===0 && a.n>0){
    if(asOf>=set.harvestDue) add('harvest','high','No harvest logged yet',`Harvest expected by ${fmtDY(set.harvestDue)}.`,'Agronomy check-in with GST and teacher; confirm crops/cycle.', 'h'+asOf.slice(0,7));
    else if(asOf>=set.harvestWarn) add('harvest','med','No harvest logged yet',`Due by ${fmtDY(set.harvestDue)} (${dayDiff(set.harvestDue,asOf)} days).`,'Ask GST to confirm planting dates and estimate first harvest.', 'h'+asOf.slice(0,7));
    else if(s.agg.nextHarvest && dayDiff(s.agg.nextHarvest,asOf)<-14) add('harvest','med','Estimated harvest date passed with no harvest logged',`GST estimated ${fmtDY(s.agg.nextHarvest)}.`,'Update the estimate or log the harvest (or its absence) on the next report.', 'hd'+s.agg.nextHarvest);
    else add('harvest','upcoming','First harvest still ahead',`Needed by ${fmtDY(set.harvestDue)} · ${dayDiff(set.harvestDue,asOf)} days. ${s.agg.nextHarvest?'GST estimate: '+fmtDY(s.agg.nextHarvest):'No estimate on file.'}`,'No action yet; watch.', 'hu');
  }
  const T=K.training;
  if(T.ns>0 && T.done===0) add('training','high',`Training no-show${T.ns>1?' ×'+T.ns:''} with no completed session`,'No completed curriculum session logged since the no-show.','Ed team to reschedule; AM to nudge the teacher/principal.', 'tn'+T.ns);
  if(T.ttUnlogged>0) add('tt','med',`${T.ttUnlogged} scheduled training visit${T.ttUnlogged>1?'s':''} (TT) with no training asset`,'The schedule lists a TT visit but no Ed Team or GST training record follows.','Ask the GST/Ed team to log the training asset.', 'tt'+T.ttUnlogged);
  const cnt=K.amcadence.cnt, pass=K.amcadence.passed, nextM=set.amvMilestones.find(m=>m>asOf);
  if(cnt<pass) add('amv','med',`AM visit pace behind (${cnt} of ${pass} due)`,`Target ${set.amvAnnualTarget} visits per year; milestones ${set.amvMilestones.map(fmtD).join(' · ')}.`,'Schedule an Area Manager visit.', 'a'+cnt+pass);
  else if(cnt===0 && nextM && dayDiff(nextM,asOf)<=45) add('amv','upcoming',`First AM visit due by ${fmtD(nextM)}`,`${dayDiff(nextM,asOf)} days away; no AM visit on file this year.`,'Put a visit on the calendar.', 'au'+nextM);
  if(s.amv.length){ const l=s.amv[s.amv.length-1]; if(l.pconv==='No' && l.fu!=='Yes') add('principal','med','No principal/AP contact at last AM visit',`${fmtDY(l.d)}${l.fu==='No'?' · follow-up email not sent':''}.`,'Send a principal touchpoint or complete the Principal Relationship asset.', 'pr'+l.d);
    if(l.curr==='No'||l.curr==='Has questions for ed team') add('curr','low','Curriculum use flagged at last AM visit',`"${l.curr}" on ${fmtDY(l.d)}.`,'Loop in the curriculum specialist.', 'cu'+l.d); }
  const seq=(s.aff||[]).map(x=>x[1]); if(seq.length>=5){ const last=seq[seq.length-1]; let run=0; for(let i=seq.length-1;i>=0&&seq[i]===last;i--) run++; const prev=seq[seq.length-1-run];
    if(run>=3 && prev && prev!==last && seq.filter(x=>x===prev).length>=2) add('contact','low','Possible teacher/contact change',`Reports used to list ${prev}; the last ${run} list ${last}. Verify and log it in notes.`,'Confirm the current teacher and update contacts (and note the change date).', 'c'+prev+last); }
  return out;
}
function computeAll(cfg=activeCfg()){
  const res={};
  Object.values(DATA.schools).forEach(s0=>{
    const s=schoolView(s0); if(s.excluded) return;
    const E=evalSchool(s,cfg); const al=alertsFor(s,E,cfg);
    res[s.code]={s,E,al};
  });
  return res;
}
function alertState(code,al){
  const st=ST.alerts[code+'|'+al.rule]; if(!st) return 'open';
  if(st.sig!==al.sig) return 'open';
  if(st.status==='snoozed' && st.until && st.until<=activeCfg().settings.asOf) return 'open';
  return st.status;
}
const SEV = {high:3,med:2,low:1,upcoming:0};
const SEVL = {high:'Act now',med:'Soon',low:'Watch',upcoming:'Coming up'};

const RULES = {missed:'Missed weekly assets',stale:'No recent visit',offline:'System not running',pest:'Pests',leak:'Leaks',harvest:'Harvest',training:'Training no-show',tt:'Training asset missing',amv:'AM visit pace',principal:'Principal contact',curr:'Curriculum use',contact:'Teacher change'};

function openItems(R){ const out=[]; Object.values(R).forEach(r=>r.al.forEach(a=>out.push({a,st:alertState(r.s.code,a),r}))); return out; }
function digestTextFor(R,am,link){
  const items=openItems(R).filter(x=>x.st==='open'&&(x.a.sev==='high'||x.a.sev==='med')&&(!am||x.r.s.amEff===am))
    .sort((a,b)=>SEV[b.a.sev]-SEV[a.a.sev]);
  const lines=items.slice(0,25).map(x=>`• [${SEVL[x.a.sev]}] ${x.r.s.code} ${x.r.s.name}: ${x.a.title}. ${x.a.action}`);
  return {n:items.length, subject:`Partner schools needing action${am?' — '+am:''} (${items.length})`,
    body:`Hi${am&&am!=='Unassigned'?' '+am:''},\n\nThese partner schools need your attention as of ${fmtDY(activeCfg().settings.asOf)}:\n\n${lines.join('\n')}${items.length>25?`\n…and ${items.length-25} more in the dashboard.`:''}\n\n${link?'Open the dashboard: '+link+'\n':'Open the dashboard action queue for details and to log notes.\n'}`};
}
return {clamp,fmtD,fmtDY,dayDiff,pct,avg,clone,GROUPS,DEFAULT_CFG,activeCfg,computeAll,alertState,SEV,SEVL,RULES,openItems,digestTextFor,rampFrac,evalSchool};
}
root.NYSWEngine={create};
if(typeof module!=='undefined')module.exports={create};
})(typeof window!=='undefined'?window:globalThis);
