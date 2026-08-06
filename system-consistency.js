'use strict';

/*
 * Canonical state synchronizer.
 * Every page reads the same mission → drone → battery relationship, so dashboard
 * counts, moving map markers, fleet cards and detail panels cannot drift apart.
 */
(function installSystemConsistency(){
  const ACTIVE_MISSION_STATUSES=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);
  const CLOSED_MISSION_STATUSES=new Set(['COMPLETED','CANCELLED']);
  const ACTIVE_DRONE_STATUSES=new Set(['IN_FLIGHT','HOLDING','RETURNING','LANDING']);
  const STATUS_TO_DRONE={IN_FLIGHT:'IN_FLIGHT',HOLDING:'HOLDING',DELIVERED:'RETURNING',RETURNING:'RETURNING',LANDING:'LANDING'};
  const STATUS_TO_MODE={IN_FLIGHT:'MISSION',HOLDING:'HOLD',DELIVERED:'RTL',RETURNING:'RTL',LANDING:'LAND'};
  let reconciling=false;

  Object.assign(STATUS,{MAINTENANCE:['정비 중','red'],CHARGING:['충전 중','amber'],OFFLINE:['오프라인','red'],LANDING:['착륙 중','amber']});

  function isActiveMission(mission){return Boolean(mission&&ACTIVE_MISSION_STATUSES.has(mission.status));}
  function isOpenMission(mission){return Boolean(mission&&!CLOSED_MISSION_STATUSES.has(mission.status));}
  function setValue(target,key,value,repairs,label){
    if(!target||target[key]===value)return;
    target[key]=value;
    repairs.push(label);
  }
  function missionSort(a,b){
    const activeDiff=Number(isActiveMission(b))-Number(isActiveMission(a));
    if(activeDiff)return activeDiff;
    return new Date(a.departedAt||a.approvedAt||a.createdAt||0)-new Date(b.departedAt||b.approvedAt||b.createdAt||0);
  }

  function reconcileAssignments(openMissions,issues,repairs){
    const droneOwner=new Map();
    const batteryOwner=new Map();
    [...openMissions].sort(missionSort).forEach(mission=>{
      if(mission.droneId){
        const drone=flowDrone(mission.droneId);
        if(!drone){issues.push(`${mission.id}: 등록되지 않은 드론 ${mission.droneId}`);}
        else if(droneOwner.has(drone.id)){
          const owner=droneOwner.get(drone.id);
          if(!isActiveMission(mission)){
            mission.droneId=null;
            repairs.push(`${mission.id}: 중복 드론 ${drone.id} 배정 해제`);
          }else issues.push(`${mission.id}: 운항 드론 ${drone.id} 중복 배정`);
        }else droneOwner.set(drone.id,mission);
      }
      if(mission.batteryId){
        const battery=flowBattery(mission.batteryId);
        if(!battery){issues.push(`${mission.id}: 등록되지 않은 배터리 ${mission.batteryId}`);}
        else if(batteryOwner.has(battery.id)){
          const owner=batteryOwner.get(battery.id);
          if(!isActiveMission(mission)){
            mission.batteryId=null;
            repairs.push(`${mission.id}: 중복 배터리 ${battery.id} 배정 해제`);
          }else issues.push(`${mission.id}: 운항 배터리 ${battery.id} 중복 배정`);
        }else batteryOwner.set(battery.id,mission);
      }
    });
    return {droneOwner,batteryOwner};
  }

  function normalizeNumbers(){
    state.missions.forEach(mission=>{
      mission.progress=flowRound1(clamp(Number(mission.progress)||0,0,100));
      mission.etaMin=flowRound1(Math.max(0,Number(mission.etaMin)||0));
      mission.returnProgress=flowRound1(clamp(Number(mission.returnProgress)||0,0,100));
      mission.payloadKg=flowRound1(Math.max(0,Number(mission.payloadKg)||0));
    });
    state.drones.forEach(drone=>{
      ['battery','altitude','speed','link','satellites','flightHours','maintenance','x','y'].forEach(key=>{drone[key]=flowRound1(Number(drone[key])||0);});
    });
    state.batteries.forEach(battery=>{
      ['soc','soh','temp','cycles','cellDiff'].forEach(key=>{battery[key]=flowRound1(Number(battery[key])||0);});
    });
  }

  function flowReconcileState(){
    if(reconciling)return state.consistencyAudit||null;
    reconciling=true;
    try{
      normalizeNumbers();
      const issues=[];
      const repairs=[];
      const openMissions=state.missions.filter(isOpenMission);
      const activeMissions=openMissions.filter(isActiveMission);
      const {droneOwner,batteryOwner}=reconcileAssignments(openMissions,issues,repairs);
      const activeDroneIds=new Set();
      const activeBatteryIds=new Set();

      activeMissions.forEach(mission=>{
        const drone=flowDrone(mission.droneId);
        const battery=flowBattery(mission.batteryId);
        if(!drone){issues.push(`${mission.id}: 운항 임무에 드론이 없습니다.`);}
        if(!battery){issues.push(`${mission.id}: 운항 임무에 배터리가 없습니다.`);}
        if(drone){
          activeDroneIds.add(drone.id);
          setValue(drone,'status',STATUS_TO_DRONE[mission.status]||'IN_FLIGHT',repairs,`${drone.id}: 임무 상태와 기체 상태 동기화`);
          setValue(drone,'flightMode',STATUS_TO_MODE[mission.status]||'MISSION',repairs,`${drone.id}: 비행모드 동기화`);
          setValue(drone,'armed',true,repairs,`${drone.id}: Armed 상태 동기화`);
          setValue(drone,'missionId',mission.id,repairs,`${drone.id}: Mission ID 동기화`);
          drone.reservedMissionId=null;
          if(mission.batteryId)setValue(drone,'batteryId',mission.batteryId,repairs,`${drone.id}: 배터리 연결 동기화`);
          if(battery)drone.battery=flowRound1(battery.soc);
        }
        if(battery){
          activeBatteryIds.add(battery.id);
          setValue(battery,'status','IN_USE',repairs,`${battery.id}: 운항 배터리 사용 상태 동기화`);
          setValue(battery,'droneId',drone?.id||null,repairs,`${battery.id}: 장착 기체 동기화`);
          battery.reservedMissionId=null;
        }
      });

      openMissions.filter(mission=>!isActiveMission(mission)).forEach(mission=>{
        const drone=flowDrone(mission.droneId);
        const battery=flowBattery(mission.batteryId);
        if(drone&&droneOwner.get(drone.id)?.id===mission.id){
          drone.reservedMissionId=mission.id;
          drone.missionId=mission.id;
          if(drone.status!=='MAINTENANCE'&&drone.flightMode!=='OFFLINE'){
            setValue(drone,'status','READY',repairs,`${drone.id}: 대기 임무 상태로 복원`);
            setValue(drone,'flightMode','STANDBY',repairs,`${drone.id}: 대기 모드로 복원`);
            setValue(drone,'armed',false,repairs,`${drone.id}: Disarmed 상태로 복원`);
            setValue(drone,'speed',0,repairs,`${drone.id}: 대기 속도 동기화`);
            setValue(drone,'altitude',0,repairs,`${drone.id}: 대기 고도 동기화`);
          }
        }
        if(battery&&batteryOwner.get(battery.id)?.id===mission.id){
          battery.reservedMissionId=mission.id;
          if(battery.status==='IN_USE')setValue(battery,'status',battery.soc<40?'CHARGING':'READY',repairs,`${battery.id}: 예약 배터리 상태 복원`);
        }
      });

      state.drones.forEach(drone=>{
        if(activeDroneIds.has(drone.id))return;
        const owner=droneOwner.get(drone.id);
        if(!owner){
          drone.missionId=null;
          drone.reservedMissionId=null;
          if(ACTIVE_DRONE_STATUSES.has(drone.status)){
            setValue(drone,'status','READY',repairs,`${drone.id}: 연결 임무 없는 운항 상태 해제`);
            setValue(drone,'flightMode','STANDBY',repairs,`${drone.id}: 연결 임무 없는 비행모드 해제`);
            setValue(drone,'armed',false,repairs,`${drone.id}: 연결 임무 없는 Armed 해제`);
            setValue(drone,'speed',0,repairs,`${drone.id}: 연결 임무 없는 속도 초기화`);
            setValue(drone,'altitude',0,repairs,`${drone.id}: 연결 임무 없는 고도 초기화`);
          }
        }
      });

      state.batteries.forEach(battery=>{
        if(activeBatteryIds.has(battery.id))return;
        if(battery.status==='IN_USE')setValue(battery,'status',battery.soc<40?'CHARGING':'READY',repairs,`${battery.id}: 비운항 배터리 상태 복원`);
      });

      const currentActive=state.missions.filter(isActiveMission);
      const linkedActive=currentActive.filter(mission=>flowDrone(mission.droneId));
      const uniqueDroneCount=new Set(linkedActive.map(mission=>mission.droneId)).size;
      const uniqueBatteryCount=new Set(linkedActive.map(mission=>mission.batteryId).filter(Boolean)).size;
      if(currentActive.length!==uniqueDroneCount)issues.push(`운항 임무 ${currentActive.length}건과 연결 드론 ${uniqueDroneCount}대가 일치하지 않습니다.`);
      if(uniqueDroneCount!==uniqueBatteryCount)issues.push(`운항 드론 ${uniqueDroneCount}대와 사용 배터리 ${uniqueBatteryCount}개가 일치하지 않습니다.`);

      const previous=state.consistencyAudit||{};
      state.consistencyAudit={
        checkedAt:flowNow(),status:issues.length?'WARNING':'NORMAL',issues,
        repairCount:repairs.length,lastRepairs:repairs.length?repairs:previous.lastRepairs||[],
        lastRepairAt:repairs.length?flowNow():previous.lastRepairAt||null
      };
      return state.consistencyAudit;
    }finally{reconciling=false;}
  }

  function flowOperationalSnapshot(){
    flowReconcileState();
    const activeMissions=state.missions.filter(isActiveMission);
    const pairs=activeMissions.map(mission=>({mission,drone:flowDrone(mission.droneId),battery:flowBattery(mission.batteryId)}));
    const activeDrones=[...new Map(pairs.filter(item=>item.drone).map(item=>[item.drone.id,item.drone])).values()];
    const activeBatteries=[...new Map(pairs.filter(item=>item.battery).map(item=>[item.battery.id,item.battery])).values()];
    return {activeMissions,pairs,activeDrones,activeBatteries,mapActiveCount:pairs.filter(item=>item.drone).length,audit:state.consistencyAudit};
  }

  window.flowReconcileState=flowReconcileState;
  window.flowOperationalSnapshot=flowOperationalSnapshot;
  getActiveMissions=()=>flowOperationalSnapshot().activeMissions;

  const basePersist=persist;
  persist=function persistConsistentState(){flowReconcileState();return basePersist();};
  const baseRender=render;
  render=function renderConsistentState(){flowReconcileState();return baseRender();};
  const baseTick=flowTelemetryTick;
  flowTelemetryTick=function tickConsistentState(){flowReconcileState();const result=baseTick();flowReconcileState();return result;};

  flowMapView=function flowMapViewConsistent(){
    const snapshot=flowOperationalSnapshot();
    const activeByDrone=new Map(snapshot.pairs.filter(item=>item.drone).map(item=>[item.drone.id,item.mission]));
    const markers=state.drones.filter(drone=>drone.status!=='MAINTENANCE').map(drone=>{
      const mission=activeByDrone.get(drone.id);
      const battery=flowBattery(drone.batteryId);
      const active=Boolean(mission);
      const labelStatus=active?(STATUS[mission.status]?.[0]||mission.status):drone.reservedMissionId?'임무 대기':'대기';
      return `<div class="drone-marker ${active?'active':''} ${(battery?.soc||drone.battery)<30?'warning':''}" style="left:${drone.x}%;top:${drone.y}%"><button data-drone-map="${drone.id}" title="${escapeHtml(drone.name)}">${ICONS.drone}</button><span class="marker-label">${escapeHtml(drone.name)} · ${drone.id}<br>${flowFmt1(battery?.soc||drone.battery,'%')} · ${escapeHtml(labelStatus)}</span></div>`;
    }).join('');
    return `<div class="map"><div class="map-water"></div><div class="map-road r1"></div><div class="map-road r2"></div><div class="map-road r3"></div><div class="route"></div>${markers}<div class="map-legend"><span class="legend-item"><i class="legend-dot"></i>운항 드론 ${flowFmt1(snapshot.activeDrones.length,'대')}</span><span class="legend-item"><i class="legend-dot amber"></i>주의</span></div></div>`;
  };

  function consistencyBanner(snapshot){
    const warning=snapshot.audit?.issues?.length>0;
    return `<section class="consistency-banner ${warning?'warning':'normal'}"><div><strong>${warning?'상태 연결 확인 필요':'전체 화면 데이터 일치'}</strong><small>임무·드론·배터리·지도 집계 기준 ${fmtDateTime(snapshot.audit?.checkedAt||flowNow())}</small></div><div class="consistency-counts"><span>운항 임무 <b>${flowFmt1(snapshot.activeMissions.length,'건')}</b></span><span>운항 드론 <b>${flowFmt1(snapshot.activeDrones.length,'대')}</b></span><span>사용 배터리 <b>${flowFmt1(snapshot.activeBatteries.length,'개')}</b></span><span>지도 운항 마커 <b>${flowFmt1(snapshot.mapActiveCount,'개')}</b></span></div>${warning?`<div class="consistency-issues">${snapshot.audit.issues.map(issue=>`<span>${escapeHtml(issue)}</span>`).join('')}</div>`:''}</section>`;
  }

  flowDashboard=function flowDashboardConsistent(){
    const snapshot=flowOperationalSnapshot();
    const unack=state.alerts.filter(item=>!item.ack).length;
    const processing=(state.operations||[]).filter(item=>item.status==='PROCESSING').length;
    const averageBattery=snapshot.activeBatteries.length?snapshot.activeBatteries.reduce((sum,battery)=>sum+Number(battery.soc||0),0)/snapshot.activeBatteries.length:0;
    const issueCount=snapshot.audit?.issues?.length||0;
    return `${pageHead('통합관제 대시보드','임무·드론·배터리·지도·기록을 하나의 운항 상태 기준으로 집계합니다.',`<button class="btn" data-export-json>${ICONS.download} 데이터 백업</button><button class="btn primary" data-new-mission>${ICONS.plus} 신규 임무</button>`)}
      <section class="flow-overview consistency-overview"><article class="flow-overview-item"><span>수행 중 임무</span><strong class="num">${flowFmt1(snapshot.activeMissions.length,'건')}</strong></article><article class="flow-overview-item"><span>운항 중 드론</span><strong class="num">${flowFmt1(snapshot.activeDrones.length,'대')}</strong></article><article class="flow-overview-item"><span>처리 중 명령</span><strong class="num">${flowFmt1(processing,'건')}</strong></article><article class="flow-overview-item"><span>운항 평균 배터리</span><strong class="num">${flowFmt1(averageBattery,'%')}</strong></article><article class="flow-overview-item ${issueCount?'warning':''}"><span>상태 불일치</span><strong class="num">${flowFmt1(issueCount,'건')}</strong></article><article class="flow-overview-item"><span>미확인 안전경보</span><strong class="num">${flowFmt1(unack,'건')}</strong></article></section>
      ${consistencyBanner(snapshot)}
      <section class="grid dashboard-grid"><article class="card"><div class="card-head"><div><h2>실시간 운항지도</h2><p>운항 임무와 연결된 드론만 운항 마커로 집계됩니다.</p></div><span class="status ${issueCount?'amber':'green'}">${issueCount?'SYNC 확인':'LIVE 1.0s'}</span></div>${flowMapView()}</article><div class="stack"><article class="card"><div class="card-head"><div><h2>진행 중 임무</h2><p>현재 단계와 연결 드론</p></div><button class="btn small" data-view="missions">전체보기</button></div><div class="card-body mission-mini">${snapshot.activeMissions.length?snapshot.activeMissions.map(flowMissionMini).join(''):'<div class="empty">운항 중 임무가 없습니다.</div>'}</div></article><article class="card"><div class="card-head"><div><h2>최근 작업 결과</h2><p>버튼 실행 결과와 화면 동기화 상태</p></div></div><div class="card-body">${flowRecentOperations()}</div></article><article class="card"><div class="card-head"><div><h2>최근 안전경보</h2><p>미확인 항목 우선</p></div><button class="btn small" data-view="safety">경보센터</button></div><div class="card-body alert-list">${state.alerts.slice().sort((a,b)=>Number(a.ack)-Number(b.ack)).slice(0,3).map(alertRow).join('')}</div></article></div></section>`;
  };

  flowFleetView=function flowFleetViewConsistent(){
    const snapshot=flowOperationalSnapshot();
    const activeMissionByDrone=new Map(snapshot.pairs.filter(item=>item.drone).map(item=>[item.drone.id,item.mission]));
    return `${pageHead('드론 관리','통합관제와 동일한 운항 임무 기준으로 기체 상태를 표시합니다.')}<section class="grid entity-grid">${state.drones.map(drone=>{const battery=flowBattery(drone.batteryId);const activeMission=activeMissionByDrone.get(drone.id);const linkedMission=activeMission||state.missions.find(item=>item.droneId===drone.id&&isOpenMission(item));const displayStatus=activeMission?activeMission.status:drone.status;return `<article class="entity"><div class="entity-top"><div><h3>${escapeHtml(drone.name)}</h3><p>${drone.id} · ${escapeHtml(drone.model)}</p></div>${statusBadge(displayStatus)}</div><div class="metric-row"><div class="metric"><span>배터리</span><strong>${flowFmt1(battery?.soc||drone.battery,'%')}</strong></div><div class="metric"><span>통신</span><strong>${flowFmt1(drone.link,'%')}</strong></div><div class="metric"><span>위성</span><strong>${flowFmt1(drone.satellites,'개')}</strong></div><div class="metric"><span>고도</span><strong>${flowFmt1(drone.altitude,'m')}</strong></div><div class="metric"><span>속도</span><strong>${flowFmt1(drone.speed,'km/h')}</strong></div><div class="metric"><span>누적비행</span><strong>${flowFmt1(drone.flightHours,'h')}</strong></div></div><div class="bar ${(battery?.soc||drone.battery)<30?'danger':(battery?.soc||drone.battery)<55?'warning':''}"><span style="width:${clamp(battery?.soc||drone.battery,0,100)}%"></span></div><div class="flow-entity-link"><span>연결 임무</span><strong>${linkedMission?`${linkedMission.id} · ${escapeHtml(linkedMission.title)} · ${STATUS[linkedMission.status]?.[0]||linkedMission.status}`:'배정된 임무 없음'}</strong></div><div class="actions" style="margin-top:13px"><button class="btn small" data-select-drone="${drone.id}">기체상세</button>${activeMission&&['IN_FLIGHT','HOLDING'].includes(activeMission.status)?`<button class="btn small danger flow-action-btn" data-drone-rth="${drone.id}">긴급 복귀</button>`:''}</div></article>`}).join('')}</section>`;
  };

  flowReconcileState();
})();
