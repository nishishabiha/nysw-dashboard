import re, os, json, shutil
S = os.path.dirname(os.path.abspath(__file__))
OUT = r"C:\Users\nishi\Documents\NYSW Partner School Dashboard v2\hosted"
t = open(os.path.join(S, 'template.html'), encoding='utf8').read()


def between(a, b, src=t, incl_b=False):
    i = src.index(a)
    j = src.index(b, i)
    return src[i:j + (len(b) if incl_b else 0)]


# ---------- engine.js ----------
helpers = between("const clamp =", "/* ===================== RUBRIC")
rubric = between("const GROUPS", "/* ===================== STATE")
engine = between("function schoolView", "let R={};")
engine += between("function computeAll", "function sevChip")
rules = between("const RULES", "const gradeChip")
extra = r"""
function openItems(R){ const out=[]; Object.values(R).forEach(r=>r.al.forEach(a=>out.push({a,st:alertState(r.s.code,a),r}))); return out; }
function digestTextFor(R,am,link){
  const items=openItems(R).filter(x=>x.st==='open'&&(x.a.sev==='high'||x.a.sev==='med')&&(!am||x.r.s.amEff===am))
    .sort((a,b)=>SEV[b.a.sev]-SEV[a.a.sev]);
  const lines=items.slice(0,25).map(x=>`• [${SEVL[x.a.sev]}] ${x.r.s.code} ${x.r.s.name}: ${x.a.title}. ${x.a.action}`);
  return {n:items.length, subject:`Partner schools needing action${am?' — '+am:''} (${items.length})`,
    body:`Hi${am&&am!=='Unassigned'?' '+am:''},\n\nThese partner schools need your attention as of ${fmtDY(activeCfg().settings.asOf)}:\n\n${lines.join('\n')}${items.length>25?`\n…and ${items.length-25} more in the dashboard.`:''}\n\n${link?'Open the dashboard: '+link+'\n':'Open the dashboard action queue for details and to log notes.\n'}`};
}
"""
exports = "return {clamp,fmtD,fmtDY,dayDiff,pct,avg,clone,GROUPS,DEFAULT_CFG,activeCfg,computeAll,alertState,SEV,SEVL,RULES,openItems,digestTextFor,rampFrac,evalSchool};"
engine_js = ("(function(root){\nfunction create(DATA, getST){\n"
             "const ST=new Proxy({},{get:(_,k)=>getST()[k]});\n"
             + helpers + rubric
             + "const activeCfg = () => ST.rubrics[ST.rubrics.length-1].cfg;\n"
             + engine + "\n"
             + rules + extra + exports + "\n}\n"
             "root.NYSWEngine={create};\nif(typeof module!=='undefined')module.exports={create};\n})(typeof window!=='undefined'?window:globalThis);\n")
os.makedirs(os.path.join(OUT, 'public'), exist_ok=True)
open(os.path.join(OUT, 'engine.js'), 'w', encoding='utf8').write(engine_js)
shutil.copy(os.path.join(OUT, 'engine.js'), os.path.join(OUT, 'public', 'engine.js'))

# ---------- client ----------
c = t
body_patch=True
# 1. remove data script + wrap
c = c.replace('<script>/*__DATA__*/</script>\n', '<script src="/engine.js"></script>\n')
i0 = c.index("<script>\n'use strict';")
head, body = c[:i0], c[i0 + len("<script>\n"):]
body = body.replace("'use strict';\nconst DATA = window.NYSW_DATA;\n", "")
# strip helpers/rubric/state/engine definitions now provided by ENG
def cut(src, a, b):
    i = src.index(a); j = src.index(b, i)
    return src[:i] + src[j:]
body = cut(body, "const clamp =", "/* ===================== RUBRIC")
body = cut(body, "/* ===================== RUBRIC", "/* ===================== STATE")
body = cut(body, "const LS = ", "let UI = ")
body = cut(body, "function schoolView", "function sevChip")
body = cut(body, "const RULES", "const gradeChip")
body = body.replace("let R={};\n", "")  # will redeclare below
body = cut(body, "const $ = ", "/* ===================== STATE")
pre = """'use strict';
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let ST, ME, DATA, ENG, CAN={edit:false,admin:false};
let R={};
async function api(method, url, body){
  const r = await fetch(url,{method,headers:{'Content-Type':'application/json','X-Requested-With':'nysw'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  if(r.status===401){ location.reload(); throw new Error('Signed out'); }
  let j={}; try{ j=await r.json(); }catch(e){}
  if(!r.ok){ const err=new Error(j.error||('Request failed ('+r.status+')')); err.status=r.status; throw err; }
  return j;
}
function start(){
  ENG = NYSWEngine.create(DATA, ()=>ST);
  CAN = {edit: ME.role!=='viewer', admin: ME.role==='admin'};
  document.body.classList.toggle('ro', !CAN.edit);
  window.__eng = ENG;
}
const E_ = new Proxy({}, {get:(_,k)=>ENG[k]});
const clamp=(...a)=>ENG.clamp(...a), fmtD=d=>ENG.fmtD(d), fmtDY=d=>ENG.fmtDY(d), dayDiff=(a,b)=>ENG.dayDiff(a,b), pct=x=>ENG.pct(x), avg=a=>ENG.avg(a), clone=o=>ENG.clone(o);
const activeCfg=()=>ENG.activeCfg(), computeAll=(c)=>ENG.computeAll(c), alertState=(c,a)=>ENG.alertState(c,a);
const GROUPS_=()=>ENG.GROUPS;
const SEV={high:3,med:2,low:1,upcoming:0}, SEVL={high:'Act now',med:'Soon',low:'Watch',upcoming:'Coming up'};
const RULES={missed:'Missed weekly assets',stale:'No recent visit',offline:'System not running',pest:'Pests',leak:'Leaks',harvest:'Harvest',training:'Training no-show',tt:'Training asset missing',amv:'AM visit pace',principal:'Principal contact',curr:'Curriculum use',contact:'Teacher change'};
const save=()=>{};
"""
body = body.replace("let UI = ", "let UI = ", 1)
# GROUPS used in vRubric
body = body.replace("Object.keys(GROUPS).map(g=>`<tr><td colspan=\"6\" style=\"background:var(--green-xl);font-weight:800;color:var(--green-dd)\">${GROUPS[g]}",
                    "Object.keys(ENG.GROUPS).map(g=>`<tr><td colspan=\"6\" style=\"background:var(--green-xl);font-weight:800;color:var(--green-dd)\">${ENG.GROUPS[g]}")
assert "ENG.GROUPS[g]" in body

body = body.replace("${ok&&dirty?'':'disabled'}","${ok&&dirty&&CAN.admin?'':'disabled'}")
# digest text from engine
body = cut(body, "function digestText(am){", "function vAMs")
body = "function digestText(am){ return ENG.digestTextFor(R, am, location.origin); }\n" + body

# who / nav
body = body.replace("$('#whoLbl').textContent=ST.user?`Editing as ${ST.user}`:'No name set';\n  $('#whoBtn').textContent=ST.user?'Change':'Set name';",
                    "$('#whoLbl').textContent=`${ME.name} · ${ME.role}`;\n  $('#whoBtn').textContent='Account';\n  $('#expBtn').classList.toggle('hide',!CAN.admin);")
assert "ME.name" in body
body = body.replace("const TABS=[['today','Today'],['schools','Schools'],['queue','Action queue'],['ams','Area managers'],['rubric','Rubric'],['health','Data health']];",
                    "const TABS=[['today','Today'],['schools','Schools'],['queue','Action queue'],['ams','Area managers'],['rubric','Rubric'],['health','Data health'],['account','Account']];")
body = body.replace("({today:vToday,schools:vSchools,queue:vQueue,ams:vAMs,rubric:vRubric,health:vHealth})[UI.tab](m);",
                    "({today:vToday,schools:vSchools,queue:vQueue,ams:vAMs,rubric:vRubric,health:vHealth,account:vAccount,admin:vAdmin})[UI.tab](m);")
body = body.replace("nav').innerHTML=TABS.map(", "nav').innerHTML=(CAN.admin?TABS.concat([['admin','Admin']]):TABS).map(")
# drawer classes
body = body.replace('<div class="row"><select id="ntype">', '<div class="row ntrow"><select id="ntype">')
body = body.replace('<div class="card f"><h3>Assignment</h3>', '<div class="card f editonly"><h3>Assignment</h3>')
# mutations
body = body.replace("""if(e.target.id==='amsave'){ const v=$('#amsel').value; const c=UI.open; ST.ov[c]=ST.ov[c]||{}; if(v==='Unassigned'||v===DATA.schools[c].am) delete ST.ov[c].am; else ST.ov[c].am=v; save(); render(); toast('Assignment saved'); return; }""",
 """if(e.target.id==='amsave'){ const v=$('#amsel').value; const c=UI.open; mutate('/api/override',{code:c,am:(v==='Unassigned'||v===DATA.schools[c].am)?null:v},'Assignment saved'); return; }""")
body = body.replace("""if(confirm('Hide this school from the dashboard? You can restore it from Backup/import.')){ const c=UI.open; ST.ov[c]=ST.ov[c]||{}; ST.ov[c].excl=true; save(); closeDrawer(); render(); toast('Hidden'); } return; }""",
 """if(confirm('Hide this school from the dashboard for everyone? An admin can restore it from the Admin tab.')){ const c=UI.open; closeDrawer(); mutate('/api/override',{code:c,excl:true},'Hidden'); } return; }""")
body = body.replace("""if(!note){toast('Add a reason for the change first.');return;} if(!ST.user){toast('Set your name first (top right).');return;}
    ST.rubrics.push({v:ST.rubrics.length+1,ts:new Date().toISOString(),by:ST.user,note,cfg:clone(UI.draft)}); UI.draft=null; save(); render(); toast('Rubric saved as v'+ST.rubrics.length); return; }""",
 """if(!note){toast('Add a reason for the change first.');return;}
    const d=UI.draft; mutate('/api/rubric',{cfg:d,note},'Rubric saved').then(()=>{UI.draft=null;render();}); return; }""")
body = body.replace("""if(e.target.id==='whoBtn'){ const n=prompt('Your name (shown on notes and rubric changes):',ST.user||''); if(n!=null){ST.user=n.trim();save();renderNav();} return; }
  if(e.target.id==='expBtn') return backup();""",
 """if(e.target.id==='whoBtn'){ UI.tab='account'; closeDrawer(); render(); return; }
  if(e.target.id==='expBtn') return window.open('/api/admin/backup');
  if(adminClick(e)) return;""")
body = body.replace("""if(t.dataset.npin){ const n=(ST.notes[UI.open]||[]).find(x=>x.id===t.dataset.npin); n.pin=!n.pin; save(); render(); return; }
  if(t.dataset.ndel){ if(confirm('Delete this note?')){ ST.notes[UI.open]=ST.notes[UI.open].filter(x=>x.id!==t.dataset.ndel); save(); render(); } return; }""",
 """if(t.dataset.npin){ mutate('/api/note/pin',{code:UI.open,id:t.dataset.npin}); return; }
  if(t.dataset.ndel){ if(confirm('Delete this note?')) mutate('/api/note/delete',{code:UI.open,id:t.dataset.ndel}); return; }""")
i = body.index("if(t.dataset.al){"); j = body.index("});\ndocument.addEventListener('input'")
body = body[:i] + """if(t.dataset.al){ const c=t.dataset.c, ru=t.dataset.r, a=R[c].al.find(x=>x.rule===ru), act=t.dataset.al;
    mutate('/api/alert',{code:c,rule:ru,status:act==='snooze'?'snoozed':act,sig:a.sig,until:act==='snooze'?new Date(Date.parse(activeCfg().settings.asOf)+14*864e5).toISOString().slice(0,10):null}); return; }
""" + body[j:]
# addNote
i = body.index("function addNote(){"); j = body.index("function openDigest")
body = body[:i] + """function addNote(){
  const text=$('#ntext').value.trim(); if(!text){toast('Write something first.');return;}
  mutate('/api/note',{code:UI.open,type:$('#ntype').value,text,due:$('#ndue').value||null,pin:$('#npin').checked},'Note saved');
}
async function mutate(url,payload,msg){
  try{ const r=await api('POST',url,payload); if(r.state){ ST=r.state; } if(msg) toast(msg); render(); }
  catch(e){ toast(e.message); throw e; }
}
async function refresh(force){
  try{ const s=await api('GET','/api/state'); const h=JSON.stringify(s); if(force||h!==window._sh){ window._sh=h; ST=s;
    const a=document.activeElement; const typing=a&&/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName);
    const draftOpen=UI.tab==='rubric'&&UI.draft; if(force||(!typing&&!draftOpen)) render(); } }catch(e){}
}
""" + body[j:]
# backup removal
i = body.index("function backup(){"); j = body.index("function exportCSV")
body = body[:i] + body[j:]
# tail: remove final render() and add views
body = body.rstrip()
assert body.endswith("render();\n</script>\n</body>\n</html>")
body = body[:-len("render();\n</script>\n</body>\n</html>")]
views = open(os.path.join(S, 'hosted_views.js'), encoding='utf8').read()
final = head + "<script>\n" + pre + body + "\n" + views + "\n</script>\n</body>\n</html>\n"
final = final.replace("""<header class="top">""", """<div id="gate" class="gate hide"></div>\n<header class="top" id="hdr">""")
final = final.replace("""<div class="who"><span class="muted" id="whoLbl"></span><button class="btn s d" id="whoBtn">Set name</button><button class="btn s g" id="expBtn">Backup</button></div>""",
                      """<div class="who"><span class="muted" id="whoLbl"></span><button class="btn s d" id="whoBtn">Account</button><button class="btn s g hide" id="expBtn">Backup</button></div>""")
final = final.replace("</style>", """.gate{position:fixed;inset:0;background:var(--bg);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
.gate .box{background:#fff;border:1px solid var(--line);border-radius:18px;padding:30px;width:min(400px,100%);box-shadow:0 8px 30px rgba(0,0,0,.08)}
.gate h1{font-size:20px;text-transform:uppercase;margin:14px 0 4px}.gate h1 em{font-style:normal;color:var(--green)}
.gate label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:12px 0 3px}
.gate input{width:100%;font:inherit;border:1.5px solid var(--line);border-radius:10px;padding:9px 11px}
.gate input:focus{outline:2px solid var(--green);border-color:var(--green)}
.gate .err{color:#B21D04;font-size:12.5px;margin-top:10px;min-height:18px}
.ro .editonly,.ro .ntrow,.ro #ntext,.ro .al .btns{display:none!important}
</style>""")
os.makedirs(os.path.join(OUT, 'public'), exist_ok=True)
open(os.path.join(OUT, 'public', 'index.html'), 'w', encoding='utf8').write(final)
print('built', len(final) // 1024, 'KB')
