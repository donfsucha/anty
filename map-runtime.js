/* Keep the live map mounted while telemetry moves every second. */
(function(){
  'use strict';
  if(typeof timer!=='undefined'&&timer)clearInterval(timer);

  function updateDashboardDom(){
    if(!state.role||state.role!=='admin'||state.view!=='dashboard')return;
    state.missions.filter(m=>['IN_FLIGHT','HOLDING','RETURNING'].includes(m.status)).forEach(m=>{
      const row=document.querySelector(`.mini-row[data-select-mission="${CSS.escape(m.id)}"]`);
      if(!row)return;
      const small=row.querySelector('small');if(small)small.textContent=`${m.droneId||'-'} · ETA ${m.etaMin}분`;
      const bar=row.querySelector('.progress span');if(bar)bar.style.width=`${m.progress}%`;
    });
  }

  tick=function(){
    if(state.settings.mode!=='simulation')return;
    let changed=false;
    for(const m of state.missions){
      if(m.status==='IN_FLIGHT'){
        m.progress=clamp(m.progress+.35*state.settings.simulationSpeed,0,96);
        m.etaMin=Math.max(1,Math.ceil((100-m.progress)/6));
        const d=state.drones.find(x=>x.id===m.droneId),b=state.batteries.find(x=>x.id===m.batteryId);
        if(d){
          d.x=clamp(d.x+.12,8,84);d.y=clamp(d.y-.055,18,82);
          d.altitude=Math.round(62+Math.sin(Date.now()/5000)*9);
          d.speed=Math.round(34+Math.sin(Date.now()/3000)*5);
          if(Math.random()<.08)d.link=clamp(d.link+Math.round(Math.random()*4-2),72,100);
          if(window.DLOGISMap){const pos=window.DLOGISMap.positionFor(m,d);d.lat=pos.lat;d.lng=pos.lng;}
        }
        if(b&&Math.random()<.18){b.soc=clamp(b.soc-.1,8,100);b.temp=clamp(b.temp+.02,20,55);if(d)d.battery=Math.round(b.soc);}
        changed=true;
      }else if(m.status==='RETURNING'){
        m.progress=clamp(m.progress-.18,5,100);m.etaMin=Math.max(1,Math.ceil(m.progress/9));
        const d=state.drones.find(x=>x.id===m.droneId);
        if(d){
          d.x=clamp(d.x-.12,10,85);d.y=clamp(d.y+.06,15,85);d.altitude=Math.max(18,Math.round(d.altitude-.08));d.speed=31;
          if(window.DLOGISMap){const pos=window.DLOGISMap.positionFor(m,d);d.lat=pos.lat;d.lng=pos.lng;}
        }
        changed=true;
      }
    }
    if(!changed)return;
    persist();
    if(state.role==='admin'&&state.view==='dashboard'){
      window.DLOGISMap?.refresh();updateDashboardDom();
    }else if(state.role&&((state.role==='admin'&&['missions','fleet','batteries'].includes(state.view))||state.role!=='admin')){
      render();
    }
  };

  timer=setInterval(tick,1000);
  setTimeout(()=>window.DLOGISMap?.scheduleInit(true),60);
})();
