const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
let missionQuery='',missionFilter='ALL',missionDraftStep=1,lastSimulationAt=0;
state.recordCache=state.recordCache||{telemetry:[],commands:[],checks:[],battery:[]};

function toast(title,message='',type='info',duration=3600){
  const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<strong>${escapeHtml(title)}</strong>${message?`<p>${escapeHtml(message)}</p>`:''}`;
  $('#toast-root').appendChild(el);setTimeout(()=>el.remove(),duration);
}
function render(){
  DLogisMap.destroy();let html='';
  if(!state.session.role)html=welcomeView();
  else if(state.session.role==='pilot')html=pilotView();
  else if(state.session.role==='recipient')html=recipientView();
  else{
    const views={dashboard:dashboardView,missions:missionsView,assets:assetsView,safety:safetyView,records:recordsView,settings:settingsView};
    html=adminShell((views[state.ui.view]||dashboardView)());
  }
  $('#app').innerHTML=html;updateClock();
  if(state.session.role==='admin'&&state.ui.view==='dashboard')requestAnimationFrame(()=>DLogisMap.render());
}
async function refreshRecordCache(showToast=false){
  try{
    const [telemetry,commands,checks,battery]=await Promise.all([DLogisDB.all('telemetry'),DLogisDB.all('command'),DLogisDB.all('check'),DLogisDB.all('battery')]);
    state.recordCache={telemetry:telemetry.slice(-500),commands:commands.slice(-500),checks:checks.slice(-500),battery:battery.slice(-500)};
    if(showToast)toast('운영기록 갱신 완료',`비행로그 ${telemetry.length.toFixed(1)}건을 불러왔습니다.`,'success');
    if(state.session.role==='admin'&&state.ui.view==='records')render();
  }catch(error){console.warn(error);if(showToast)toast('기록 갱신 실패',error.message,'error');}
}
function addCache(type,row){const list=state.recordCache[type];if(!list)return;list.push(row);if(list.length>500)list.splice(0,list.length-500);}

function openMissionWizard(){
  missionDraftStep=1;
  const readyDrones=state.drones.filter(d=>d.airworthy&&d.status==='READY'),readyBatteries=state.batteries.filter(b=>b.status==='READY'&&b.soc>=60&&b.soh>=85&&b.cellDeltaMv<=50);
  const local=new Date(Date.now()+30*60000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('#modal-root').innerHTML=`<div class="modal-backdrop" data-modal-close><section class="modal" onclick="event.stopPropagation()"><div class="modal-head"><div><h2>신규 배송임무</h2><p>4단계 입력과 자동 안전검토 후 Mission ID를 생성합니다.</p></div><button class="btn icon" data-modal-close>${icon('close')}</button></div><form id="mission-form"><div class="modal-body"><div class="wizard-steps">${['배송정보','경로·일정','자원배정','최종검토'].map((label,index)=>`<div class="wizard-step ${index===0?'active':''}" data-wizard-indicator="${index+1}">${index+1}. ${label}</div>`).join('')}</div>
  <section class="wizard-page active" data-wizard-page="1"><div class="form-grid"><div class="field full"><label>임무명 <em>*</em></label><input class="input" name="title" required placeholder="예: 산업단지 긴급부품 배송"></div><div class="field"><label>배송 유형</label><select class="select" name="type"><option value="GENERAL">일반배송</option><option value="INDUSTRIAL">산업물류</option><option value="MEDICAL">의료연계</option><option value="EMERGENCY">재난긴급</option></select></div><div class="field"><label>우선순위</label><select class="select" name="priority"><option value="NORMAL">일반</option><option value="HIGH">우선</option><option value="URGENT">긴급</option></select></div><div class="field"><label>화물명 <em>*</em></label><input class="input" name="cargo" required></div><div class="field"><label>중량(kg) <em>*</em></label><input class="input" name="payloadKg" type="number" min="0.1" max="10" step="0.1" value="1.0" required></div><div class="field"><label>수령인·부서 <em>*</em></label><input class="input" name="recipient" required></div><div class="field"><label>연락처</label><input class="input" name="recipientPhone" value="010-0000-0000"></div></div></section>
  <section class="wizard-page" data-wizard-page="2"><div class="form-grid"><div class="field"><label>출발지 <em>*</em></label><select class="select" name="originId">${state.locations.filter(l=>l.type==='HUB').map(l=>`<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}</select></div><div class="field"><label>배송지 <em>*</em></label><select class="select" name="destinationId">${state.locations.filter(l=>l.type!=='HUB').map(l=>`<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}</select></div><div class="field"><label>출발 예정시각 <em>*</em></label><input class="input" name="scheduledAt" type="datetime-local" value="${local}" required></div><div class="field"><label>수령 OTP</label><input class="input mono" name="otp" value="${Math.floor(100000+Math.random()*900000)}" readonly></div><div class="field full"><div class="notice">거리와 예상 비행시간은 출발지·도착지의 WGS84 좌표로 자동 계산합니다.</div></div></div></section>
  <section class="wizard-page" data-wizard-page="3"><div class="form-grid"><div class="field"><label>조종자</label><select class="select" name="pilot"><option>김도윤</option><option>이현우</option><option>최민재</option></select></div><div class="field"><label>드론</label><select class="select" name="droneId"><option value="">자동배정 대기</option>${readyDrones.map(d=>`<option value="${d.id}">${escapeHtml(d.name)} · 최대 ${fmt1(d.payloadMaxKg,'kg')}</option>`).join('')}</select><div class="help">화물중량을 초과하는 기체는 생성 단계에서 차단합니다.</div></div><div class="field"><label>배터리</label><select class="select" name="batteryId"><option value="">자동배정 대기</option>${readyBatteries.map(b=>`<option value="${b.id}">${b.id} · SOC ${fmt1(b.soc,'%')} · SOH ${fmt1(b.soh,'%')}</option>`).join('')}</select></div><div class="field"><label>기록주기</label><input class="input" value="${state.settings.telemetryIntervalSec}초" disabled></div></div></section>
  <section class="wizard-page" data-wizard-page="4"><div id="mission-review" class="review-grid"></div><div class="notice warning" style="margin-top:13px">생성 직후 상태는 ‘승인대기’입니다. 관제 승인과 7개 안전점검이 완료되어야 이륙할 수 있습니다.</div></section></div><div class="modal-foot"><button type="button" class="btn" data-modal-close>취소</button><button type="button" class="btn" data-wizard-prev disabled>이전</button><button type="button" class="btn primary" data-wizard-next>다음</button><button type="submit" class="btn primary hidden" data-wizard-submit>임무 생성</button></div></form></section></div>`;
}
function updateWizard(step){
  missionDraftStep=step;$$('[data-wizard-page]').forEach(x=>x.classList.toggle('active',Number(x.dataset.wizardPage)===step));$$('[data-wizard-indicator]').forEach(x=>x.classList.toggle('active',Number(x.dataset.wizardIndicator)===step));
  $('[data-wizard-prev]').disabled=step===1;$('[data-wizard-next]').classList.toggle('hidden',step===4);$('[data-wizard-submit]').classList.toggle('hidden',step!==4);
  if(step===4){const fd=new FormData($('#mission-form')),origin=locationById(fd.get('originId')),destination=locationById(fd.get('destinationId'));$('#mission-review').innerHTML=[['임무명',fd.get('title')],['화물',`${fd.get('cargo')} · ${fmt1(fd.get('payloadKg'),'kg')}`],['경로',`${origin?.name} → ${destination?.name}`],['거리',fmt1(haversineKm(origin,destination),'km')],['출발예정',fmtKST(new Date(fd.get('scheduledAt')).toISOString(),false)],['조종자',fd.get('pilot')],['드론',fd.get('droneId')||'생성 후 자동배정'],['배터리',fd.get('batteryId')||'생성 후 자동배정']].map(([label,value])=>`<div class="review-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');}
}
function validateWizardStep(step){const page=$(`[data-wizard-page="${step}"]`);for(const input of $$('input,select',page)){if(!input.reportValidity())return false;}return true;}
function kstDateId(){return new Intl.DateTimeFormat('sv-SE',{timeZone:TIME_ZONE}).format(new Date()).replaceAll('-','');}
function createMission(form){
  const fd=new FormData(form),origin=locationById(fd.get('originId')),destination=locationById(fd.get('destinationId')),distance=haversineKm(origin,destination),scheduled=new Date(fd.get('scheduledAt')).toISOString(),payload=round1(fd.get('payloadKg')),drone=droneById(fd.get('droneId'));
  if(drone&&payload>drone.payloadMaxKg)return toast('기체 배정 실패',`화물 ${fmt1(payload,'kg')}이 ${drone.name} 최대 탑재량을 초과합니다.`,'error');
  const id=`MSN-${kstDateId()}-${String(state.missions.length+1).padStart(3,'0')}`,minutes=Math.max(8,Math.ceil(distance/34*60));
  const mission={id,orderNo:`ORD-${Date.now().toString().slice(-10)}`,title:fd.get('title'),type:fd.get('type'),priority:fd.get('priority'),status:'PENDING_APPROVAL',progress:0,originId:origin.id,destinationId:destination.id,droneId:fd.get('droneId')||null,batteryId:fd.get('batteryId')||null,pilot:fd.get('pilot'),cargo:fd.get('cargo'),payloadKg:payload,recipient:fd.get('recipient'),recipientPhone:fd.get('recipientPhone'),otp:fd.get('otp'),distanceKm:distance,scheduledAt:scheduled,createdAt:nowIso(),approvedAt:null,departedAt:null,etaAt:new Date(new Date(scheduled).getTime()+minutes*60000).toISOString(),completedAt:null,onTime:null,checks:{weather:false,airspace:false,airframe:false,battery:false,cargo:false,link:false,route:false},history:[{event:'임무 생성',at:nowIso(),actor:state.session.operatorName}]};
  state.missions.unshift(mission);state.ui.selectedMissionId=id;state.ui.view='missions';logAudit('MISSION_CREATE','MISSION',id,`${mission.title} · ${mission.cargo} · ${fmt1(mission.payloadKg,'kg')}`);addAlert({severity:mission.priority==='URGENT'?'CRITICAL':'WARNING',category:'MISSION',title:'신규 임무 승인 필요',message:`${id} · ${mission.title}`,missionId:id});persist();$('#modal-root').innerHTML='';render();toast('배송임무 생성 완료',`${id}가 승인대기로 등록되었습니다.`,'success');
}
async function toggleCheck(id,key){
  const mission=missionById(id);if(!mission)return;mission.checks[key]=!mission.checks[key];const actor=state.session.role==='pilot'?'김도윤':state.session.operatorName;
  const row={id:uid('CHK'),missionId:id,itemKey:key,itemName:CHECK_LABELS[key],passed:mission.checks[key],checkedAt:nowIso(),checkedBy:actor,note:mission.checks[key]?'점검 완료':'점검 해제',source:'MANUAL'};
  addCache('checks',row);await DLogisDB.add('check',row);mission.history.push({event:`${CHECK_LABELS[key]} ${mission.checks[key]?'완료':'해제'}`,at:row.checkedAt,actor});logAudit('PREFLIGHT_CHECK','MISSION',id,`${CHECK_LABELS[key]}: ${mission.checks[key]?'완료':'해제'}`,actor);persist();render();
}
async function completeAllChecks(id){
  const mission=missionById(id);if(!mission)return;const checkedAt=nowIso(),actor=state.session.role==='pilot'?'김도윤':state.session.operatorName;
  for(const key of Object.keys(mission.checks)){if(!mission.checks[key]){const row={id:uid('CHK'),missionId:id,itemKey:key,itemName:CHECK_LABELS[key],passed:true,checkedAt,checkedBy:actor,note:'전체 점검 실행',source:'MANUAL'};addCache('checks',row);await DLogisDB.add('check',row);}mission.checks[key]=true;}
  mission.history.push({event:'비행 전 전체 점검 완료',at:checkedAt,actor});logAudit('PREFLIGHT_ALL','MISSION',id,'7개 안전점검 전체 완료',actor);persist();render();toast('비행 전 점검 완료','점검자와 완료시각이 기록되었습니다.','success');
}
function autoAssign(id){
  const mission=missionById(id);if(!mission)return;const drone=state.drones.find(x=>x.airworthy&&x.status==='READY'&&x.payloadMaxKg>=mission.payloadKg),battery=state.batteries.find(x=>x.status==='READY'&&x.soc>=60&&x.soh>=85&&x.cellDeltaMv<=50);
  if(!drone||!battery)return toast('자동배정 불가','화물중량과 안전기준을 만족하는 기체 또는 배터리가 없습니다.','error');
  mission.droneId=drone.id;mission.batteryId=battery.id;mission.pilot=mission.pilot==='미배정'?'김도윤':mission.pilot;drone.batteryId=battery.id;battery.droneId=drone.id;mission.history.push({event:`자원 자동배정 · ${drone.id} / ${battery.id}`,at:nowIso(),actor:state.session.operatorName});logAudit('AUTO_ASSIGN','MISSION',id,`${drone.id} · ${battery.id}`);persist();render();toast('자원 자동배정 완료',`${drone.name}과 ${battery.id}를 배정했습니다.`,'success');
}
async function commandLog(mission,command,result='APPLIED'){
  const requestedAt=nowIso(),actor=state.session.role==='pilot'?'김도윤':state.session.operatorName;
  const row={id:uid('CMD'),missionId:mission.id,droneId:mission.droneId,command,requestedBy:actor,requestedAt,sentAt:requestedAt,acknowledgedAt:new Date(Date.now()+180).toISOString(),appliedAt:new Date(Date.now()+420).toISOString(),status:result,result:state.settings.mode==='simulation'?'SIMULATION_ACCEPTED':'MAV_RESULT_ACCEPTED',source:state.settings.mode==='simulation'?'SIMULATION':'GATEWAY'};
  addCache('commands',row);await DLogisDB.add('command',row);logAudit('COMMAND','MISSION',mission.id,`${command} · ${row.result}`,actor);return row;
}
async function missionAction(id,action){
  const mission=missionById(id);if(!mission)return;const actor=state.session.role==='pilot'?'김도윤':state.session.operatorName;
  if(['RTH','CANCEL'].includes(action)&&!confirm(`${action==='RTH'?'긴급 복귀':'임무 취소'}를 실행하시겠습니까?\n사용자와 실행시각이 기록됩니다.`))return;
  if(action==='APPROVE'){mission.status='READY';mission.approvedAt=nowIso();mission.history.push({event:'운항 승인',at:mission.approvedAt,actor});await commandLog(mission,'APPROVE');}
  if(action==='CANCEL'){mission.status='CANCELLED';mission.history.push({event:'임무 취소',at:nowIso(),actor});await commandLog(mission,'CANCEL');}
  if(action==='START'){
    if(!mission.droneId||!mission.batteryId)return toast('이륙 차단','기체와 배터리를 먼저 배정하세요.','error');
    if(!Object.values(mission.checks).every(Boolean))return toast('이륙 차단','7개 비행 전 점검을 모두 완료하세요.','error');
    const drone=droneById(mission.droneId),battery=batteryById(mission.batteryId);if(!drone?.airworthy||!battery||battery.status==='QUARANTINE'||battery.soc<40)return toast('이륙 차단','기체 또는 배터리가 임무 투입 기준을 충족하지 않습니다.','error');
    mission.status='IN_FLIGHT';mission.departedAt=nowIso();mission.history.push({event:'이륙·임무 시작',at:mission.departedAt,actor});drone.status='IN_FLIGHT';drone.missionId=mission.id;drone.armed=true;drone.flightMode='MISSION';drone.payloadKg=mission.payloadKg;battery.status='IN_USE';await commandLog(mission,'START');
  }
  if(action==='HOLD'){mission.status='HOLDING';mission.history.push({event:'일시대기',at:nowIso(),actor});const drone=droneById(mission.droneId);if(drone){drone.status='HOLDING';drone.flightMode='HOLD';drone.groundSpeedKmh=0;}await commandLog(mission,'HOLD');}
  if(action==='RESUME'){mission.status='IN_FLIGHT';mission.history.push({event:'운항 재개',at:nowIso(),actor});const drone=droneById(mission.droneId);if(drone){drone.status='IN_FLIGHT';drone.flightMode='MISSION';}await commandLog(mission,'RESUME');}
  if(action==='RTH'){mission.status='RETURNING';mission.returnProgress=0;mission.history.push({event:'긴급 복귀 명령',at:nowIso(),actor});const drone=droneById(mission.droneId);if(drone){drone.status='RETURNING';drone.flightMode='RTL';drone.payloadKg=0;}await commandLog(mission,'RTH');}
  if(action==='COMPLETE'){
    mission.status='COMPLETED';mission.progress=100;mission.completedAt=nowIso();mission.onTime=new Date(mission.completedAt)<=new Date(mission.etaAt);mission.history.push({event:'착륙·임무 종료',at:mission.completedAt,actor});
    const drone=droneById(mission.droneId),battery=batteryById(mission.batteryId),origin=locationById(mission.originId),destination=locationById(mission.destinationId);
    if(drone){drone.status='READY';drone.missionId=null;drone.armed=false;drone.flightMode='STANDBY';drone.altitudeM=0;drone.groundSpeedKmh=0;drone.payloadKg=0;drone.lat=origin.lat;drone.lng=origin.lng;}
    if(battery){battery.status=battery.soc>=40?'READY':'CHARGING';battery.droneId=drone?.id||null;}
    if(!state.proofs.some(p=>p.missionId===mission.id))state.proofs.unshift({id:uid('PRF'),missionId:mission.id,orderNo:mission.orderNo,recipient:mission.recipient,method:'OTP+화물함 개폐',otpMatched:true,lockerOpenedAt:mission.completedAt,deliveredAt:mission.completedAt,latitudeDms:coordToDms(destination.lat,true),longitudeDms:coordToDms(destination.lng,false),photoFileName:`POD_${mission.id}.jpg`,signature:'전자 인수확인 완료',temperatureMinC:round1(22+Math.random()),temperatureMaxC:round1(24+Math.random())});
    await commandLog(mission,'COMPLETE');
  }
  persist();render();toast('임무 상태 변경',`${mission.id} · ${STATUS[mission.status]?.[0]||mission.status}`,'success');
}
function acknowledgeAlert(id){const alert=state.alerts.find(x=>x.id===id);if(!alert)return;alert.acknowledged=true;alert.acknowledgedAt=nowIso();alert.acknowledgedBy=state.session.operatorName;logAudit('ALERT_ACK','ALERT',id,alert.title);persist();render();toast('경보 확인 기록 완료',`${alert.acknowledgedBy} · ${fmtKST(alert.acknowledgedAt,true)}`,'success');}
function saveSettings(){state.settings.mapProvider=$('#setting-map-provider')?.value||state.settings.mapProvider;state.settings.kakaoJavaScriptKey=$('#setting-kakao-key')?.value.trim()||'';state.settings.telemetryIntervalSec=Number($('#setting-log-interval')?.value||5);persist();render();toast('설정 저장 완료',state.settings.mapProvider==='kakao'?'카카오맵 무료 대상 앱으로 연결합니다.':'OpenStreetMap을 사용합니다.','success');}
function updateClock(){const clock=$('#live-clock'),date=$('#live-date');if(clock)clock.textContent=fmtTime(nowIso(),true);if(date)date.textContent=fmtDate(nowIso());}
function setRole(role){state.session.role=role;if(role==='admin'){state.session.operatorName='한지수';state.session.operatorRole='관제운영 책임자';state.ui.view='dashboard';}if(role==='pilot'){state.session.operatorName='김도윤';state.session.operatorRole='현장 조종자';}if(role==='recipient'){state.session.operatorName='박서연';state.session.operatorRole='배송 수령인';}persist();render();}

async function simulationLoop(){
  if(state.settings.mode!=='simulation')return;const now=Date.now(),interval=state.settings.telemetryIntervalSec*1000;if(now-lastSimulationAt<interval)return;lastSimulationAt=now;let changed=false;
  for(const mission of activeMissions()){
    const drone=droneById(mission.droneId),battery=batteryById(mission.batteryId),origin=locationById(mission.originId),destination=locationById(mission.destinationId);if(!drone||!origin||!destination)continue;
    if(mission.status==='IN_FLIGHT'||mission.status==='DELIVERING'){mission.progress=round1(clamp(mission.progress+1.2,0,97));if(mission.progress>=78)mission.status='DELIVERING';const p=mission.progress/100;drone.lat=roundCoord(origin.lat+(destination.lat-origin.lat)*p);drone.lng=roundCoord(origin.lng+(destination.lng-origin.lng)*p);drone.altitudeM=round1(78+Math.sin(now/5000)*7);drone.groundSpeedKmh=round1(34+Math.sin(now/3000)*4);drone.headingDeg=round1(105+Math.sin(now/7000)*12);}
    else if(mission.status==='RETURNING'){mission.returnProgress=round1(clamp((mission.returnProgress||0)+1.3,0,98));const p=1-mission.returnProgress/100;drone.lat=roundCoord(origin.lat+(destination.lat-origin.lat)*p);drone.lng=roundCoord(origin.lng+(destination.lng-origin.lng)*p);drone.altitudeM=round1(Math.max(18,74-mission.returnProgress*.45));drone.groundSpeedKmh=round1(39+Math.sin(now/3500)*3);}
    else if(mission.status==='HOLDING'){drone.groundSpeedKmh=0;drone.altitudeM=round1(drone.altitudeM);}
    drone.linkQualityPct=round1(clamp(drone.linkQualityPct+(Math.random()-.5)*2,55,100));drone.satellites=round1(clamp(drone.satellites+(Math.random()>.7?(Math.random()>.5?1:-1):0),12,26));
    if(battery){battery.soc=round1(clamp(battery.soc-.2,5,100));battery.temperatureC=round1(clamp(battery.temperatureC+(Math.random()-.35)*.15,25,49));if(battery.soc<24)addAlert({severity:'WARNING',category:'BATTERY',title:`${drone.name} 배터리 안전여유 감소`,message:`현재 SOC ${fmt1(battery.soc,'%')}입니다. 복귀 가능시간을 확인하세요.`,missionId:mission.id,droneId:drone.id,batteryId:battery.id,currentValue:battery.soc,threshold:24,unit:'%'});}
    if(drone.linkQualityPct<65)addAlert({severity:'CRITICAL',category:'LINK',title:`${drone.name} 통신품질 저하`,message:`현재 통신품질 ${fmt1(drone.linkQualityPct,'%')}입니다.`,missionId:mission.id,droneId:drone.id,currentValue:drone.linkQualityPct,threshold:65,unit:'%'});
    const telemetry=recordTelemetry(drone,mission);addCache('telemetry',telemetry);
    if(battery)addCache('battery',{id:uid('BATLOG'),missionId:mission.id,droneId:drone.id,batteryId:battery.id,recordedAt:telemetry.receivedAt,soc:battery.soc,soh:battery.soh,temperatureC:battery.temperatureC,cellDeltaMv:battery.cellDeltaMv,cycles:battery.cycles,status:battery.status,source:'SIMULATION'});
    changed=true;
  }
  if(changed){persist();if(state.session.role)render();}
}

async function bootstrap(){
  try{await DLogisDB.open();await refreshRecordCache(false);if(!state.recordCache.telemetry.length){for(const mission of activeMissions()){const drone=droneById(mission.droneId);if(drone){const row=recordTelemetry(drone,mission);addCache('telemetry',row);}}persist();}}catch(error){console.warn('IndexedDB 초기화 실패',error);}
  render();
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('button,[data-select-mission],[data-go-missions]');if(!target)return;
  if(target.dataset.enterRole)return setRole(target.dataset.enterRole);
  if(target.dataset.exit!==undefined){state.session.role=null;persist();return render();}
  if(target.dataset.roleMenu!==undefined){state.session.role=null;persist();return render();}
  if(target.dataset.sidebarToggle!==undefined){state.ui.sidebarOpen=!state.ui.sidebarOpen;persist();return render();}
  if(target.dataset.view){state.session.role='admin';state.ui.view=target.dataset.view;state.ui.sidebarOpen=false;persist();return render();}
  if(target.dataset.newMission!==undefined)return openMissionWizard();
  if(target.dataset.modalClose!==undefined){$('#modal-root').innerHTML='';return;}
  if(target.dataset.wizardNext!==undefined){if(!validateWizardStep(missionDraftStep))return;return updateWizard(Math.min(4,missionDraftStep+1));}
  if(target.dataset.wizardPrev!==undefined)return updateWizard(Math.max(1,missionDraftStep-1));
  if(target.dataset.selectMission){state.ui.selectedMissionId=target.dataset.selectMission;if(target.dataset.goMissions!==undefined){state.session.role='admin';state.ui.view='missions';}persist();return render();}
  if(target.dataset.toggleCheck)return toggleCheck(target.dataset.toggleCheck,target.dataset.checkKey);
  if(target.dataset.checkAll)return completeAllChecks(target.dataset.checkAll);
  if(target.dataset.autoAssign)return autoAssign(target.dataset.autoAssign);
  if(target.dataset.missionAction)return missionAction(target.dataset.missionId,target.dataset.missionAction);
  if(target.dataset.ackAlert)return acknowledgeAlert(target.dataset.ackAlert);
  if(target.dataset.ackAll!==undefined){state.alerts.filter(a=>!a.acknowledged).forEach(a=>{a.acknowledged=true;a.acknowledgedAt=nowIso();a.acknowledgedBy=state.session.operatorName;});logAudit('ALERT_ACK_ALL','ALERT','ALL','전체 경보 확인');persist();render();return toast('전체 경보 확인 완료','확인자와 시각이 기록되었습니다.','success');}
  if(target.dataset.testAlert!==undefined){addAlert({severity:'WARNING',category:'LINK',title:'통신품질 시험경보',message:'화면·기록 검증을 위한 시험 경보입니다.',droneId:'DR-003',currentValue:62.4,threshold:65,unit:'%'});persist();render();return toast('시험경보 생성','안전·경보 센터에 기록했습니다.','warning');}
  if(target.dataset.recordType){state.ui.recordType=target.dataset.recordType;persist();return render();}
  if(target.dataset.refreshRecords!==undefined)return refreshRecordCache(true);
  if(target.dataset.exportXlsx!==undefined)return exportOperationalWorkbook();
  if(target.dataset.exportJson!==undefined)return exportJsonBackup();
  if(target.dataset.openKakao!==undefined)return DLogisMap.openInKakao();
  if(target.dataset.saveSettings!==undefined)return saveSettings();
  if(target.dataset.reset!==undefined){if(confirm('현재 브라우저의 모든 임무·설정·정밀로그를 초기화하시겠습니까?')){localStorage.removeItem(STORAGE_KEY);await DLogisDB.clear();state=seedState();state.recordCache={telemetry:[],commands:[],checks:[],battery:[]};persist();await bootstrap();toast('초기화 완료','최초 시연 데이터로 복원했습니다.','success');}return;}
  if(target.dataset.copyOtp){try{await navigator.clipboard.writeText(target.dataset.copyOtp);toast('수령코드 복사 완료',target.dataset.copyOtp,'success');}catch{toast('수령코드',target.dataset.copyOtp);}}
});
document.addEventListener('input',event=>{if(event.target.id==='mission-search'){missionQuery=event.target.value;render();const input=$('#mission-search');input?.focus();input?.setSelectionRange(missionQuery.length,missionQuery.length);}});
document.addEventListener('change',event=>{if(event.target.id==='mission-filter'){missionFilter=event.target.value;render();}if(event.target.id==='quick-map-provider'){state.settings.mapProvider=event.target.value;persist();render();}});
document.addEventListener('submit',event=>{if(event.target.id==='mission-form'){event.preventDefault();createMission(event.target);}});
window.addEventListener('keydown',event=>{if(event.key==='Escape')$('#modal-root').innerHTML='';});
setInterval(updateClock,1000);setInterval(simulationLoop,1000);bootstrap();
