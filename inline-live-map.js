'use strict';

/*
 * Inline real-map mode for the operational dashboard.
 * The current canonical mission/drone/battery state is rendered in the same
 * dashboard card instead of opening the legacy map.html application.
 */
(function installInlineLiveMap(){
  const ROUTE_PRESETS={
    'MSN-260726-001':{origin:{lat:37.5046,lng:126.7636,name:'부천 물류거점 A'},destination:{lat:37.4877,lng:126.7926,name:'가톨릭대 부천성모병원'}},
    'MSN-260726-002':{origin:{lat:37.5046,lng:126.7636,name:'부천 물류거점 A'},destination:{lat:37.5161,lng:126.7858,name:'오정산업단지 3공장'}},
    'MSN-260726-003':{origin:{lat:37.5035,lng:126.7657,name:'부천시청 자료실'},destination:{lat:37.5064,lng:126.7534,name:'상동도서관'}},
    'MSN-260725-018':{origin:{lat:37.5009,lng:126.7625,name:'테크노파크 1동'},destination:{lat:37.4979,lng:126.7695,name:'테크노파크 5동'}}
  };
  const ACTIVE_STATES=new Set(['IN_FLIGHT','HOLDING','RETURNING']);
  const runtime={map:null,generation:0,layers:[],markers:new Map(),fitted:false};
  let leafletLoader=null;

  function inlineUi(){
    state.flowUi=state.flowUi&&typeof state.flowUi==='object'?state.flowUi:{};
    state.flowUi.inlineMapMode=state.flowUi.inlineMapMode==='live'?'live':'schematic';
    return state.flowUi;
  }
  function liveMode(){return inlineUi().inlineMapMode==='live';}
  function point(lat,lng,name=''){return {lat:Number(lat),lng:Number(lng),name};}
  function clamp01(value){return Math.max(0,Math.min(1,Number(value)||0));}
  function lerp(start,end,ratio){return start+(end-start)*ratio;}
  function roundCoordinate(value){return Math.round(Number(value)*1000000)/1000000;}
  function interpolate(start,end,ratio){
    const p=clamp01(ratio);
    return {lat:roundCoordinate(lerp(start.lat,end.lat,p)),lng:roundCoordinate(lerp(start.lng,end.lng,p))};
  }
  function missionSeed(mission){return [...String(mission?.id||'DLOGIS')].reduce((total,char)=>total+char.charCodeAt(0),0);}
  function routeFor(mission,drone){
    if(Number.isFinite(Number(mission?.originLat))&&Number.isFinite(Number(mission?.originLng))&&Number.isFinite(Number(mission?.destinationLat))&&Number.isFinite(Number(mission?.destinationLng))){
      return {
        origin:point(mission.originLat,mission.originLng,mission.origin||'출발지'),
        destination:point(mission.destinationLat,mission.destinationLng,mission.destination||'배송지')
      };
    }
    if(ROUTE_PRESETS[mission?.id])return ROUTE_PRESETS[mission.id];
    const seed=missionSeed(mission);
    const centerLat=Number(drone?.lat)||37.5032;
    const centerLng=Number(drone?.lng)||126.7652;
    return {
      origin:point(centerLat-.010-(seed%4)*.001,centerLng-.010+(seed%3)*.001,mission?.origin||'출발지'),
      destination:point(centerLat+.010+(seed%5)*.001,centerLng+.012-(seed%4)*.001,mission?.destination||'배송지')
    };
  }
  function currentPosition(mission,drone,route){
    if(mission.status==='RETURNING')return interpolate(route.destination,route.origin,clamp01(Number(mission.returnProgress||0)/100));
    return interpolate(route.origin,route.destination,clamp01(Number(mission.progress||0)/100));
  }
  function segmentPoints(start,end,ratio,segments=18){
    const limit=clamp01(ratio);const points=[];
    const count=Math.max(1,Math.ceil(segments*limit));
    for(let index=0;index<=count;index+=1){points.push(interpolate(start,end,limit*(index/count)));}
    return points;
  }
  function flownPoints(mission,route){
    if(mission.status==='RETURNING'){
      const outbound=segmentPoints(route.origin,route.destination,1,20);
      const inbound=segmentPoints(route.destination,route.origin,Number(mission.returnProgress||0)/100,20);
      return [...outbound,...inbound.slice(1)];
    }
    return segmentPoints(route.origin,route.destination,Number(mission.progress||0)/100,20);
  }
  function operationalSnapshot(){
    if(typeof flowOperationalSnapshot==='function')return flowOperationalSnapshot();
    const missions=state.missions.filter(mission=>ACTIVE_STATES.has(mission.status));
    const pairs=missions.map(mission=>({mission,drone:flowDrone(mission.droneId),battery:flowBattery(mission.batteryId)})).filter(pair=>pair.drone);
    return {activeMissions:missions,activeDrones:pairs.map(pair=>pair.drone),pairs};
  }
  function selectedPair(snapshot){
    const selectedId=inlineUi().selectedMapDroneId;
    return snapshot.pairs.find(pair=>pair.drone?.id===selectedId)||snapshot.pairs[0]||null;
  }
  function latestTelemetry(droneId){
    const rows=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){if(rows[index].droneId===droneId)return rows[index];}
    return null;
  }
  function ageSeconds(value){
    if(!value)return null;const time=new Date(value).getTime();
    return Number.isFinite(time)?flowRound1(Math.max(0,(Date.now()-time)/1000)):null;
  }
  function routeApproval(mission){
    const records=Array.isArray(state.preflightVerifications)?state.preflightVerifications:[];
    const record=records.find(item=>item.missionId===mission.id&&!item.supersededAt);
    return record?.items?.route?.snapshot?.approvalRef||'확인 필요';
  }
  function remainingDistance(mission){return flowRound1(Math.max(.1,(100-Number(mission.progress||0))*.035));}
  function routeDeviation(mission){return flowRound1(Math.abs(Math.sin(Number(mission.progress||0)/12))*4.2);}
  function headingFor(mission){
    if(mission.status==='RETURNING')return flowRound1((225+Number(mission.returnProgress||0)*1.1)%360);
    return flowRound1((45+Number(mission.progress||0)*2.4)%360);
  }

  function ensureLeaflet(){
    if(window.L)return Promise.resolve(window.L);
    if(leafletLoader)return leafletLoader;
    leafletLoader=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-inline-leaflet]')){
        const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';link.dataset.inlineLeaflet='1';document.head.appendChild(link);
      }
      const existing=document.querySelector('script[data-inline-leaflet]');
      if(existing){
        if(window.L){resolve(window.L);return;}
        existing.addEventListener('load',()=>resolve(window.L),{once:true});
        existing.addEventListener('error',()=>reject(new Error('OpenStreetMap 라이브러리를 불러오지 못했습니다.')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.async=true;script.dataset.inlineLeaflet='1';
      script.onload=()=>window.L?resolve(window.L):reject(new Error('지도 라이브러리 초기화에 실패했습니다.'));
      script.onerror=()=>reject(new Error('OpenStreetMap 라이브러리를 불러오지 못했습니다.'));
      document.head.appendChild(script);
      setTimeout(()=>{if(!window.L)reject(new Error('실제 지도 연결 시간이 초과되었습니다.'));},12000);
    });
    return leafletLoader;
  }
  function clearOperationalLayers(){
    runtime.layers.forEach(layer=>{try{layer.remove();}catch{}});runtime.layers=[];
    runtime.markers.forEach(marker=>{try{marker.remove();}catch{}});runtime.markers.clear();
  }
  function destroyMap(){
    runtime.generation+=1;clearOperationalLayers();
    if(runtime.map){try{runtime.map.remove();}catch{}}
    runtime.map=null;runtime.fitted=false;
  }
  function addLayer(layer){runtime.layers.push(layer);return layer;}
  function addMarker(id,marker){runtime.markers.set(id,marker);return marker;}
  function toLatLngs(points){return points.map(item=>[item.lat,item.lng]);}
  function markerHtml(pair,selected){
    const {mission,drone,battery}=pair;const heading=headingFor(mission);
    const warning=Number(drone.link)<70||Number(battery?.soc||drone.battery)<30;
    return `<div class="inline-live-drone ${selected?'selected':''} ${warning?'warning':''}"><span class="inline-live-heading" style="transform:rotate(${heading}deg)">▲</span><i>✈</i><b>${escapeHtml(drone.name)}</b><small>${flowFmt1(drone.altitude,'m')} · ${flowFmt1(battery?.soc||drone.battery,'%')}</small></div>`;
  }
  function markerPopup(pair,position){
    const {mission,drone,battery}=pair;
    return `<div class="inline-live-popup"><strong>${escapeHtml(drone.name)} · ${drone.id}</strong><span>${mission.id} · ${escapeHtml(mission.title)}</span><div><b>고도 ${flowFmt1(drone.altitude,'m')}</b><b>속도 ${flowFmt1(drone.speed,'km/h')}</b><b>배터리 ${flowFmt1(battery?.soc||drone.battery,'%')}</b><b>통신 ${flowFmt1(drone.link,'%')}</b></div><small>${flowFmtCoordinate(position.lat)} / ${flowFmtCoordinate(position.lng)}</small></div>`;
  }
  function drawOperationalLayers(snapshot,fitMap=false){
    if(!runtime.map||!window.L)return;
    clearOperationalLayers();
    const layers=inlineUi().mapLayers||{};const selected=selectedPair(snapshot);const bounds=[];
    snapshot.pairs.forEach(pair=>{
      const {mission,drone,battery}=pair;if(!drone)return;
      const route=routeFor(mission,drone);const position=currentPosition(mission,drone,route);
      drone.lat=position.lat;drone.lng=position.lng;
      const returning=mission.status==='RETURNING';
      const planned=returning?[position,route.origin]:[route.origin,route.destination];
      if(layers.corridor!==false)addLayer(L.polyline(toLatLngs(planned),{color:returning?'#d97706':'#2874e8',weight:18,opacity:.12,lineCap:'round'}).addTo(runtime.map));
      addLayer(L.polyline(toLatLngs(planned),{color:returning?'#d97706':'#2874e8',weight:4,opacity:.95,dashArray:returning?'10 7':'8 8',lineCap:'round'}).addTo(runtime.map));
      addLayer(L.polyline(toLatLngs(flownPoints(mission,route)),{color:'#0d946c',weight:5,opacity:.95,lineCap:'round'}).addTo(runtime.map));
      if(layers.geofence!==false)addLayer(L.circle([route.origin.lat,route.origin.lng],{radius:800,color:'#2874e8',weight:2,opacity:.65,fillColor:'#2874e8',fillOpacity:.05,dashArray:'8 7'}).addTo(runtime.map));
      if(layers.restricted!==false){
        const mid=interpolate(route.origin,route.destination,.68);const polygon=[[mid.lat+.0032,mid.lng-.002],[mid.lat+.0037,mid.lng+.0042],[mid.lat-.0018,mid.lng+.005],[mid.lat-.0026,mid.lng-.0012]];
        addLayer(L.polygon(polygon,{color:'#d92d20',weight:2,opacity:.8,fillColor:'#d92d20',fillOpacity:.12,dashArray:'7 5'}).addTo(runtime.map).bindTooltip('제한구역',{direction:'center'}));
      }
      if(layers.emergency!==false){
        [.42,.72].forEach((ratio,index)=>{const site=interpolate(route.origin,route.destination,ratio);addLayer(L.circleMarker([site.lat,site.lng],{radius:10,color:'#0d946c',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(runtime.map).bindTooltip(`비상착륙 ${index+1}`,{permanent:false,direction:'top'}));});
      }
      addLayer(L.circleMarker([route.origin.lat,route.origin.lng],{radius:7,color:'#0b1f3a',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(runtime.map).bindTooltip(`출발 · ${route.origin.name}`,{direction:'top'}));
      addLayer(L.circleMarker([route.destination.lat,route.destination.lng],{radius:8,color:'#0d946c',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(runtime.map).bindTooltip(`도착 · ${route.destination.name}`,{direction:'top'}));
      const icon=L.divIcon({className:'inline-live-div-icon',html:markerHtml(pair,selected?.drone?.id===drone.id),iconSize:[104,76],iconAnchor:[52,38]});
      const marker=addMarker(drone.id,L.marker([position.lat,position.lng],{icon,zIndexOffset:selected?.drone?.id===drone.id?900:500}).addTo(runtime.map));
      marker.bindPopup(markerPopup(pair,position),{offset:[0,-15]});
      marker.on('click',()=>{inlineUi().selectedMapDroneId=drone.id;persist();render();});
      bounds.push([route.origin.lat,route.origin.lng],[route.destination.lat,route.destination.lng],[position.lat,position.lng]);
    });
    if(fitMap&&bounds.length){runtime.map.fitBounds(bounds,{padding:[38,38],maxZoom:14});runtime.fitted=true;}
  }
  function liveMapMarkup(){
    return `<div id="ops-inline-live-map" class="ops-inline-live-map" aria-label="현재 관제데이터 기반 실제 지도"><div class="ops-inline-map-loading"><span></span><strong>실제 지도 연결 중</strong><small>현재 임무·드론·배터리 데이터를 준비하고 있습니다.</small></div></div><div class="ops-inline-map-source"><strong>OpenStreetMap</strong><span>현재 통합관제 데이터 · ${state.settings.mode==='simulation'?'SIMULATION':'GATEWAY'}</span></div><div class="ops-inline-map-legend"><span class="flown">비행 완료궤적</span><span class="planned">승인 예정항로</span><span class="returning">복귀항로</span><span class="restricted">제한구역</span><span class="emergency">비상착륙점</span></div>`;
  }
  function liveSideCard(pair){
    if(!pair)return `<div class="ops-map-empty"><strong>운항 중 기체가 없습니다.</strong><span>임무를 시작하면 동일 화면의 실제 지도에 기체와 항로가 표시됩니다.</span></div>`;
    const {mission,drone,battery}=pair;const route=routeFor(mission,drone);const position=currentPosition(mission,drone,route);const telemetry=latestTelemetry(drone.id);const receivedAt=telemetry?.recordedAt||telemetry?.receivedAt;const age=ageSeconds(receivedAt);const deviation=routeDeviation(mission);
    return `<article class="ops-flight-card ops-live-flight-card"><div class="ops-flight-head"><div><span>선택 기체 · 실제 지도</span><strong>${escapeHtml(drone.name)} <small>${drone.id}</small></strong></div>${statusBadge(mission.status)}</div><div class="ops-flight-mission"><strong>${mission.id} · ${escapeHtml(mission.title)}</strong><span>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)}</span></div><div class="ops-flight-grid"><div><span>고도</span><strong>${flowFmt1(drone.altitude,'m')}</strong></div><div><span>속도</span><strong>${flowFmt1(drone.speed,'km/h')}</strong></div><div><span>배터리</span><strong>${flowFmt1(battery?.soc||drone.battery,'%')}</strong></div><div><span>통신</span><strong>${flowFmt1(drone.link,'%')}</strong></div><div><span>GNSS</span><strong>${flowFmt1(drone.satellites,'개')}</strong></div><div><span>ETA</span><strong>${flowFmt1(mission.etaMin,'분')}</strong></div><div><span>항로 편차</span><strong class="${deviation>5?'warn':''}">${flowFmt1(deviation,'m')}</strong></div><div><span>잔여 거리</span><strong>${flowFmt1(remainingDistance(mission),'km')}</strong></div></div><div class="ops-live-coordinates"><span>현재 WGS84</span><strong>${flowFmtCoordinate(position.lat)} / ${flowFmtCoordinate(position.lng)}</strong></div><div class="ops-flight-footer"><span>모드 <b>${escapeHtml(drone.flightMode||'-')}</b></span><span>승인 <b>${escapeHtml(routeApproval(mission))}</b></span><span>수신 <b>${age===null?'기록 없음':flowFmt1(age,'초 전')}</b></span><span>지도 <b>OpenStreetMap · 현재 상태</b></span></div></article><div class="ops-map-advisory"><strong>현재 화면에서 관제</strong><span>별도 프로그램으로 이동하지 않고 선택 기체, 실제 지도, 승인항로와 운항 수치를 함께 확인합니다.</span></div>`;
  }
  function updateSide(snapshot){
    const side=document.querySelector('.ops-map-side');if(!side)return;side.innerHTML=liveSideCard(selectedPair(snapshot));
  }
  function showMapError(error){
    const container=document.getElementById('ops-inline-live-map');if(!container)return;
    container.innerHTML=`<div class="ops-inline-map-error"><strong>실제 지도를 표시하지 못했습니다.</strong><span>${escapeHtml(error?.message||'네트워크 연결 상태를 확인하십시오.')}</span><button type="button" data-inline-map-toggle>상황도로 돌아가기</button></div>`;
  }
  async function mountLiveMap(generation){
    if(generation!==runtime.generation||!liveMode()||state.view!=='dashboard')return;
    const canvas=document.querySelector('.ops-map-canvas');if(!canvas)return;
    destroyMap();runtime.generation=generation;
    canvas.classList.add('is-inline-live');canvas.innerHTML=liveMapMarkup();
    const snapshot=operationalSnapshot();updateSide(snapshot);
    try{
      const L=await ensureLeaflet();
      if(generation!==runtime.generation||!liveMode()||state.view!=='dashboard')return;
      const container=document.getElementById('ops-inline-live-map');if(!container)return;
      container.innerHTML='';
      runtime.map=L.map(container,{zoomControl:true,attributionControl:true,preferCanvas:true,minZoom:9,maxZoom:19});
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(runtime.map);
      drawOperationalLayers(snapshot,true);
      setTimeout(()=>{try{runtime.map?.invalidateSize();}catch{}},120);
    }catch(error){showMapError(error);}
  }
  function scheduleMount(){
    const generation=runtime.generation+1;runtime.generation=generation;
    requestAnimationFrame(()=>requestAnimationFrame(()=>mountLiveMap(generation)));
  }
  function updateLiveMap(){
    if(!liveMode()||state.view!=='dashboard'||!runtime.map)return;
    const snapshot=operationalSnapshot();drawOperationalLayers(snapshot,false);updateSide(snapshot);
  }

  const baseMapView=flowMapView;
  flowMapView=function inlineMapView(){
    const isLive=liveMode();
    let html=baseMapView();
    html=html.replace(/<button data-open-live-map>실제 지도 ↗<\/button>/,`<button class="inline-map-toggle ${isLive?'active':''}" data-inline-map-toggle>${isLive?'상황도 보기':'실제 지도 보기'}</button>`);
    if(isLive){
      html=html.replace('<strong>운항 상황도</strong><span>승인항로·비행궤적·공역·비상지점·기체상태</span>','<strong>실시간 실제 지도</strong><span>현재 임무·드론·배터리·승인항로를 동일 화면에 표시</span>');
      scheduleMount();
    }else if(runtime.map){destroyMap();}
    return html;
  };
  mapView=flowMapView;

  const baseTelemetryTick=flowTelemetryTick;
  flowTelemetryTick=function inlineMapTelemetryTick(){
    const keepMap=liveMode()&&state.view==='dashboard'&&Boolean(runtime.map);
    if(!keepMap)return baseTelemetryTick();
    const activeRender=render;
    try{render=()=>{};return baseTelemetryTick();}
    finally{render=activeRender;updateLiveMap();}
  };

  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-inline-map-toggle]');if(!target)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    inlineUi().inlineMapMode=liveMode()?'schematic':'live';persist();render();
  },true);
})();
