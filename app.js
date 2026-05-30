
// -- DB ------------------------------------------------------------------------
let DB, CASES=[];
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open('SurgLog',3);
    r.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('cases'))
        db.createObjectStore('cases',{keyPath:'id'});
      // v3: separate store for clinical photos (blobs stay local, never exported)
      if(!db.objectStoreNames.contains('photos'))
        db.createObjectStore('photos',{keyPath:'id'});
    };
    r.onsuccess=e=>{DB=e.target.result;res()};
    r.onerror=e=>rej(e);
  });
}
// Photo DB helpers
async function dbPhotoPut(obj){return new Promise(res=>{const tx=DB.transaction('photos','readwrite');tx.objectStore('photos').put(obj);tx.oncomplete=res;});}
async function dbPhotoGet(id){return new Promise(res=>{const tx=DB.transaction('photos','readonly');const r=tx.objectStore('photos').get(id);r.onsuccess=()=>res(r.result);});}
async function dbPhotoDel(id){return new Promise(res=>{const tx=DB.transaction('photos','readwrite');tx.objectStore('photos').delete(id);tx.oncomplete=res;});}
async function dbPhotoGetAll(caseId){
  return new Promise(res=>{
    const tx=DB.transaction('photos','readonly');
    const r=tx.objectStore('photos').getAll();
    r.onsuccess=()=>res((r.result||[]).filter(p=>p.caseId===caseId));
  });
}
async function dbGetAll(){
  return new Promise(res=>{
    const tx=DB.transaction('cases','readonly');
    const r=tx.objectStore('cases').getAll();
    r.onsuccess=()=>res((r.result||[]).sort((a,b)=>(b.opdate||'').localeCompare(a.opdate||'')));
  });
}
async function dbPut(c){
  return new Promise(res=>{
    const tx=DB.transaction('cases','readwrite');
    tx.objectStore('cases').put(c);
    tx.oncomplete=res;
  });
}
async function dbDel(id){
  return new Promise(res=>{
    const tx=DB.transaction('cases','readwrite');
    tx.objectStore('cases').delete(id);
    tx.oncomplete=res;
  });
}

// -- State helpers -------------------------------------------------------------
function ls(k){try{return localStorage.getItem(k);}catch{return null;}}
function lss(k,v){try{localStorage.setItem(k,v);}catch{}}
function getApiKey(){return ls('surglog_apikey')||'';}
function getGset(){try{return JSON.parse(ls('gset_tracker')||'{}');}catch{return {};}}
function saveGset(s){lss('gset_tracker',JSON.stringify(s));}
function getCriteria(){
  const def={
    selYear:2026,intakeYear:2027,closeDate:'2026-03-19',
    wRural:10,wCv:20,wRef:20,wInt:50,
    ruralEd:3,ruralOrig:3,ruralExp:4,ruralTotal:10,
    cvQual:4,cvPres:3,cvPub:5,cvTeach:3,cvIndig:4,cvTotal:19,
    eligGsWks:26,eligCcWks:8,eligConsult:4,eligRefs:15,eligRefGrps:5,
    validFrom:'2022-12-01'
  };
  try{return Object.assign({},def,JSON.parse(ls('gset_criteria')||'{}'));}catch{return def;}
}
function getLastExport(){return ls('surglog_last_export');}

// -- Screen routing ------------------------------------------------------------
let currentScreen='home';
function showScreen(s){
  document.querySelectorAll('.screen').forEach(el=>el.classList.remove('act'));
  document.querySelectorAll('.nb').forEach(el=>el.classList.remove('on'));
  document.getElementById('s-'+s).classList.add('act');
  const nb=document.getElementById('nb-'+s);
  if(nb) nb.classList.add('on');
  currentScreen=s;
  document.getElementById('hdr-action').style.display=(s==='add')?'none':'flex';
  if(s==='home') renderDashboard();
  if(s==='log'){populateFilterUI();renderLogbook();}
  if(s==='analytics'){populateAnalyticsDropdowns();renderAnalytics();}
  if(s==='gset') renderGset();
  if(s==='settings'){renderSettings();renderBackupBanner();}
  document.getElementById('screens').scrollTop=0;
}

// -- Role badge helper ---------------------------------------------------------
function roleBadge(role){
  const map={'Primary Operator':'bg-pr','Supervised':'bg-am','1st Assist':'bg-bl',
    '2nd Assist':'bg-bl','Observer':'bg-gy'};
  return role?`<span class="badge ${map[role]||'bg-gy'}">${role}</span>`:'';
}

// -- Case item HTML ------------------------------------------------------------
function caseItemHTML(c){
  return `<div class="oi" onclick="openDetail('${c.id}')">
    <div class="oi-top">
      <div class="oi-title">${c.procedure||'Unnamed procedure'}</div>
      <div class="oi-date">${c.opdate||''}</div>
    </div>
    <div class="oi-meta">
      ${roleBadge(c.role)}
      ${c.specialty?`<span>${c.specialty}</span>`:''}
      ${c.hospital?`<span style="color:var(--text3)">. ${c.hospital}</span>`:''}
    </div>
  </div>`;
}

// -- DASHBOARD -----------------------------------------------------------------
function renderDashboard(){
  document.getElementById('dash-api-warn').style.display=getApiKey()?'none':'block';
  const cases=CASES;
  const total=cases.length;
  const primary=cases.filter(c=>['Primary Operator','Supervised'].includes(c.role)).length;
  const pct=total?Math.round(primary/total*100):0;
  const yr=new Date().getFullYear().toString();
  const ytd=cases.filter(c=>(c.opdate||'').startsWith(yr)).length;
  const specs=new Set(cases.map(c=>c.specialty).filter(Boolean)).size;
  document.getElementById('dash-stats').innerHTML=`
    <div class="sc"><div class="sc-l">Total cases</div><div class="sc-v">${total}</div><div class="sc-s">all time</div></div>
    <div class="sc"><div class="sc-l">Primary rate</div><div class="sc-v">${pct}%</div><div class="sc-s">${primary} cases</div></div>
    <div class="sc"><div class="sc-l">This year</div><div class="sc-v">${ytd}</div><div class="sc-s">${yr}</div></div>
    <div class="sc"><div class="sc-l">Specialties</div><div class="sc-v">${specs}</div><div class="sc-s">areas covered</div></div>`;

  const renderChart=(elId,data,color)=>{
    const sorted=Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const max=sorted[0]?.[1]||1;
    document.getElementById(elId).innerHTML=sorted.length?sorted.map(([k,v])=>`
      <div class="bar-wrap">
        <div class="bar-lbl"><span>${k}</span><span>${v}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(v/max*100)}%;background:${color}"></div></div>
      </div>`).join(''):'<p style="font-size:13px;color:var(--text3);text-align:center;padding:10px">No cases yet</p>';
  };

  const byRole={},bySpec={};
  cases.forEach(c=>{
    if(c.role) byRole[c.role]=(byRole[c.role]||0)+1;
    if(c.specialty) bySpec[c.specialty]=(bySpec[c.specialty]||0)+1;
  });
  renderChart('dash-role-chart',byRole,'var(--accent)');
  renderChart('dash-spec-chart',bySpec,'var(--blue)');
  document.getElementById('dash-recent').innerHTML=cases.slice(0,5).map(caseItemHTML).join('')||
    '<div class="empty"><div class="empty-icon"></div><div class="empty-text">No cases yet. Tap + Case to get started.</div></div>';
}

// -- SEARCH --------------------------------------------------------------------
function focusSearch(){setTimeout(()=>document.getElementById('srch-input')?.focus(),200);}
function clearSearch(){
  document.getElementById('srch-input').value='';
  document.getElementById('srch-clear').classList.remove('vis');
  document.getElementById('srch-results').innerHTML='<div class="empty"><div class="empty-icon"></div><div class="empty-text">Search by name, UR number, or procedure</div></div>';
}
function runSearch(q){
  document.getElementById('srch-clear').classList.toggle('vis',q.length>0);
  if(!q.trim()){clearSearch();return;}
  const lq=q.toLowerCase().trim();
  const results=CASES.filter(c=>{
    const name=((c.surname||'')+' '+(c.given||'')).toLowerCase();
    const nameRev=((c.given||'')+' '+(c.surname||'')).toLowerCase();
    return name.includes(lq)||nameRev.includes(lq)||
      (c.ur||'').toLowerCase().includes(lq)||
      (c.procedure||'').toLowerCase().includes(lq)||
      (c.hospital||'').toLowerCase().includes(lq)||
      (c.supervisor||'').toLowerCase().includes(lq)||
      (c.specialty||'').toLowerCase().includes(lq)||
      (c.opdate||'').includes(lq);
  });
  const el=document.getElementById('srch-results');
  if(!results.length){
    el.innerHTML='<div class="empty"><div class="empty-icon"></div><div class="empty-text">No cases match "'+q+'"</div></div>';
    return;
  }
  el.innerHTML=`<div style="font-size:12px;color:var(--text3);margin-bottom:8px">${results.length} result${results.length===1?'':'s'}</div>`+
    results.map(c=>{
      const name=[c.given,c.surname].filter(Boolean).join(' ');
      const hl=v=>v?(v+'').replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),m=>`<mark style="background:var(--acl);border-radius:2px">${m}</mark>`):v;
      return `<div class="oi" onclick="openDetail('${c.id}')">
        <div class="oi-top">
          <div class="oi-title">${hl(c.procedure||'Unnamed procedure')}</div>
          <div class="oi-date">${c.opdate||''}</div>
        </div>
        <div class="oi-meta" style="margin-top:3px">
          ${name?`<span style="font-weight:500">${hl(name)}</span>`:''}
          ${c.ur?`<span style="font-family:monospace;font-size:11px">UR: ${hl(c.ur)}</span>`:''}
          ${roleBadge(c.role)}
          ${c.hospital?`<span style="color:var(--text3)">${hl(c.hospital)}</span>`:''}
        </div>
      </div>`;
    }).join('');
}

// -- FILTERS -------------------------------------------------------------------
let activeFilters={roles:[],specs:[],hospitals:[],outcomes:[],complexity:[],years:[],from:'',to:''};

function clearAllFilters(){
  activeFilters={roles:[],specs:[],hospitals:[],outcomes:[],complexity:[],years:[],from:'',to:''};
  ['fl-from','fl-to'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  renderLogbook();
}

function applyFilter(type,val){
  const arr=activeFilters[type];
  const idx=arr.indexOf(val);
  if(idx>=0) arr.splice(idx,1); else arr.push(val);
  renderLogbook();
}

function getFilteredCases(){
  return CASES.filter(c=>{
    const af=activeFilters;
    if(af.roles.length&&!af.roles.includes(c.role||'')) return false;
    if(af.specs.length&&!af.specs.includes(c.specialty||'')) return false;
    if(af.hospitals.length&&!af.hospitals.includes(c.hospital||'')) return false;
    if(af.outcomes.length&&!af.outcomes.includes(c.outcome||'')) return false;
    if(af.complexity.length&&!af.complexity.includes(String(c.complexity||'').charAt(0))) return false;
    if(af.years.length&&!af.years.includes((c.opdate||'').slice(0,4))) return false;
    if(af.from&&(c.opdate||'')<af.from) return false;
    if(af.to&&(c.opdate||'')>af.to) return false;
    return true;
  });
}

function hasActiveFilters(){
  const af=activeFilters;
  return af.roles.length||af.specs.length||af.hospitals.length||
    af.outcomes.length||af.complexity.length||af.years.length||af.from||af.to;
}

function populateFilterUI(){
  const roles=['Primary Operator','Supervised','1st Assist','2nd Assist','Observer'];
  const specs=[...new Set(CASES.map(c=>c.specialty).filter(Boolean))].sort();
  const hospitals=[...new Set(CASES.map(c=>c.hospital).filter(Boolean))].sort();
  const outcomes=[...new Set(CASES.map(c=>c.outcome).filter(Boolean))].sort();
  const years=[...new Set(CASES.map(c=>(c.opdate||'').slice(0,4)).filter(Boolean))].sort().reverse();
  const complexities=['1','2','3','4','5'];

  const makeChips=(elId,items,type,labelFn)=>{
    const el=document.getElementById(elId);
    if(!el) return;
    el.innerHTML=items.map(v=>`
      <button class="chip${activeFilters[type]?.includes(v)?' on':''}"
        onclick="applyFilter('${type}','${v}');populateFilterUI()">${labelFn?labelFn(v):v}</button>`).join('');
  };
  makeChips('fl-roles',roles,'roles');
  makeChips('fl-specs',specs,'specs');
  makeChips('fl-hospitals',hospitals,'hospitals');
  makeChips('fl-outcomes',outcomes,'outcomes');
  makeChips('fl-complexity',complexities,'complexity',v=>`${v} - ${['','Straightforward','Minor','Moderate','Complex','Highly complex'][v]}`);
  makeChips('fl-years',years,'years');
  // date
  const fd=document.getElementById('fl-from'),td=document.getElementById('fl-to');
  if(fd) fd.value=activeFilters.from||'';
  if(td) td.value=activeFilters.to||'';
  // attach date listeners
  if(fd) fd.onchange=e=>{activeFilters.from=e.target.value;};
  if(td) td.onchange=e=>{activeFilters.to=e.target.value;};
}

function openFilterPanel(){populateFilterUI();document.getElementById('ov-filter').classList.add('open');}

function renderLogbook(){
  const filtered=getFilteredCases();
  const hasF=hasActiveFilters();

  // Quick chips (years + all)
  const years=[...new Set(CASES.map(c=>(c.opdate||'').slice(0,4)).filter(Boolean))].sort().reverse();
  document.getElementById('quick-chips').innerHTML=
    `<button class="chip${!activeFilters.years.length&&!hasF?' on':''}" onclick="clearAllFilters()">All</button>`+
    years.map(y=>`<button class="chip${activeFilters.years.includes(y)?' on':''}" onclick="applyFilter('years','${y}')">${y}</button>`).join('');

  document.getElementById('result-count').textContent=
    `${filtered.length} case${filtered.length===1?'':'s'}${hasF?' (filtered)':''}`;

  // Active filter analytics mini card
  const afBar=document.getElementById('active-filter-bar');
  if(hasF){
    afBar.style.display='block';
    const labels=[];
    if(activeFilters.roles.length) labels.push(activeFilters.roles.join(', '));
    if(activeFilters.specs.length) labels.push(activeFilters.specs.join(', '));
    if(activeFilters.hospitals.length) labels.push(activeFilters.hospitals.join(', '));
    if(activeFilters.years.length) labels.push(activeFilters.years.join(', '));
    if(activeFilters.from||activeFilters.to) labels.push(`${activeFilters.from||'...'} -> ${activeFilters.to||'...'}`);
    document.getElementById('active-filter-label').textContent=labels.join(' . ');
    // Mini analytics for filtered set
    const prim=filtered.filter(c=>['Primary Operator','Supervised'].includes(c.role)).length;
    const pct=filtered.length?Math.round(prim/filtered.length*100):0;
    const specs={};
    filtered.forEach(c=>{if(c.specialty)specs[c.specialty]=(specs[c.specialty]||0)+1;});
    const topSpec=Object.entries(specs).sort((a,b)=>b[1]-a[1])[0];
    document.getElementById('filter-analytics').innerHTML=`
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <div><div style="font-size:20px;font-weight:700;color:var(--accent)">${filtered.length}</div><div style="font-size:11px;color:var(--text3)">cases</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--blue)">${pct}%</div><div style="font-size:11px;color:var(--text3)">primary rate</div></div>
        ${topSpec?`<div><div style="font-size:13px;font-weight:600;color:var(--text)">${topSpec[0]}</div><div style="font-size:11px;color:var(--text3)">top specialty (${topSpec[1]})</div></div>`:''}
      </div>`;
  } else {
    afBar.style.display='none';
  }

  document.getElementById('log-list').innerHTML=filtered.length?
    filtered.map(caseItemHTML).join(''):
    `<div class="empty"><div class="empty-icon"></div><div class="empty-text">No cases match the current filters.</div></div>`;
}

// -- ANALYTICS -----------------------------------------------------------------
function populateAnalyticsDropdowns(){
  const hosp=[...new Set(CASES.map(c=>c.hospital).filter(Boolean))].sort();
  const specs=[...new Set(CASES.map(c=>c.specialty).filter(Boolean))].sort();
  const years=[...new Set(CASES.map(c=>(c.opdate||'').slice(0,4)).filter(Boolean))].sort().reverse();
  const fill=(id,items)=>{
    const el=document.getElementById(id);
    if(!el) return;
    const first=el.options[0].outerHTML;
    el.innerHTML=first+items.map(v=>`<option>${v}</option>`).join('');
  };
  fill('an-hospital',hosp);fill('an-specialty',specs);fill('an-year',years);
}

function getAnalyticsFiltered(){
  const h=document.getElementById('an-hospital')?.value||'';
  const s=document.getElementById('an-specialty')?.value||'';
  const r=document.getElementById('an-role')?.value||'';
  const y=document.getElementById('an-year')?.value||'';
  const f=document.getElementById('an-from')?.value||'';
  const t=document.getElementById('an-to')?.value||'';
  return CASES.filter(c=>{
    if(h&&c.hospital!==h) return false;
    if(s&&c.specialty!==s) return false;
    if(r&&c.role!==r) return false;
    if(y&&!(c.opdate||'').startsWith(y)) return false;
    if(f&&(c.opdate||'')<f) return false;
    if(t&&(c.opdate||'')>t) return false;
    return true;
  });
}

function renderAnalytics(){
  const cases=getAnalyticsFiltered();
  const total=cases.length;
  if(!total){
    document.getElementById('analytics-body').innerHTML=
      '<div class="empty"><div class="empty-icon"></div><div class="empty-text">No cases match these filters.</div></div>';
    return;
  }

  // Aggregate helpers
  const countBy=key=>{const m={};cases.forEach(c=>{const v=c[key]||'Unknown';m[v]=(m[v]||0)+1;});return m;};
  const sorted=obj=>Object.entries(obj).sort((a,b)=>b[1]-a[1]);
  const pct=(n,d)=>d?Math.round(n/d*100)+'%':'-';

  const primary=cases.filter(c=>['Primary Operator','Supervised'].includes(c.role)).length;
  const byRole=countBy('role'),bySpec=countBy('specialty'),byHosp=countBy('hospital');
  const byOutcome=countBy('outcome'),byYear=countBy('opdate');
  // group by year
  const byYearMap={};
  cases.forEach(c=>{const y=(c.opdate||'????').slice(0,4);byYearMap[y]=(byYearMap[y]||0)+1;});

  const tableHTML=(rows,headers)=>`
    <table class="atbl"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  const barSection=(title,data,colorVar)=>{
    const max=sorted(data)[0]?.[1]||1;
    return `<div class="sh">${title}</div><div class="card">${
      sorted(data).map(([k,v])=>`<div class="bar-wrap">
        <div class="bar-lbl"><span>${k}</span><span>${v} (${pct(v,total)})</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(v/max*100)}%;background:${colorVar}"></div></div>
      </div>`).join('')}</div>`;
  };

  // Primary operator rate per hospital
  const hospData={};
  cases.forEach(c=>{
    const h=c.hospital||'Unknown';
    if(!hospData[h]) hospData[h]={total:0,primary:0};
    hospData[h].total++;
    if(['Primary Operator','Supervised'].includes(c.role)) hospData[h].primary++;
  });
  const hospRows=Object.entries(hospData).sort((a,b)=>b[1].total-a[1].total)
    .map(([h,d])=>[h,d.total,d.primary,pct(d.primary,d.total)]);

  // Primary rate per specialty
  const specData={};
  cases.forEach(c=>{
    const s=c.specialty||'Unknown';
    if(!specData[s]) specData[s]={total:0,primary:0};
    specData[s].total++;
    if(['Primary Operator','Supervised'].includes(c.role)) specData[s].primary++;
  });
  const specRows=Object.entries(specData).sort((a,b)=>b[1].total-a[1].total)
    .map(([s,d])=>[s,d.total,d.primary,pct(d.primary,d.total)]);

  // Cases per month for trend
  const monthMap={};
  cases.forEach(c=>{
    const m=(c.opdate||'').slice(0,7);
    if(m) monthMap[m]=(monthMap[m]||0)+1;
  });
  const monthRows=Object.entries(monthMap).sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([m,v])=>[m,v]);

  document.getElementById('analytics-body').innerHTML=`
    <div class="sh" style="margin-top:0">Summary (${total} cases)</div>
    <div class="sg">
      <div class="sc"><div class="sc-l">Total cases</div><div class="sc-v">${total}</div></div>
      <div class="sc"><div class="sc-l">Primary rate</div><div class="sc-v">${pct(primary,total)}</div><div class="sc-s">${primary} cases</div></div>
      <div class="sc"><div class="sc-l">Hospitals</div><div class="sc-v">${Object.keys(hospData).length}</div></div>
      <div class="sc"><div class="sc-l">Specialties</div><div class="sc-v">${Object.keys(specData).length}</div></div>
    </div>

    <div class="sh">Primary operator rate by hospital</div>
    <div class="card" style="padding:10px 0;overflow-x:auto">
      ${tableHTML(hospRows,['Hospital','Cases','Primary / Supervised','Rate'])}
    </div>

    <div class="sh">Primary operator rate by specialty</div>
    <div class="card" style="padding:10px 0;overflow-x:auto">
      ${tableHTML(specRows,['Specialty','Cases','Primary / Supervised','Rate'])}
    </div>

    ${barSection('Cases by role',byRole,'var(--accent)')}
    ${barSection('Cases by specialty',bySpec,'var(--blue)')}
    ${barSection('Cases by hospital',byHosp,'var(--amber)')}
    ${barSection('Cases by outcome',byOutcome,'var(--text3)')}

    <div class="sh">Cases by year</div>
    <div class="card" style="padding:10px 0;overflow-x:auto">
      ${tableHTML(Object.entries(byYearMap).sort((a,b)=>b[0].localeCompare(a[0])).map(([y,v])=>[y,v,pct(v,total)]),['Year','Cases','%'])}
    </div>

    ${monthRows.length>1?`<div class="sh">Monthly trend</div><div class="card" style="padding:10px 0;overflow-x:auto">
      ${tableHTML(monthRows.slice(-12),['Month (YYYY-MM)','Cases'])}</div>`:''}
  `;
}

// -- DETAIL OVERLAY ------------------------------------------------------------
let detailCaseId=null;
function openDetail(id){
  detailCaseId=id;
  const c=CASES.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('ov-detail-title').textContent=c.procedure||'Case detail';
  const row=(label,val)=>val?`<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:.5px solid var(--border2)">
    <span style="font-size:12.5px;color:var(--text2);flex-shrink:0;margin-right:12px">${label}</span>
    <span style="font-size:13.5px;text-align:right">${val}</span></div>`:'';
  document.getElementById('ov-detail-body').innerHTML=`
    <div class="sh" style="margin-top:0">Patient</div>
    <div class="card" style="padding:4px 14px">
      ${row('Name',[c.given,c.surname].filter(Boolean).join(' '))}
      ${row('Date of birth',c.dob+(c.age?` (age ${c.age})`:'' ))}
      ${row('UR number',c.ur?`<span style="font-family:monospace">${c.ur}</span>`:'')}
    </div>
    <div class="sh">Operation</div>
    <div class="card" style="padding:4px 14px">
      ${row('Date',c.opdate)}
      ${row('Role',roleBadge(c.role))}
      ${row('Supervisor',c.supervisor)}
      ${row('1st Assist',c.assist1)}
      ${row('2nd Assist',c.assist2)}
      ${row('Anaesthetist',c.anaesthetist)}
      ${row('Hospital',c.hospital)}
      ${row('Specialty',c.specialty)}
      ${row('Classification',c.classification)}
      ${row('Complexity',c.complexity)}
      ${row('Outcome',c.outcome)}
    </div>
    ${c.steps?`<div class="sh">Key steps performed</div><div class="card"><p style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${c.steps}</p></div>`:''}
    ${c.learning?`<div class="sh">Learning points</div><div class="card"><p style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${c.learning}</p></div>`:''}
    <div class="sh">Clinical photos</div>
    <div id="detail-photos-wrap" style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--text3);padding:8px 0">Loading photos...</div>
    </div>
    <div style="display:flex;gap:9px;margin-top:4px">
      <button class="btn danger sm" onclick="confirmDelete('${c.id}')">Delete case</button>
    </div>
    <div style="height:20px"></div>\`;
  // Load photos async after rendering detail
  loadDetailPhotos(id);
  document.getElementById('ov-detail').classList.add('open');
}
function editCurrentCase(){
  closeOverlay('ov-detail');
  const c=CASES.find(x=>x.id===detailCaseId);
  if(!c) return;
  showScreen('add');
  setTimeout(()=>{
    const flds={
      'f-surname':'surname','f-given':'given','f-dob':'dob','f-age':'age',
      'f-ur':'ur','f-opdate':'opdate','f-proc':'procedure','f-role':'role',
      'f-supervisor':'supervisor','f-hospital':'hospital','f-assist1':'assist1',
      'f-assist2':'assist2','f-anaesthetist':'anaesthetist','f-specialty':'specialty','f-classification':'classification',
      'f-complexity':'complexity','f-outcome':'outcome','f-steps':'steps','f-learning':'learning'
    };
    Object.entries(flds).forEach(([id,key])=>{
      const el=document.getElementById(id);
      if(el) el.value=c[key]||'';
    });
    document.getElementById('f-edit-id').value=c.id;
    // Load existing photos into grid
    _pendingPhotos=[];
    const cpg=document.getElementById('clinical-photos-grid');
    if(cpg&&c.photoIds&&c.photoIds.length){
      cpg.innerHTML='';
      c.photoIds.forEach(async pid=>{
        const p=await dbPhotoGet(pid);
        if(p) renderPhotoThumb(cpg,p.dataUrl,p.caption,pid,true);
      });
    }
  },80);
}
async function confirmDelete(id){
  if(!confirm('Delete this case? This cannot be undone.')) return;
  await dbDel(id);
  CASES=await dbGetAll();
  closeOverlay('ov-detail');
  renderDashboard();
  renderLogbook();
}
function closeOverlay(id){document.getElementById(id).classList.remove('open');}

// -- ADD / EDIT CASE -----------------------------------------------------------
function openAdd(){showScreen('add');clearForm();}
function calcAge(){
  const dob=document.getElementById('f-dob').value;
  if(!dob) return;
  document.getElementById('f-age').value=Math.floor((Date.now()-new Date(dob))/31557600000);
}
function clearForm(){
  ['f-surname','f-given','f-dob','f-age','f-ur','f-proc','f-supervisor','f-hospital',
   'f-assist1','f-assist2','f-anaesthetist','f-classification','f-steps','f-learning'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';});
  ['f-role','f-specialty','f-complexity'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('f-outcome').value='Uneventful';
  document.getElementById('f-opdate').value=new Date().toISOString().slice(0,10);
  document.getElementById('f-edit-id').value='';
  document.getElementById('sticker-result').innerHTML='';
  document.getElementById('opnote-result').innerHTML='';
  const sf=document.getElementById('sticker-fallback');if(sf)sf.style.display='none';
  const mfl=document.getElementById('missing-fields-list');if(mfl)mfl.innerHTML='';
  document.getElementById('save-status').textContent='';
  const ppv=document.getElementById('opnote-pages-preview');if(ppv)ppv.innerHTML='';
  const cpg=document.getElementById('clinical-photos-grid');if(cpg)cpg.innerHTML='';
  const cps=document.getElementById('clinical-photo-status');if(cps)cps.textContent='';
  _pendingPhotos=[];
}
async function saveCase(){
  const proc=document.getElementById('f-proc').value.trim();
  if(!proc){alert('Please enter a procedure name.');return;}
  const id=document.getElementById('f-edit-id').value||crypto.randomUUID();
  // Save any pending clinical photos
  const newPhotoIds=[];
  for(const p of _pendingPhotos){
    const photoId=crypto.randomUUID();
    await dbPhotoPut({id:photoId,caseId:id,dataUrl:p.dataUrl,caption:p.caption,ts:new Date().toISOString()});
    newPhotoIds.push(photoId);
  }
  // Merge with existing photos (for edits)
  const existingCase=CASES.find(x=>x.id===id);
  const allPhotoIds=[...(existingCase?.photoIds||[]),...newPhotoIds];
  const c={
    id,saved:new Date().toISOString(),
    surname:document.getElementById('f-surname').value.trim(),
    given:document.getElementById('f-given').value.trim(),
    dob:document.getElementById('f-dob').value,
    age:document.getElementById('f-age').value,
    ur:document.getElementById('f-ur').value.trim(),
    opdate:document.getElementById('f-opdate').value||new Date().toISOString().slice(0,10),
    procedure:proc,
    role:document.getElementById('f-role').value,
    supervisor:document.getElementById('f-supervisor').value.trim(),
    hospital:document.getElementById('f-hospital').value.trim(),
    assist1:document.getElementById('f-assist1').value.trim(),
    assist2:document.getElementById('f-assist2').value.trim(),
    anaesthetist:document.getElementById('f-anaesthetist').value.trim(),
    specialty:document.getElementById('f-specialty').value,
    classification:document.getElementById('f-classification').value,
    complexity:document.getElementById('f-complexity').value,
    outcome:document.getElementById('f-outcome').value,
    steps:document.getElementById('f-steps').value.trim(),
    learning:document.getElementById('f-learning').value.trim(),
    photoIds:allPhotoIds,
  };
  await dbPut(c);
  CASES=await dbGetAll();
  updateHospitalList();
  const st=document.getElementById('save-status');
  st.textContent='OK Case saved';
  setTimeout(()=>{st.textContent='';clearForm();showScreen('log');},1100);
}
function updateHospitalList(){
  const dl=document.getElementById('hospital-list');
  if(!dl) return;
  const hosp=[...new Set(CASES.map(c=>c.hospital).filter(Boolean))].sort();
  dl.innerHTML=hosp.map(h=>`<option value='${h}'>`).join('');
}

// -- CLINICAL PHOTOS ----------------------------------------------------------
let _pendingPhotos=[];  // [{dataUrl, caption}] - saved to DB on case save

async function addClinicalPhotos(input){
  const files=Array.from(input.files||[]);
  if(!files.length) return;
  const grid=document.getElementById('clinical-photos-grid');
  const st=document.getElementById('clinical-photo-status');
  st.textContent='Adding '+files.length+' photo'+(files.length>1?'s':'')+'...';
  for(const file of files){
    const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
    const caption='';
    _pendingPhotos.push({dataUrl,caption});
    renderPhotoThumb(grid,dataUrl,caption,null,false);
  }
  st.textContent='OK '+_pendingPhotos.length+' photo'+((_pendingPhotos.length>1)?'s':'')+' added - will save with case';
  input.value='';
}

function renderPhotoThumb(container,dataUrl,caption,existingId,isSaved){
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--surface2);border:.5px solid var(--border)';
  const img=document.createElement('img');
  img.src=dataUrl;
  img.style.cssText='width:100%;height:100%;object-fit:cover;cursor:pointer';
  img.onclick=()=>openPhotoLightbox(dataUrl,caption);
  const del=document.createElement('button');
  del.innerHTML='x';
  del.style.cssText='position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1';
  del.onclick=async(e)=>{
    e.stopPropagation();
    if(isSaved&&existingId){
      if(!confirm('Delete this photo permanently?')) return;
      await dbPhotoDel(existingId);
      // Remove from case photoIds
      const caseId=document.getElementById('f-edit-id').value;
      const c=CASES.find(x=>x.id===caseId);
      if(c){c.photoIds=(c.photoIds||[]).filter(id=>id!==existingId);await dbPut(c);CASES=await dbGetAll();}
    } else {
      // Remove from pending
      const idx=_pendingPhotos.findIndex(p=>p.dataUrl===dataUrl);
      if(idx>=0) _pendingPhotos.splice(idx,1);
    }
    wrap.remove();
    const st=document.getElementById('clinical-photo-status');
    if(st&&!isSaved) st.textContent=_pendingPhotos.length>0?'OK '+_pendingPhotos.length+' photo(s) pending':'';
  };
  wrap.appendChild(img);wrap.appendChild(del);
  container.appendChild(wrap);
}

function openPhotoLightbox(dataUrl,caption){
  const bg=document.createElement('div');
  bg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:500;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
  const img=document.createElement('img');
  img.src=dataUrl;
  img.style.cssText='max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain';
  const close=document.createElement('button');
  close.textContent='Close';
  close.style.cssText='margin-top:16px;padding:10px 24px;border-radius:8px;background:#fff;border:none;font-size:15px;font-weight:500;cursor:pointer';
  close.onclick=()=>bg.remove();
  bg.appendChild(img);if(caption){const c=document.createElement('p');c.textContent=caption;c.style.cssText='color:#fff;margin-top:10px;font-size:13px';bg.appendChild(c);}
  bg.appendChild(close);
  bg.onclick=e=>{if(e.target===bg)bg.remove();};
  document.body.appendChild(bg);
}

async function loadDetailPhotos(caseId){
  const wrap=document.getElementById('detail-photos-wrap');
  if(!wrap) return;
  const photos=await dbPhotoGetAll(caseId);
  if(!photos.length){wrap.innerHTML='<p style="font-size:13px;color:var(--text3);padding:4px 0">No clinical photos for this case.</p>';return;}
  const grid=document.createElement('div');
  grid.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:8px';
  photos.forEach(p=>{
    const wrap2=document.createElement('div');
    wrap2.style.cssText='aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--surface2);border:.5px solid var(--border)';
    const img=document.createElement('img');
    img.src=p.dataUrl;img.style.cssText='width:100%;height:100%;object-fit:cover;cursor:pointer';
    img.onclick=()=>openPhotoLightbox(p.dataUrl,p.caption);
    wrap2.appendChild(img);grid.appendChild(wrap2);
  });
  wrap.innerHTML='';wrap.appendChild(grid);
  wrap.insertAdjacentHTML('beforeend',`<p style="font-size:11.5px;color:var(--text3);margin-top:6px">${photos.length} photo${photos.length>1?'s':''} - stored locally on this device only</p>`);
}

// -- DE-IDENTIFICATION ---------------------------------------------------------
// Strip known patient/surgeon names from text before any API call
function deidentifyText(text){
  if(!getDeident()) return text;  // toggle off - return as-is
  let t=text;
  const toRedact=[];
  // Collect values from form fields
  const surname=document.getElementById('f-surname')?.value?.trim();
  const given=document.getElementById('f-given')?.value?.trim();
  const ur=document.getElementById('f-ur')?.value?.trim();
  const dob=document.getElementById('f-dob')?.value?.trim();
  const supervisor=document.getElementById('f-supervisor')?.value?.trim();
  const assist1=document.getElementById('f-assist1')?.value?.trim();
  const assist2=document.getElementById('f-assist2')?.value?.trim();
  const anaesthetist=document.getElementById('f-anaesthetist')?.value?.trim();
  if(surname) toRedact.push(surname);
  if(given) toRedact.push(given);
  if(ur) toRedact.push(ur);
  if(dob) toRedact.push(dob);
  if(supervisor) toRedact.push(supervisor);
  if(assist1) toRedact.push(assist1);
  if(assist2) toRedact.push(assist2);
  if(anaesthetist) toRedact.push(anaesthetist);
  // Also redact partial names (surname only) for all personnel
  [supervisor,assist1,assist2,anaesthetist].filter(Boolean).forEach(name=>{
    const parts=name.trim().split(/\s+/);
    if(parts.length>1) parts.forEach(p=>{if(p.length>2) toRedact.push(p);});
  });
  // Also redact common DOB formats that may appear in raw text
  if(dob){
    // Convert YYYY-MM-DD to DD/MM/YYYY variant
    const parts=dob.split('-');
    if(parts.length===3) toRedact.push(`${parts[2]}/${parts[1]}/${parts[0]}`);
  }
  toRedact.filter(Boolean).forEach(v=>{
    // Case-insensitive whole-word replacement
    try{
      const escaped=v.replace(/[.*+?^${}()|[\]\\]/g,'$&');
      t=t.replace(new RegExp(escaped,'gi'),'[REDACTED]');
    }catch{}
  });
  return t;
}

// -- OCR & AI EXTRACTION -------------------------------------------------------

// OCR mode: 'local' | 'hybrid' | 'api'
function getOcrMode(){return ls('surglog_ocr_mode')||'hybrid';}

// Tesseract worker - initialised lazily, reused across calls
let _tessWorker=null;
async function getTessWorker(){
  if(_tessWorker) return _tessWorker;
  if(typeof Tesseract==='undefined') throw new Error('Tesseract not loaded - check internet connection.');
  _tessWorker=await Tesseract.createWorker('eng',1,{
    workerPath:'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/worker.min.js',
    corePath:'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract-core-simd-lstm.wasm.js',
    logger:()=>{}
  });
  return _tessWorker;
}

// Run Tesseract on a File, return raw text
async function tessOCR(file){
  const worker=await getTessWorker();
  const url=URL.createObjectURL(file);
  try{
    const {data:{text}}=await worker.recognize(url);
    return text;
  }finally{URL.revokeObjectURL(url);}
}

// -- Local parsers (regex-based, no API needed) --------------------------------

function parsePatientFromText(text){
  const out={surname:'',given_name:'',dob:'',ur_number:''};
  const lines=text.split(/
?
/).map(l=>l.trim()).filter(Boolean);
  const flat=lines.join(' ');

  // UR / MRN number - 4-8 digits sometimes prefixed by UR/MRN/Patient No
  const urMatch=flat.match(/(?:UR|MRN|Patient\s*No\.?|ID|Unit\s*Record)[:\s#]*([0-9]{4,10})/i)
    ||flat.match(/([0-9]{6,8})/);
  if(urMatch) out.ur_number=urMatch[1];

  // DOB - various Australian formats
  const dobMatch=flat.match(/(?:DOB|D\.O\.B|Date\s*of\s*Birth)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/i)
    ||flat.match(/([0-9]{1,2})[\/\-\.]([0-9]{1,2})[\/\-\.]([0-9]{4})/);
  if(dobMatch){
    try{
      let raw=dobMatch[1];
      if(!raw.includes('/') && !raw.includes('-') && !raw.includes('.')){
        // reconstruct from groups
        raw=`${dobMatch[1]}/${dobMatch[2]}/${dobMatch[3]}`;
      }
      const parts=raw.split(/[\/\-\.]/);
      if(parts.length===3){
        let [d,m,y]=parts;
        if(y.length===2) y='20'+y;
        out.dob=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      }
    }catch{}
  }

  // Name - look for "Name:" label or "Surname / Given" label pattern
  const nameLabel=flat.match(/(?:Patient\s*Name|Name)[:\s]+([A-Z][a-zA-Z'\-]+)[,\s]+([A-Z][a-zA-Z'\-]+)/i);
  if(nameLabel){
    // Could be "Smith, John" or "John Smith"
    const a=nameLabel[1],b=nameLabel[2];
    // Heuristic: if first part is all caps or longer, treat as surname
    out.surname=a;out.given_name=b;
  } else {
    // Try to find name on a line that looks like "SURNAME, Firstname"
    for(const line of lines){
      const m=line.match(/^([A-Z]{2,})[,]\s*([A-Za-z][a-z]+)/);
      if(m){out.surname=m[1].charAt(0)+m[1].slice(1).toLowerCase();out.given_name=m[2];break;}
    }
  }
  return out;
}

function parseSurgicalFromText(text){
  const out={procedure:'',primary_operator:'',first_assist:'',second_assist:'',date:'',hospital:''};
  const flat=text.replace(/
?
/g,' ');

  // Procedure - look for Operation/Procedure label
  const procMatch=flat.match(/(?:Procedure|Operation|Surgery)[:\s]+([A-Za-z][\w\s,\-\(\)\/]{4,80}?)(?:\.|$|Surgeon|Operator|Anaes)/i);
  if(procMatch) out.procedure=procMatch[1].trim();

  // Surgeon / Operator
  const surgMatch=flat.match(/(?:Surgeon|Operator|Primary\s*Surgeon|Performed\s*by)[:\s]+(?:Dr\.?\s*)?([A-Z][a-zA-Z'\-]+)/i);
  if(surgMatch) out.primary_operator=surgMatch[1];

  // Assists
  const ass1=flat.match(/(?:1st\s*Assist|First\s*Assist|Assistant\s*1)[:\s]+(?:Dr\.?\s*)?([A-Z][a-zA-Z'\-\s]+?)(?:,|2nd|$)/i);
  if(ass1) out.first_assist=ass1[1].trim();
  const ass2=flat.match(/(?:2nd\s*Assist|Second\s*Assist|Assistant\s*2)[:\s]+(?:Dr\.?\s*)?([A-Z][a-zA-Z'\-\s]+?)(?:,|$)/i);
  if(ass2) out.second_assist=ass2[1].trim();

  // Date of operation
  const dateMatch=flat.match(/(?:Date\s*of\s*(?:Operation|Surgery|Procedure)|Op(?:eration)?\s*Date)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/i);
  if(dateMatch){
    try{
      const parts=dateMatch[1].split(/[\/\-\.]/);
      if(parts.length===3){
        let [d,m,y]=parts;
        if(y.length===2) y='20'+y;
        out.date=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      }
    }catch{}
  }

  // Hospital - look for "Hospital:" or common Aus hospital names
  const hospMatch=flat.match(/(?:Hospital|Facility|Institution)[:\s]+([A-Z][a-zA-Z\s&'\.]{3,50}?)(?:\.|,|$)/i);
  if(hospMatch) out.hospital=hospMatch[1].trim();

  // Anaesthetist
  const anaesMatch=flat.match(/(?:Anaesth[a-z]*|Anesthetist|Anaes)[:\s]+(?:Dr\.?\s*)?([A-Z][a-zA-Z'\-]+)/i);
  if(anaesMatch) out.anaesthetist=anaesMatch[1];

  return out;
}

// Score how complete a local parse is (0-1)
function parseCompleteness(patient,surgical){
  const fields=[patient.surname,patient.given_name,patient.dob,patient.ur_number,
    surgical.procedure,surgical.primary_operator];
  return fields.filter(Boolean).length/fields.length;
}

// -- Anthropic API -------------------------------------------------------------
async function callClaude(prompt,b64=null){
  const key=getApiKey();
  if(!key) throw new Error('No API key set - add it in Settings.');
  const msgContent=b64?[
    {type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},
    {type:'text',text:prompt}
  ]:[{type:'text',text:prompt}];
  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01',
      'x-api-key':key,'anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:800,
      messages:[{role:'user',content:msgContent}]})
  });
  if(!r.ok){const e=await r.json();throw new Error(e.error?.message||'API error');}
  const data=await r.json();
  return data.content[0].text;
}

// Call Claude with raw text only (no image - cheaper, more private)
async function callClaudeText(rawText,prompt){
  const safeText=deidentifyText(rawText);
  const note=getDeident()?' (de-identified)':'';
  return callClaude(prompt+'\n\nRAW OCR TEXT'+note+':\n'+safeText);
}

function fileToB64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

// -- Fill fields helper --------------------------------------------------------
function fillPatientFields(d,overwrite=false){
  const flds={
    'f-surname':'surname','f-given':'given_name',
    'f-dob':'dob','f-ur':'ur_number'
  };
  Object.entries(flds).forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el&&d[key]&&(overwrite||!el.value)) el.value=d[key];
  });
  if(d.dob) calcAge();
}
function fillSurgicalFields(d,overwrite=false){
  const flds={
    'f-proc':'procedure','f-supervisor':'primary_operator',
    'f-assist1':'first_assist','f-assist2':'second_assist',
    'f-opdate':'date','f-hospital':'hospital','f-anaesthetist':'anaesthetist'
  };
  Object.entries(flds).forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el&&d[key]&&(overwrite||!el.value)) el.value=d[key];
  });
}

// -- Sticker extraction --------------------------------------------------------
async function extractSticker(input){
  const file=input.files[0];if(!file) return;
  const el=document.getElementById('sticker-result');
  const mode=getOcrMode();

  // Step 1: local OCR always runs first (except api-only mode)
  let localData={surname:'',given_name:'',dob:'',ur_number:''};
  let rawText='';

  if(mode!=='api'){
    el.innerHTML=statusHTML(' Running local OCR...','text3');
    try{
      rawText=await tessOCR(file);
      localData=parsePatientFromText(rawText);
      fillPatientFields(localData);
    }catch(e){
      el.innerHTML=statusHTML('Local OCR unavailable - '+e.message,'amber');
    }
  }

  // Step 2: decide whether to call API
  const localScore=[localData.surname,localData.given_name,localData.dob,localData.ur_number].filter(Boolean).length;
  const needsApi=(mode==='api')||(mode==='hybrid'&&localScore<3);

  if(needsApi&&getApiKey()){
    el.innerHTML=statusHTML('\u1f504 Local found '+localScore+'/4 fields - refining with AI...','text3');
    try{
      let raw;
      if(mode==='api'){
        // Full image to API
        const b64=await fileToB64(file);
        raw=await callClaude('You are reading an Australian hospital patient ID sticker. Return ONLY valid JSON no markdown: {"surname":"","given_name":"","dob":"YYYY-MM-DD else empty","ur_number":""}. Empty string if not clearly visible.',b64);
      } else {
        // Text only to API - image stays on device
        raw=await callClaudeText(rawText,'From this OCR text of an Australian hospital patient sticker (de-identified), extract and return ONLY valid JSON no markdown: {"surname":"","given_name":"","dob":"YYYY-MM-DD else empty","ur_number":""}. Empty string if not clearly found.');
      }
      const apiData=JSON.parse(raw.replace(/```json|```/g,'').trim());
      fillPatientFields(apiData);
      Object.keys(apiData).forEach(k=>{ if(apiData[k]) localData[k]=apiData[k]; });
    }catch(e){
      if(localScore===0) el.innerHTML=statusHTML('AI refine failed: '+e.message,'danger');
    }
  } else if(needsApi&&!getApiKey()&&localScore<3){
    // Not enough local data, no API key
    el.innerHTML=statusHTML('\u26a0 Only '+localScore+'/4 fields found locally. Add an API key in Settings for better accuracy.','amber');
  }

  // Final summary
  const surnameEl=document.getElementById('f-surname');
  const givenEl=document.getElementById('f-given');
  const dobEl=document.getElementById('f-dob');
  const urEl=document.getElementById('f-ur');
  const filled=[surnameEl.value,givenEl.value,dobEl.value,urEl.value].filter(Boolean);
  const missing=[];
  if(!surnameEl.value) missing.push('Surname');
  if(!givenEl.value) missing.push('Given name');
  if(!dobEl.value) missing.push('Date of birth');
  if(!urEl.value) missing.push('UR number');

  const modeLabel=needsApi&&getApiKey()?'local OCR + AI refinement':mode==='api'?'AI only':'local OCR only';
  el.innerHTML=filled.length
    ?`<div class="alert gr" style="margin-top:8px;padding:9px 12px;line-height:1.5">
        <div>OK <strong>${filled.length}/4 fields</strong> extracted (${modeLabel})</div>
        <div style="font-size:12px;margin-top:3px">${[givenEl.value,surnameEl.value].filter(Boolean).join(' ')}${dobEl.value?' . '+dobEl.value:''}${urEl.value?' . UR: '+urEl.value:''}</div>
        ${missing.length?`<div style="font-size:12px;color:var(--amber-text);margin-top:4px">Still missing: ${missing.join(', ')} - enter manually</div>`:''}
      </div>`
    :`<div class="alert am" style="margin-top:8px;padding:8px 12px">No fields detected - please enter manually.</div>`;

  // Update fallback zone
  const fallback=document.getElementById('sticker-fallback');
  const missingList=document.getElementById('missing-fields-list');
  if(missing.length&&fallback&&missingList){
    missingList.innerHTML=`<strong>Still missing:</strong> ${missing.join(', ')} - please enter manually.`;
  } else if(fallback){
    fallback.style.display='none';
  }
  input.value='';
}

// -- Op note extraction --------------------------------------------------------
async function extractOpNote(input){
  const files=Array.from(input.files||[]);
  if(!files.length) return;
  const el=document.getElementById('opnote-result');
  const mode=getOcrMode();

  // Show page previews
  const preview=document.getElementById('opnote-pages-preview');
  if(preview){
    preview.innerHTML='';
    files.forEach((f,i)=>{
      const url=URL.createObjectURL(f);
      const wrap=document.createElement('div');
      wrap.style.cssText='position:relative;width:60px;height:80px;border-radius:6px;overflow:hidden;border:.5px solid var(--border)';
      const img=document.createElement('img');
      img.src=url;img.style.cssText='width:100%;height:100%;object-fit:cover';
      img.onload=()=>URL.revokeObjectURL(url);
      const lbl=document.createElement('div');
      lbl.textContent='P'+(i+1);
      lbl.style.cssText='position:absolute;bottom:2px;right:3px;font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.8)';
      wrap.appendChild(img);wrap.appendChild(lbl);preview.appendChild(wrap);
    });
  }

  // Step 1: local OCR - run on each page sequentially, merge text
  let localPatient={surname:'',given_name:'',dob:'',ur_number:''};
  let localSurgical={procedure:'',primary_operator:'',first_assist:'',second_assist:'',date:'',hospital:''};
  let rawText='';

  if(mode!=='api'){
    el.innerHTML=statusHTML(` Running local OCR on ${files.length} page${files.length>1?'s':''}...`,'text3');
    try{
      const pageTexts=[];
      for(let i=0;i<files.length;i++){
        el.innerHTML=statusHTML(` Reading page ${i+1} of ${files.length}...`,'text3');
        pageTexts.push(await tessOCR(files[i]));
      }
      rawText=pageTexts.join('\n\n--- PAGE BREAK ---\n\n');
      localPatient=parsePatientFromText(rawText);
      localSurgical=parseSurgicalFromText(rawText);
      fillPatientFields(localPatient);
      fillSurgicalFields(localSurgical);
    }catch(e){
      el.innerHTML=statusHTML('Local OCR unavailable - '+e.message,'amber');
    }
  }

  // Step 2: decide whether to call API
  const score=parseCompleteness(localPatient,localSurgical);
  const needsApi=(mode==='api')||(mode==='hybrid'&&score<0.6);

  if(needsApi&&getApiKey()){
    const pct=Math.round(score*100);
    el.innerHTML=statusHTML(`\u1f504 Local found ${pct}% of fields - refining with AI (text only, image stays on device)...`,'text3');
    try{
      let raw;
      const jsonSchema=`{"surname":"","given_name":"","dob":"YYYY-MM-DD else empty","ur_number":"","procedure":"","primary_operator":"surname only","first_assist":"","second_assist":"","anaesthetist":"surname only","date":"YYYY-MM-DD else empty","hospital":""}`;
      if(mode==='api'){
        // Send all pages - use first page image + mention page count
        const b64=await fileToB64(files[0]);
        const pageNote=files.length>1?` This is page 1 of ${files.length} pages. Extract what you can from this page.`:'';
        raw=await callClaude(`You are reading an Australian hospital operation note.${pageNote} Extract all fields and return ONLY valid JSON no markdown: ${jsonSchema}. Patient details are usually in the header. Empty string if not clearly visible. Do not guess.`,b64);
        // If multiple pages and procedure still missing, try page 2
        if(files.length>1){
          try{
            const d2=JSON.parse(raw.replace(/```json|```/g,'').trim());
            if(!d2.procedure&&files.length>1){
              const b64p2=await fileToB64(files[1]);
              const raw2=await callClaude(`Continuing the operation note (page 2 of ${files.length}). Extract remaining fields if found: ${jsonSchema}. Empty string if not found.`,b64p2);
              const d2b=JSON.parse(raw2.replace(/```json|```/g,'').trim());
              // Merge: prefer non-empty values
              const merged={};
              Object.keys(d2).forEach(k=>merged[k]=d2[k]||d2b[k]||'');
              raw=JSON.stringify(merged);
            }
          }catch{}
        }
      } else {
        // Send merged text only - images never leave device, text is de-identified
        raw=await callClaudeText(rawText,`From this OCR text of an Australian hospital operation note (${files.length} page${files.length>1?'s':''}), extract all fields and return ONLY valid JSON no markdown: ${jsonSchema}. Empty string if not clearly found. Do not guess.`);
      }
      const apiData=JSON.parse(raw.replace(/```json|```/g,'').trim());
      fillPatientFields(apiData);
      fillSurgicalFields(apiData);
      // Merge for summary
      Object.keys(apiData).forEach(k=>{
        if(apiData[k]){
          if(k in localPatient) localPatient[k]=apiData[k];
          if(k in localSurgical) localSurgical[k]=apiData[k];
        }
      });
    }catch(e){
      if(score<0.3) el.innerHTML=statusHTML('AI refine failed: '+e.message+' - enter details manually.','danger');
    }
  } else if(needsApi&&!getApiKey()){
    el.innerHTML=statusHTML('\u26a0 '+Math.round(score*100)+'% of fields found locally. Add an API key in Settings for better accuracy on complex notes.','amber');
  }

  // Build summary
  const surnameEl=document.getElementById('f-surname');
  const givenEl=document.getElementById('f-given');
  const dobEl=document.getElementById('f-dob');
  const urEl=document.getElementById('f-ur');
  const procEl=document.getElementById('f-proc');
  const supervisorEl=document.getElementById('f-supervisor');
  const hospitalEl=document.getElementById('f-hospital');

  const gotPatient=[surnameEl.value,givenEl.value,dobEl.value,urEl.value].filter(Boolean);
  const gotSurgical=[procEl.value,supervisorEl.value,hospitalEl.value].filter(Boolean);
  const missingPatient=[];
  if(!surnameEl.value) missingPatient.push('Surname');
  if(!givenEl.value) missingPatient.push('Given name');
  if(!dobEl.value) missingPatient.push('Date of birth');
  if(!urEl.value) missingPatient.push('UR number');

  const modeLabel=needsApi&&getApiKey()?'local OCR + AI (text only)':mode==='api'?'AI vision':'local OCR only';
  let html=`<div class="alert gr" style="margin-top:8px;padding:10px 13px;line-height:1.6">
    <div style="font-size:11.5px;color:var(--act);margin-bottom:4px">${modeLabel}</div>`;
  if(gotSurgical.length) html+=`<div><strong>OK Op:</strong> ${procEl.value||''}${supervisorEl.value?' . Dr '+supervisorEl.value:''}${hospitalEl.value?' . '+hospitalEl.value:''}</div>`;
  if(gotPatient.length) html+=`<div><strong>OK Patient:</strong> ${[givenEl.value,surnameEl.value].filter(Boolean).join(' ')}${dobEl.value?' . '+dobEl.value:''}${urEl.value?' . UR: '+urEl.value:''}</div>`;
  if(!gotSurgical.length&&!gotPatient.length) html+=`<div>No fields detected - please enter manually.</div>`;
  html+=`</div>`;
  el.innerHTML=html;

  // Sticker fallback
  const fallback=document.getElementById('sticker-fallback');
  const missingList=document.getElementById('missing-fields-list');
  if(missingPatient.length>0&&fallback){
    fallback.style.display='block';
    missingList.innerHTML=`<strong>Patient details not found in op note:</strong> ${missingPatient.join(', ')}<br>Photograph the patient sticker to fill these in.`;
    setTimeout(()=>fallback.scrollIntoView({behavior:'smooth',block:'start'}),200);
  } else if(fallback){
    fallback.style.display='none';
  }

  if(procEl.value) classifyProc();
  input.value='';
}

function statusHTML(msg,color){
  const c={'text3':'color:var(--text3)','amber':'color:var(--amber)','danger':'color:var(--danger)'};
  return `<div style="font-size:13px;${c[color]||''};margin-top:8px;padding:4px 0">${msg}</div>`;
}
let classifyTimer=null;
function debounceClassify(){clearTimeout(classifyTimer);classifyTimer=setTimeout(classifyProc,1200);}
async function classifyProc(){
  const proc=document.getElementById('f-proc').value.trim();
  if(!proc||!getApiKey()) return;
  const el=document.getElementById('f-classification');
  el.value='Classifying...';
  try{
    const r=await callClaude(`RACS GSET classification for: "${proc}". Reply with ONLY a short label <=6 words e.g. "Upper GI - laparoscopic" or "Colorectal - open". Nothing else.`);
    el.value=r.trim().replace(/^"|"$/g,'');
  }catch{el.value='';}
}

// -- GSET TRACKER --------------------------------------------------------------
const GSET_SECTIONS=[
  {id:'rural',title:'Rurality',sub:'10% weighting - max 10 pts',color:'var(--accent)',items:[
    {key:'rural-ed-1',label:'Rural Education - Rural Clinical School (\u22651 full academic year)',pts:3,desc:'One of 21 RHMT universities. Requires letter on letterhead.'},
    {key:'rural-orig-1',label:'Rural Origin - certified (10 yrs cumulative or 5 yrs consecutive, MM2-7)',pts:3,desc:'Statutory declaration + supporting evidence required.'},
    {key:'rural-r18',label:'Rural surgical experience - 18 months (MM2-5)',pts:4,desc:'Single hospital or one employment network. Letter from hospital required.'},
    {key:'rural-r12',label:'Rural surgical experience - 12 months (MM2-5)',pts:3,desc:''},
    {key:'rural-r6',label:'Rural surgical experience - 6 months (MM2-5)',pts:1,desc:''},
    {key:'rural-rem12',label:'Remote surgical experience - 12 months (MM6-7)',pts:4,desc:''},
    {key:'rural-rem6',label:'Remote surgical experience - 6 months (MM6-7)',pts:2,desc:''},
  ]},
  {id:'qual',title:'Qualifications',sub:'Max 4 pts',color:'var(--blue)',items:[
    {key:'qual-phd',label:'PhD in medically related area',pts:3,desc:'Awarded by application date. Not MRCS or MBBS.'},
    {key:'qual-masters',label:'Masters degree (coursework or thesis)',pts:2,desc:'Medically related. Graduate Diploma/Diploma = 1 pt.'},
    {key:'qual-dip',label:'Graduate Diploma / Diploma',pts:1,desc:'Meets Australian Qualifications Framework definition.'},
    {key:'qual-2nd',label:'Second qualifying degree (+1 bonus)',pts:1,desc:'Additional point for a second eligible qualification.'},
  ]},
  {id:'pres',title:'Presentations',sub:'Max 3 pts - last 5 years',color:'#7B68EE',items:[
    {key:'pres-oral1',label:'Oral presentation #1',pts:2,desc:'Peer-reviewed competitive abstract. General Surgery / Basic Science / Surgical Ed.'},
    {key:'pres-oral2',label:'Oral presentation #2',pts:2,desc:''},
    {key:'pres-post1',label:'Poster presentation #1',pts:1,desc:'Must be first author and named presenter.'},
    {key:'pres-post2',label:'Poster presentation #2',pts:1,desc:''},
  ]},
  {id:'pub',title:'Publications',sub:'Max 5 pts - last 5 years',color:'#5B7FA6',items:[
    {key:'pub-fa1',label:'First-author peer-reviewed article #1',pts:2,desc:'Published (not just accepted). General Surgery / Basic Science / Surgical Ed.'},
    {key:'pub-fa2',label:'First-author peer-reviewed article #2',pts:2,desc:''},
    {key:'pub-nfa1',label:'Non-first-author article #1',pts:1,desc:'Collaborative lead/steering committee also scored here.'},
    {key:'pub-nfa2',label:'Non-first-author article #2',pts:1,desc:''},
    {key:'pub-cr1',label:'Case report #1 (first author)',pts:1,desc:'Incl. "How I Do It", Commentary, Perspective. Max 3 case reports total.'},
    {key:'pub-cr2',label:'Case report #2',pts:1,desc:''},
    {key:'pub-cr3',label:'Case report #3',pts:1,desc:''},
  ]},
  {id:'teach',title:'Scholarship & Teaching',sub:'Max 3 pts - last 3 years',color:'var(--amber)',items:[
    {key:'teach-18',label:'18 months weekly teaching / 6 university semesters',pts:3,desc:'\u22652 hrs/wk, outside normal employment. Must use ABiGS template.'},
    {key:'teach-12',label:'12 months weekly teaching / 4 university semesters',pts:2,desc:''},
    {key:'teach-6',label:'6 months weekly teaching / 2 university semesters',pts:1,desc:'Ward rounds and bed-side teaching do NOT count.'},
  ]},
  {id:'indig',title:'Indigeneity & Ethnicity',sub:'Max 4 pts',color:'#5D4E7D',items:[
    {key:'indig-1',label:'Eligible Aboriginal and/or Torres Strait Islander applicant',pts:4,desc:'Must identify at registration and meet AIDA membership eligibility.'},
  ]},
];

// Caps: presentations max 3, publications max 5, rural exp take highest only
const GSET_CAPS={pres:3,pub:5};
const GSET_RURAL_EXP_RURAL=['rural-r18','rural-r12','rural-r6'];
const GSET_RURAL_EXP_REMOTE=['rural-rem12','rural-rem6'];

function calcGsetPts(){
  const g=getGset();
  const chk=g.checked||{};
  let total=0;
  const secPts={};

  GSET_SECTIONS.forEach(sec=>{
    let sp=0;
    if(sec.id==='rural'){
      // Ed + Origin straight
      if(chk['rural-ed-1']) sp+=3;
      if(chk['rural-orig-1']) sp+=3;
      // Exp: take max of rural or remote
      const ruralPts=chk['rural-r18']?4:chk['rural-r12']?3:chk['rural-r6']?1:0;
      const remotePts=chk['rural-rem12']?4:chk['rural-rem6']?2:0;
      sp+=Math.min(4,Math.max(ruralPts,remotePts));
      sp=Math.min(10,sp);
    } else if(sec.id==='qual'){
      const base=chk['qual-phd']?3:chk['qual-masters']?2:chk['qual-dip']?1:0;
      sp=Math.min(4,base+(chk['qual-2nd']?1:0));
    } else if(sec.id==='pres'){
      let pp=0;
      sec.items.forEach(it=>{if(chk[it.key]) pp+=it.pts;});
      sp=Math.min(GSET_CAPS.pres,pp);
    } else if(sec.id==='pub'){
      let pp=0;
      sec.items.forEach(it=>{if(chk[it.key]) pp+=it.pts;});
      sp=Math.min(GSET_CAPS.pub,pp);
    } else if(sec.id==='teach'){
      sp=chk['teach-18']?3:chk['teach-12']?2:chk['teach-6']?1:0;
    } else if(sec.id==='indig'){
      sp=chk['indig-1']?4:0;
    }
    secPts[sec.id]=sp;
    total+=sp;
  });
  return {total,secPts};
}

function renderGset(){
  const g=getGset();
  const chk=g.checked||{};
  const notes=g.notes||{};
  const {total,secPts}=calcGsetPts();

  document.getElementById('gset-pts-display').textContent=`${total} / 29 pts`;

  // Progress bars
  const bars=[
    {label:`Rurality (${secPts.rural}/10)`,val:secPts.rural,max:10,color:'var(--accent)'},
    {label:`Qualifications (${secPts.qual}/4)`,val:secPts.qual,max:4,color:'var(--blue)'},
    {label:`Presentations (${secPts.pres}/3)`,val:secPts.pres,max:3,color:'#7B68EE'},
    {label:`Publications (${secPts.pub}/5)`,val:secPts.pub,max:5,color:'#5B7FA6'},
    {label:`Teaching (${secPts.teach}/3)`,val:secPts.teach,max:3,color:'var(--amber)'},
    {label:`Indigeneity (${secPts.indig}/4)`,val:secPts.indig,max:4,color:'#5D4E7D'},
  ];
  document.getElementById('gset-prog-wrap').innerHTML=bars.map(b=>`
    <div class="bar-wrap" style="margin-bottom:6px">
      <div class="bar-lbl"><span>${b.label}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${b.max?Math.round(b.val/b.max*100):0}%;background:${b.color}"></div></div>
    </div>`).join('');

  // Gaps
  const maxPts={rural:10,qual:4,pres:3,pub:5,teach:3,indig:4};
  const gaps=Object.entries(secPts).filter(([k,v])=>v<maxPts[k]).map(([k,v])=>({
    sec:GSET_SECTIONS.find(s=>s.id===k)?.title||k,gap:maxPts[k]-v,current:v,max:maxPts[k]
  })).sort((a,b)=>b.gap-a.gap);
  document.getElementById('gset-gaps-alert').innerHTML=gaps.length?`
    <div class="alert am" style="margin-bottom:12px">
      <strong>Points gaps (${gaps.reduce((a,g)=>a+g.gap,0)} pts remaining):</strong><br>
      ${gaps.map(g=>`${g.sec}: ${g.current}/${g.max} pts`).join(' . ')}
    </div>`:'<div class="alert gr" style="margin-bottom:12px">\u1f389 Maximum CV + Rurality points achieved!</div>';

  // Sections
  document.getElementById('gset-sections').innerHTML=GSET_SECTIONS.map(sec=>`
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:600;color:${sec.color}">${sec.title}</div>
          <div style="font-size:11.5px;color:var(--text3)">${sec.sub}</div>
        </div>
        <div style="font-size:18px;font-weight:700;color:${sec.color}">${secPts[sec.id]}</div>
      </div>
      <div class="card" style="padding:4px 14px">
        ${sec.items.map(it=>`
          <div class="gi">
            <div class="gchk${chk[it.key]?' on':''}" id="gchk-${it.key}" onclick="toggleGsetItem('${it.key}')"></div>
            <div class="gi-info">
              <div class="gi-title">${it.label}</div>
              ${it.desc?`<div class="gi-desc">${it.desc}</div>`:''}
            </div>
            <span class="gi-pts">${it.pts} pt${it.pts>1?'s':''}</span>
          </div>`).join('')}
      </div>
      <div style="margin-top:6px">
        <textarea style="width:100%;background:var(--surface);border:.5px solid var(--border);
          border-radius:var(--rs);padding:8px 10px;font-size:12.5px;color:var(--text);
          resize:none;min-height:44px;outline:none;font-family:inherit"
          placeholder="Notes for ${sec.title}..."
          onchange="saveGsetNote('${sec.id}',this.value)">${notes[sec.id]||''}</textarea>
      </div>
    </div>`).join('');
}

function toggleGsetItem(key){
  const g=getGset();
  g.checked=g.checked||{};
  g.checked[key]=!g.checked[key];
  saveGset(g);
  renderGset();
}
function saveGsetNote(sec,val){
  const g=getGset();
  g.notes=g.notes||{};
  g.notes[sec]=val;
  saveGset(g);
}

// -- SETTINGS ------------------------------------------------------------------
function saveApiKey(){
  const k=document.getElementById('s-apikey').value.trim();
  if(!k){alert('Please enter your API key.');return;}
  lss('surglog_apikey',k);
  const st=document.getElementById('api-save-status');
  st.textContent='OK Saved';setTimeout(()=>st.textContent='',2000);
}

function renderBackupBanner(){
  const last=getLastExport();
  const el=document.getElementById('backup-banner');
  if(!el) return;
  if(last){
    const d=new Date(last),days=Math.floor((Date.now()-d)/86400000);
    const ds=d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
    el.innerHTML=`<div class="alert ${days>30?'am':'gr'}" style="margin-bottom:10px">
      ${days>30?`\u26a0 Last backup was ${days} days ago (${ds}). Export again to keep data safe.`:`OK Last backup: ${ds}`}</div>`;
  } else {
    el.innerHTML=`<div class="alert am" style="margin-bottom:10px">\u26a0 No backup yet. Export before changing phones.</div>`;
  }
}

const OCR_DESCS={
  hybrid:'+ <strong>Hybrid (recommended):</strong> Tesseract runs locally first - fast and free. If fewer than 60% of fields are found, only the extracted text (not the image) is sent to Claude for refinement. Best balance of privacy, speed and accuracy.',
  local:' <strong>Local only:</strong> Tesseract OCR runs entirely on your device. Nothing ever leaves your phone. Works well on printed labels and typed op notes. May struggle with handwritten notes or poor lighting.',
  api:' <strong>AI only:</strong> The full image is sent to Anthropic's API. Best accuracy for handwritten, complex, or low-quality photos. Each extraction costs ~$0.01-0.04 USD.'
};
function getDeident(){return ls('surglog_deident')!=='off';}  // on by default
function toggleDeident(){
  const tog=document.getElementById('tog-deident');
  const on=tog.classList.toggle('on');
  lss('surglog_deident',on?'on':'off');
  const st=document.getElementById('deident-status');
  if(st) st.textContent=on?'OK De-identification on - patient identifiers stripped before API calls':'\u26a0 De-identification off - raw OCR text sent to API';
  setTimeout(()=>{if(st)st.textContent='';},3000);
}
function saveOcrMode(v){
  lss('surglog_ocr_mode',v);
  const d=document.getElementById('ocr-mode-desc');
  if(d) d.innerHTML=OCR_DESCS[v]||'';
}
function renderSettings(){
  const k=getApiKey();
  if(k){const el=document.getElementById('s-apikey');if(el)el.value=k;}
  const modeEl=document.getElementById('s-ocr-mode');
  if(modeEl){modeEl.value=getOcrMode();saveOcrMode(modeEl.value);}
  const deidentTog=document.getElementById('tog-deident');
  if(deidentTog) deidentTog.classList.toggle('on',getDeident());
  // Criteria editor
  const c=getCriteria();
  const criteriaFields=[
    {label:'Selection year',key:'selYear',type:'number'},
    {label:'Intake year',key:'intakeYear',type:'number'},
    {label:'Application closing date',key:'closeDate',type:'date'},
    {label:'Rurality max pts',key:'ruralTotal',type:'number'},
    {label:'Rurality: Rural Education max',key:'ruralEd',type:'number'},
    {label:'Rurality: Rural Origin max',key:'ruralOrig',type:'number'},
    {label:'Rurality: Rural Exp max',key:'ruralExp',type:'number'},
    {label:'CV total max pts',key:'cvTotal',type:'number'},
    {label:'CV: Qualifications max',key:'cvQual',type:'number'},
    {label:'CV: Presentations max',key:'cvPres',type:'number'},
    {label:'CV: Publications max',key:'cvPub',type:'number'},
    {label:'CV: Teaching max',key:'cvTeach',type:'number'},
    {label:'CV: Indigeneity max',key:'cvIndig',type:'number'},
    {label:'Eligibility: Gen Surgery wks',key:'eligGsWks',type:'number'},
    {label:'Eligibility: Critical Care wks',key:'eligCcWks',type:'number'},
    {label:'Consultants required',key:'eligConsult',type:'number'},
    {label:'Referees required',key:'eligRefs',type:'number'},
    {label:'Referee groups required',key:'eligRefGrps',type:'number'},
    {label:'Rotations valid from',key:'validFrom',type:'date'},
  ];
  document.getElementById('criteria-card').innerHTML=criteriaFields.map(f=>`
    <div class="sr" style='${f===criteriaFields[criteriaFields.length-1]?'border:none':''}'>
      <div class="sr-label" style="font-size:13px">${f.label}</div>
      <input type='${f.type}' id="cr-${f.key}" value='${c[f.key]||''}'
        style="width:110px;background:var(--surface2);border:.5px solid var(--border);
        border-radius:var(--rs);padding:6px 8px;font-size:13px;text-align:right;outline:none">
    </div>`).join('');
}

function saveCriteria(){
  const keys=['selYear','intakeYear','closeDate','ruralTotal','ruralEd','ruralOrig','ruralExp',
    'cvTotal','cvQual','cvPres','cvPub','cvTeach','cvIndig','eligGsWks','eligCcWks',
    'eligConsult','eligRefs','eligRefGrps','validFrom'];
  const c={};
  keys.forEach(k=>{
    const el=document.getElementById('cr-'+k);
    if(el) c[k]=el.type==='number'?Number(el.value):el.value;
  });
  lss('gset_criteria',JSON.stringify(c));
  const st=document.getElementById('criteria-status');
  st.textContent='OK Criteria saved';setTimeout(()=>st.textContent='',2000);
}
function resetCriteria(){
  if(!confirm('Reset all criteria to 2026 regulation defaults?')) return;
  localStorage.removeItem('gset_criteria');
  renderSettings();
  const st=document.getElementById('criteria-status');
  st.textContent='OK Reset to 2026 defaults';setTimeout(()=>st.textContent='',2000);
}

// -- EXPORT / IMPORT -----------------------------------------------------------
async function exportJSON(){
  const payload={version:3,exportedAt:new Date().toISOString(),app:'SurgLog',
    data:{cases:CASES,gset:getGset(),criteria:getCriteria(),apiKey:getApiKey()}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`surglog-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  lss('surglog_last_export',new Date().toISOString());
  renderBackupBanner();
}
async function importJSON(input){
  const file=input.files[0];if(!file)return;
  try{
    const text=await file.text();
    const payload=JSON.parse(text);
    const fileVersion=payload.version||1;
    const cases=payload.data?.cases||payload.cases||[];
    if(!Array.isArray(cases)){alert('Invalid backup file - no case array found.');input.value='';return;}
    const exportDate=payload.exportedAt?new Date(payload.exportedAt).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'unknown date';
    const currentFields=['surname','given','dob','ur','opdate','procedure','role','supervisor','assist1','assist2','anaesthetist','hospital','specialty','classification','complexity','outcome','steps','learning','photoIds'];
    const backupFields=cases.length>0?Object.keys(cases[0]):[];
    const missingInBackup=currentFields.filter(f=>!backupFields.includes(f));
    const confirmed=confirm(
      'Backup: v'+fileVersion+' exported '+exportDate+'\nCases: '+cases.length+
      (missingInBackup.length?'\nNew fields since backup: '+missingInBackup.join(', '):'')+'\n\nImport will merge with existing data. Continue?'
    );
    if(!confirmed){input.value='';return;}
    const migrated=cases.map(c=>({
      id:c.id||crypto.randomUUID(),
      saved:c.saved||new Date().toISOString(),
      surname:c.surname||'',given:c.given||'',dob:c.dob||'',age:c.age||'',ur:c.ur||'',
      opdate:c.opdate||'',procedure:c.procedure||'',role:c.role||'',
      supervisor:c.supervisor||'',assist1:c.assist1||'',assist2:c.assist2||'',
      anaesthetist:c.anaesthetist||'',hospital:c.hospital||'',specialty:c.specialty||'',
      classification:c.classification||'',complexity:c.complexity||'',
      outcome:c.outcome||'Uneventful',steps:c.steps||'',learning:c.learning||'',
      photoIds:c.photoIds||[],
    }));
    let imported=0,skipped=0;
    for(const c of migrated){
      const existing=CASES.find(x=>x.id===c.id);
      if(existing&&existing.saved>c.saved){skipped++;continue;}
      await dbPut(c);imported++;
    }
    if(payload.data?.gset) saveGset(payload.data.gset);
    if(payload.data?.criteria) lss('gset_criteria',JSON.stringify(payload.data.criteria));
    if(payload.data?.apiKey) lss('surglog_apikey',payload.data.apiKey);
    CASES=await dbGetAll();
    updateHospitalList();
    renderDashboard();
    alert('Import complete: '+imported+' cases imported, '+skipped+' skipped. All data migrated.');
  }catch(e){
    alert('Import failed: '+e.message+'. Make sure you selected a valid SurgLog .json backup file.');
  }
  input.value='';
}
function clearAllData(){
  if(!confirm('Delete ALL data from this device? This cannot be undone.')) return;
  if(!confirm('Final confirmation - delete everything?')) return;
  localStorage.clear();
  indexedDB.deleteDatabase('SurgLog');
  location.reload();
}

// -- EXCEL EXPORT --------------------------------------------------------------
async function exportXLSX(){
  if(typeof XLSX==='undefined'){alert('Excel library not loaded. Please check your internet connection and try again.');return;}
  const redact=document.getElementById('tog-redact').classList.contains('on');
  const inclNotes=document.getElementById('tog-notes').classList.contains('on');
  const cases=CASES;
  const gset=getGset();
  const now=new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});

  const C={g:'0F6E56',gl:'E1F5EE',b:'185FA5',bl:'E6F1FB',a:'BA7517',al:'FAEEDA',
    w:'FFFFFF',gy:'F8F7F4',gy2:'F1EFE8',dg:'A32D2D',t:'1A1A18',t3:'888888'};
  const hdr=t=>({v:t,t:'s',s:{font:{bold:true,color:{rgb:C.w},name:'Arial',sz:10},
    fill:{fgColor:{rgb:C.g},patternType:'solid'},alignment:{horizontal:'center',vertical:'center'}}});
  const cel=(v,bold=false,col=C.t,bg=C.w,align='left')=>
    ({v:v??'',t:typeof v==='number'?'n':'s',s:{font:{bold,color:{rgb:col},name:'Arial',sz:10},
    fill:{fgColor:{rgb:bg},patternType:'solid'},alignment:{horizontal:align,vertical:'center',wrapText:true}}});
  const ti=(t,bg=C.g,fg=C.w,sz=12)=>({v:t,t:'s',s:{font:{bold:true,color:{rgb:fg},name:'Arial',sz},
    fill:{fgColor:{rgb:bg},patternType:'solid'},alignment:{horizontal:'left',vertical:'center'}}});

  const roleColMap={'Primary Operator':C.gl,'Supervised':C.bl,'1st Assist':C.al,
    '2nd Assist':'FFF3CD','Observer':'F5F5F5'};

  const wb=XLSX.utils.book_new();

  // Sheet 1 - Logbook
  const lFields=['opdate','surname','given','dob','age','ur','procedure','specialty',
    'classification','role','supervisor','assist1','assist2','anaesthetist','hospital','complexity','outcome',
    ...(inclNotes?['steps','learning']:[])];
  const lHdrs=['Date','Surname','Given name','DOB','Age','UR number','Procedure','Specialty',
    'Classification','Role','Supervisor','1st Assist','2nd Assist','Anaesthetist','Hospital','Complexity','Outcome',
    ...(inclNotes?['Key steps','Learning points']:[])];
  const lData=[
    [ti(`SurgLog - Surgical Logbook  |  Exported: ${now}  |  ${cases.length} cases`)],
    lHdrs.map(hdr),
    ...cases.map((c,i)=>{
      const alt=i%2===0?C.gy2:C.w;
      return lFields.map((f,fi)=>{
        let v=c[f]||'';
        if(redact){if(f==='surname')v=`Patient-${String(i+1).padStart(3,'0')}`;
          if(f==='given')v='';if(f==='dob')v='Redacted';if(f==='ur')v=`UR-${String(i+1).padStart(4,'0')}`;}
        const bg=f==='role'?(roleColMap[c.role]||alt):alt;
        return cel(v,f==='role',f==='role'&&c.role==='Primary Operator'?C.g:C.t,bg);
      });
    })
  ];
  const ws1=XLSX.utils.aoa_to_sheet(lData,{cellStyles:true});
  ws1['!merges']=[{s:{r:0,c:0},e:{r:0,c:lHdrs.length-1}}];
  ws1['!cols']=[{wch:12},{wch:14},{wch:14},{wch:12},{wch:5},{wch:12},{wch:32},{wch:18},
    {wch:22},{wch:18},{wch:14},{wch:14},{wch:14},{wch:20},{wch:14},{wch:18},
    ...(inclNotes?[{wch:42},{wch:35}]:[])];
  ws1['!freeze']={xSplit:0,ySplit:2};
  XLSX.utils.book_append_sheet(wb,ws1,'Surgical Logbook');

  // Sheet 2 - Dashboard
  const total=cases.length,prim=cases.filter(c=>['Primary Operator','Supervised'].includes(c.role)).length;
  const byRole={},bySpec={},byHosp={},byYr={};
  cases.forEach(c=>{
    if(c.role) byRole[c.role]=(byRole[c.role]||0)+1;
    if(c.specialty) bySpec[c.specialty]=(bySpec[c.specialty]||0)+1;
    if(c.hospital) byHosp[c.hospital]=(byHosp[c.hospital]||0)+1;
    const y=(c.opdate||'').slice(0,4);if(y)byYr[y]=(byYr[y]||0)+1;
  });
  const hospPrimary={};
  cases.forEach(c=>{
    const h=c.hospital||'Unknown';
    if(!hospPrimary[h])hospPrimary[h]={t:0,p:0};
    hospPrimary[h].t++;
    if(['Primary Operator','Supervised'].includes(c.role))hospPrimary[h].p++;
  });
  const pct=(n,d)=>d?`${Math.round(n/d*100)}%`:'-';
  const d2=[
    [ti('SurgLog - Dashboard & Statistics')],[],
    [cel('KEY STATISTICS',true,C.g,C.gl)],
    [cel('Total cases'),cel(total,true,C.g)],
    [cel('Primary operator / supervised'),cel(prim,true,C.b)],
    [cel('Primary operator rate'),cel(total?`${Math.round(prim/total*100)}%`:'-',true,C.a)],
    [cel(`Cases ${new Date().getFullYear()} (YTD)`),cel(cases.filter(c=>(c.opdate||'').startsWith(String(new Date().getFullYear()))).length,true,C.g)],
    [],[hdr('Role'),hdr('Count'),hdr('% of total')],
    ...Object.entries(byRole).sort((a,b)=>b[1]-a[1]).map(([r,n],i)=>[
      cel(r,false,C.t,i%2?C.w:C.gy2),cel(n,true,C.g,i%2?C.w:C.gy2,'center'),
      cel(pct(n,total),false,C.t3,i%2?C.w:C.gy2,'center')]),
    [],[hdr('Specialty'),hdr('Count'),hdr('%')],
    ...Object.entries(bySpec).sort((a,b)=>b[1]-a[1]).map(([s,n],i)=>[
      cel(s,false,C.t,i%2?C.w:C.gy2),cel(n,true,C.b,i%2?C.w:C.gy2,'center'),
      cel(pct(n,total),false,C.t3,i%2?C.w:C.gy2,'center')]),
    [],[hdr('Hospital'),hdr('Cases'),hdr('Primary/Supervised'),hdr('Rate')],
    ...Object.entries(hospPrimary).sort((a,b)=>b[1].t-a[1].t).map(([h,d],i)=>[
      cel(h,false,C.t,i%2?C.w:C.gy2),cel(d.t,false,C.t,i%2?C.w:C.gy2,'center'),
      cel(d.p,false,C.t,i%2?C.w:C.gy2,'center'),cel(pct(d.p,d.t),true,C.g,i%2?C.w:C.gy2,'center')]),
    [],[hdr('Year'),hdr('Cases')],
    ...Object.entries(byYr).sort((a,b)=>b[0].localeCompare(a[0])).map(([y,n],i)=>[
      cel(y,false,C.t,i%2?C.w:C.gy2),cel(n,true,C.a,i%2?C.w:C.gy2,'center')]),
  ];
  const ws2=XLSX.utils.aoa_to_sheet(d2,{cellStyles:true});
  ws2['!merges']=[{s:{r:0,c:0},e:{r:0,c:3}}];
  ws2['!cols']=[{wch:30},{wch:12},{wch:20},{wch:12}];
  XLSX.utils.book_append_sheet(wb,ws2,'Dashboard');

  // Sheet 3 - RACS format
  const r3Hdrs=['#','Date','Procedure','Specialty','Role','Supervisor','1st Assist',
    'Hospital','Complexity','Outcome',...(inclNotes?['Key steps','Reflections']:[])];
  const r3Fields=['opdate','procedure','specialty','role','supervisor','assist1',
    'hospital','complexity','outcome',...(inclNotes?['steps','learning']:[])];
  const d3=[
    [ti('RACS GSET - Operative Experience Log')],
    [ti('Aligned with RACS Surgical Education and Training logbook requirements',C.gl,C.g,9)],
    r3Hdrs.map(hdr),
    ...cases.map((c,i)=>{
      const alt=i%2?C.w:C.gy2;
      return [
        cel(i+1,false,C.t3,alt,'center'),
        ...r3Fields.map(f=>cel(c[f]||'',f==='role',f==='role'&&c.role==='Primary Operator'?C.g:C.t,
          f==='role'?(roleColMap[c.role]||alt):alt))
      ];
    })
  ];
  const ws3=XLSX.utils.aoa_to_sheet(d3,{cellStyles:true});
  ws3['!merges']=[{s:{r:0,c:0},e:{r:0,c:r3Hdrs.length-1}},{s:{r:1,c:0},e:{r:1,c:r3Hdrs.length-1}}];
  ws3['!cols']=[{wch:5},{wch:11},{wch:34},{wch:20},{wch:18},{wch:14},{wch:14},{wch:20},
    {wch:12},{wch:18},...(inclNotes?[{wch:42},{wch:35}]:[])];
  ws3['!freeze']={xSplit:0,ySplit:3};
  XLSX.utils.book_append_sheet(wb,ws3,'RACS Format');

  // Sheet 4 - GSET Tracker
  const chk=(gset.checked)||{};
  const {total:gTotal,secPts}=calcGsetPts();
  const d4=[[ti('GSET Points Tracker - 2026 Selection')],[],
    [hdr('Item'),hdr('Max pts'),hdr('Achieved?'),hdr('Pts earned'),hdr('Notes')]];
  GSET_SECTIONS.forEach(sec=>{
    d4.push([{v:`${sec.title}  -  ${sec.sub}`,t:'s',s:{font:{bold:true,color:{rgb:C.w},name:'Arial',sz:10},
      fill:{fgColor:{rgb:C.g},patternType:'solid'},alignment:{horizontal:'left',vertical:'center'}}},
      cel(''),cel(''),cel(''),cel('')]);
    sec.items.forEach((it,i)=>{
      const done=!!chk[it.key],earned=done?it.pts:0,alt=i%2?C.w:C.gy2;
      d4.push([
        cel(it.label,false,C.t,alt),cel(it.pts,false,C.t3,alt,'center'),
        {v:done?'OK Yes':'x No',t:'s',s:{font:{bold:true,color:{rgb:done?C.g:C.dg},name:'Arial',sz:10},
          fill:{fgColor:{rgb:alt},patternType:'solid'},alignment:{horizontal:'center',vertical:'center'}}},
        cel(earned,true,earned>0?C.g:'888888',alt,'center'),
        cel((gset.notes||{})[sec.id]||'',false,C.t3,alt),
      ]);
    });
    d4.push([]);
  });
  d4.push([{v:'TOTAL POINTS (CV + Rurality)',t:'s',s:{font:{bold:true,color:{rgb:C.w},name:'Arial',sz:11},
    fill:{fgColor:{rgb:C.g},patternType:'solid'},alignment:{horizontal:'left',vertical:'center'}}},
    cel(''),cel(''),
    {v:gTotal,t:'n',s:{font:{bold:true,color:{rgb:C.w},name:'Arial',sz:14},
      fill:{fgColor:{rgb:C.g},patternType:'solid'},alignment:{horizontal:'center',vertical:'center'}}},
    {v:'out of 29 pts (CV 19 + Rurality 10)',t:'s',s:{font:{italic:true,color:{rgb:C.w},name:'Arial',sz:9},
      fill:{fgColor:{rgb:C.g},patternType:'solid'},alignment:{horizontal:'left',vertical:'center'}}},
  ]);
  const ws4=XLSX.utils.aoa_to_sheet(d4,{cellStyles:true});
  ws4['!merges']=[{s:{r:0,c:0},e:{r:0,c:4}}];
  ws4['!cols']=[{wch:52},{wch:10},{wch:12},{wch:12},{wch:38}];
  XLSX.utils.book_append_sheet(wb,ws4,'GSET Points Tracker');

  // Tab colours
  ['0F6E56','185FA5','5DCAA5','BA7517'].forEach((col,i)=>{
    if(wb.Workbook?.Sheets?.[i]) wb.Workbook.Sheets[i].TabColor=col;
  });

  const date=new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb,`surglog-${date}${redact?'-anonymised':''}.xlsx`);
}

async function exportCSV(){
  const redact=document.getElementById('tog-redact').classList.contains('on');
  const esc=v=>v==null?'':(`"${String(v).replace(/"/g,'""')}"`);
  const headers=['Date','Surname','Given name','DOB','Age','UR number','Procedure',
    'Specialty','Classification','Role','Supervisor','1st Assist','2nd Assist','Hospital','Complexity','Outcome'];
  const fields=['opdate','surname','given','dob','age','ur','procedure','specialty',
    'classification','role','supervisor','assist1','assist2','hospital','complexity','outcome'];
  const rows=[headers.map(esc).join(',')];
  CASES.forEach((c,i)=>{
    rows.push(fields.map((f,fi)=>{
      let v=c[f]||'';
      if(redact){if(f==='surname')v=`Patient-${String(i+1).padStart(3,'0')}`;
        if(f==='given')v='';if(f==='dob')v='Redacted';if(f==='ur')v=`UR-${String(i+1).padStart(4,'0')}`;}
      return esc(v);
    }).join(','));
  });
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`surglog-${new Date().toISOString().slice(0,10)}.csv`;a.click();
}

// -- MODALS --------------------------------------------------------------------
function closeModal(){document.getElementById('modal-bg').classList.remove('open');}
function openModal(html){
  document.getElementById('modal-body').innerHTML=html;
  document.getElementById('modal-bg').classList.add('open');
}
function showGSheetsModal(){
  openModal('<h3 style="font-size:17px;font-weight:600;margin-bottom:12px">Import into Google Sheets</h3>' +
    '<div style="font-size:13.5px;color:var(--text2);line-height:1.9">' +
    '<strong style="color:var(--text)">From .xlsx (recommended):</strong><br>' +
    '1. Download the .xlsx file<br>2. Go to sheets.google.com<br>' +
    '3. File > Import > Upload > select the file<br>' +
    '4. Choose "Insert new sheet(s)"<br>5. All 4 sheets import with formatting<br><br>' +
    '<strong style="color:var(--text)">From CSV (quickest):</strong><br>' +
    '1. Download the CSV<br>2. File > Import > Upload > select file<br>' +
    '3. Logbook data only, no formatting<br><br>' +
    '<div style="background:var(--acl);border-radius:var(--rs);padding:10px;color:var(--act)">' +
    'Tip: .xlsx keeps all 4 sheets and colours. Use CSV for raw data only.</div></div>' +
    '<button class="btn pr full" style="margin-top:16px" onclick="closeModal()">Got it</button>');
}
function showGitHubModal(){
  openModal('<h3 style="font-size:17px;font-weight:600;margin-bottom:12px">Host on GitHub Pages</h3>' +
    '<div style="font-size:13px;color:var(--text2);line-height:1.85">' +
    'A permanent URL so any new phone can open and install without the file again.<br><br>' +
    '<strong style="color:var(--text)">1. Create a GitHub account</strong> at github.com<br><br>' +
    '<strong style="color:var(--text)">2. Create a repository</strong><br>' +
    'Click + > New repository > name it surglog > Public > Add README > Create<br><br>' +
    '<strong style="color:var(--text)">3. Upload the file</strong><br>' +
    'Add file > Upload files > drag SurgLog.html > rename to index.html > Commit<br><br>' +
    '<strong style="color:var(--text)">4. Enable GitHub Pages</strong><br>' +
    'Settings > Pages > Deploy from branch > main / (root) > Save<br><br>' +
    '<strong style="color:var(--text)">5. Install on your phone</strong><br>' +
    'Open https://yourusername.github.io/surglog in Chrome > 3-dot menu > Add to Home Screen<br><br>' +
    '<div style="background:var(--acl);border-radius:var(--rs);padding:10px;color:var(--act)">' +
    'Your data stays on your phone only. GitHub just hosts the app code.</div></div>' +
    '<button class="btn pr full" style="margin-top:16px" onclick="closeModal()">Got it</button>');
}
async function init(){
  try{
    await openDB();
    CASES=await dbGetAll();
    updateHospitalList();
    const el=document.getElementById('f-opdate');
    if(el) el.value=new Date().toISOString().slice(0,10);
    renderDashboard();
    console.log('SurgLog init complete, cases:',CASES.length);
  }catch(e){
    console.error('SurgLog init error:',e);
    const body=document.getElementById('screens');
    if(body) body.innerHTML='<div style="padding:20px;color:red;font-size:14px"><strong>Init error:</strong> '+e.message+'<br><small>Please screenshot this and report it.</small></div>';
  }
}
// Catch any uncaught JS errors and show them
window.onerror=function(msg,src,line,col,err){
  console.error('Uncaught:',msg,'at line',line);
  const d=document.createElement('div');
  d.style.cssText='position:fixed;bottom:80px;left:0;right:0;background:#a32d2d;color:#fff;padding:12px;font-size:12px;z-index:9999;white-space:pre-wrap';
  d.textContent='JS Error (line '+line+'): '+msg;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),8000);
  return false;
};
window.onunhandledrejection=function(e){
  console.error('Unhandled promise rejection:',e.reason);
};

// Expose all functions to window scope explicitly
// This fixes compatibility with browser extensions (e.g. MetaMask) that
// run JS in a sandbox where inline onclick= cannot see module-scope functions
// Expose all functions globally so inline onclick handlers can find them
// regardless of browser extension sandboxing (e.g. MetaMask/SES)
window.showScreen=showScreen;
window.openAdd=openAdd;
window.openDetail=openDetail;
window.closeOverlay=closeOverlay;
window.editCurrentCase=editCurrentCase;
window.confirmDelete=confirmDelete;
window.saveCase=saveCase;
window.clearForm=clearForm;
window.calcAge=calcAge;
window.closeModal=closeModal;
window.clearAllFilters=clearAllFilters;
window.applyFilter=applyFilter;
window.renderLogbook=renderLogbook;
window.renderDashboard=renderDashboard;
window.renderAnalytics=renderAnalytics;
window.renderGset=renderGset;
window.renderSettings=renderSettings;
window.toggleGsetItem=toggleGsetItem;
window.saveGsetNote=saveGsetNote;
window.toggleCat=toggleCat;
window.saveCriteria=saveCriteria;
window.resetCriteria=resetCriteria;
window.saveApiKey=saveApiKey;
window.saveOcrMode=saveOcrMode;
window.toggleDeident=toggleDeident;
window.exportJSON=exportJSON;
window.importJSON=importJSON;
window.clearAllData=clearAllData;
window.exportXLSX=exportXLSX;
window.exportCSV=exportCSV;
window.extractSticker=extractSticker;
window.extractOpNote=extractOpNote;
window.addClinicalPhotos=addClinicalPhotos;
window.classifyProc=classifyProc;
window.debounceClassify=debounceClassify;
window.runSearch=runSearch;
window.clearSearch=clearSearch;
window.focusSearch=focusSearch;
window.showGSheetsModal=showGSheetsModal;
window.showGitHubModal=showGitHubModal;
window.openPhotoLightbox=openPhotoLightbox;
window.loadDetailPhotos=loadDetailPhotos;
window.renderBackupBanner=renderBackupBanner;
window.populateFilterUI=populateFilterUI;
window.openFilterPanel=openFilterPanel;
window.toggleDeident=toggleDeident;
window.toggle=toggle;

init();
