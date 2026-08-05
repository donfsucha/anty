const DLogisMap=(()=>{
  let map=null,provider=null,loadPromise=null,leafletPromise=null;
  const markerLayers=[];
  function destroy(){
    try{if(provider==='leaflet'&&map)map.remove();}catch{}
    map=null;provider=null;markerLayers.length=0;
  }
  function addCss(href,id){
    if(document.getElementById(id))return;
    const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=href;document.head.appendChild(link);
  }
  function loadLeaflet(){
    if(window.L)return Promise.resolve(window.L);
    if(leafletPromise)return leafletPromise;
    addCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css','leaflet-css');
    leafletPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload=()=>resolve(window.L);s.onerror=()=>reject(new Error('OpenStreetMap 지도 모듈 로딩 실패'));document.head.appendChild(s);
    });
    return leafletPromise;
  }
  function loadKakao(key){
    if(window.kakao?.maps)return new Promise(resolve=>window.kakao.maps.load(resolve));
    if(loadPromise)return loadPromise;
    loadPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      s.onload=()=>window.kakao?.maps?window.kakao.maps.load(resolve):reject(new Error('카카오맵 SDK 초기화 실패'));
      s.onerror=()=>reject(new Error('카카오맵 SDK 로딩 실패'));document.head.appendChild(s);
    });
    return loadPromise;
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
  async function render(containerId='ops-map'){
    const el=document.getElementById(containerId);if(!el)return;
    destroy();
    const ctx=context();
    if(state.settings.mapProvider==='kakao'&&state.settings.kakaoJavaScriptKey){
      try{await loadKakao(state.settings.kakaoJavaScriptKey);renderKakao(el,ctx);return;}
      catch(error){console.warn(error);toast('카카오맵 연결 실패','무료 OpenStreetMap으로 자동 전환했습니다.','warning');}
    }
    try{await loadLeaflet();renderLeaflet(el,ctx);}
    catch(error){console.warn(error);renderFallback(el,ctx);}
  }
  function renderKakao(el,{origin,destination,drones}){
    provider='kakao';
    const center=new kakao.maps.LatLng(origin?.lat||37.50342,origin?.lng||126.76608);
    map=new kakao.maps.Map(el,{center,level:6});
    const bounds=new kakao.maps.LatLngBounds();
    if(origin&&destination){
      const path=[new kakao.maps.LatLng(origin.lat,origin.lng),new kakao.maps.LatLng(destination.lat,destination.lng)];
      new kakao.maps.Polyline({map,path,strokeWeight:5,strokeColor:'#2874e8',strokeOpacity:.9,strokeStyle:'solid'});
      [{loc:origin,label:'출발'},{loc:destination,label:'도착'}].forEach(({loc,label})=>{
        const p=new kakao.maps.LatLng(loc.lat,loc.lng);bounds.extend(p);
        new kakao.maps.CustomOverlay({map,position:p,content:`<div style="background:#fff;border:2px solid ${label==='출발'?'#155bcc':'#0d946c'};border-radius:10px;padding:6px 8px;font:700 11px sans-serif;box-shadow:0 6px 14px rgba(0,0,0,.15)">${label} · ${escapeHtml(loc.name)}</div>`,yAnchor:1.5});
      });
    }
    drones.forEach(d=>{
      const p=new kakao.maps.LatLng(d.lat,d.lng);bounds.extend(p);
      const overlay=new kakao.maps.CustomOverlay({map,position:p,content:pinHtml(d),yAnchor:.5,xAnchor:.5});
      markerLayers.push(overlay);
    });
    if(!bounds.isEmpty())map.setBounds(bounds,60,60,60,60);
  }
  function renderLeaflet(el,{origin,destination,drones}){
    provider='leaflet';
    map=L.map(el,{zoomControl:true,attributionControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    const points=[];
    if(origin&&destination){
      const route=[[origin.lat,origin.lng],[destination.lat,destination.lng]];
      L.polyline(route,{color:'#2874e8',weight:5,opacity:.9}).addTo(map);
      L.circleMarker(route[0],{radius:9,color:'#155bcc',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip(`출발 · ${origin.name}`,{permanent:true,direction:'top'});
      L.circleMarker(route[1],{radius:9,color:'#0d946c',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip(`도착 · ${destination.name}`,{permanent:true,direction:'top'});
      points.push(...route);
    }
    drones.forEach(d=>{
      const icon=L.divIcon({className:'',html:pinHtml(d),iconSize:[38,38],iconAnchor:[19,19]});
      L.marker([d.lat,d.lng],{icon}).addTo(map).bindPopup(`<strong>${escapeHtml(d.name)}</strong><br>고도 ${fmt1(d.altitudeM,' m')}<br>배터리 ${fmt1(batteryById(d.batteryId)?.soc,'%')}`);
      points.push([d.lat,d.lng]);
    });
    if(points.length)map.fitBounds(points,{padding:[45,45],maxZoom:14});else map.setView([37.50342,126.76608],13);
  }
  function renderFallback(el,{origin,destination,drones}){
    provider='fallback';
    const all=[origin,destination,...drones].filter(Boolean);
    const minLat=Math.min(...all.map(x=>x.lat))-.004,maxLat=Math.max(...all.map(x=>x.lat))+.004;
    const minLng=Math.min(...all.map(x=>x.lng))-.004,maxLng=Math.max(...all.map(x=>x.lng))+.004;
    const xy=p=>({x:70+(p.lng-minLng)/(maxLng-minLng)*760,y:370-(p.lat-minLat)/(maxLat-minLat)*300});
    const o=origin?xy(origin):{x:100,y:300},d=destination?xy(destination):{x:800,y:100};
    el.innerHTML=`<svg class="fallback-map" viewBox="0 0 900 430" role="img" aria-label="운항 경로 대체 지도">
      <defs><pattern id="g" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#cbd9e8" stroke-width="1"/></pattern></defs>
      <rect width="900" height="430" fill="url(#g)"/><path d="M20 350C190 290 240 150 410 160S690 270 880 70" fill="none" stroke="#fff" stroke-width="22"/>
      <line x1="${o.x}" y1="${o.y}" x2="${d.x}" y2="${d.y}" stroke="#2874e8" stroke-width="6" stroke-linecap="round"/>
      <circle cx="${o.x}" cy="${o.y}" r="12" fill="#fff" stroke="#155bcc" stroke-width="5"/><circle cx="${d.x}" cy="${d.y}" r="12" fill="#fff" stroke="#0d946c" stroke-width="5"/>
      ${drones.map(dr=>{const p=xy(dr);return `<g transform="translate(${p.x} ${p.y})"><circle r="20" fill="#2874e8" stroke="#fff" stroke-width="4"/><text x="0" y="5" text-anchor="middle" fill="#fff" font-size="16">✥</text><text x="0" y="34" text-anchor="middle" fill="#344054" font-size="12">${dr.id}</text></g>`}).join('')}
    </svg>`;
  }
  function openInKakao(){
    const {mission,destination,drones}=context();
    const drone=drones.find(d=>d.id===mission?.droneId)||drones[0];
    const target=drone||destination;if(!target)return;
    const name=encodeURIComponent(drone?.name||destination?.name||'드론 위치');
    window.open(`https://map.kakao.com/link/map/${name},${target.lat},${target.lng}`,'_blank','noopener');
  }
  return {render,destroy,openInKakao};
})();
