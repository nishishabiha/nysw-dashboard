/* ===================== HOSTED: login, account, admin ===================== */
const LOGO = '<span class="logo">NY<b>SUN</b><br>WORKS<small>Partner School Success</small></span>';
function showGate(html){ const g=$('#gate'); g.classList.remove('hide'); g.innerHTML='<div class="box">'+LOGO+html+'</div>'; $('#hdr').classList.add('hide'); $('#main').classList.add('hide'); }
function showLogin(msg){
  showGate(`<h1>Sign in to <em>the dashboard</em></h1><form id="lf"><label>Email</label><input id="le" type="email" autocomplete="username" required><label>Password</label><input id="lp" type="password" autocomplete="current-password" required><div class="err" id="lerr">${esc(msg||'')}</div><button class="btn g" style="width:100%;margin-top:6px">Sign in</button></form>`);
  $('#lf').onsubmit=async ev=>{ ev.preventDefault(); $('#lerr').textContent='';
    try{ const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'nysw'},body:JSON.stringify({email:$('#le').value,password:$('#lp').value})}); const j=await r.json(); if(!r.ok) throw new Error(j.error||'Sign-in failed'); boot(); }
    catch(e){ $('#lerr').textContent=e.message; } };
}
function showChangePw(forced){
  showGate(`<h1>Choose a <em>new password</em></h1><p class="src">${forced?'Your account needs a new password before you continue.':''} Use at least 10 characters.</p><form id="pf"><label>Current / temporary password</label><input id="pc" type="password" autocomplete="current-password" required><label>New password</label><input id="pn" type="password" autocomplete="new-password" minlength="10" required><div class="err" id="perr"></div><button class="btn g" style="width:100%;margin-top:6px">Save password</button></form>`);
  $('#pf').onsubmit=async ev=>{ ev.preventDefault(); try{ await api('POST','/api/password',{current:$('#pc').value,next:$('#pn').value}); boot(); }catch(e){ $('#perr').textContent=e.message; } };
}
async function boot(){
  let me;
  try{ const r=await fetch('/api/me',{credentials:'same-origin'}); if(r.status===401) return showLogin(); me=await r.json(); }
  catch(e){ return showGate('<p>Cannot reach the server. Check your connection and reload.</p>'); }
  ME=me;
  if(me.mustChange) return showChangePw(true);
  try{ [DATA,ST]=await Promise.all([api('GET','/api/data'),api('GET','/api/state')]); }
  catch(e){ return showGate('<p>'+esc(e.message)+'</p>'); }
  window._sh=JSON.stringify(ST);
  start();
  $('#gate').classList.add('hide'); $('#hdr').classList.remove('hide'); $('#main').classList.remove('hide');
  render();
  if(!window._poll) window._poll=setInterval(()=>{ if(!document.hidden) refresh(); },40000);
}
function vAccount(m){
  hero(m,'Your <em>account</em>','Notes, alert actions and rubric changes are saved to the shared database with your name on them.');
  m.insertAdjacentHTML('beforeend',`<div class="grid g2"><div class="card"><h3>Profile</h3><div class="kv" style="grid-template-columns:1fr 1fr"><div><small>Name</small><span>${esc(ME.name)}</span></div><div><small>Email</small><span>${esc(ME.email)}</span></div><div><small>Role</small><span>${esc(ME.role)}</span></div><div><small>Weekly email digest</small><span>${ME.am?'Yes — '+esc(ME.am)+' schools':'Not set (ask an admin)'}</span></div></div>
   <p class="src"><b>admin</b> can change the rubric, users and data. <b>staff</b> can add notes, resolve alerts and fix assignments. <b>viewer</b> is read-only.</p><button class="btn d" id="logout">Sign out</button></div>
   <div class="card"><h3>Change password</h3><div class="f"><input id="pc" type="password" placeholder="Current password" autocomplete="current-password"><input id="pn" type="password" placeholder="New password (10+ characters)" autocomplete="new-password"><div class="row"><button class="btn g" id="pwsave">Update password</button></div></div></div></div>`);
}
async function vAdmin(m){
  hero(m,'Team &amp; <em>admin</em>','Manage who can sign in, upload fresh data, restore hidden schools and review the audit trail.');
  m.insertAdjacentHTML('beforeend','<div id="adm" class="muted">Loading…</div>');
  let U,A,Mi; try{ [U,A,Mi]=await Promise.all([api('GET','/api/admin/users'),api('GET','/api/admin/audit?limit=80'),api('GET','/api/admin/mail')]); }catch(e){ $('#adm').textContent=e.message; return; }
  const hidden=Object.entries(ST.ov||{}).filter(([c,o])=>o.excl).map(([c])=>c);
  const ams=[...new Set(Object.values(DATA.schools).map(s=>s.am).filter(Boolean))].sort();
  $('#adm').outerHTML=`
  <div class="card"><h3>Users <span class="src" style="text-transform:none;letter-spacing:0">${U.length}</span></h3>
   <table class="mini"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Digest for AM</th><th>Active</th><th>Last sign-in</th><th></th></tr></thead><tbody>${U.map(u=>`<tr data-urow="${u.id}"><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
    <td><select class="u-role">${['admin','staff','viewer'].map(r=>`<option ${u.role===r?'selected':''}>${r}</option>`).join('')}</select></td>
    <td><select class="u-am"><option value="">— none —</option>${ams.map(a=>`<option ${u.am===a?'selected':''}>${esc(a)}</option>`).join('')}</select></td>
    <td><input type="checkbox" class="u-act" ${u.active?'checked':''}></td><td class="src">${u.lastLogin?new Date(u.lastLogin).toLocaleString():'never'}</td>
    <td><button class="btn s o" data-usave="${u.id}">Save</button> <button class="btn s d" data-ureset="${u.id}">Reset password</button></td></tr>`).join('')}</tbody></table>
   <h3 style="margin-top:16px">Add a user</h3><div class="row f" style="display:flex;gap:8px;flex-wrap:wrap"><input id="nu-name" placeholder="Full name"><input id="nu-email" type="email" placeholder="Email"><select id="nu-role"><option>staff</option><option>viewer</option><option>admin</option></select><select id="nu-am"><option value="">Digest for AM…</option>${ams.map(a=>`<option>${esc(a)}</option>`).join('')}</select><input id="nu-pw" placeholder="Temporary password (10+)"><button class="btn g" id="nu-add">Add user</button></div>
   <div class="src">They are made to choose their own password at first sign-in. Share the temporary password out-of-band, not by email.</div></div>
  <div class="grid g2" style="margin-top:14px"><div class="card"><h3>Email digests</h3><p class="src" style="margin-top:0">${Mi.configured?'Sending is configured (provider: Resend). Digests go out Mondays 7am Eastern to users with a “Digest for AM”.':'Not configured. Set RESEND_API_KEY and MAIL_FROM on the server to enable. Until then, use the “Email digest” buttons (they open your own mail app).'}<br>Last automatic send: ${Mi.last?esc(Mi.last):'never'}</p><div class="row" style="display:flex;gap:8px"><button class="btn s o" id="dg-test" ${Mi.configured?'':'disabled'}>Send me a test</button><button class="btn s g" id="dg-all" ${Mi.configured?'':'disabled'}>Send all digests now</button></div></div>
   <div class="card"><h3>Data</h3><p class="src" style="margin-top:0">Loaded: data through <b>${fmtDY(DATA.meta.asOf)}</b>, built ${esc(DATA.meta.built||'')}. Run the pipeline on new Accelo exports, then upload the generated <code>data.json</code> here — notes and settings are kept.</p><input type="file" id="data-file" accept=".json"> <button class="btn s g" id="data-up">Upload data</button></div></div>
  <div class="card" style="margin-top:14px"><h3>Hidden schools</h3>${hidden.length?hidden.map(c=>`<div>${esc(c)} ${esc(DATA.schools[c]?.name||'')} <button class="btn s d" data-restore="${esc(c)}">Restore</button></div>`).join(''):'<span class="muted">None.</span>'}</div>
  <div class="card" style="margin-top:14px"><h3>Audit trail <span class="src" style="text-transform:none;letter-spacing:0">latest ${A.length}</span></h3><table class="mini"><tbody>${A.map(a=>`<tr><td class="src" style="white-space:nowrap">${new Date(a.ts).toLocaleString()}</td><td><b>${esc(a.by)}</b></td><td>${esc(a.action)}</td><td>${esc(a.target||'')}</td><td class="src">${esc(a.detail||'')}</td></tr>`).join('')}</tbody></table></div>`;
}
function adminClick(e){
  const id=e.target.id, d=e.target.dataset;
  const go=async(fn,msg)=>{ try{ await fn(); if(msg) toast(msg); }catch(er){ toast(er.message); } };
  if(id==='logout'){ go(async()=>{ await api('POST','/api/logout',{}); location.reload(); }); return true; }
  if(id==='pwsave'){ go(async()=>{ await api('POST','/api/password',{current:$('#pc').value,next:$('#pn').value}); $('#pc').value=$('#pn').value=''; },'Password updated'); return true; }
  if(id==='nu-add'){ go(async()=>{ await api('POST','/api/admin/users',{name:$('#nu-name').value,email:$('#nu-email').value,role:$('#nu-role').value,am:$('#nu-am').value||null,password:$('#nu-pw').value}); render(); },'User added'); return true; }
  if(d.usave){ const row=e.target.closest('tr'); go(async()=>{ await api('POST','/api/admin/users/update',{id:d.usave,role:row.querySelector('.u-role').value,am:row.querySelector('.u-am').value||null,active:row.querySelector('.u-act').checked}); render(); },'Saved'); return true; }
  if(d.ureset){ const p=prompt('Temporary password for this user (10+ characters). They will be asked to change it at next sign-in:'); if(p) go(async()=>{ await api('POST','/api/admin/users/update',{id:d.ureset,password:p}); },'Password reset'); return true; }
  if(d.restore){ mutate('/api/override',{code:d.restore,excl:false},'Restored'); return true; }
  if(id==='dg-test'||id==='dg-all'){ go(async()=>{ const r=await api('POST','/api/admin/digest',{all:id==='dg-all'}); toast(`Sent ${r.sent} email${r.sent===1?'':'s'}`); render(); }); return true; }
  if(id==='data-up'){ const f=$('#data-file').files[0]; if(!f){ toast('Choose data.json first'); return true; } go(async()=>{ const txt=await f.text(); const j=JSON.parse(txt); const r=await api('POST','/api/admin/data',j); DATA=await api('GET','/api/data'); start(); render(); },'Data updated'); return true; }
  return false;
}
boot();
