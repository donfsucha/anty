const DLogisMap=(()=>{
  let map=null,provider=null,kakaoPromise=null,layers=[];

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
  function loadKakao(key){
    if(window.kakao?.maps)return new Promise(resolve=>window.kakao.maps.load(resolve));
    if(kakaoPromise)return kakaoPromise;
    kakaoPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      script.onload=()=>window.kakao?.maps?window.kakao.maps.load(resolve):reject(new Error('카카오맵 SDK 초기화 실패'));
      script.onerror=()=>reject(new Error('카카오맵 SDK 로딩 실패'));
      document.head.appendChild(script);
    });
    return kakaoPromise;
  }
  async function render(containerId='ops-map'){
    const el=document.getElementById(containerId);if(!el)return;
    destroy();const ctx=context();
    if(state.settings.mapProvider==='kakao'&&state.settings.kakaoJavaScriptKey){
      try{await loadKakao(state.settings.kakaoJavaScriptKey);renderKakao(el,ctx);return;}
      catch(error){console.warn(error);toast('카카오맵 연결 실패','무료 OpenStreetMap으로 자동 전환했습니다.','warning');}
    }
    renderLeaflet(el,ctx);
  }
  function renderKakao(el,{origin,destination,drones}){
    provider='kakao';
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
    if(!window.L){el.innerHTML='<div class="notice warning" style="margin:16px">지도 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</div>';return;}
    provider='leaflet';map=L.map(el,{zoomControl:true,attributionControl:true});
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
  function openInKakao(){
    const {mission,destination,drones}=context(),drone=drones.find(d=>d.id===mission?.droneId)||drones[0],target=drone||destination;
    if(!target)return;const name=encodeURIComponent(drone?.name||destination?.name||'드론 위치');
    window.open(`https://map.kakao.com/link/map/${name},${target.lat},${target.lng}`,'_blank','noopener');
  }
  return {render,destroy,openInKakao};
})();
