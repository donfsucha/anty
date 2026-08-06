'use strict';

/*
 * Mission-to-map synchronization guard.
 *
 * A mission that is actually flying must always produce the same linked pair
 * (mission -> drone -> battery) in the dashboard diagram and the inline live
 * map. This module is loaded after all workflow/view patches so it can provide
 * one final canonical snapshot and a direct "track on map" action.
 */
(function installMissionMapSynchronization(){
  const VERSION='1.0.0';
  const MAP_ACTIVE_STATUSES=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);
  const MAP_ACTIONS=new Set(['START','HOLD','RESUME','RTH','DELIVER','COMPLETE']);
  const STATUS_TO_DRONE={IN_FLIGHT:'IN_FLIGHT',HOLDING:'HOLDING',DELIVERED:'RETURNING',RETURNING:'RETURNING',LANDING:'LANDING'};
  const STATUS_TO_MODE={IN_FLIGHT:'MISSION',HOLDING:'HOLD',DELIVERED:'RTL',RETURNING:'RTL',LANDING:'LAND'};
  const DEFAULT_CENTER={lat:37.5032,lng:126.7652};
  const baseSnapshot=typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot:null;
  const baseApplyAction=typeof flowApplyAction==='function'?flowApplyAction:null;
  const baseMissionButtons=typeof flowMissionButtons==='function'?flowMissionButtons:null;
  let syncing=false;
  let renderQueued=false;

  function uiState(){
    state.flowUi=state.flowUi&&typeof state.flowUi==='object'?state.flowUi:{};
    return state.flowUi;
  }

  function isMapActive(mission){return Boolean(mission&&MAP_ACTIVE_STATUSES.has(mission.status));}

  function coordinateSeed(mission){
    return [...String(mission?.id||'DLOGIS')].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  }

  function ensureCoordinates(mission,drone){
    const seed=coordinateSeed(mission);
    if(!Number.isFinite(Number(drone.x)))drone.x=45+(seed%24);
    if(!Number.isFinite(Number(drone.y)))drone.y=58-(seed%18);
    if(!Number.isFinite(Number(drone.lat)))drone.lat=DEFAULT_CENTER.lat+((seed%11)-5)*.0007;
    if(!Number.isFinite(Number(drone.lng)))drone.lng=DEFAULT_CENTER.lng+((seed%13)-6)*.0007;
  }

  function ensureActiveLink(mission){
    if(!isMapActive(mission)||!mission.droneId)return null;
    const drone=typeof flowDrone==='function'?flowDrone(mission.droneId):state.drones.find(item=>item.id===mission.droneId);
    if(!drone)return null;
    const battery=mission.batteryId&&(typeof flowBattery==='function'?flowBattery(mission.batteryId):state.batteries.find(item=>item.id===mission.batteryId));
    ensureCoordinates(mission,drone);
    drone.status=STATUS_TO_DRONE[mission.status]||'IN_FLIGHT';
    drone.flightMode=STATUS_TO_MODE[mission.status]||'MISSION';
    drone.armed=true;
    drone.missionId=mission.id;
    drone.reservedMissionId=null;
    if(mission.batteryId)drone.batteryId=mission.batteryId;
    if(battery){
      battery.status='IN_USE';
      battery.droneId=drone.id;
      battery.reservedMissionId=null;
      drone.battery=typeof flowRound1==='function'?flowRound1(battery.soc):Math.round(Number(battery.soc||0)*10)/10;
    }
    return {mission,drone,battery: battery||null};
  }

  function uniqueById(rows){return [...new Map(rows.filter(Boolean).map(item=>[item.id,item])).values()];}

  function synchronizedSnapshot(){
    if(syncing){
      const missions=state.missions.filter(isMapActive);
      const pairs=missions.map(ensureActiveLink).filter(Boolean);
      return {activeMissions:missions,pairs,activeDrones:uniqueById(pairs.map(item=>item.drone)),activeBatteries:uniqueById(pairs.map(item=>item.battery)),mapActiveCount:pairs.length,audit:state.consistencyAudit||null};
    }
    syncing=true;
    try{
      if(typeof flowReconcileState==='function')flowReconcileState();
      const existing=baseSnapshot?baseSnapshot():{pairs:[],audit:state.consistencyAudit||null};
      const activeMissions=state.missions.filter(isMapActive);
      const pairByMission=new Map((existing?.pairs||[]).filter(item=>item?.mission).map(item=>[item.mission.id,item]));
      activeMissions.forEach(mission=>{
        const linked=ensureActiveLink(mission);
        if(linked)pairByMission.set(mission.id,linked);
        else pairByMission.delete(mission.id);
      });
      const activeIds=new Set(activeMissions.map(item=>item.id));
      const pairs=[...pairByMission.values()].filter(item=>item?.mission&&activeIds.has(item.mission.id)&&item.drone);
      const activeDrones=uniqueById(pairs.map(item=>item.drone));
      const activeBatteries=uniqueById(pairs.map(item=>item.battery));
      return {activeMissions,pairs,activeDrones,activeBatteries,mapActiveCount:pairs.length,audit:existing?.audit||state.consistencyAudit||null};
    }finally{syncing=false;}
  }

  function chooseSelectedDrone(preferredMission=null){
    const ui=uiState();
    const snapshot=synchronizedSnapshot();
    const preferred=preferredMission&&snapshot.pairs.find(item=>item.mission.id===preferredMission.id);
    const current=snapshot.pairs.find(item=>item.drone.id===ui.selectedMapDroneId);
    const selected=preferred||current||snapshot.pairs[0]||null;
    ui.selectedMapDroneId=selected?.drone?.id||null;
    ui.mapFocusMissionId=selected?.mission?.id||null;
    return selected;
  }

  function requestDashboardRender(){
    if(state.view!=='dashboard'||renderQueued)return;
    renderQueued=true;
    queueMicrotask(()=>{
      renderQueued=false;
      if(state.view==='dashboard')render();
    });
  }

  function publishMapSync(mission,action){
    const ui=uiState();
    if(isMapActive(mission)){
      ensureActiveLink(mission);
      chooseSelectedDrone(mission);
      if(action==='START')ui.inlineMapMode='live';
    }else chooseSelectedDrone();
    ui.lastMapSyncAt=typeof flowNow==='function'?flowNow():new Date().toISOString();
    ui.lastMapSyncMissionId=mission?.id||null;
    ui.lastMapSyncAction=action||'STATE_SYNC';
    window.dispatchEvent(new CustomEvent('dlogis:mission-map-sync',{detail:{missionId:mission?.id||null,droneId:mission?.droneId||null,status:mission?.status||null,action:action||'STATE_SYNC'}}));
    requestDashboardRender();
  }

  if(baseSnapshot){
    flowOperationalSnapshot=synchronizedSnapshot;
    getActiveMissions=()=>synchronizedSnapshot().activeMissions;
  }

  if(baseApplyAction){
    flowApplyAction=function applyActionWithMapSync(mission,action){
      const result=baseApplyAction(mission,action);
      if(MAP_ACTIONS.has(action))publishMapSync(mission,action);
      return result;
    };
  }

  if(baseMissionButtons){
    flowMissionButtons=function missionButtonsWithTracking(mission,ready){
      const buttons=baseMissionButtons(mission,ready);
      if(!isMapActive(mission)||!mission.droneId)return buttons;
      return `${buttons}<button type="button" class="btn primary mission-map-track-btn" data-track-mission="${escapeHtml(mission.id)}">⌖ 통합관제에서 추적</button>`;
    };
    missionButtons=flowMissionButtons;
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-track-mission]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const mission=typeof flowMission==='function'?flowMission(button.dataset.trackMission):state.missions.find(item=>item.id===button.dataset.trackMission);
    if(!mission||!isMapActive(mission)||!mission.droneId){
      toast('지도 추적 불가','운항 중이며 기체가 배정된 임무만 지도에서 추적할 수 있습니다.','error');
      return;
    }
    const ui=uiState();
    ensureActiveLink(mission);
    ui.selectedMapDroneId=mission.droneId;
    ui.mapFocusMissionId=mission.id;
    ui.inlineMapMode='live';
    ui.lastMapSyncAt=typeof flowNow==='function'?flowNow():new Date().toISOString();
    state.role='admin';state.view='dashboard';state.sidebar=false;
    persist();render();window.scrollTo({top:0,behavior:'smooth'});
  },true);

  const firstActive=state.missions.find(isMapActive);
  if(firstActive)chooseSelectedDrone(firstActive);

  window.dlogisMissionMapSync={
    version:VERSION,
    activeStatuses:[...MAP_ACTIVE_STATUSES],
    synchronizedSnapshot,
    ensureActiveLink,
    publishMapSync,
    chooseSelectedDrone
  };
})();
