/* D-LOGIS multi-provider live map: OpenStreetMap, Google Maps, Kakao Maps */
(function(){
  'use strict';

  const SETTINGS_KEY='dlogis-map-settings-v1';
  const PROVIDERS={osm:'OpenStreetMap',google:'Google Maps',kakao:'Kakao Maps'};
  const ROUTE_PRESETS={
    'MSN-260726-001':{origin:{lat:37.5046,lng:126.7636,name:'부천 물류거점 A'},destination:{lat:37.4877,lng:126.7926,name:'가톨릭대 부천성모병원'}},
    'MSN-260726-002':{origin:{lat:37.5046,lng:126.7636,name:'부천 물류거점 A'},destination:{lat:37.5161,lng:126.7858,name:'오정산업단지 3공장'}},
    'MSN-260726-003':{origin:{lat:37.5035,lng:126.7657,name:'부천시청 자료실'},destination:{lat:37.5064,lng:126.7534,name:'상동도서관'}},
    'MSN-260725-018':{origin:{lat:37.5009,lng:126.7625,name:'테크노파크 1동'},destination:{lat:37.4979,lng:126.7695,name:'테크노파크 5동'}}
  };
  const runtime={provider:null,map:null,container:null,markers:new Map(),routes:[],overlays:[],ready:false,loading:false,generation:0,googleInfo:null};
  let googleLoader=null,googleLoaderKey='';
  let kakaoLoader=null,kakaoLoaderKey='';
  let settings=loadSettings();

  function loadSettings(){
    const defaults={provider:'osm',googleKey:'',kakaoKey:''};
    try{return {...defaults,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};}catch{return defaults;}
  }
  function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}
  function safe(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function activeStatuses(){return ['IN_FLIGHT','HOLDING','RETURNING'];}
  function activeMissionForDrone(id){return state.missions.find(m=>m.droneId===id&&activeStatuses().includes(m.status));}
  function selectedFocus(){
    const selected=state.missions.find(m=>m.id===state.selectedMission);
    const mission=selected&&activeStatuses().includes(selected.status)?selected:state.missions.find(m=>activeStatuses().includes(m.status));
    const drone=mission?state.drones.find(d=>d.id===mission.droneId):state.drones.find(d=>d.status!=='MAINTENANCE');
    return {mission,drone:drone||state.drones[0]};
  }
  function point(lat,lng,name=''){return {lat:Number(lat),lng:Number(lng),name};}
  function routeFor(mission,drone){
    if(!mission){
      const d=drone||state.drones[0];
      return {origin:point((d?.lat||37.503)-.012,(d?.lng||126.765)-.012,'출발 거점'),destination:point((d?.lat||37.503)+.012,(d?.lng||126.765)+.016,'배송지')};
    }
    if(Number.isFinite(mission.originLat)&&Number.isFinite(mission.originLng)&&Number.isFinite(mission.destinationLat)&&Number.isFinite(mission.destinationLng)){
      return {origin:point(mission.originLat,mission.originLng,mission.origin),destination:point(mission.destinationLat,mission.destinationLng,mission.destination)};
    }
    if(ROUTE_PRESETS[mission.id])return ROUTE_PRESETS[mission.id];
    const d=drone||state.drones.find(x=>x.id===mission.droneId)||state.drones[0];
    const seed=[...String(mission.id)].reduce((a,c)=>a+c.charCodeAt(0),0);
    const lat=d?.lat||37.503,lng=d?.lng||126.765;
    return {
      origin:point(lat-.012-(seed%5)*.001,lng-.014+(seed%3)*.001,mission.origin||'출발지'),
      destination:point(lat+.012+(seed%4)*.001,lng+.015-(seed%5)*.001,mission.destination||'배송지')
    };
  }
  function positionFor(mission,drone){
    const route=routeFor(mission,drone);
    const progress=Math.max(0,Math.min(1,Number(mission?.progress||0)/100));
    const eased=progress<.5?2*progress*progress:1-Math.pow(-2*progress+2,2)/2;
    return {lat:route.origin.lat+(route.destination.lat-route.origin.lat)*eased,lng:route.origin.lng+(route.destination.lng-route.origin.lng)*eased};
  }
  function allMapDrones(){return state.drones.filter(d=>d.status!=='MAINTENANCE'&&Number.isFinite(Number(d.lat))&&Number.isFinite(Number(d.lng)));}
  function mapRoutes(){return state.missions.filter(m=>activeStatuses().includes(m.status)&&m.droneId).map(m=>{const d=state.drones.find(x=>x.id===m.droneId);return d?{mission:m,drone:d,...routeFor(m,d)}:null;}).filter(Boolean);}
  function markerClass(drone,mission){return `dlogis-map-marker ${mission?'active':''} ${drone.battery<30?'warning':''} ${drone.link<1?'offline':''}`.trim();}
  function markerHtml(drone,mission){return `<button type="button" class="${markerClass(drone,mission)}" data-drone-map="${safe(drone.id)}" aria-label="${safe(drone.name)} 위치"><span class="plane">✈</span>${mission?'<span class="pulse"></span>':''}<span class="dlogis-marker-label">${safe(drone.id)} · ${Math.round(drone.battery)}%</span></button>`;}
  function infoHtml(drone,mission){return `<div class="dlogis-info"><strong>${safe(drone.name)} · ${safe(drone.id)}</strong><p>${mission?safe(mission.title):'현재 배정 임무 없음'}<br>${safe(drone.flightMode||'STANDBY')}</p><div class="dlogis-info-grid"><span>고도 ${Math.round(drone.altitude||0)}m</span><span>속도 ${Math.round(drone.speed||0)}km/h</span><span>배터리 ${Math.round(drone.battery||0)}%</span><span>통신 ${Math.round(drone.link||0)}%</span></div></div>`;}
  function focusPoint(){const {drone}=selectedFocus();return {lat:Number(drone?.lat||37.5032),lng:Number(drone?.lng||126.7652)};}
  function mapLinks(){
    const {drone}=selectedFocus();const lat=Number(drone?.lat||37.5032),lng=Number(drone?.lng||126.7652),name=drone?.name||'D-LOGIS 드론';
    return {
      google:`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      kakao:`https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`
    };
  }
  function noteText(){
    if(settings.provider==='google'&&!settings.googleKey)return '<strong>Google Maps API 키가 필요합니다.</strong> API 설정에서 키를 저장하면 동일 화면에서 바로 전환됩니다.';
    if(settings.provider==='kakao'&&!settings.kakaoKey)return '<strong>Kakao JavaScript Key가 필요합니다.</strong> 카카오 개발자센터에서 현재 도메인을 등록한 뒤 키를 저장하십시오.';
    if(settings.provider==='google')return '<strong>Google Maps 연결 모드</strong> · 실시간 기체 마커와 승인 항로를 표시합니다.';
    if(settings.provider==='kakao')return '<strong>Kakao Maps 연결 모드</strong> · 국내 주소 기반 운영에 적합한 실시간 관제 지도입니다.';
    return '<strong>OpenStreetMap 실시간 지도</strong> · API 키 없이 즉시 사용 가능하며 Google·Kakao 지도도 선택할 수 있습니다.';
  }

  mapView=function(){
    const links=mapLinks();
    return `<div class="real-map-shell"><div class="map-toolbar"><div class="map-provider-group"><span class="map-provider-dot"></span><select class="map-provider-select" data-map-provider aria-label="지도 선택">${Object.entries(PROVIDERS).map(([key,label])=>`<option value="${key}" ${settings.provider===key?'selected':''}>${label}</option>`).join('')}</select></div><button type="button" class="map-tool-btn" data-map-settings>⚙ API 설정</button><div class="map-toolbar-spacer"></div><a class="map-link" data-google-link href="${links.google}" target="_blank" rel="noopener">G <span class="optional">Google 지도에서 열기</span></a><a class="map-link" data-kakao-link href="${links.kakao}" target="_blank" rel="noopener">K <span class="optional">카카오맵에서 열기</span></a></div><div id="dlogis-live-map" class="real-map" aria-label="실시간 드론 운항 지도"><div class="map-loading"><div class="map-loading-card"><div class="map-spinner"></div><strong>${safe(PROVIDERS[settings.provider])} 불러오는 중</strong><p>기체 위치와 배송 항로를 준비하고 있습니다.</p></div></div></div><div class="map-provider-note ${((settings.provider==='google'&&!settings.googleKey)||(settings.provider==='kakao'&&!settings.kakaoKey))?'warning':''}"><span class="map-note-dot"></span><span>${noteText()}</span></div></div>`;
  };

  function clearRuntime(){
    runtime.generation++;
    if(runtime.provider==='osm'&&runtime.map&&typeof runtime.map.remove==='function'){try{runtime.map.remove();}catch{}}
    runtime.markers.forEach(marker=>{try{if(marker.setMap)marker.setMap(null);else if(marker.setMap===undefined&&marker.remove)marker.remove();}catch{}});
    runtime.routes.forEach(route=>{try{if(route.setMap)route.setMap(null);else if(runtime.map&&route.removeFrom)route.removeFrom(runtime.map);else if(route.setMap===undefined&&route.setMap)route.setMap(null);}catch{}});
    runtime.overlays.forEach(overlay=>{try{if(overlay.setMap)overlay.setMap(null);}catch{}});
    runtime.provider=null;runtime.map=null;runtime.container=null;runtime.markers=new Map();runtime.routes=[];runtime.overlays=[];runtime.ready=false;runtime.loading=false;runtime.googleInfo=null;
  }
  function loading(container,label){container.innerHTML=`<div class="map-loading"><div class="map-loading-card"><div class="map-spinner"></div><strong>${safe(label)} 연결 중</strong><p>지도 SDK와 실시간 기체 위치를 불러오고 있습니다.</p></div></div>`;}
  function keyRequired(container,provider){
    const domain=location.protocol==='file:'?'https://donfsucha.github.io':`${location.protocol}//${location.host}`;
    const isKakao=provider==='kakao';
    container.innerHTML=`<div class="map-key-required"><div class="map-key-card"><span class="map-provider-badge">${isKakao?'KAKAO MAPS':'GOOGLE MAPS'}</span><h3>${isKakao?'Kakao JavaScript Key':'Google Maps API Key'}를 입력해 주세요.</h3><p>${isKakao?'카카오 개발자센터 앱의 플랫폼 Web 도메인에 아래 주소를 등록해야 합니다.':'Google Cloud에서 Maps JavaScript API를 활성화하고 HTTP 리퍼러 제한을 적용하는 것이 안전합니다.'}</p><code class="map-key-domain">${safe(domain)}</code><div class="map-key-actions"><button class="map-tool-btn primary" type="button" data-map-settings>API 키 설정</button><button class="map-tool-btn" type="button" data-map-fallback>키 없이 지도 보기</button></div></div></div>`;
  }
  function errorView(container,provider,error){container.innerHTML=`<div class="map-error"><div class="map-key-card"><span class="map-provider-badge">연결 오류</span><h3>${safe(PROVIDERS[provider])}를 표시하지 못했습니다.</h3><p>${safe(error?.message||'API 키, 등록 도메인 또는 네트워크 상태를 확인하십시오.')}</p><div class="map-key-actions"><button class="map-tool-btn primary" type="button" data-map-settings>설정 확인</button><button class="map-tool-btn" type="button" data-map-fallback>OpenStreetMap 사용</button><button class="map-tool-btn" type="button" data-map-retry>다시 시도</button></div></div></div>`;}

  function ensureLeaflet(){
    if(window.L)return Promise.resolve(window.L);
    return new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-dlogis-leaflet]')){const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';link.dataset.dlogisLeaflet='1';document.head.appendChild(link);}
      const existing=document.querySelector('script[data-dlogis-leaflet]');
      if(existing){existing.addEventListener('load',()=>resolve(window.L),{once:true});existing.addEventListener('error',()=>reject(new Error('OpenStreetMap 라이브러리 로딩 실패')),{once:true});return;}
      const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.dataset.dlogisLeaflet='1';script.onload=()=>resolve(window.L);script.onerror=()=>reject(new Error('OpenStreetMap 라이브러리 로딩 실패'));document.head.appendChild(script);
    });
  }
  function ensureGoogle(key){
    if(window.google?.maps)return Promise.resolve(window.google.maps);
    if(googleLoader&&googleLoaderKey===key)return googleLoader;
    googleLoaderKey=key;
    googleLoader=new Promise((resolve,reject)=>{
      const callback=`__dlogisGoogleReady_${Date.now()}`;
      const script=document.createElement('script');
      let settled=false;
      const finish=(fn,value)=>{if(settled)return;settled=true;try{delete window[callback];}catch{}fn(value);};
      window[callback]=()=>finish(resolve,window.google.maps);
      window.gm_authFailure=()=>finish(reject,new Error('Google Maps API 키 또는 허용 도메인을 확인하십시오.'));
      script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}&v=weekly&language=ko&region=KR`;
      script.async=true;script.defer=true;script.dataset.dlogisGoogle='1';script.onerror=()=>finish(reject,new Error('Google Maps SDK 로딩 실패'));document.head.appendChild(script);
      setTimeout(()=>finish(reject,new Error('Google Maps 연결 시간 초과')),12000);
    });
    return googleLoader;
  }
  function ensureKakao(key){
    if(window.kakao?.maps)return new Promise(resolve=>window.kakao.maps.load(()=>resolve(window.kakao.maps)));
    if(kakaoLoader&&kakaoLoaderKey===key)return kakaoLoader;
    kakaoLoaderKey=key;
    kakaoLoader=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;script.async=true;script.dataset.dlogisKakao='1';script.onload=()=>{if(!window.kakao?.maps)return reject(new Error('Kakao Maps SDK 응답 오류'));window.kakao.maps.load(()=>resolve(window.kakao.maps));};script.onerror=()=>reject(new Error('Kakao Maps SDK 로딩 실패 · JavaScript Key와 등록 도메인을 확인하십시오.'));document.head.appendChild(script);
      setTimeout(()=>reject(new Error('Kakao Maps 연결 시간 초과')),12000);
    });
    return kakaoLoader;
  }

  async function initMap(force=false){
    const container=document.getElementById('dlogis-live-map');
    if(!container)return;
    if(!force&&runtime.ready&&runtime.container===container&&runtime.provider===settings.provider){refresh();return;}
    clearRuntime();
    runtime.container=container;runtime.provider=settings.provider;runtime.loading=true;
    const generation=runtime.generation;
    try{
      if(settings.provider==='google'&&!settings.googleKey){runtime.loading=false;return keyRequired(container,'google');}
      if(settings.provider==='kakao'&&!settings.kakaoKey){runtime.loading=false;return keyRequired(container,'kakao');}
      loading(container,PROVIDERS[settings.provider]);
      if(settings.provider==='google'){await ensureGoogle(settings.googleKey);if(generation!==runtime.generation)return;initGoogle(container);}
      else if(settings.provider==='kakao'){await ensureKakao(settings.kakaoKey);if(generation!==runtime.generation)return;initKakao(container);}
      else{await ensureLeaflet();if(generation!==runtime.generation)return;initOsm(container);}
      runtime.ready=true;runtime.loading=false;updateExternalLinks();
    }catch(error){runtime.loading=false;errorView(container,settings.provider,error);console.error('[D-LOGIS map]',error);}
  }

  function initOsm(container){
    container.innerHTML='';const center=focusPoint();
    runtime.map=L.map(container,{zoomControl:true,attributionControl:true,preferCanvas:true}).setView([center.lat,center.lng],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(runtime.map);
    updateOsm(true);
    setTimeout(()=>runtime.map?.invalidateSize(),100);
  }
  function updateOsm(initial=false){
    if(!runtime.map||!window.L)return;
    const liveIds=new Set();const bounds=[];
    allMapDrones().forEach(drone=>{
      const mission=activeMissionForDrone(drone.id);const latlng=[Number(drone.lat),Number(drone.lng)];liveIds.add(drone.id);bounds.push(latlng);
      const icon=L.divIcon({className:'dlogis-leaflet-icon',html:markerHtml(drone,mission),iconSize:[42,42],iconAnchor:[21,21],popupAnchor:[0,-20]});
      let marker=runtime.markers.get(drone.id);
      if(!marker){marker=L.marker(latlng,{icon,title:drone.name,zIndexOffset:mission?1000:100}).addTo(runtime.map);runtime.markers.set(drone.id,marker);}else{marker.setLatLng(latlng);marker.setIcon(icon);}
      marker.setPopupContent?marker.setPopupContent(infoHtml(drone,mission)):marker.bindPopup(infoHtml(drone,mission));
      if(!marker.getPopup())marker.bindPopup(infoHtml(drone,mission));
    });
    runtime.markers.forEach((marker,id)=>{if(!liveIds.has(id)){runtime.map.removeLayer(marker);runtime.markers.delete(id);}});
    runtime.routes.forEach(route=>{try{runtime.map.removeLayer(route);}catch{}});runtime.routes=[];
    mapRoutes().forEach(({mission,drone,origin,destination})=>{
      const coords=[[origin.lat,origin.lng],[Number(drone.lat),Number(drone.lng)],[destination.lat,destination.lng]];bounds.push([origin.lat,origin.lng],[destination.lat,destination.lng]);
      const line=L.polyline(coords,{color:mission.status==='RETURNING'?'#d97706':'#2874e8',weight:4,opacity:.9,dashArray:mission.status==='HOLDING'?'8 8':null,lineCap:'round'}).addTo(runtime.map);runtime.routes.push(line);
      const start=L.circleMarker([origin.lat,origin.lng],{radius:7,color:'#fff',weight:3,fillColor:'#0b1f3a',fillOpacity:1}).addTo(runtime.map).bindTooltip(origin.name,{direction:'top',className:'dlogis-route-label'});
      const end=L.circleMarker([destination.lat,destination.lng],{radius:7,color:'#fff',weight:3,fillColor:'#0d946c',fillOpacity:1}).addTo(runtime.map).bindTooltip(destination.name,{direction:'top',className:'dlogis-route-label'});
      runtime.routes.push(start,end);
    });
    if(initial&&bounds.length>1)runtime.map.fitBounds(bounds,{padding:[45,45],maxZoom:14});
  }

  function googleSymbol(drone,mission){return {path:google.maps.SymbolPath.CIRCLE,scale:17,fillColor:drone.battery<30?'#d97706':mission?'#2874e8':'#0b1f3a',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:4};}
  function initGoogle(container){
    container.innerHTML='';const center=focusPoint();
    runtime.map=new google.maps.Map(container,{center,zoom:13,gestureHandling:'greedy',mapTypeControl:true,streetViewControl:false,fullscreenControl:true,clickableIcons:false,styles:[{featureType:'poi',elementType:'labels',stylers:[{visibility:'off'}]}]});
    runtime.googleInfo=new google.maps.InfoWindow();updateGoogle(true);
  }
  function updateGoogle(initial=false){
    if(!runtime.map||!window.google?.maps)return;
    const liveIds=new Set(),bounds=new google.maps.LatLngBounds();
    allMapDrones().forEach(drone=>{
      const mission=activeMissionForDrone(drone.id),position={lat:Number(drone.lat),lng:Number(drone.lng)};liveIds.add(drone.id);bounds.extend(position);
      let marker=runtime.markers.get(drone.id);
      if(!marker){marker=new google.maps.Marker({map:runtime.map,position,title:`${drone.name} · ${drone.battery}%`,icon:googleSymbol(drone,mission),label:{text:'✈',color:'#fff',fontSize:'13px',fontWeight:'800'},zIndex:mission?1000:100});marker.addListener('click',()=>{runtime.googleInfo.setContent(infoHtml(drone,activeMissionForDrone(drone.id)));runtime.googleInfo.open({map:runtime.map,anchor:marker});});runtime.markers.set(drone.id,marker);}else{marker.setPosition(position);marker.setIcon(googleSymbol(drone,mission));marker.setTitle(`${drone.name} · ${Math.round(drone.battery)}%`);}
    });
    runtime.markers.forEach((marker,id)=>{if(!liveIds.has(id)){marker.setMap(null);runtime.markers.delete(id);}});
    runtime.routes.forEach(route=>route.setMap(null));runtime.routes=[];
    mapRoutes().forEach(({mission,drone,origin,destination})=>{
      bounds.extend(origin);bounds.extend(destination);
      const line=new google.maps.Polyline({map:runtime.map,path:[origin,{lat:Number(drone.lat),lng:Number(drone.lng)},destination],strokeColor:mission.status==='RETURNING'?'#d97706':'#2874e8',strokeOpacity:.9,strokeWeight:4,geodesic:true});runtime.routes.push(line);
    });
    if(initial&&!bounds.isEmpty())runtime.map.fitBounds(bounds,48);
  }

  function initKakao(container){
    container.innerHTML='';const center=focusPoint();runtime.map=new kakao.maps.Map(container,{center:new kakao.maps.LatLng(center.lat,center.lng),level:5});
    runtime.map.addControl(new kakao.maps.MapTypeControl(),kakao.maps.ControlPosition.TOPRIGHT);runtime.map.addControl(new kakao.maps.ZoomControl(),kakao.maps.ControlPosition.RIGHT);updateKakao(true);
  }
  function updateKakao(initial=false){
    if(!runtime.map||!window.kakao?.maps)return;
    const liveIds=new Set(),bounds=new kakao.maps.LatLngBounds();
    allMapDrones().forEach(drone=>{
      const mission=activeMissionForDrone(drone.id),position=new kakao.maps.LatLng(Number(drone.lat),Number(drone.lng));liveIds.add(drone.id);bounds.extend(position);
      let overlay=runtime.markers.get(drone.id);
      const content=document.createElement('div');content.className='kakao-custom-marker';content.innerHTML=markerHtml(drone,mission);content.title=`${drone.name} · ${drone.battery}%`;
      if(!overlay){overlay=new kakao.maps.CustomOverlay({map:runtime.map,position,content,yAnchor:.5,xAnchor:.5,zIndex:mission?10:3});runtime.markers.set(drone.id,overlay);}else{overlay.setPosition(position);overlay.setContent(content);overlay.setZIndex(mission?10:3);}
    });
    runtime.markers.forEach((overlay,id)=>{if(!liveIds.has(id)){overlay.setMap(null);runtime.markers.delete(id);}});
    runtime.routes.forEach(route=>route.setMap(null));runtime.routes=[];
    mapRoutes().forEach(({mission,drone,origin,destination})=>{
      const start=new kakao.maps.LatLng(origin.lat,origin.lng),current=new kakao.maps.LatLng(Number(drone.lat),Number(drone.lng)),end=new kakao.maps.LatLng(destination.lat,destination.lng);bounds.extend(start);bounds.extend(end);
      const line=new kakao.maps.Polyline({map:runtime.map,path:[start,current,end],strokeWeight:5,strokeColor:mission.status==='RETURNING'?'#d97706':'#2874e8',strokeOpacity:.9,strokeStyle:mission.status==='HOLDING'?'shortdash':'solid'});runtime.routes.push(line);
    });
    if(initial)runtime.map.setBounds(bounds,50,50,50,50);
  }

  function updateExternalLinks(){
    const links=mapLinks();document.querySelectorAll('[data-google-link]').forEach(a=>a.href=links.google);document.querySelectorAll('[data-kakao-link]').forEach(a=>a.href=links.kakao);
  }
  function refresh(){
    const container=document.getElementById('dlogis-live-map');
    if(!container)return;
    if(!runtime.ready||runtime.container!==container||runtime.provider!==settings.provider){scheduleInit(true);return;}
    try{if(runtime.provider==='google')updateGoogle(false);else if(runtime.provider==='kakao')updateKakao(false);else updateOsm(false);updateExternalLinks();}catch(error){console.warn('[D-LOGIS map refresh]',error);}
  }
  let scheduled=false;
  function scheduleInit(force=false){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;initMap(force);});}

  function openSettings(){
    const domain=location.protocol==='file:'?'https://donfsucha.github.io':`${location.protocol}//${location.host}`;
    const root=document.getElementById('modal-root');if(!root)return;
    root.innerHTML=`<div class="modal-backdrop" data-map-close><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><div class="modal-head"><div><h2>실시간 지도 API 설정</h2><p class="muted" style="margin:4px 0 0;font-size:.68rem">OpenStreetMap·Google Maps·Kakao Maps 중 선택합니다.</p></div><button class="btn icon" type="button" data-map-close>×</button></div><form id="map-settings-form"><div class="modal-body map-settings-grid"><div class="field full"><label>기본 지도</label><select class="select" name="provider"><option value="osm" ${settings.provider==='osm'?'selected':''}>OpenStreetMap — 키 없이 바로 사용</option><option value="kakao" ${settings.provider==='kakao'?'selected':''}>Kakao Maps — 국내 서비스 권장</option><option value="google" ${settings.provider==='google'?'selected':''}>Google Maps — 글로벌 서비스</option></select></div><div class="field"><label>Google Maps API Key</label><input class="input" name="googleKey" autocomplete="off" value="${safe(settings.googleKey)}" placeholder="AIza..."></div><div class="field"><label>Kakao JavaScript Key</label><input class="input" name="kakaoKey" autocomplete="off" value="${safe(settings.kakaoKey)}" placeholder="카카오 JavaScript Key"></div><div class="map-help full"><strong>등록할 웹 도메인</strong><code class="map-key-domain">${safe(domain)}</code><div class="map-key-actions" style="justify-content:flex-start"><button type="button" class="map-tool-btn" data-map-copy-domain="${safe(domain)}">도메인 복사</button></div></div><div class="map-help"><strong>Kakao Maps 설정</strong>카카오 개발자센터 → 앱 → 플랫폼 → Web 사이트 도메인에 위 주소를 등록하고 JavaScript Key를 사용합니다.</div><div class="map-help"><strong>Google Maps 설정</strong>Maps JavaScript API를 활성화한 뒤 API 키를 HTTP 리퍼러로 제한하고 위 도메인을 허용합니다.</div><div class="map-secret-note full"><span>!</span><span>키는 이 브라우저의 로컬 저장소에만 저장됩니다. 실제 배포용 키에는 반드시 도메인·API 제한을 적용하십시오.</span></div></div><div class="modal-foot"><button type="button" class="btn" data-map-close>취소</button><button type="submit" class="btn primary">저장하고 지도 연결</button></div></form></div></div>`;
  }
  function closeSettings(){const root=document.getElementById('modal-root');if(root)root.innerHTML='';}
  function setProvider(provider){settings.provider=PROVIDERS[provider]?provider:'osm';saveSettings();clearRuntime();if(typeof render==='function')render();else scheduleInit(true);}

  document.addEventListener('change',event=>{const select=event.target.closest('[data-map-provider]');if(select)setProvider(select.value);});
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-map-settings],[data-map-close],[data-map-fallback],[data-map-retry],[data-map-copy-domain]');if(!target)return;
    if(target.dataset.mapSettings!==undefined){event.preventDefault();return openSettings();}
    if(target.dataset.mapClose!==undefined){event.preventDefault();return closeSettings();}
    if(target.dataset.mapFallback!==undefined){event.preventDefault();return setProvider('osm');}
    if(target.dataset.mapRetry!==undefined){event.preventDefault();return scheduleInit(true);}
    if(target.dataset.mapCopyDomain){event.preventDefault();try{await navigator.clipboard.writeText(target.dataset.mapCopyDomain);toast('도메인 복사 완료',target.dataset.mapCopyDomain,'success');}catch{toast('등록 도메인',target.dataset.mapCopyDomain);}return;}
  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='map-settings-form')return;
    event.preventDefault();const form=new FormData(event.target);settings={provider:String(form.get('provider')||'osm'),googleKey:String(form.get('googleKey')||'').trim(),kakaoKey:String(form.get('kakaoKey')||'').trim()};saveSettings();closeSettings();clearRuntime();if(typeof render==='function')render();toast('지도 설정 저장 완료',`${PROVIDERS[settings.provider]} 연결을 시작합니다.`,'success');
  });

  const appRoot=document.getElementById('app');
  if(appRoot)new MutationObserver(()=>{const container=document.getElementById('dlogis-live-map');if(container&&container!==runtime.container)scheduleInit(true);}).observe(appRoot,{childList:true,subtree:true});

  window.DLOGISMap={
    get settings(){return {...settings};},
    routeFor,positionFor,refresh,scheduleInit,openSettings,setProvider,
    reset(){settings={provider:'osm',googleKey:'',kakaoKey:''};saveSettings();clearRuntime();if(typeof render==='function')render();}
  };
})();
