const DLogisMap=(()=>{
  let map=null,provider=null,kakaoPromise=null,leafletPromise=null,layers=[];

  function destroy(){
    try{if(provider==='leaflet'&&map)map.remove();}catch{}
    try{if(provider==='kakao'&&map)layers.forEach(layer=>layer.setMap?.(null));}catch{}
    map=null;provider=null;layers=[];
  }
  function context(){
    const mission=missionById(state.ui.selectedMissionId)||activeMissions()[0]||state.missions[0];
    const origin=locationById(mission?.originId),destination=locationById(mission?.destinationId);
    const drones=state.drones.filter(d=>['IN_FLIGHT','HOLDING','RETURNING'].includes(d.status));
    return {mission,origin,destination,drones};
  }
  function pinHtml(drone){
    const cls=drone.status==='RETURNING'?'returning':drone.linkQualityPct<70?'warning':'';
    return `<div class="drone-pin ${cls}" title="${escapeHtml(drone.name)}">✥</div>`;
  }
  function loadCss(id,url){
    if(document.getElementById(id))return;
    const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=url;document.head.appendChild(link);
  }
  function loadScript(id,url,test){
    if(test())return Promise.resolve();
    const old=document.getElementById(id);if(old)old.remove();
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.id=id;script.src=url;script.async=true;
      script.onload=()=>test()?resolve():reject(new Error('지도 모듈 초기화 실패'));
      script.onerror=()=>reject(new Error('지도 모듈 로딩 실패'));
      document.head.appendChild(script);
    });
  }
  function loadLeaflet(){
    if(window.L)return Promise.resolve(window.L);
    if(leafletPromise)return leafletPromise;
    loadCss('leaflet-css','https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    leafletPromise=loadScript('leaflet-js','https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',()=>Boolean(window.L)).then(()=>window.L).catch(error=>{leafletPromise=null;throw error;});
    return leafletPromise;
  }
  function loadKakao(key){
    if(window.kakao?.maps)return new Promise(resolve=>window.kakao.maps.load(resolve));
    if(kakaoPromise)return kakaoPromise;
    kakaoPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.id='kakao-map-js';
      script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      script.onload=()=>window.kakao?.maps?window.kakao.maps.load(resolve):reject(new Error('카카오맵 SDK 초기화 실패'));
      script.onerror=()=>reject(new Error('카카오맵 SDK 로딩 실패'));
      document.head.appendChild(script);
    }).catch(error=>{kakaoPromise=null;document.getElementById('kakao-map-js')?.remove();throw error;});
    return kakaoPromise;
  }
  async function render(containerId='ops-map'){
    const el=document.getElementById(containerId);if(!el)return;
    destroy();const ctx=context();
    el.innerHTML='<div class="notice" style="position:absolute;left:16px;top:16px;z-index:3">무료 지도 데이터를 불러오는 중입니다.</div>';
    if(state.settings.mapProvider==='kakao'&&state.settings.kakaoJavaScriptKey){
      try{await loadKakao(state.settings.kakaoJavaScriptKey);renderKakao(el,ctx);return;}
      catch(error){console.warn(error);toast('카카오맵 연결 실패','무료 OpenStreetMap으로 자동 전환했습니다.','warning');}
    }
    try{await loadLeaflet();renderLeaflet(el,ctx);}
    catch(error){console.warn(error);renderFallback(el,ctx);}
  }
  function renderKakao(el,{origin,destination,drones}){
    provider='kakao';el.innerHTML='';
    map=new kakao.maps.Map(el,{center:new kakao.maps.LatLng(origin?.lat||37.50342,origin?.lng||126.76608),level:6});
    const bounds=new kakao.maps.LatLngBounds();
    if(origin&&destination){
      const route=[new kakao.maps.LatLng(origin.lat,origin.lng),new kakao.maps.LatLng(destination.lat,destination.lng)];
      const line=new kakao.maps.Polyline({map,path:route,strokeWeight:5,strokeColor:'#2874e8',strokeOpacity:.9,strokeStyle:'solid'});layers.push(line);
      [{loc:origin,label:'출발',color:'#155bcc'},{loc:destination,label:'도착',color:'#0d946c'}].forEach(({loc,label,color})=>{
        const point=new kakao.maps.LatLng(loc.lat,loc.lng);bounds.extend(point);
        const overlay=new kakao.maps.CustomOverlay({map,position:point,content:`<div style="background:#fff;border:2px solid ${color};border-radius:10px;padding:6px 8px;font:700 11px sans-serif;box-shadow:0 6px 14px rgba(0,0,0,.15)">${label} · ${escapeHtml(loc.name)}</div>`,yAnchor:1.5});layers.push(overlay);
      });
    }
    drones.forEach(drone=>{
      const point=new kakao.maps.LatLng(drone.lat,drone.lng);bounds.extend(point);
      const overlay=new kakao.maps.CustomOverlay({map,position:point,content:pinHtml(drone),yAnchor:.5,xAnchor:.5});layers.push(overlay);
    });
    if(!bounds.isEmpty())map.setBounds(bounds,60,60,60,60);
  }
  function renderLeaflet(el,{origin,destination,drones}){
    provider='leaflet';el.innerHTML='';
    map=L.map(el,{zoomControl:true,attributionControl:true});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    const points=[];
    if(origin&&destination){
      const route=[[origin.lat,origin.lng],[destination.lat,destination.lng]];
      L.polyline(route,{color:'#2874e8',weight:5,opacity:.9}).addTo(map);
      L.circleMarker(route[0],{radius:9,color:'#155bcc',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip(`출발 · ${origin.name}`,{permanent:true,direction:'top'});
      L.circleMarker(route[1],{radius:9,color:'#0d946c',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip(`도착 · ${destination.name}`,{permanent:true,direction:'top'});
      points.push(...route);
    }
    drones.forEach(drone=>{
      const markerIcon=L.divIcon({className:'',html:pinHtml(drone),iconSize:[38,38],iconAnchor:[19,19]});
      L.marker([drone.lat,drone.lng],{icon:markerIcon}).addTo(map).bindPopup(`<strong>${escapeHtml(drone.name)}</strong><br>고도 ${fmt1(drone.altitudeM,' m')}<br>배터리 ${fmt1(batteryById(drone.batteryId)?.soc,'%')}<br>통신 ${fmt1(drone.linkQualityPct,'%')}`);
      points.push([drone.lat,drone.lng]);
    });
    if(points.length)map.fitBounds(points,{padding:[45,45],maxZoom:14});else map.setView([37.50342,126.76608],13);
  }
  function renderFallback(el,{origin,destination,drones}){
    provider='fallback';
    const all=[origin,destination,...drones].filter(Boolean);
    if(!all.length){el.innerHTML='<div class="notice warning" style="margin:16px">표시할 위치 데이터가 없습니다.</div>';return;}
    const minLat=Math.min(...all.map(x=>x.lat))-.004,maxLat=Math.max(...all.map(x=>x.lat))+.004,minLng=Math.min(...all.map(x=>x.lng))-.004,maxLng=Math.max(...all.map(x=>x.lng))+.004;
    const xy=point=>({x:70+(point.lng-minLng)/(maxLng-minLng)*760,y:370-(point.lat-minLat)/(maxLat-minLat)*300});
    const start=origin?xy(origin):{x:100,y:300},end=destination?xy(destination):{x:800,y:100};
    el.innerHTML=`<svg class="fallback-map" viewBox="0 0 900 430" role="img" aria-label="운항 경로 대체 지도"><defs><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#cbd9e8" stroke-width="1"/></pattern></defs><rect width="900" height="430" fill="#edf5fa"/><rect width="900" height="430" fill="url(#grid)"/><path d="M20 350C190 290 240 150 410 160S690 270 880 70" fill="none" stroke="#fff" stroke-width="22"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#2874e8" stroke-width="6" stroke-linecap="round"/><circle cx="${start.x}" cy="${start.y}" r="12" fill="#fff" stroke="#155bcc" stroke-width="5"/><circle cx="${end.x}" cy="${end.y}" r="12" fill="#fff" stroke="#0d946c" stroke-width="5"/>${drones.map(drone=>{const point=xy(drone);return `<g transform="translate(${point.x} ${point.y})"><circle r="20" fill="#2874e8" stroke="#fff" stroke-width="4"/><text x="0" y="5" text-anchor="middle" fill="#fff" font-size="16">✥</text><text x="0" y="34" text-anchor="middle" fill="#344054" font-size="12">${drone.id}</text></g>`}).join('')}</svg><div class="notice warning" style="position:absolute;right:14px;top:14px;z-index:3">외부 지도 서버 연결 실패 · 내장 대체지도 표시</div>`;
  }
  function openInKakao(){
    const {mission,destination,drones}=context(),drone=drones.find(d=>d.id===mission?.droneId)||drones[0],target=drone||destination;
    if(!target)return;const name=encodeURIComponent(drone?.name||destination?.name||'드론 위치');
    window.open(`https://map.kakao.com/link/map/${name},${target.lat},${target.lng}`,'_blank','noopener');
  }
  return {render,destroy,openInKakao};
})();
