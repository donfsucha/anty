'use strict';

/*
 * Actual-map availability guard.
 * Leaflet does not request tiles until a center and zoom are assigned. When no
 * mission was active, the dashboard skipped fitBounds(), so only the zoom
 * controls and a blank map background were visible. This guard gives the
 * current inline map a deterministic Bucheon default view and normalizes the
 * OSM tile endpoint to the official non-subdomain URL.
 */
(function installMapResilience(){
  const VERSION='1.0.0';
  const MAP_CONTAINER_ID='ops-inline-live-map';
  const DEFAULT_CENTER=[37.5032,126.7652];
  const DEFAULT_ZOOM=13;
  const OSM_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const api={version:VERSION,lastMap:null,lastTileLayer:null};

  function isInlineMap(map){
    return Boolean(map?._container&&map._container.id===MAP_CONTAINER_ID);
  }

  function mapHasView(map){
    if(!map||typeof map.getCenter!=='function'||typeof map.getZoom!=='function')return false;
    let center=null;let zoom=null;
    try{center=map.getCenter();zoom=map.getZoom();}catch{return false;}
    return Boolean(map._loaded&&center&&Number.isFinite(center.lat)&&Number.isFinite(center.lng)&&Number.isFinite(zoom));
  }

  function ensureDefaultView(map){
    if(!isInlineMap(map))return;
    if(!mapHasView(map))map.setView(DEFAULT_CENTER,DEFAULT_ZOOM,{animate:false});
    requestAnimationFrame(()=>{
      try{map.invalidateSize({animate:false,pan:false});}catch{}
    });
  }

  function removeStatus(map){
    map?._container?.querySelector('.dlogis-map-tile-status')?.remove();
  }

  function showStatus(map,message,tone='loading'){
    if(!isInlineMap(map))return;
    let status=map._container.querySelector('.dlogis-map-tile-status');
    if(!status){
      status=document.createElement('div');
      status.className='dlogis-map-tile-status';
      status.setAttribute('role','status');
      status.setAttribute('aria-live','polite');
      map._container.appendChild(status);
    }
    status.className=`dlogis-map-tile-status ${tone}`;
    status.innerHTML=`<span></span><strong>${message}</strong>${tone==='error'?'<button type="button" data-map-tile-retry>재연결</button>':''}`;
  }

  function attachTileHealth(layer){
    if(!layer||layer.__dlogisTileHealth)return layer;
    layer.__dlogisTileHealth=true;
    let errorCount=0;
    let timeoutId=null;

    layer.on('add',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map))return;
      api.lastMap=map;api.lastTileLayer=layer;
      ensureDefaultView(map);
      showStatus(map,'실제 지도 불러오는 중');
      clearTimeout(timeoutId);
      timeoutId=setTimeout(()=>{
        if(layer._map&&errorCount>0)showStatus(layer._map,'지도 연결이 지연되고 있습니다.','error');
      },9000);
    });
    layer.on('tileload',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map))return;
      errorCount=0;
      clearTimeout(timeoutId);
      map._container.classList.add('has-map-tiles');
      removeStatus(map);
    });
    layer.on('load',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map))return;
      errorCount=0;
      clearTimeout(timeoutId);
      map._container.classList.add('has-map-tiles');
      removeStatus(map);
    });
    layer.on('tileerror',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map))return;
      errorCount+=1;
      if(errorCount>=3)showStatus(map,'지도 타일을 불러오지 못했습니다.','error');
    });
    layer.on('remove',()=>clearTimeout(timeoutId));
    return layer;
  }

  function patchLeaflet(L){
    if(!L||L.__dlogisMapResilience||typeof L.map!=='function'||typeof L.tileLayer!=='function')return;

    const originalMap=L.map;
    const patchedMap=function patchedLeafletMap(...args){
      const map=originalMap.apply(L,args);
      if(isInlineMap(map)){
        api.lastMap=map;
        ensureDefaultView(map);
        requestAnimationFrame(()=>ensureDefaultView(map));
      }
      return map;
    };
    Object.assign(patchedMap,originalMap);
    patchedMap.__dlogisOriginal=originalMap;
    L.map=patchedMap;

    const originalTileLayer=L.tileLayer;
    const patchedTileLayer=function patchedLeafletTileLayer(url,options={}){
      const requested=String(url||'');
      const isOsmStandard=/(?:[abc]\.)?tile\.openstreetmap\.org/i.test(requested);
      const normalizedUrl=isOsmStandard?OSM_TILE_URL:requested;
      const normalizedOptions=isOsmStandard
        ?{...options,maxZoom:Number(options.maxZoom||19),attribution:options.attribution||'&copy; OpenStreetMap contributors'}
        :options;
      return attachTileHealth(originalTileLayer.call(L,normalizedUrl,normalizedOptions));
    };
    Object.assign(patchedTileLayer,originalTileLayer);
    patchedTileLayer.__dlogisOriginal=originalTileLayer;
    L.tileLayer=patchedTileLayer;
    L.__dlogisMapResilience=true;
  }

  function installLeafletInterceptor(){
    if(window.L){patchLeaflet(window.L);return;}
    const descriptor=Object.getOwnPropertyDescriptor(window,'L');
    if(descriptor&&!descriptor.configurable){
      const timer=setInterval(()=>{
        if(!window.L)return;
        clearInterval(timer);patchLeaflet(window.L);
      },50);
      setTimeout(()=>clearInterval(timer),15000);
      return;
    }

    let leafletValue;
    Object.defineProperty(window,'L',{
      configurable:true,
      enumerable:true,
      get(){return leafletValue;},
      set(value){
        leafletValue=value;
        patchLeaflet(value);
        Object.defineProperty(window,'L',{configurable:true,enumerable:true,writable:true,value});
      }
    });
  }

  document.addEventListener('click',event=>{
    const retry=event.target.closest('[data-map-tile-retry]');
    if(!retry)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const map=api.lastMap;const layer=api.lastTileLayer;
    if(!map||!layer)return;
    showStatus(map,'실제 지도 다시 연결 중');
    ensureDefaultView(map);
    try{layer.redraw();}catch{}
  },true);

  api.ensureDefaultView=ensureDefaultView;
  api.patchLeaflet=patchLeaflet;
  window.dlogisMapResilience=api;
  installLeafletInterceptor();
})();
