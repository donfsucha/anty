'use strict';

/* Operational map presentation for the integrated dashboard. */
(function installOperationalMap(){
  function opsHash(text){let hash=0;for(const char of String(text||'')){hash=((hash<<5)-hash)+char.charCodeAt(0);hash|=0;}return Math.abs(hash);}
  function opsPointForMission(mission){
    const hash=opsHash(mission.destination||mission.id);
    return {x:62+(hash%25),y:18+((Math.floor(hash/31))%48)};
  }
  function opsHomeForMission(mission){
    const hash=opsHash(mission.origin||mission.id);
    return {x:10+(hash%14),y:68-((Math.floor(hash/19))%20)};
  }
  function opsLatestTelemetry(droneId){
    const rows=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){if(rows[index].droneId===droneId)return rows[index];}
    return null;
  }
  function opsAge(value){
    if(!value)return null;const time=new Date(value).getTime();return Number.isFinite(time)?flowRound1(Math.max(0,(Date.now()-time)/1000)):null;
  }
  function opsRouteApproval(mission){
    const record=Array.isArray(state.preflightVerifications)?state.preflightVerifications.find(item=>item.missionId===mission.id&&!item.supersededAt):null;
    return record?.items?.route?.snapshot?.approvalRef||'확인 필요';
  }
  function opsCaptureTracks(){
    state.mapTracks=state.mapTracks&&typeof state.mapTracks==='object'?state.mapTracks:{};
    const active=typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot().pairs:state.missions.filter(item=>['IN_FLIGHT','HOLDING','RETURNING'].includes(item.status)).map(mission=>({mission,drone:flowDrone(mission.droneId),battery:flowBattery(mission.batteryId)}));
    active.forEach(({drone})=>{
      if(!drone)return;const rows=Array.isArray(state.mapTracks[drone.id])?state.mapTracks[drone.id]:[];
      const last=rows.at(-1);if(!last||Math.abs(last.x-drone.x)>.02||Math.abs(last.y-drone.y)>.02)rows.push({x:flowRound1(drone.x),y:flowRound1(drone.y),at:new Date().toISOString()});
      if(rows.length>36)rows.splice(0,rows.length-36);state.mapTracks[drone.id]=rows;
    });
  }
  function opsTrackPoints(drone){
    const rows=state.mapTracks?.[drone.id]||[];
    if(rows.length<2)return `${drone.x},${drone.y}`;
    return rows.map(point=>`${point.x},${point.y}`).join(' ');
  }
  function opsRemainingDistance(mission){return flowRound1(Math.max(.1,(100-Number(mission.progress||0))*.035));}
  function opsDeviation(mission){return flowRound1(Math.abs(Math.sin(Number(mission.progress||0)/12))*4.2);}
  function opsSelectedPair(snapshot){
    const requested=state.flowUi?.selectedMapDroneId;
    return snapshot.pairs.find(item=>item.drone?.id===requested)||snapshot.pairs[0]||null;
  }
  function opsLayerState(){
    state.flowUi=state.flowUi&&typeof state.flowUi==='object'?state.flowUi:{};
    state.flowUi.mapLayers={corridor:true,geofence:true,restricted:true,emergency:true,weather:true,...(state.flowUi.mapLayers||{})};
    return state.flowUi.mapLayers;
  }
  function opsSvgRoutes(snapshot,layers){
    return snapshot.pairs.filter(item=>item.drone).map(({mission,drone})=>{
      const target=opsPointForMission(mission),home=opsHomeForMission(mission),mid1={x:flowRound1((home.x+target.x)*.48),y:flowRound1(home.y-14)},mid2={x:flowRound1((home.x+target.x)*.72),y:flowRound1(target.y+10)};
      const route=`${home.x},${home.y} ${mid1.x},${mid1.y} ${mid2.x},${mid2.y} ${target.x},${target.y}`;
      const returnRoute=`${drone.x},${drone.y} ${mid1.x},${mid1.y} ${home.x},${home.y}`;
      const returning=mission.status==='RETURNING';
      return `${layers.corridor?`<polyline class="ops-map-corridor" points="${returning?returnRoute:route}"/>`:''}<polyline class="ops-map-planned ${returning?'returning':''}" points="${returning?returnRoute:route}"/><polyline class="ops-map-flown" points="${opsTrackPoints(drone)}"/><circle class="ops-map-home" cx="${home.x}" cy="${home.y}" r="1.4"/><circle class="ops-map-destination" cx="${target.x}" cy="${target.y}" r="1.6"/>`;
    }).join('');
  }
  function opsMarker(pair,selected){
    const {mission,drone,battery}=pair;if(!drone)return '';
    const heading=flowRound1((Number(mission.progress||0)*3.2+45)%360);
    const warning=Number(drone.link)<70||Number(battery?.soc)<30;
    return `<button class="ops-drone-marker ${selected?'selected':''} ${warning?'warning':''}" style="left:${drone.x}%;top:${drone.y}%" data-map-select="${drone.id}" title="${escapeHtml(drone.name)}"><span class="ops-heading" style="transform:rotate(${heading}deg)">▲</span><i>${ICONS.drone}</i><b>${escapeHtml(drone.name)}</b><small>${flowFmt1(drone.altitude,'m')} · ${flowFmt1(battery?.soc||drone.battery,'%')}</small></button>`;
  }
  function opsFlightCard(pair){
    if(!pair)return `<div class="ops-map-empty"><strong>운항 중 기체가 없습니다.</strong><span>임무를 시작하면 승인항로와 텔레메트리가 표시됩니다.</span></div>`;
    const {mission,drone,battery}=pair;const telemetry=opsLatestTelemetry(drone.id);const receivedAt=telemetry?.recordedAt||telemetry?.receivedAt;const age=opsAge(receivedAt);const deviation=opsDeviation(mission);
    return `<article class="ops-flight-card"><div class="ops-flight-head"><div><span>선택 기체</span><strong>${escapeHtml(drone.name)} <small>${drone.id}</small></strong></div>${statusBadge(mission.status)}</div><div class="ops-flight-mission"><strong>${mission.id} · ${escapeHtml(mission.title)}</strong><span>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)}</span></div><div class="ops-flight-grid"><div><span>고도</span><strong>${flowFmt1(drone.altitude,'m')}</strong></div><div><span>속도</span><strong>${flowFmt1(drone.speed,'km/h')}</strong></div><div><span>배터리</span><strong>${flowFmt1(battery?.soc||drone.battery,'%')}</strong></div><div><span>통신</span><strong>${flowFmt1(drone.link,'%')}</strong></div><div><span>GNSS</span><strong>${flowFmt1(drone.satellites,'개')}</strong></div><div><span>ETA</span><strong>${flowFmt1(mission.etaMin,'분')}</strong></div><div><span>항로 편차</span><strong class="${deviation>5?'warn':''}">${flowFmt1(deviation,'m')}</strong></div><div><span>잔여 거리</span><strong>${flowFmt1(opsRemainingDistance(mission),'km')}</strong></div></div><div class="ops-flight-footer"><span>모드 <b>${escapeHtml(drone.flightMode||'-')}</b></span><span>승인 <b>${escapeHtml(opsRouteApproval(mission))}</b></span><span>수신 <b>${age===null?'기록 없음':flowFmt1(age,'초 전')}</b></span></div></article>`;
  }
  function opsMissionList(snapshot,selectedId){
    return `<div class="ops-flight-list"><div class="ops-list-head"><strong>운항 기체</strong><span>${flowFmt1(snapshot.activeDrones.length,'대')}</span></div>${snapshot.pairs.filter(item=>item.drone).map(({mission,drone,battery})=>`<button class="ops-list-row ${drone.id===selectedId?'active':''}" data-map-select="${drone.id}"><i></i><div><strong>${escapeHtml(drone.name)} · ${drone.id}</strong><small>${mission.id} · ${STATUS[mission.status]?.[0]||mission.status}</small></div><span>${flowFmt1(battery?.soc||drone.battery,'%')}</span></button>`).join('')||'<div class="ops-list-empty">운항 기체 없음</div>'}</div>`;
  }

  opsCaptureTracks();
  const baseTick=flowTelemetryTick;
  flowTelemetryTick=function operationalMapTick(){const result=baseTick();opsCaptureTracks();return result;};

  flowMapView=function operationalMapView(){
    const snapshot=typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot():{activeMissions:getActiveMissions(),pairs:getActiveMissions().map(mission=>({mission,drone:flowDrone(mission.droneId),battery:flowBattery(mission.batteryId)})),activeDrones:[]};
    opsCaptureTracks();const layers=opsLayerState();const selected=opsSelectedPair(snapshot);if(selected?.drone)state.flowUi.selectedMapDroneId=selected.drone.id;
    const selectedId=selected?.drone?.id||null;
    return `<section class="ops-map-shell"><div class="ops-map-toolbar"><div class="ops-map-title"><strong>운항 상황도</strong><span>승인항로·비행궤적·공역·비상지점·기체상태</span></div><div class="ops-layer-buttons">${[['corridor','항로폭'],['geofence','지오펜스'],['restricted','제한구역'],['emergency','비상착륙'],['weather','기상']].map(([key,label])=>`<button class="${layers[key]?'active':''}" data-map-layer="${key}">${label}</button>`).join('')}<button data-open-live-map>실제 지도 ↗</button></div></div><div class="ops-map-layout">${opsMissionList(snapshot,selectedId)}<div class="ops-map-canvas"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="드론 운항 상황도"><defs><pattern id="ops-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="rgba(70,103,145,.12)" stroke-width=".18"/></pattern><filter id="ops-shadow"><feDropShadow dx="0" dy=".5" stdDeviation=".7" flood-opacity=".2"/></filter></defs><rect width="100" height="100" fill="url(#ops-grid)"/>${layers.geofence?'<circle class="ops-geofence" cx="20" cy="66" r="16"/>':''}${layers.restricted?'<path class="ops-restricted" d="M65 14 L87 17 L84 36 L69 32 Z"/>':''}${layers.emergency?'<g class="ops-emergency"><circle cx="45" cy="69" r="2"/><text x="45" y="70">H</text><circle cx="75" cy="73" r="2"/><text x="75" y="74">H</text></g>':''}${opsSvgRoutes(snapshot,layers)}</svg>${snapshot.pairs.map(pair=>opsMarker(pair,pair.drone?.id===selectedId)).join('')}${layers.weather?'<div class="ops-weather"><span>현장 기상</span><strong>풍속 3.8m/s · 가시거리 12.0km</strong><small>SIMULATION · 검증 전 최신값 확인 필요</small></div>':''}<div class="ops-map-legend"><span class="flown">비행 완료궤적</span><span class="planned">승인 예정항로</span><span class="return">복귀항로</span><span class="restricted">제한구역</span><span class="emergency">비상착륙점</span></div></div><aside class="ops-map-side">${opsFlightCard(selected)}<div class="ops-map-advisory"><strong>관제 판단 정보</strong><span>항로 편차, 데이터 신선도, 배터리·통신·GNSS를 함께 확인하십시오.</span></div></aside></div></section>`;
  };
  mapView=flowMapView;

  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-map-select],[data-map-layer],[data-open-live-map]');if(!target)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    if(target.dataset.mapSelect){state.flowUi.selectedMapDroneId=target.dataset.mapSelect;persist();render();return;}
    if(target.dataset.mapLayer){const layers=opsLayerState();layers[target.dataset.mapLayer]=!layers[target.dataset.mapLayer];persist();render();return;}
    if(target.dataset.openLiveMap!==undefined)window.open('./map.html','_blank','noopener');
  },true);
})();
