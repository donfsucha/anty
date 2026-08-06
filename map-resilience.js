'use strict';

/*
 * Actual-map availability and lifecycle guard.
 *
 * The inline Leaflet map must remain stable when the dashboard changes between
 * schematic and actual-map modes, when an active mission is added, and when the
 * user moves to another page. The guard supplies a deterministic empty-state
 * view, normalizes OSM tile requests and cancels map callbacks before removal.
 */
(function installMapResilience(){
  const VERSION='1.2.1';
  const MAP_CONTAINER_ID='ops-inline-live-map';
  const DEFAULT_CENTER=[37.5032,126.7652];
  const DEFAULT_ZOOM=13;
  const OSM_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const api={version:VERSION,lastMap:null,lastTileLayer:null};

  function mapTarget(value){
    if(typeof value==='string')return document.getElementById(value);
    return value&&value.nodeType===1?value:null;
  }

  function isInlineTarget(value){return mapTarget(value)?.id===MAP_CONTAINER_ID;}

  function isInlineMap(map){
    return Boolean(map?._container&&map._container.id===MAP_CONTAINER_ID);
  }

  function mapHasView(map){
    if(!map||typeof map.getCenter!=='function'||typeof map.getZoom!=='function')return false;
    let center=null;let zoom=null;
    try{center=map.getCenter();zoom=map.getZoom();}catch{return false;}
    return Boolean(map._loaded&&center&&Number.isFinite(center.lat)&&Number.isFinite(center.lng)&&Number.isFinite(zoom));
  }

  function mapRenderers(map){
    const renderers=new Set();
    if(map?._renderer)renderers.add(map._renderer);
    Object.values(map?._paneRenderers||{}).forEach(renderer=>renderer&&renderers.add(renderer));
    Object.values(map?._layers||{}).forEach(layer=>{if(layer?._renderer)renderers.add(layer._renderer);});
    return [...renderers];
  }

  function cancelRendererDraws(map){
    mapRenderers(map).forEach(renderer=>{
      try{
        if(renderer._redrawRequest){cancelAnimationFrame(renderer._redrawRequest);renderer._redrawRequest=null;}
        if(renderer._animRequest){cancelAnimationFrame(renderer._animRequest);renderer._animRequest=null;}
        renderer._redrawBounds=null;
      }catch{}
    });
  }

  function stopMapAnimations(map){
    if(!map)return;
    try{map.stop?.();}catch{}
    try{map._panAnim?.stop?.();}catch{}
    try{
      if(map._flyToFrame){cancelAnimationFrame(map._flyToFrame);map._flyToFrame=null;}
      if(map._resizeRequest){cancelAnimationFrame(map._resizeRequest);map._resizeRequest=null;}
    }catch{}
    cancelRendererDraws(map);
    map._animatingZoom=false;
    map._zoomAnimated=false;
  }

  function makeInlineLifecycleSafe(map){
    if(!isInlineMap(map)||map.__dlogisLifecycleSafe)return map;
    map.__dlogisLifecycleSafe=true;

    const originalSetView=map.setView.bind(map);
    map.setView=(center,zoom,options={})=>originalSetView(center,zoom,{...options,animate:false});

    const originalFitBounds=map.fitBounds.bind(map);
    map.fitBounds=(bounds,options={})=>originalFitBounds(bounds,{...options,animate:false});

    const originalPanTo=map.panTo.bind(map);
    map.panTo=(center,options={})=>originalPanTo(center,{...options,animate:false});

    const originalRemove=map.remove.bind(map);
    map.remove=()=>{
      if(map.__dlogisRemoved)return map;
      map.__dlogisRemoved=true;
      stopMapAnimations(map);
      if(api.lastMap===map){api.lastMap=null;api.lastTileLayer=null;}
      try{return originalRemove();}catch(error){
        if(!map._container?.isConnected)return map;
        throw error;
      }finally{cancelRendererDraws(map);}
    };
    return map;
  }

  function ensureDefaultView(map){
    if(!isInlineMap(map)||map.__dlogisRemoved)return;
    if(!mapHasView(map))map.setView(DEFAULT_CENTER,DEFAULT_ZOOM,{animate:false});
    requestAnimationFrame(()=>{
      if(map.__dlogisRemoved||!map._container?.isConnected)return;
      try{map.invalidateSize({animate:false,pan:false});}catch{}
    });
  }

  function removeStatus(map){map?._container?.querySelector('.dlogis-map-tile-status')?.remove();}

  function showStatus(map,message,tone='loading'){
    if(!isInlineMap(map)||map.__dlogisRemoved||!map._container?.isConnected)return;
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
      if(!isInlineMap(map)||map.__dlogisRemoved)return;
      api.lastMap=map;api.lastTileLayer=layer;
      ensureDefaultView(map);
      showStatus(map,'실제 지도 불러오는 중');
      clearTimeout(timeoutId);
      timeoutId=setTimeout(()=>{
        if(layer._map&&!layer._map.__dlogisRemoved&&errorCount>0)showStatus(layer._map,'지도 연결이 지연되고 있습니다.','error');
      },9000);
    });
    layer.on('tileload',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map)||map.__dlogisRemoved||!map._container?.isConnected)return;
      errorCount=0;clearTimeout(timeoutId);map._container.classList.add('has-map-tiles');removeStatus(map);
    });
    layer.on('load',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map)||map.__dlogisRemoved||!map._container?.isConnected)return;
      errorCount=0;clearTimeout(timeoutId);map._container.classList.add('has-map-tiles');removeStatus(map);
    });
    layer.on('tileerror',event=>{
      const map=event.target?._map;
      if(!isInlineMap(map)||map.__dlogisRemoved)return;
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
      if(isInlineTarget(args[0])){
        args[1]={
          ...(args[1]||{}),
          preferCanvas:false,
          zoomAnimation:false,
          fadeAnimation:false,
          markerZoomAnimation:false,
          inertia:false
        };
      }
      const map=makeInlineLifecycleSafe(originalMap.apply(L,args));
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
        ?{...options,maxZoom:Number(options.maxZoom||19),attribution:options.attribution||'&copy; OpenStreetMap contributors',updateWhenZooming:false,keepBuffer:2}
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
      const timer=setInterval(()=>{if(window.L){clearInterval(timer);patchLeaflet(window.L);}},50);
      setTimeout(()=>clearInterval(timer),15000);
      return;
    }
    let leafletValue;
    Object.defineProperty(window,'L',{
      configurable:true,enumerable:true,
      get(){return leafletValue;},
      set(value){leafletValue=value;patchLeaflet(value);Object.defineProperty(window,'L',{configurable:true,enumerable:true,writable:true,value});}
    });
  }

  document.addEventListener('click',event=>{
    const retry=event.target.closest('[data-map-tile-retry]');
    if(!retry)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const map=api.lastMap;const layer=api.lastTileLayer;
    if(!map||!layer||map.__dlogisRemoved)return;
    showStatus(map,'실제 지도 다시 연결 중');ensureDefaultView(map);
    try{layer.redraw();}catch{}
  },true);

  api.ensureDefaultView=ensureDefaultView;
  api.stopMapAnimations=stopMapAnimations;
  api.cancelRendererDraws=cancelRendererDraws;
  api.makeInlineLifecycleSafe=makeInlineLifecycleSafe;
  api.patchLeaflet=patchLeaflet;
  window.dlogisMapResilience=api;
  installLeafletInterceptor();
})();
