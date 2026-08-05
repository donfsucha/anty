'use strict';

/* Connected mission operation engine. Loaded after the original app. */
const FLOW_ACTION_LABELS={
  APPROVE:'운항 승인',AUTO_ASSIGN:'자원 자동배정',CHECK_ALL:'비행 전 전체 점검',START:'이륙·임무 시작',
  HOLD:'일시대기',RESUME:'운항 재개',RTH:'긴급 복귀',DELIVER:'배송 완료·복귀',COMPLETE:'착륙·임무 종료',
  ACK_ALERT:'경보 확인',BATTERY_TOGGLE:'배터리 상태 변경'
};
const FLOW_STAGE_LABELS=['임무 생성','관제 승인','자원 배정','안전 점검','이륙 확인','배송 운항','복귀 운항','종료·증빙'];
const FLOW_COMMAND_ACTIONS=new Set(['START','HOLD','RESUME','RTH','DELIVER','COMPLETE']);

function flowRound1(value){
  const number=Number(value);
  return Number.isFinite(number)?Math.round((number+Number.EPSILON)*10)/10:0;
}
function flowFmt1(value,unit=''){
  const number=Number(value);
  return `${(Number.isFinite(number)?number:0).toFixed(1)}${unit}`;
}
function flowFmtCoordinate(value){
  const number=Number(value);
  return Number.isFinite(number)?number.toFixed(6):'0.000000';
}
function flowActor(){
  return state.role==='pilot'?'김도윤':state.role==='recipient'?'배송 수령인':'관제 관리자';
}
function flowDrone(id){return state.drones.find(item=>item.id===id);}
function flowBattery(id){return state.batteries.find(item=>item.id===id);}
function flowMission(id){return state.missions.find(item=>item.id===id);}
function flowNow(){return new Date().toISOString();}
function flowDelay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function flowPush(list,item,limit=300){list.push(item);if(list.length>limit)list.splice(0,list.length-limit);}
function flowHistory(mission,label,actor=flowActor()){
  mission.history=Array.isArray(mission.history)?mission.history:[];
  mission.history.push([label,Date.now(),actor]);
}
function flowAudit(action,targetType,targetId,detail,actor=flowActor()){
  state.auditLogs=Array.isArray(state.auditLogs)?state.auditLogs:[];
  flowPush(state.auditLogs,{id:uid('AUD'),action,targetType,targetId,detail,actor,createdAt:flowNow()});
}
function flowCommand(mission,action,status='APPLIED',result='SIMULATION_ACCEPTED'){
  state.commandLogs=Array.isArray(state.commandLogs)?state.commandLogs:[];
  const requestedAt=flowNow();
  const row={
    id:uid('CMD'),missionId:mission.id,droneId:mission.droneId||null,action,status,result,
    requestedBy:flowActor(),requestedAt,sentAt:requestedAt,
    acknowledgedAt:new Date(Date.now()+180).toISOString(),appliedAt:new Date(Date.now()+420).toISOString()
  };
  flowPush(state.commandLogs,row);return row;
}
function flowLatestOperation(missionId=null){
  const rows=(state.operations||[]).filter(item=>!missionId||item.missionId===missionId);
  return rows.length?rows[rows.length-1]:null;
}
function flowOperationBusy(missionId){
  return (state.operations||[]).some(item=>item.missionId===missionId&&item.status==='PROCESSING');
}
function flowEnsureState(){
  state.operations=Array.isArray(state.operations)?state.operations:[];
  state.commandLogs=Array.isArray(state.commandLogs)?state.commandLogs:[];
  state.auditLogs=Array.isArray(state.auditLogs)?state.auditLogs:[];
  state.telemetryLogs=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
  state.flowUi=state.flowUi&&typeof state.flowUi==='object'?state.flowUi:{operationOpen:false,operationId:null};
  Object.assign(STATUS,{DELIVERED:['배송 완료','blue'],LANDING:['착륙 중','amber']});
  state.drones.forEach(drone=>{
    ['battery','altitude','speed','link','satellites','flightHours','maintenance','x','y'].forEach(key=>{drone[key]=flowRound1(drone[key]);});
    const mission=state.missions.find(item=>item.droneId===drone.id&&!['COMPLETED','CANCELLED'].includes(item.status));
    drone.missionId=mission?.id||drone.missionId||null;
    drone.reservedMissionId=mission&&['READY','APPROVED'].includes(mission.status)?mission.id:drone.reservedMissionId||null;
  });
  state.batteries.forEach(battery=>{
    ['soc','soh','temp','cycles','cellDiff'].forEach(key=>{battery[key]=flowRound1(battery[key]);});
    const mission=state.missions.find(item=>item.batteryId===battery.id&&!['COMPLETED','CANCELLED'].includes(item.status));
    battery.reservedMissionId=mission&&['READY','APPROVED'].includes(mission.status)?mission.id:battery.reservedMissionId||null;
  });
  state.missions.forEach(mission=>{
    mission.progress=flowRound1(mission.progress);
    mission.etaMin=flowRound1(mission.etaMin);
    mission.payloadKg=flowRound1(mission.payloadKg);
    mission.returnProgress=flowRound1(mission.returnProgress||0);
    mission.approvalState=mission.approvalState||(mission.status==='READY'?'PENDING':'APPROVED');
    mission.history=Array.isArray(mission.history)?mission.history:[];
  });
  persist();
}
function flowOperationDefinition(action,mission){
  const definitions={
    APPROVE:['운항 승인 처리',['임무 정보 검증','화물·경로 확인','승인자 기록','임무 상태 동기화']],
    AUTO_ASSIGN:['기체·배터리 자동배정',['대기 기체 조회','적재중량·정비 상태 확인','배터리 SOC·SOH 확인','기체·배터리 예약','전체 화면 동기화']],
    CHECK_ALL:['비행 전 안전점검',['기체 외관·프로펠러','배터리 장착·잠금','화물함 적재·잠금','통신 링크·조종기','항로·공역 확인','기상·풍속 확인','점검자·시각 기록']],
    START:['이륙·임무 시작',['최종 안전조건 확인','명령 ID 생성','이륙 명령 전송','기체 ACK 확인','Armed·MISSION 모드 확인','텔레메트리 수신 확인','임무·자산 상태 동기화']],
    HOLD:['일시대기 전환',['현재 위치·고도 확인','HOLD 명령 전송','기체 ACK 확인','속도 0.0 km/h 확인','HOLD 모드 동기화']],
    RESUME:['운항 재개',['운항 조건 재확인','MISSION 명령 전송','기체 ACK 확인','속도·경로 재개 확인','임무 상태 동기화']],
    RTH:['긴급 복귀',['배터리·통신 안전여유 확인','RTH 명령 생성','명령 전송','기체 ACK 확인','RTL 모드 확인','복귀 경로·ETA 갱신']],
    DELIVER:['배송 완료·복귀',['배송지 접근 확인','수령 OTP 확인','화물함 개방 확인','배송 완료좌표 저장','전자 증빙 생성','RTL 복귀 전환']],
    COMPLETE:['착륙·임무 종료',['거점 도착 확인','착륙 상태 확인','Disarm 확인','기체·배터리 상태 복원','임무 종료시각 기록','보고서 데이터 동기화']]
  };
  const found=definitions[action]||[FLOW_ACTION_LABELS[action]||action,['요청 확인','처리','결과 저장']];
  return {title:found[0],steps:found[1],missionId:mission?.id||null,droneId:mission?.droneId||null};
}
function flowCreateOperation(mission,action){
  const definition=flowOperationDefinition(action,mission);
  const operation={
    id:uid('OP'),missionId:definition.missionId,droneId:definition.droneId,action,title:definition.title,
    status:'PROCESSING',progress:0,currentStep:0,totalSteps:definition.steps.length,message:'작업을 준비하고 있습니다.',
    requestedBy:flowActor(),requestedAt:flowNow(),completedAt:null,error:null,
    steps:definition.steps.map(name=>({name,status:'WAITING',startedAt:null,completedAt:null}))
  };
  flowPush(state.operations,operation,60);
  state.flowUi.operationOpen=true;state.flowUi.operationId=operation.id;
  persist();return operation;
}
function flowSetOperationStep(operation,index,status,message=''){
  operation.currentStep=index+1;
  operation.steps.forEach((step,stepIndex)=>{
    if(stepIndex<index&&step.status!=='ERROR'){step.status='DONE';step.completedAt=step.completedAt||flowNow();}
    if(stepIndex===index){step.status=status;if(status==='PROCESSING')step.startedAt=step.startedAt||flowNow();if(status==='DONE')step.completedAt=flowNow();}
  });
  operation.progress=flowRound1(((status==='DONE'?index+1:index+.45)/operation.totalSteps)*100);
  operation.message=message||operation.steps[index]?.name||operation.message;
  persist();render();
}
function flowValidateAction(mission,action){
  const allDone=Object.values(mission.checks||{}).every(Boolean);
  const drone=flowDrone(mission.droneId),battery=flowBattery(mission.batteryId);
  if(flowOperationBusy(mission.id))return '현재 이 임무에서 다른 작업이 진행 중입니다.';
  if(action==='APPROVE'&&mission.status!=='READY')return '승인 대기 상태의 임무만 승인할 수 있습니다.';
  if(action==='AUTO_ASSIGN'&&!['READY','APPROVED'].includes(mission.status))return '승인 전 또는 출동대기 임무에서만 자원을 배정할 수 있습니다.';
  if(action==='START'){
    if(mission.status!=='APPROVED')return '관제 승인을 먼저 완료하십시오.';
    if(!mission.droneId||!mission.batteryId)return '기체와 배터리를 먼저 배정하십시오.';
    if(!allDone)return '비행 전 점검을 모두 완료하십시오.';
    if(!drone||drone.status==='MAINTENANCE')return '운항 가능한 기체가 아닙니다.';
    if(!battery||battery.status==='QUARANTINE'||battery.soc<40)return '임무 투입 가능한 배터리가 아닙니다.';
  }
  if(action==='HOLD'&&mission.status!=='IN_FLIGHT')return '운항 중 임무만 일시대기할 수 있습니다.';
  if(action==='RESUME'&&mission.status!=='HOLDING')return '일시대기 상태에서만 운항을 재개할 수 있습니다.';
  if(action==='RTH'&&!['IN_FLIGHT','HOLDING','DELIVERED'].includes(mission.status))return '운항 중인 임무만 복귀할 수 있습니다.';
  if(action==='DELIVER'&&!['IN_FLIGHT','HOLDING'].includes(mission.status))return '배송지에 접근한 운항 임무만 배송 완료 처리할 수 있습니다.';
  if(action==='COMPLETE'&&mission.status!=='RETURNING')return '복귀 중 임무만 착륙·종료할 수 있습니다.';
  return '';
}
function flowReservedDrone(droneId,missionId){
  return state.missions.some(item=>item.id!==missionId&&item.droneId===droneId&&!['COMPLETED','CANCELLED'].includes(item.status));
}
function flowReservedBattery(batteryId,missionId){
  return state.missions.some(item=>item.id!==missionId&&item.batteryId===batteryId&&!['COMPLETED','CANCELLED'].includes(item.status));
}
function flowAssignResources(mission){
  let drone=flowDrone(mission.droneId);
  if(!drone||drone.status!=='READY'||flowReservedDrone(drone.id,mission.id)){
    drone=state.drones.find(item=>item.status==='READY'&&!flowReservedDrone(item.id,mission.id));
  }
  let battery=flowBattery(mission.batteryId);
  if(!battery||battery.status!=='READY'||battery.soc<60||battery.soh<85||flowReservedBattery(battery.id,mission.id)){
    battery=state.batteries.find(item=>item.status==='READY'&&item.soc>=60&&item.soh>=85&&!flowReservedBattery(item.id,mission.id));
  }
  if(!drone||!battery)throw new Error('사용 가능한 기체 또는 배터리가 없습니다.');
  mission.droneId=drone.id;mission.batteryId=battery.id;mission.pilot=mission.pilot||'김도윤';
  drone.reservedMissionId=mission.id;drone.missionId=mission.id;drone.batteryId=battery.id;drone.battery=flowRound1(battery.soc);
  battery.reservedMissionId=mission.id;battery.droneId=drone.id;
  flowHistory(mission,`자원 배정 · ${drone.name} (${drone.id}) / ${battery.id}`);
}
function flowCreateProof(mission){
  const drone=flowDrone(mission.droneId);
  if(state.proofs.some(item=>item.missionId===mission.id))return;
  state.proofs.unshift({
    id:uid('PRF'),missionId:mission.id,orderNo:mission.orderNo,recipient:mission.recipient,
    otp:String(Math.floor(1000+Math.random()*9000)),completedAt:flowNow(),lat:drone?.lat||37.5,lng:drone?.lng||126.76,tempRange:'22.0~24.1℃'
  });
}
function flowApplyAction(mission,action){
  const drone=flowDrone(mission.droneId),battery=flowBattery(mission.batteryId),at=flowNow();
  if(action==='APPROVE'){
    mission.status='APPROVED';mission.approvalState='APPROVED';mission.approvedAt=at;flowHistory(mission,'운항 승인 완료');
  }
  if(action==='AUTO_ASSIGN')flowAssignResources(mission);
  if(action==='CHECK_ALL'){
    Object.keys(mission.checks).forEach(key=>mission.checks[key]=true);
    mission.checkedAt=at;mission.checkedBy=flowActor();flowHistory(mission,'비행 전 전체 점검 완료');
  }
  if(action==='START'){
    mission.status='IN_FLIGHT';mission.departedAt=at;mission._progressRaw=mission.progress;
    if(drone){drone.status='IN_FLIGHT';drone.armed=true;drone.flightMode='MISSION';drone.missionId=mission.id;drone.reservedMissionId=null;}
    if(battery){battery.status='IN_USE';battery.droneId=drone?.id||null;battery.reservedMissionId=null;battery._socRaw=battery.soc;}
    flowHistory(mission,'이륙·임무 시작');flowCommand(mission,'START');
  }
  if(action==='HOLD'){
    mission.status='HOLDING';mission.holdStartedAt=at;
    if(drone){drone.status='HOLDING';drone.flightMode='HOLD';drone.speed=0;}
    flowHistory(mission,'일시대기 전환');flowCommand(mission,'HOLD');
  }
  if(action==='RESUME'){
    mission.status='IN_FLIGHT';mission.holdEndedAt=at;
    if(drone){drone.status='IN_FLIGHT';drone.flightMode='MISSION';drone.speed=flowRound1(Math.max(drone.speed,31));}
    flowHistory(mission,'운항 재개');flowCommand(mission,'RESUME');
  }
  if(action==='RTH'){
    mission.status='RETURNING';mission.returnProgress=0;mission.returnStartedAt=at;mission.returnReason='EMERGENCY';
    if(drone){drone.status='RETURNING';drone.flightMode='RTL';drone.speed=flowRound1(Math.max(drone.speed,31));}
    flowHistory(mission,'긴급 복귀 명령 실행');flowCommand(mission,'RTH');
  }
  if(action==='DELIVER'){
    mission.deliveredAt=at;mission.progress=100;mission.status='RETURNING';mission.returnProgress=0;mission.returnStartedAt=at;mission.returnReason='DELIVERY_COMPLETE';
    flowCreateProof(mission);
    if(drone){drone.status='RETURNING';drone.flightMode='RTL';drone.speed=flowRound1(Math.max(drone.speed,31));}
    flowHistory(mission,'배송 완료·자동 복귀 시작');flowCommand(mission,'DELIVER');
  }
  if(action==='COMPLETE'){
    const wasCompleted=mission.status==='COMPLETED';
    mission.status='COMPLETED';mission.progress=100;mission.returnProgress=100;mission.etaMin=0;mission.completedAt=at;
    if(drone){drone.status='READY';drone.armed=false;drone.flightMode='STANDBY';drone.altitude=0;drone.speed=0;drone.missionId=null;drone.reservedMissionId=null;}
    if(battery){battery.status=battery.soc>=40?'READY':'CHARGING';battery.reservedMissionId=null;}
    flowHistory(mission,'착륙·임무 종료');flowCommand(mission,'COMPLETE');
    if(!wasCompleted){state.stats.success+=1;state.stats.onTime+=1;}
  }
  if(FLOW_COMMAND_ACTIONS.has(action)&&action!=='START'&&action!=='HOLD'&&action!=='RESUME'&&action!=='RTH'&&action!=='DELIVER'&&action!=='COMPLETE')flowCommand(mission,action);
  flowAudit(action,'MISSION',mission.id,`${FLOW_ACTION_LABELS[action]||action} · ${mission.droneId||'미배정'} · ${mission.batteryId||'미배정'}`);
}
async function flowRunMissionOperation(missionId,action){
  const mission=flowMission(missionId);if(!mission)return;
  const validation=flowValidateAction(mission,action);
  if(validation){toast('작업을 실행할 수 없습니다',validation,'error');return;}
  const operation=flowCreateOperation(mission,action);render();
  try{
    for(let index=0;index<operation.steps.length;index+=1){
      flowSetOperationStep(operation,index,'PROCESSING',`${operation.steps[index].name} 중...`);
      await flowDelay(action==='CHECK_ALL'?260:320);
      if(state.settings.mode==='gateway'&&index===Math.max(1,operation.steps.length-3)&&FLOW_COMMAND_ACTIONS.has(action)){
        await gatewayFetch('/api/commands',{method:'POST',body:JSON.stringify({missionId:mission.id,droneId:mission.droneId,command:action,commandId:uid('CMD')})});
      }
      flowSetOperationStep(operation,index,'DONE',`${operation.steps[index].name} 완료`);
      await flowDelay(100);
    }
    flowApplyAction(mission,action);
    operation.status='SUCCESS';operation.progress=100;operation.message=`${operation.title}이 정상 처리되었습니다.`;operation.completedAt=flowNow();
    persist();render();toast(`${operation.title} 완료`,`${mission.id} · 모든 화면에 상태가 반영되었습니다.`,'success');
    setTimeout(()=>{state.flowUi.operationOpen=false;persist();render();},1100);
  }catch(error){
    const index=Math.max(0,operation.currentStep-1);if(operation.steps[index])operation.steps[index].status='ERROR';
    operation.status='ERROR';operation.error=error.message;operation.message=error.message;operation.completedAt=flowNow();
    flowAudit(`${action}_FAILED`,'MISSION',mission.id,error.message);persist();render();toast(`${operation.title} 실패`,error.message,'error');
  }
}
function flowMissionStages(mission){
  const allChecks=Object.values(mission.checks||{}).every(Boolean);
  const delivered=Boolean(mission.deliveredAt||state.proofs.some(item=>item.missionId===mission.id));
  const departed=Boolean(mission.departedAt||['IN_FLIGHT','HOLDING','RETURNING','COMPLETED'].includes(mission.status));
  const returned=mission.status==='COMPLETED';
  const checks=[true,mission.status!=='READY',Boolean(mission.droneId&&mission.batteryId),allChecks,departed,delivered,returned,returned];
  let activeIndex=checks.findIndex(value=>!value);if(activeIndex<0)activeIndex=checks.length-1;
  if(mission.status==='IN_FLIGHT'||mission.status==='HOLDING')activeIndex=5;
  if(mission.status==='RETURNING')activeIndex=6;
  if(mission.status==='COMPLETED')activeIndex=7;
  return FLOW_STAGE_LABELS.map((label,index)=>({label,status:checks[index]?'DONE':index===activeIndex?'ACTIVE':'WAITING'}));
}
function flowNextAction(mission){
  const allDone=Object.values(mission.checks||{}).every(Boolean);
  if(mission.status==='READY')return '관제 운영자의 운항 승인이 필요합니다.';
  if(mission.status==='APPROVED'&&!mission.droneId)return '기체와 배터리를 자동배정하십시오.';
  if(mission.status==='APPROVED'&&!allDone)return '비행 전 안전점검을 완료하십시오.';
  if(mission.status==='APPROVED')return '이륙·임무 시작을 실행하십시오.';
  if(mission.status==='IN_FLIGHT')return '운항 수치와 배송지 접근 상태를 확인하십시오.';
  if(mission.status==='HOLDING')return '안전조건 확인 후 운항을 재개하거나 복귀하십시오.';
  if(mission.status==='RETURNING')return '거점 도착 후 착륙·임무 종료를 실행하십시오.';
  if(mission.status==='COMPLETED')return '배송증빙과 운영기록을 확인하십시오.';
  return '임무 상태를 확인하십시오.';
}
function flowTelemetryTick(){
  if(state.settings.mode!=='simulation')return;
  let changed=false;const speedFactor=Number(state.settings.simulationSpeed||1);
  state.missions.forEach(mission=>{
    if(!['IN_FLIGHT','HOLDING','RETURNING'].includes(mission.status))return;
    const drone=flowDrone(mission.droneId),battery=flowBattery(mission.batteryId);if(!drone)return;
    if(mission.status==='IN_FLIGHT'){
      mission._progressRaw=Number.isFinite(mission._progressRaw)?mission._progressRaw:Number(mission.progress||0);
      mission._progressRaw=clamp(mission._progressRaw+.32*speedFactor,0,96);
      mission.progress=flowRound1(mission._progressRaw);mission.etaMin=flowRound1(Math.max(1,(100-mission.progress)/6));
      drone.x=flowRound1(clamp(drone.x+.11*speedFactor,8,84));drone.y=flowRound1(clamp(drone.y-.05*speedFactor,18,82));
      drone.altitude=flowRound1(62+Math.sin(Date.now()/5000)*9);drone.speed=flowRound1(34+Math.sin(Date.now()/3000)*5);
    }
    if(mission.status==='HOLDING'){drone.speed=0;drone.altitude=flowRound1(drone.altitude);}
    if(mission.status==='RETURNING'){
      mission._returnRaw=Number.isFinite(mission._returnRaw)?mission._returnRaw:Number(mission.returnProgress||0);
      mission._returnRaw=clamp(mission._returnRaw+.42*speedFactor,0,99);mission.returnProgress=flowRound1(mission._returnRaw);
      mission.etaMin=flowRound1(Math.max(1,(100-mission.returnProgress)/9));
      drone.x=flowRound1(clamp(drone.x-.1*speedFactor,10,85));drone.y=flowRound1(clamp(drone.y+.05*speedFactor,15,85));
      drone.altitude=flowRound1(Math.max(18,drone.altitude-.08));drone.speed=flowRound1(31+Math.sin(Date.now()/3500)*2.5);
    }
    drone.link=flowRound1(clamp(drone.link+(Math.random()-.5)*1.2,72,100));
    if(battery){battery._socRaw=Number.isFinite(battery._socRaw)?battery._socRaw:Number(battery.soc||0);battery._socRaw=clamp(battery._socRaw-.025*speedFactor,8,100);battery.soc=flowRound1(battery._socRaw);battery.temp=flowRound1(clamp(battery.temp+.015,20,55));drone.battery=battery.soc;}
    changed=true;
  });
  const now=Date.now();
  if(changed&&(!state.lastFlowTelemetryAt||now-state.lastFlowTelemetryAt>=5000)){
    state.lastFlowTelemetryAt=now;
    state.drones.filter(drone=>['IN_FLIGHT','HOLDING','RETURNING'].includes(drone.status)).forEach(drone=>{
      const mission=state.missions.find(item=>item.droneId===drone.id&&!['COMPLETED','CANCELLED'].includes(item.status));const battery=flowBattery(drone.batteryId);
      flowPush(state.telemetryLogs,{id:uid('TEL'),missionId:mission?.id||null,droneId:drone.id,batteryId:drone.batteryId||null,recordedAt:flowNow(),altitude:flowRound1(drone.altitude),speed:flowRound1(drone.speed),battery:flowRound1(battery?.soc||drone.battery),temperature:flowRound1(battery?.temp||0),link:flowRound1(drone.link),satellites:flowRound1(drone.satellites),flightMode:drone.flightMode,source:'SIMULATION'},500);
    });
  }
  if(changed){persist();if(!state.flowUi.operationOpen)render();}
}
