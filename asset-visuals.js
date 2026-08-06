'use strict';

/*
 * Fleet and battery visual systems.
 * Drone management is flight/maintenance centric; battery management is
 * energy/health centric. Both views still read the canonical shared state.
 */
(function installAssetVisualSystems(){
  const ACTIVE_MISSION_STATUSES=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);
  const OPEN_MISSION_STATUSES=new Set(['READY','APPROVED','IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);

  const DRONE_SVG=`<svg class="fleet-drone-svg" viewBox="0 0 160 112" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="32" cy="25" r="16"/><circle cx="128" cy="25" r="16"/><circle cx="32" cy="87" r="16"/><circle cx="128" cy="87" r="16"/>
      <path d="M45 34 65 48M115 34 95 48M45 78 65 64M115 78 95 64"/>
      <rect x="62" y="38" width="36" height="36" rx="11"/>
      <path d="M70 76h20l-4 12H74l-4-12Z"/>
    </g>
    <circle cx="80" cy="56" r="7" fill="currentColor"/>
  </svg>`;

  const BATTERY_SVG=`<svg viewBox="0 0 64 28" fill="none" aria-hidden="true"><rect x="2" y="2" width="54" height="24" rx="6" stroke="currentColor" stroke-width="3"/><path d="M58 9h4v10h-4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="m29 6-8 10h8l-3 7 13-12h-8l3-5h-5Z" fill="currentColor"/></svg>`;

  function openMission(mission){return Boolean(mission&&OPEN_MISSION_STATUSES.has(mission.status));}
  function activeMission(mission){return Boolean(mission&&ACTIVE_MISSION_STATUSES.has(mission.status));}
  function missionForDrone(droneId){
    return state.missions.find(item=>item.droneId===droneId&&openMission(item))||null;
  }
  function missionForBattery(batteryId){
    return state.missions.find(item=>item.batteryId===batteryId&&openMission(item))||null;
  }
  function latestTelemetry(filterKey,value){
    const rows=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){if(rows[index][filterKey]===value)return rows[index];}
    return null;
  }
  function cellDeltaMv(battery){
    if(typeof flowCellDeltaMv==='function')return flowCellDeltaMv(battery);
    const raw=Number(battery?.cellDiff);
    if(!Number.isFinite(raw))return 0;
    return flowRound1(Math.abs(raw)<=1?raw*1000:raw);
  }
  function dataSourceLabel(source){
    return ({SIMULATION:'시뮬레이션',GATEWAY:'실기체',SYSTEM:'시스템',MANUAL:'수동 입력'})[source]||source||'시뮬레이션';
  }
  function droneTone(drone){
    if(drone.status==='MAINTENANCE'||drone.flightMode==='OFFLINE')return 'maintenance';
    if(['IN_FLIGHT','HOLDING','RETURNING','LANDING'].includes(drone.status))return 'active';
    return 'ready';
  }
  function droneStatusBadge(drone){
    const code=STATUS[drone.status]?drone.status:drone.status==='MAINTENANCE'?'MAINTENANCE':'READY';
    return statusBadge(code);
  }
  function maintenanceMeta(drone){
    const hours=flowRound1(drone.maintenance);
    if(drone.status==='MAINTENANCE'||hours<=0)return {label:'정비 필요',tone:'danger',percent:0};
    if(hours<=10)return {label:'정비 임박',tone:'danger',percent:clamp(hours/40*100,0,100)};
    if(hours<=20)return {label:'정비 예정',tone:'warning',percent:clamp(hours/40*100,0,100)};
    return {label:'정비 여유',tone:'normal',percent:clamp(hours/40*100,0,100)};
  }
  function batteryDecision(battery){
    const delta=cellDeltaMv(battery);
    if(battery.status==='QUARANTINE'||Number(battery.soh)<85||delta>50)return {label:'임무 투입 차단',tone:'danger',detail:'격리 또는 건전성 기준 확인 필요'};
    if(battery.status==='IN_USE')return {label:'운항 사용 중',tone:'active',detail:'연결 기체의 실시간 소비 상태'};
    if(battery.status==='CHARGING'||Number(battery.soc)<60)return {label:'충전·준비 필요',tone:'warning',detail:'임무 배정 전 충전상태 확인'};
    return {label:'임무 투입 가능',tone:'ready',detail:'현재 앱 관리조건 충족'};
  }
  function temperaturePosition(value){return clamp((Number(value)||0)/60*100,0,100);}
  function cellPosition(value){return clamp(Number(value)/50*100,0,120);}
  function statusLabel(code){return STATUS[code]?.[0]||code||'-';}

  function fleetHero(snapshot){
    const operational=state.drones.filter(drone=>drone.status!=='MAINTENANCE'&&drone.flightMode!=='OFFLINE');
    const ready=state.drones.filter(drone=>drone.status==='READY'&&Number(drone.maintenance)>0).length;
    const maintenance=state.drones.filter(drone=>drone.status==='MAINTENANCE'||Number(drone.maintenance)<=0).length;
    const dueSoon=state.drones.filter(drone=>drone.status!=='MAINTENANCE'&&Number(drone.maintenance)>0&&Number(drone.maintenance)<=20).length;
    const avgLink=operational.length?operational.reduce((sum,drone)=>sum+Number(drone.link||0),0)/operational.length:0;
    return `<section class="fleet-command-hero">
      <div class="fleet-hero-copy"><span class="asset-eyebrow">FLIGHT ASSET CONTROL</span><h2>운항·통신·정비 상태를 기체 중심으로 판단</h2><p>운항 중 기체는 실시간 비행수치와 임무를, 대기 기체는 출동준비도와 정비잔여시간을 우선 표시합니다.</p>
        <div class="fleet-hero-stats"><div><span>운항 중</span><strong>${flowFmt1(snapshot.activeDrones.length,'대')}</strong></div><div><span>출동 가능</span><strong>${flowFmt1(ready,'대')}</strong></div><div><span>정비 중</span><strong>${flowFmt1(maintenance,'대')}</strong></div><div><span>정비 예정</span><strong>${flowFmt1(dueSoon,'대')}</strong></div><div><span>평균 통신</span><strong>${flowFmt1(avgLink,'%')}</strong></div></div>
      </div>
      <div class="fleet-radar-graphic"><i></i><i></i><i></i><span class="fleet-radar-sweep"></span>${DRONE_SVG}<b>${flowFmt1(snapshot.activeDrones.length,' LIVE')}</b></div>
    </section>`;
  }

  function fleetCard(drone){
    const mission=missionForDrone(drone.id);
    const battery=flowBattery(drone.batteryId);
    const telemetry=latestTelemetry('droneId',drone.id);
    const tone=droneTone(drone);
    const maintenance=maintenanceMeta(drone);
    const batterySoc=flowRound1(battery?.soc??drone.battery);
    const link=flowRound1(telemetry?.link??drone.link);
    const altitude=flowRound1(telemetry?.altitude??drone.altitude);
    const speed=flowRound1(telemetry?.speed??drone.speed);
    const satellites=flowRound1(telemetry?.satellites??drone.satellites);
    const flightMode=telemetry?.flightMode||drone.flightMode||'-';
    const source=telemetry?.source||(state.settings.mode==='gateway'?'GATEWAY':'SIMULATION');
    const missionProgress=flowRound1(mission?.status==='RETURNING'?mission.returnProgress:mission?.progress||0);
    return `<article class="fleet-aircraft-card ${tone}" data-aircraft-id="${drone.id}">
      <header class="fleet-card-head">
        <div class="fleet-aircraft-id"><span class="fleet-mini-icon">${DRONE_SVG}</span><div><h3>${escapeHtml(drone.name)}</h3><p>${drone.id} · ${escapeHtml(drone.model)}</p></div></div>
        <div class="fleet-head-status">${droneStatusBadge(drone)}<small>${escapeHtml(dataSourceLabel(source))}</small></div>
      </header>
      <div class="fleet-card-main">
        <div class="fleet-visual-column">
          <div class="fleet-airframe-stage"><span class="airframe-orbit one"></span><span class="airframe-orbit two"></span>${DRONE_SVG}<em>${escapeHtml(flightMode)}</em></div>
          <div class="fleet-link-ring" style="--ring-value:${clamp(link,0,100)}"><div><strong>${flowFmt1(link,'%')}</strong><span>통신 품질</span></div></div>
        </div>
        <div class="fleet-telemetry-column">
          <div class="fleet-section-label"><span>LIVE TELEMETRY</span><b>${drone.armed?'ARMED':'DISARMED'}</b></div>
          <div class="fleet-telemetry-grid">
            <div><span>고도</span><strong>${flowFmt1(altitude,'m')}</strong><small>현재 비행고도</small></div>
            <div><span>지상속도</span><strong>${flowFmt1(speed,'km/h')}</strong><small>실시간 이동속도</small></div>
            <div><span>GNSS</span><strong>${flowFmt1(satellites,'개')}</strong><small>수신 위성수</small></div>
            <div><span>배터리</span><strong>${flowFmt1(batterySoc,'%')}</strong><small>${battery?.id||'미장착'}</small></div>
          </div>
          <div class="fleet-location-line"><span>WGS84 위치</span><strong class="mono">${flowFmtCoordinate(drone.lat)} / ${flowFmtCoordinate(drone.lng)}</strong></div>
        </div>
        <div class="fleet-readiness-column">
          <div class="fleet-section-label"><span>ASSET READINESS</span><b class="${maintenance.tone}">${maintenance.label}</b></div>
          <div class="fleet-health-row"><span>정비 잔여</span><strong>${flowFmt1(drone.maintenance,'h')}</strong></div>
          <div class="fleet-health-bar ${maintenance.tone}"><i style="width:${maintenance.percent}%"></i></div>
          <div class="fleet-health-row"><span>누적 비행</span><strong>${flowFmt1(drone.flightHours,'h')}</strong></div>
          <div class="fleet-health-row"><span>배터리 SOC</span><strong>${flowFmt1(batterySoc,'%')}</strong></div>
          <div class="fleet-health-bar energy"><i style="width:${clamp(batterySoc,0,100)}%"></i></div>
        </div>
      </div>
      <div class="fleet-mission-band ${mission?'linked':'empty'}">
        <div class="fleet-mission-symbol">${mission?'↗':'○'}</div>
        <div class="fleet-mission-copy">${mission?`<span>연결 임무 · ${statusLabel(mission.status)}</span><strong>${mission.id} · ${escapeHtml(mission.title)}</strong><small>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)} · ETA ${flowFmt1(mission.etaMin,'분')}</small>`:'<span>연결 임무</span><strong>현재 배정된 임무 없음</strong><small>출동 가능 여부와 정비상태를 확인하십시오.</small>'}</div>
        ${mission?`<div class="fleet-mission-progress"><strong>${flowFmt1(missionProgress,'%')}</strong><div><i style="width:${clamp(missionProgress,0,100)}%"></i></div></div>`:''}
      </div>
      <footer class="fleet-card-foot"><div><span>기체 ID</span><b>${drone.id}</b><span>모델</span><b>${escapeHtml(drone.model)}</b></div><div class="actions"><button class="btn small" data-select-drone="${drone.id}">기체 상세</button>${mission?`<button class="btn small" data-select-mission="${mission.id}" data-go-missions>임무 보기</button>`:''}${['IN_FLIGHT','HOLDING'].includes(drone.status)?`<button class="btn small danger flow-action-btn" data-drone-rth="${drone.id}">긴급 복귀</button>`:''}</div></footer>
    </article>`;
  }

  function batteryHero(){
    const ready=state.batteries.filter(battery=>battery.status==='READY'&&batteryDecision(battery).tone==='ready').length;
    const inUse=state.batteries.filter(battery=>battery.status==='IN_USE').length;
    const charging=state.batteries.filter(battery=>battery.status==='CHARGING').length;
    const blocked=state.batteries.filter(battery=>batteryDecision(battery).tone==='danger').length;
    const avgSoh=state.batteries.length?state.batteries.reduce((sum,battery)=>sum+Number(battery.soh||0),0)/state.batteries.length:0;
    return `<section class="energy-command-hero">
      <div class="energy-hero-copy"><span class="asset-eyebrow">ENERGY & HEALTH CONTROL</span><h2>충전량보다 건전성·셀 균형·임무 적합성을 우선 판단</h2><p>SOC는 에너지 잔량, SOH와 셀 편차는 장기 건전성, 연결 임무는 실제 사용상태로 분리하여 표시합니다.</p>
        <div class="energy-hero-stats"><div><span>사용 중</span><strong>${flowFmt1(inUse,'개')}</strong></div><div><span>투입 가능</span><strong>${flowFmt1(ready,'개')}</strong></div><div><span>충전 중</span><strong>${flowFmt1(charging,'개')}</strong></div><div><span>투입 차단</span><strong>${flowFmt1(blocked,'개')}</strong></div><div><span>평균 SOH</span><strong>${flowFmt1(avgSoh,'%')}</strong></div></div>
      </div>
      <div class="energy-stack-graphic"><span style="--level:92%"></span><span style="--level:67%"></span><span style="--level:41%"></span><div>${BATTERY_SVG}</div><b>ENERGY</b></div>
    </section>`;
  }

  function batteryCard(battery){
    const mission=missionForBattery(battery.id);
    const drone=flowDrone(battery.droneId||mission?.droneId);
    const telemetry=latestTelemetry('batteryId',battery.id);
    const decision=batteryDecision(battery);
    const status=batteryStatus(battery.status);
    const delta=cellDeltaMv(battery);
    const deltaPercent=cellPosition(delta);
    const estimated=flowRound1(Math.max(0,Number(battery.soc||0)*.29));
    const source=telemetry?.source||(state.settings.mode==='gateway'?'GATEWAY':'SIMULATION');
    const soc=flowRound1(battery.soc);
    const soh=flowRound1(battery.soh);
    return `<article class="energy-battery-card ${decision.tone}" data-battery-id="${battery.id}" style="--soc:${clamp(soc,0,100)};--soh:${clamp(soh,0,100)}">
      <header class="energy-card-head"><div><span class="energy-id-icon">${BATTERY_SVG}</span><div><h3>${battery.id}</h3><p>${drone?`${escapeHtml(drone.name)} · ${drone.id} 장착`:'보관 랙 · 미장착'}</p></div></div><span class="energy-decision ${decision.tone}">${decision.label}</span></header>
      <div class="energy-card-main">
        <div class="battery-pack-visual"><div class="battery-terminal"></div><div class="battery-pack-fill"></div><div class="battery-pack-grid"></div><strong>${flowFmt1(soc,'%')}</strong><span>SOC</span></div>
        <div class="energy-primary-data">
          <div class="energy-soh-ring"><div><strong>${flowFmt1(soh,'%')}</strong><span>SOH</span></div></div>
          <div class="energy-primary-copy"><span class="status ${status[1]}">${status[0]}</span><h4>${decision.detail}</h4><p>예상 잔여비행 <strong>${flowFmt1(estimated,'분')}</strong></p><small>데이터 출처 · ${escapeHtml(dataSourceLabel(source))}</small></div>
        </div>
        <div class="energy-condition-panel">
          <div class="energy-condition-row"><div><span>온도</span><strong>${flowFmt1(battery.temp,'℃')}</strong></div><div class="temperature-track"><i style="left:${temperaturePosition(battery.temp)}%"></i></div><small>현재 측정값</small></div>
          <div class="energy-condition-row"><div><span>셀 편차</span><strong>${flowFmt1(delta,'mV')}</strong></div><div class="cell-balance-track ${delta>50?'danger':delta>35?'warning':''}"><i style="width:${Math.min(deltaPercent,100)}%"></i><b></b></div><small>앱 관리 기준 50.0mV</small></div>
          <div class="energy-cycle-row"><div><span>충방전 사이클</span><strong>${flowFmt1(battery.cycles,'회')}</strong></div><div><span>연결 기체</span><strong>${drone?escapeHtml(drone.name):'미장착'}</strong></div></div>
        </div>
      </div>
      <div class="energy-assignment-band ${mission?'linked':'empty'}"><div><span>연결 임무</span><strong>${mission?`${mission.id} · ${escapeHtml(mission.title)}`:'배정된 임무 없음'}</strong><small>${mission?`${statusLabel(mission.status)} · ${escapeHtml(flowCurrentStageName(mission))} · ETA ${flowFmt1(mission.etaMin,'분')}`:'보관·충전·정비 상태를 관리하십시오.'}</small></div>${mission?`<span class="energy-mission-chip">${flowFmt1(mission.progress,'%')}</span>`:''}</div>
      <footer class="energy-card-foot"><div><span>건전성</span><b>${flowFmt1(soh,'%')}</b><span>셀 균형</span><b>${flowFmt1(delta,'mV')}</b></div><div class="actions"><button class="btn small" data-battery-detail="${battery.id}">배터리 상세</button>${mission?`<button class="btn small" data-select-mission="${mission.id}" data-go-missions>임무 보기</button>`:''}${battery.status!=='IN_USE'?`<button class="btn small ${battery.status==='QUARANTINE'?'primary':'danger'} flow-action-btn" data-toggle-battery="${battery.id}">${battery.status==='QUARANTINE'?'격리 해제':'정비 격리'}</button>`:''}</div></footer>
    </article>`;
  }

  function showBatteryDetail(batteryId){
    const battery=flowBattery(batteryId);if(!battery)return;
    const mission=missionForBattery(battery.id);
    const drone=flowDrone(battery.droneId||mission?.droneId);
    const telemetry=latestTelemetry('batteryId',battery.id);
    const decision=batteryDecision(battery);
    const delta=cellDeltaMv(battery);
    const source=telemetry?.source||(state.settings.mode==='gateway'?'GATEWAY':'SIMULATION');
    const receivedAt=telemetry?.recordedAt||telemetry?.receivedAt||null;
    const estimated=flowRound1(Math.max(0,Number(battery.soc||0)*.29));
    $('#modal-root').innerHTML=`<div class="modal-backdrop battery-detail-backdrop"><div class="modal battery-detail-modal" role="dialog" aria-modal="true" aria-labelledby="battery-detail-title" onclick="event.stopPropagation()">
      <div class="modal-head battery-detail-head"><div><div class="battery-detail-title-row"><span>${BATTERY_SVG}</span><div><h2 id="battery-detail-title">${battery.id}</h2><p>${drone?`${escapeHtml(drone.name)} · ${drone.id} 장착`:'보관 랙 · 미장착'}</p></div></div></div><button class="btn icon" data-modal-close aria-label="팝업 닫기">${ICONS.close}</button></div>
      <div class="modal-body battery-detail-body">
        <section class="battery-detail-hero ${decision.tone}" style="--soc:${clamp(battery.soc,0,100)};--soh:${clamp(battery.soh,0,100)}"><div class="battery-pack-visual large"><div class="battery-terminal"></div><div class="battery-pack-fill"></div><div class="battery-pack-grid"></div><strong>${flowFmt1(battery.soc,'%')}</strong><span>SOC</span></div><div><span class="energy-decision ${decision.tone}">${decision.label}</span><h3>${decision.detail}</h3><p>SOH ${flowFmt1(battery.soh,'%')} · 예상 잔여비행 ${flowFmt1(estimated,'분')}</p></div></section>
        <section class="battery-detail-grid">
          <article><header><span>ENERGY</span><h3>에너지 상태</h3></header><div class="battery-detail-metrics"><div><span>SOC</span><strong>${flowFmt1(battery.soc,'%')}</strong></div><div><span>SOH</span><strong>${flowFmt1(battery.soh,'%')}</strong></div><div><span>온도</span><strong>${flowFmt1(battery.temp,'℃')}</strong></div><div><span>예상비행</span><strong>${flowFmt1(estimated,'분')}</strong></div></div></article>
          <article><header><span>HEALTH</span><h3>건전성·셀 균형</h3></header><div class="battery-detail-metrics"><div><span>셀 편차</span><strong>${flowFmt1(delta,'mV')}</strong></div><div><span>관리 기준</span><strong>50.0mV</strong></div><div><span>사이클</span><strong>${flowFmt1(battery.cycles,'회')}</strong></div><div><span>상태</span><strong>${escapeHtml(batteryStatus(battery.status)[0])}</strong></div></div></article>
          <article><header><span>LINK</span><h3>기체·임무 연결</h3></header><div class="battery-detail-metrics"><div><span>장착 기체</span><strong>${drone?escapeHtml(drone.name):'미장착'}</strong></div><div><span>기체 ID</span><strong>${drone?.id||'-'}</strong></div><div class="full"><span>연결 임무</span><strong>${mission?`${mission.id} · ${escapeHtml(mission.title)}`:'배정된 임무 없음'}</strong></div></div></article>
          <article><header><span>DATA</span><h3>데이터 신뢰성</h3></header><div class="battery-detail-metrics"><div><span>데이터 출처</span><strong>${escapeHtml(dataSourceLabel(source))}</strong></div><div><span>최종 수신</span><strong>${receivedAt?fmtDateTime(receivedAt):'기록 없음'}</strong></div><div><span>연결 상태</span><strong>${mission?statusLabel(mission.status):'대기'}</strong></div><div><span>현재 단계</span><strong>${mission?escapeHtml(flowCurrentStageName(mission)):'-'}</strong></div></div></article>
        </section>
      </div>
      <div class="modal-foot battery-detail-foot"><button class="btn" data-modal-close>닫기</button>${mission?`<button class="btn primary" data-select-mission="${mission.id}" data-go-missions>임무 상세보기</button>`:''}</div>
    </div></div>`;
  }

  flowFleetView=function flowFleetViewVisual(){
    const snapshot=typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot():{activeDrones:state.drones.filter(drone=>['IN_FLIGHT','HOLDING','RETURNING','LANDING'].includes(drone.status))};
    const rank={active:0,ready:1,maintenance:2};
    const drones=[...state.drones].sort((a,b)=>rank[droneTone(a)]-rank[droneTone(b)]||a.id.localeCompare(b.id));
    return `${pageHead('드론 운항·정비 관리','기체의 실시간 비행상태, 임무 연결, 통신과 정비 잔여시간을 한 화면에서 판단합니다.')} ${fleetHero(snapshot)}<section class="fleet-card-grid">${drones.map(fleetCard).join('')}</section>`;
  };

  flowBatteryView=function flowBatteryViewVisual(){
    const rank={active:0,ready:1,warning:2,danger:3};
    const batteries=[...state.batteries].sort((a,b)=>rank[batteryDecision(a).tone]-rank[batteryDecision(b).tone]||a.id.localeCompare(b.id));
    return `${pageHead('배터리 에너지·건전성 관리','SOC·SOH·온도·셀 편차·사이클과 실제 임무 사용상태를 에너지 관점으로 관리합니다.')} ${batteryHero()}<section class="energy-card-grid">${batteries.map(batteryCard).join('')}</section>`;
  };

  fleetView=flowFleetView;
  batteryView=flowBatteryView;

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-battery-detail]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    showBatteryDetail(button.dataset.batteryDetail);
  },true);
})();
