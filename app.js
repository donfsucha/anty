function render(){
  let html;
  if(!state.role) html=welcome();
  else if(state.role==='pilot') html=pilotView();
  else if(state.role==='recipient') html=recipientView();
  else { const views={dashboard,missions:missionsView,fleet:fleetView,batteries:batteryView,safety:safetyView,proofs:proofsView,reports:reportsView,connection:connectionView}; html=adminShell((views[state.view]||dashboard)()); }
  $('#app').innerHTML=html;
}

function openMissionModal(){
  const readyDrones=state.drones.filter(d=>d.status==='READY'); const readyBats=state.batteries.filter(b=>b.status==='READY'&&b.soc>=60&&b.soh>=85);
  $('#modal-root').innerHTML=`<div class="modal-backdrop" data-modal-close><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><div class="modal-head"><div><h2>신규 배송임무</h2><p class="muted" style="margin:4px 0 0;font-size:.68rem">주문·화물·자원 정보를 입력합니다.</p></div><button class="btn icon" data-modal-close>${ICONS.close}</button></div><form id="mission-form"><div class="modal-body form-grid"><div class="field full"><label>임무명</label><input class="input" name="title" required placeholder="예: 긴급 의약품 배송"></div><div class="field"><label>출발지</label><input class="input" name="origin" required value="부천 물류거점 A"></div><div class="field"><label>배송지</label><input class="input" name="destination" required placeholder="배송지 명칭"></div><div class="field"><label>화물명</label><input class="input" name="cargo" required placeholder="화물 종류"></div><div class="field"><label>중량(kg)</label><input class="input" name="payloadKg" type="number" min="0.1" max="10" step="0.1" value="1.0" required></div><div class="field"><label>수령인</label><input class="input" name="recipient" required placeholder="부서 또는 성명"></div><div class="field"><label>연락처</label><input class="input" name="phone" value="010-0000-0000"></div><div class="field"><label>우선순위</label><select class="select" name="priority"><option value="NORMAL">일반</option><option value="HIGH">높음</option><option value="URGENT">긴급</option></select></div><div class="field"><label>조종자</label><select class="select" name="pilot"><option>김도윤</option><option>박서준</option><option>이서연</option></select></div><div class="field"><label>드론</label><select class="select" name="droneId"><option value="">미배정</option>${readyDrones.map(d=>`<option value="${d.id}">${d.id} · ${d.name} · ${d.battery}%</option>`).join('')}</select></div><div class="field"><label>배터리</label><select class="select" name="batteryId"><option value="">미배정</option>${readyBats.map(b=>`<option value="${b.id}">${b.id} · SOC ${b.soc}% · SOH ${b.soh}%</option>`).join('')}</select></div></div><div class="modal-foot"><button type="button" class="btn" data-modal-close>취소</button><button class="btn primary" type="submit">임무 생성</button></div></form></div></div>`;
}
function closeModal(){ $('#modal-root').innerHTML=''; }
function createMission(form){
  const fd=new FormData(form),id=`MSN-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${String(state.missions.length+4).padStart(3,'0')}`;
  const m={id,orderNo:`ORD-${Date.now().toString().slice(-10)}`,title:fd.get('title'),cargo:fd.get('cargo'),payloadKg:Number(fd.get('payloadKg')),origin:fd.get('origin'),destination:fd.get('destination'),recipient:fd.get('recipient'),phone:fd.get('phone'),pilot:fd.get('pilot'),droneId:fd.get('droneId')||null,batteryId:fd.get('batteryId')||null,status:'READY',priority:fd.get('priority'),progress:0,etaMin:15,createdAt:nowIso(),departedAt:null,checks:{airframe:false,battery:false,cargo:false,link:false,route:false,weather:false},history:[['임무 생성',Date.now()]]};
  state.missions.unshift(m); state.selectedMission=id; state.view='missions'; state.stats.today++; closeModal(); saveRender(); toast('임무가 생성되었습니다',`${id} · 비행 전 점검을 진행하십시오.`,'success');
}
function autoAssign(id){ const m=state.missions.find(x=>x.id===id); if(!m)return; const d=state.drones.find(x=>x.status==='READY'),b=state.batteries.find(x=>x.status==='READY'&&x.soc>=60&&x.soh>=85); if(!d||!b)return toast('자동 배정 실패','사용 가능한 기체 또는 배터리가 없습니다.','error'); m.droneId=d.id;m.batteryId=b.id;m.pilot=m.pilot||'김도윤';saveRender();toast('자원 자동 배정 완료',`${d.id} · ${b.id}`,'success'); }
function toggleCheck(id,key,value){ const m=state.missions.find(x=>x.id===id);if(!m)return;m.checks[key]=value??!m.checks[key];m.history.push([`${CHECK_LABELS[key]} ${m.checks[key]?'완료':'해제'}`,Date.now()]);saveRender(); }
function allChecks(id){ const m=state.missions.find(x=>x.id===id);if(!m)return;Object.keys(m.checks).forEach(k=>m.checks[k]=true);m.history.push(['비행 전 전체 점검 완료',Date.now()]);saveRender();toast('전체 안전점검 완료','이륙 조건을 확인했습니다.','success'); }
async function missionAction(id,action){
  const m=state.missions.find(x=>x.id===id);if(!m)return;
  if(state.settings.mode==='gateway'){
    if(state.settings.gatewayStatus!=='online')return toast('명령 전송 차단','게이트웨이 연결을 먼저 확인하십시오.','error');
    try{ await gatewayFetch('/api/commands',{method:'POST',body:JSON.stringify({missionId:id,droneId:m.droneId,command:action,commandId:uid('CMD')})}); toast('게이트웨이 명령 전송',`${action} 명령이 접수되었습니다.`,'success'); return; }
    catch(e){ return toast('명령 전송 실패',e.message,'error'); }
  }
  const transitions={START:'IN_FLIGHT',HOLD:'HOLDING',RESUME:'IN_FLIGHT',RTH:'RETURNING',COMPLETE:'COMPLETED'}; const next=transitions[action];if(!next)return;
  if(action==='START'&&!Object.values(m.checks).every(Boolean))return toast('이륙 차단','비행 전 점검을 모두 완료하십시오.','error');
  m.status=next;m.history.push([({START:'임무 시작',HOLD:'일시대기',RESUME:'운항재개',RTH:'즉시복귀',COMPLETE:'배송완료'})[action],Date.now()]);
  const d=state.drones.find(x=>x.id===m.droneId),b=state.batteries.find(x=>x.id===m.batteryId);
  if(action==='START'){m.departedAt=nowIso();if(d){d.status='IN_FLIGHT';d.armed=true;d.flightMode='MISSION'}if(b)b.status='IN_USE'}
  if(action==='HOLD'&&d){d.status='HOLDING';d.flightMode='HOLD'}
  if(action==='RESUME'&&d){d.status='IN_FLIGHT';d.flightMode='MISSION'}
  if(action==='RTH'&&d){d.status='RETURNING';d.flightMode='RTL'}
  if(action==='COMPLETE'){m.progress=100;m.etaMin=0;m.completedAt=nowIso();if(d){d.status='READY';d.armed=false;d.altitude=0;d.speed=0;d.flightMode='STANDBY'}if(b)b.status='READY';if(!state.proofs.some(p=>p.missionId===m.id)){state.proofs.unshift({id:uid('PRF'),missionId:m.id,orderNo:m.orderNo,recipient:m.recipient,otp:String(Math.floor(1000+Math.random()*9000)),completedAt:m.completedAt,lat:d?.lat||37.5,lng:d?.lng||126.76,tempRange:'22.0~24.1℃'});state.stats.success++;state.stats.onTime++;}}
  saveRender();toast('임무 상태 변경',`${m.id} · ${STATUS[next][0]}`,'success');
}
function ackAlert(id){const a=state.alerts.find(x=>x.id===id);if(a){a.ack=true;saveRender();toast('경보 확인 처리','감사로그에 기록되었습니다.','success')}}
function createAlert(){state.alerts.unshift({id:uid('ALT'),severity:'WARNING',title:'통신품질 시험경보',message:'시뮬레이션 검증용 경보입니다. 실제 기체에는 영향이 없습니다.',createdAt:nowIso(),ack:false});saveRender();toast('시험경보 생성','안전경보 센터에서 확인할 수 있습니다.');}
function gatewayFetch(path,options={}){const base=state.settings.gatewayUrl.replace(/\/$/,'');if(!base)throw new Error('게이트웨이 주소가 없습니다.');return Promise.race([fetch(base+path,{...options,headers:{'Content-Type':'application/json','X-Drone-Key':state.settings.apiKey,...options.headers}}).then(async r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('연결 시간 초과')),5000))]);}
async function testConnection(){ if(state.settings.mode==='simulation'){state.settings.gatewayStatus='idle';state.settings.lastGatewayCheck=nowIso();persist();render();return toast('시뮬레이션 모드','외부 연결 없이 정상 실행 중입니다.','success');} try{await gatewayFetch('/api/health');state.settings.gatewayStatus='online';state.settings.lastGatewayCheck=nowIso();persist();render();toast('게이트웨이 연결 성공','상태 API 응답을 확인했습니다.','success')}catch(e){state.settings.gatewayStatus='failed';state.settings.lastGatewayCheck=nowIso();persist();render();toast('게이트웨이 연결 실패',e.message,'error')}}
function saveConnection(){state.settings.mode=$('#connection-mode').value;state.settings.gatewayUrl=$('#gateway-url').value.trim();state.settings.apiKey=$('#gateway-key').value.trim();state.settings.gatewayStatus='idle';persist();render();toast('연결 설정 저장',state.settings.mode==='simulation'?'가상 운항을 계속합니다.':'연결 시험 후 실기체 명령을 사용할 수 있습니다.','success')}
function download(name,content,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},200)}
function csv(rows){return '\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n')}
function exportMissions(){download(`DLOGIS_missions_${new Date().toISOString().slice(0,10)}.csv`,csv([['임무ID','주문번호','임무명','출발지','배송지','기체','배터리','상태','진행률'],...state.missions.map(m=>[m.id,m.orderNo,m.title,m.origin,m.destination,m.droneId,m.batteryId,STATUS[m.status][0],m.progress])]),'text/csv;charset=utf-8')}
function resetDemo(){if(!confirm('현재 브라우저의 데모 데이터를 초기화하시겠습니까?'))return;state=seedState();persist();render();toast('데모 초기화 완료','초기 임무와 기체 데이터가 복원되었습니다.','success')}
function tick(){if(state.settings.mode!=='simulation')return;let changed=false;for(const m of state.missions){if(m.status==='IN_FLIGHT'){m.progress=clamp(m.progress+.35*state.settings.simulationSpeed,0,96);m.etaMin=Math.max(1,Math.ceil((100-m.progress)/6));const d=state.drones.find(x=>x.id===m.droneId),b=state.batteries.find(x=>x.id===m.batteryId);if(d){d.x=clamp(d.x+.12,8,84);d.y=clamp(d.y-.055,18,82);d.altitude=Math.round(62+Math.sin(Date.now()/5000)*9);d.speed=Math.round(34+Math.sin(Date.now()/3000)*5);if(Math.random()<.08)d.link=clamp(d.link+Math.round(Math.random()*4-2),72,100)}if(b&&Math.random()<.18){b.soc=clamp(b.soc-.1,8,100);b.temp=clamp(b.temp+.02,20,55);if(d)d.battery=Math.round(b.soc)}changed=true}else if(m.status==='RETURNING'){m.progress=clamp(m.progress-.18,5,100);m.etaMin=Math.max(1,Math.ceil(m.progress/9));const d=state.drones.find(x=>x.id===m.droneId);if(d){d.x=clamp(d.x-.12,10,85);d.y=clamp(d.y+.06,15,85);d.altitude=Math.max(18,Math.round(d.altitude-.08));d.speed=31}changed=true}}
  if(changed){persist(); if(state.role&&((state.role==='admin'&&['dashboard','missions','fleet','batteries'].includes(state.view))||state.role!=='admin'))render();}
}

function setRole(role){state.role=role;if(role==='admin'&&!NAV.some(n=>n[0]===state.view))state.view='dashboard';persist();render();}
function setView(v){state.role='admin';state.view=v;state.sidebar=false;persist();render();window.scrollTo({top:0,behavior:'smooth'});}

document.addEventListener('click',async e=>{
  const t=e.target.closest('button,[data-select-mission],[data-go-missions],[data-drone-map]');if(!t)return;
  if(t.dataset.enterRole)return setRole(t.dataset.enterRole);
  if(t.dataset.role)return setRole(t.dataset.role);
  if(t.dataset.exit!==undefined){state.role=null;persist();return render()}
  if(t.dataset.roleMenu!==undefined){$('#role-menu')?.classList.toggle('hidden');return}
  if(t.dataset.menu!==undefined){state.sidebar=true;return render()}
  if(t.dataset.menuClose!==undefined){state.sidebar=false;return render()}
  if(t.dataset.view)return setView(t.dataset.view);
  if(t.dataset.newMission!==undefined)return openMissionModal();
  if(t.dataset.modalClose!==undefined)return closeModal();
  if(t.dataset.selectMission){state.selectedMission=t.dataset.selectMission;if(t.dataset.goMissions!==undefined)state.view='missions';persist();return render()}
  if(t.dataset.droneMap){const m=state.missions.find(x=>x.droneId===t.dataset.droneMap&&['IN_FLIGHT','HOLDING','RETURNING'].includes(x.status));if(m){state.selectedMission=m.id;return setView('missions')}return toast('기체 대기 중',`${t.dataset.droneMap}에 진행 중 임무가 없습니다.`)}
  if(t.dataset.toggleCheck)return toggleCheck(t.dataset.toggleCheck,t.dataset.checkKey);
  if(t.dataset.checkAll)return allChecks(t.dataset.checkAll);
  if(t.dataset.autoAssign)return autoAssign(t.dataset.autoAssign);
  if(t.dataset.missionAction)return missionAction(t.dataset.missionId,t.dataset.missionAction);
  if(t.dataset.ackAlert)return ackAlert(t.dataset.ackAlert);
  if(t.dataset.ackAll!==undefined){state.alerts.forEach(a=>a.ack=true);saveRender();return toast('전체 경보 확인','모든 경보를 확인 처리했습니다.','success')}
  if(t.dataset.createAlert!==undefined)return createAlert();
  if(t.dataset.toggleBattery){const b=state.batteries.find(x=>x.id===t.dataset.toggleBattery);b.status=b.status==='QUARANTINE'?'READY':'QUARANTINE';saveRender();return toast('배터리 상태 변경',`${b.id} · ${batteryStatus(b.status)[0]}`,'success')}
  if(t.dataset.droneRth){const m=state.missions.find(x=>x.droneId===t.dataset.droneRth&&['IN_FLIGHT','HOLDING'].includes(x.status));return m?missionAction(m.id,'RTH'):toast('복귀 대상 없음','운항 중 임무가 없습니다.','error')}
  if(t.dataset.saveConnection!==undefined)return saveConnection();
  if(t.dataset.testConnection!==undefined)return testConnection();
  if(t.dataset.reset!==undefined)return resetDemo();
  if(t.dataset.exportCsv!==undefined)return exportMissions();
  if(t.dataset.exportJson!==undefined)return download(`DLOGIS_backup_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json');
  if(t.dataset.exportProof!==undefined)return download('DLOGIS_proofs.csv',csv([['증빙ID','임무ID','주문번호','수령인','OTP','완료시간','위도','경도','온도'],...state.proofs.map(p=>[p.id,p.missionId,p.orderNo,p.recipient,p.otp,p.completedAt,p.lat,p.lng,p.tempRange])]),'text/csv;charset=utf-8');
  if(t.dataset.exportReport!==undefined)return download('DLOGIS_report.csv',csv([['지표','값'],['오늘 배송',state.stats.today],['성공',state.stats.success],['정시',state.stats.onTime],['경보',state.alerts.length]]),'text/csv;charset=utf-8');
  if(t.dataset.print!==undefined)return window.print();
  if(t.dataset.copyOtp){try{await navigator.clipboard.writeText(t.dataset.copyOtp);toast('OTP 복사 완료',t.dataset.copyOtp,'success')}catch{toast('OTP',t.dataset.copyOtp)}return}
  if(t.dataset.support!==undefined)return toast('배송 문의 접수','관제센터에 현재 배송상태를 전달했습니다.','success');
  if(t.dataset.toastClose)document.getElementById(t.dataset.toastClose)?.remove();
});
document.addEventListener('submit',e=>{if(e.target.id==='mission-form'){e.preventDefault();createMission(e.target)}});
document.addEventListener('input',e=>{if(e.target.id==='mission-search'){missionQuery=e.target.value;render();$('#mission-search')?.focus()}});
document.addEventListener('change',e=>{if(e.target.id==='mission-status'){missionStatus=e.target.value;render()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#role-menu')?.classList.add('hidden')}});
window.addEventListener('beforeinstallprompt',e=>e.preventDefault());
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
render();timer=setInterval(tick,1000);
