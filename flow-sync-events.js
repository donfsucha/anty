'use strict';

function flowCreateMission(form){
  const fd=new FormData(form);
  const id=`MSN-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${String(state.missions.length+4).padStart(3,'0')}`;
  const mission={
    id,orderNo:`ORD-${Date.now().toString().slice(-10)}`,title:fd.get('title'),cargo:fd.get('cargo'),payloadKg:flowRound1(fd.get('payloadKg')),
    origin:fd.get('origin'),destination:fd.get('destination'),recipient:fd.get('recipient'),phone:fd.get('phone'),pilot:fd.get('pilot'),
    droneId:fd.get('droneId')||null,batteryId:fd.get('batteryId')||null,status:'READY',approvalState:'PENDING',priority:fd.get('priority'),
    progress:0,etaMin:15,createdAt:flowNow(),approvedAt:null,departedAt:null,deliveredAt:null,completedAt:null,returnProgress:0,
    checks:{airframe:false,battery:false,cargo:false,link:false,route:false,weather:false},history:[['임무 생성',Date.now(),flowActor()]]
  };
  state.missions.unshift(mission);state.selectedMission=id;state.view='missions';state.stats.today+=1;
  if(mission.droneId){const drone=flowDrone(mission.droneId);if(drone){drone.reservedMissionId=id;drone.missionId=id;}}
  if(mission.batteryId){const battery=flowBattery(mission.batteryId);if(battery)battery.reservedMissionId=id;}
  flowAudit('MISSION_CREATE','MISSION',id,`${mission.title} · ${flowFmt1(mission.payloadKg,'kg')}`);
  closeModal();persist();render();toast('임무가 생성되었습니다',`${id} · 현재 단계는 운항 승인 대기입니다.`,'success');
}
async function flowRunAlertOperation(alertId){
  const alert=state.alerts.find(item=>item.id===alertId);if(!alert||alert.ack)return;
  const operation={id:uid('OP'),missionId:null,droneId:null,action:'ACK_ALERT',title:'경보 확인 기록',status:'PROCESSING',progress:0,currentStep:0,totalSteps:3,message:'경보 정보를 확인하고 있습니다.',requestedBy:flowActor(),requestedAt:flowNow(),completedAt:null,error:null,steps:['경보 대상·현재값 확인','확인자·확인시각 기록','안전경보 화면 동기화'].map(name=>({name,status:'WAITING',startedAt:null,completedAt:null}))};
  flowPush(state.operations,operation,60);state.flowUi.operationOpen=true;state.flowUi.operationId=operation.id;persist();render();
  for(let index=0;index<operation.steps.length;index+=1){flowSetOperationStep(operation,index,'PROCESSING',`${operation.steps[index].name} 중...`);await flowDelay(260);flowSetOperationStep(operation,index,'DONE',`${operation.steps[index].name} 완료`);await flowDelay(80);}
  alert.ack=true;alert.acknowledgedAt=flowNow();alert.acknowledgedBy=flowActor();operation.status='SUCCESS';operation.progress=100;operation.completedAt=flowNow();operation.message='경보 확인자와 확인시각을 저장했습니다.';flowAudit('ALERT_ACK','ALERT',alert.id,alert.title);persist();render();toast('경보 확인 완료',`${alert.acknowledgedBy} · ${fmtDateTime(alert.acknowledgedAt)}`,'success');setTimeout(()=>{state.flowUi.operationOpen=false;persist();render();},900);
}
async function flowRunBatteryOperation(batteryId){
  const battery=flowBattery(batteryId);if(!battery)return;
  const operation={id:uid('OP'),missionId:battery.reservedMissionId||null,droneId:battery.droneId||null,action:'BATTERY_TOGGLE',title:'배터리 상태 변경',status:'PROCESSING',progress:0,currentStep:0,totalSteps:4,message:'배터리 안전상태를 확인하고 있습니다.',requestedBy:flowActor(),requestedAt:flowNow(),completedAt:null,error:null,steps:['현재 SOC·SOH 확인','장착·예약 임무 확인','상태 변경 기록','자산·임무 화면 동기화'].map(name=>({name,status:'WAITING',startedAt:null,completedAt:null}))};
  flowPush(state.operations,operation,60);state.flowUi.operationOpen=true;state.flowUi.operationId=operation.id;persist();render();
  try{
    for(let index=0;index<operation.steps.length;index+=1){flowSetOperationStep(operation,index,'PROCESSING',`${operation.steps[index].name} 중...`);await flowDelay(250);if(index===1&&battery.status!=='QUARANTINE'&&battery.droneId&&state.missions.some(item=>item.batteryId===battery.id&&['IN_FLIGHT','HOLDING','RETURNING'].includes(item.status)))throw new Error('운항 중인 기체에 장착된 배터리는 격리할 수 없습니다.');flowSetOperationStep(operation,index,'DONE',`${operation.steps[index].name} 완료`);await flowDelay(80);}
    battery.status=battery.status==='QUARANTINE'?'READY':'QUARANTINE';operation.status='SUCCESS';operation.progress=100;operation.completedAt=flowNow();operation.message=`${battery.id} 상태가 ${batteryStatus(battery.status)[0]}으로 변경되었습니다.`;flowAudit('BATTERY_STATUS','BATTERY',battery.id,operation.message);persist();render();toast('배터리 상태 변경 완료',operation.message,'success');setTimeout(()=>{state.flowUi.operationOpen=false;persist();render();},900);
  }catch(error){operation.status='ERROR';operation.error=error.message;operation.message=error.message;operation.completedAt=flowNow();const current=operation.steps[Math.max(0,operation.currentStep-1)];if(current)current.status='ERROR';persist();render();toast('배터리 상태 변경 실패',error.message,'error');}
}
function flowShowDroneDetail(droneId){
  const drone=flowDrone(droneId);if(!drone)return;const battery=flowBattery(drone.batteryId);const mission=state.missions.find(item=>item.droneId===drone.id&&!['COMPLETED','CANCELLED'].includes(item.status));
  $('#modal-root').innerHTML=`<div class="modal-backdrop" data-modal-close><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><div class="modal-head"><div><h2>${escapeHtml(drone.name)}</h2><p>${drone.id} · ${escapeHtml(drone.model)} · 모든 화면의 동일 기체 정보</p></div><button class="btn icon" data-modal-close>${ICONS.close}</button></div><div class="modal-body"><div class="detail-grid"><div class="detail-item"><span>현재 상태</span><strong>${STATUS[drone.status]?.[0]||drone.status}</strong></div><div class="detail-item"><span>연결 임무</span><strong>${mission?`${mission.id} · ${escapeHtml(mission.title)}`:'없음'}</strong></div><div class="detail-item"><span>배터리</span><strong>${battery?`${battery.id} · ${flowFmt1(battery.soc,'%')}`:'미장착'}</strong></div><div class="detail-item"><span>통신 / GNSS</span><strong>${flowFmt1(drone.link,'%')} · ${flowFmt1(drone.satellites,'개')}</strong></div><div class="detail-item"><span>고도 / 속도</span><strong>${flowFmt1(drone.altitude,'m')} · ${flowFmt1(drone.speed,'km/h')}</strong></div><div class="detail-item"><span>비행모드</span><strong>${escapeHtml(drone.flightMode||'-')}</strong></div></div>${mission?`<div class="next-action-box"><span>임무 현재 단계</span><strong>${escapeHtml(flowCurrentStageName(mission))} · ${escapeHtml(flowNextAction(mission))}</strong></div>`:''}</div><div class="modal-foot"><button class="btn" data-modal-close>닫기</button>${mission?`<button class="btn primary" data-select-mission="${mission.id}" data-go-missions data-modal-close>임무 상세보기</button>`:''}</div></div></div>`;
}
function flowExportMissions(){
  const rows=[['임무ID','주문번호','임무명','출발지','배송지','드론명','기체ID','모델','배터리','조종자','상태','현재단계','진행률(%)','ETA(분)','생성시각','출발시각','완료시각'],...state.missions.map(mission=>{const drone=flowDrone(mission.droneId);return [mission.id,mission.orderNo,mission.title,mission.origin,mission.destination,drone?.name||'',drone?.id||'',drone?.model||'',mission.batteryId||'',mission.pilot||'',STATUS[mission.status]?.[0]||mission.status,flowCurrentStageName(mission),flowFmt1(mission.progress),flowFmt1(mission.etaMin),mission.createdAt||'',mission.departedAt||'',mission.completedAt||''];})];
  download(`DLOGIS_missions_${new Date().toISOString().slice(0,10)}.csv`,csv(rows),'text/csv;charset=utf-8');toast('임무 CSV 생성 완료','드론명·기체 ID·단계·소수점 한 자리 수치를 저장했습니다.','success');
}

/* Override original functions so every call path uses the connected operation engine. */
createMission=flowCreateMission;
autoAssign=id=>flowRunMissionOperation(id,'AUTO_ASSIGN');
allChecks=id=>flowRunMissionOperation(id,'CHECK_ALL');
missionAction=(id,action)=>flowRunMissionOperation(id,action);
ackAlert=id=>flowRunAlertOperation(id);
exportMissions=flowExportMissions;

/* Capture major action buttons before the original click handler changes state instantly. */
document.addEventListener('click',event=>{
  const target=event.target.closest('button,[data-select-drone]');if(!target)return;
  const stop=()=>{event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();};
  if(target.dataset.operationClose!==undefined){stop();state.flowUi.operationOpen=false;persist();render();return;}
  if(target.dataset.operationOpen!==undefined){stop();state.flowUi.operationOpen=true;persist();render();return;}
  if(target.dataset.missionAction){
    stop();const action=target.dataset.missionAction;if(action==='RTH'&&!confirm('긴급 복귀를 실행하시겠습니까?\n현재 기체·배터리·통신 상태를 확인한 뒤 명령 진행상황을 표시합니다.'))return;
    flowRunMissionOperation(target.dataset.missionId,action);return;
  }
  if(target.dataset.autoAssign){stop();flowRunMissionOperation(target.dataset.autoAssign,'AUTO_ASSIGN');return;}
  if(target.dataset.checkAll){stop();flowRunMissionOperation(target.dataset.checkAll,'CHECK_ALL');return;}
  if(target.dataset.ackAlert){stop();flowRunAlertOperation(target.dataset.ackAlert);return;}
  if(target.dataset.ackAll!==undefined){stop();const pending=state.alerts.filter(item=>!item.ack);if(!pending.length){toast('확인할 경보가 없습니다.','','info');return;}Promise.all(pending.map(item=>flowRunAlertOperation(item.id)));return;}
  if(target.dataset.toggleBattery){stop();flowRunBatteryOperation(target.dataset.toggleBattery);return;}
  if(target.dataset.droneRth){stop();const mission=state.missions.find(item=>item.droneId===target.dataset.droneRth&&['IN_FLIGHT','HOLDING'].includes(item.status));if(!mission){toast('복귀 대상 없음','운항 중 임무가 없습니다.','error');return;}if(confirm(`${flowDrone(target.dataset.droneRth)?.name||target.dataset.droneRth}의 긴급 복귀를 실행하시겠습니까?`))flowRunMissionOperation(mission.id,'RTH');return;}
  if(target.dataset.selectDrone){stop();flowShowDroneDetail(target.dataset.selectDrone);return;}
  if(target.dataset.exportCsv!==undefined){stop();flowExportMissions();return;}
},true);

flowEnsureState();
clearInterval(timer);
timer=setInterval(flowTelemetryTick,1000);
persist();
render();
