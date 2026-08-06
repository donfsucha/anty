'use strict';

/* Compact, decision-oriented drone quick detail. */
(function enhanceDroneQuickDetail(){
  function latestTelemetryFor(droneId){
    const rows=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){if(rows[index].droneId===droneId)return rows[index];}
    return null;
  }
  function latestCommandFor(droneId){
    const rows=Array.isArray(state.commandLogs)?state.commandLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){if(rows[index].droneId===droneId)return rows[index];}
    return null;
  }
  function secondsSince(value){
    if(!value)return null;
    const time=new Date(value).getTime();
    return Number.isFinite(time)?flowRound1(Math.max(0,(Date.now()-time)/1000)):null;
  }
  function sourceLabel(source){return ({SIMULATION:'시뮬레이션',GATEWAY:'실기체 게이트웨이',SYSTEM:'시스템',MANUAL:'수동 입력'})[source]||source||'데이터 없음';}
  function valueFromTelemetry(telemetry,keys,fallback){
    for(const key of keys){if(telemetry&&telemetry[key]!==undefined&&telemetry[key]!==null)return telemetry[key];}
    return fallback;
  }
  function aircraftCondition(drone,battery,ageSec,live){
    if(drone.status==='MAINTENANCE'||(!drone.armed&&drone.flightMode==='OFFLINE'))return ['운항 차단','red','정비 또는 오프라인 상태'];
    if(battery?.status==='QUARANTINE'||Number(battery?.soh)<85||Number(battery?.cellDiff)>.05)return ['점검 필요','red','배터리 건전성 기준 확인'];
    if(Number(live.link)<65||Number(live.batterySoc)<30||(ageSec!==null&&ageSec>15))return ['주의 확인','amber','통신·배터리·수신시각 확인'];
    return [drone.status==='READY'?'출동 가능':'운항 정상','green','현재 운항 기준 정상'];
  }
  function sectionHead(index,title,description,badge=''){
    return `<div class="drone-detail-section-head"><div class="drone-section-title"><span class="section-index">${index}</span><div><h3>${title}</h3><p>${description}</p></div></div>${badge}</div>`;
  }

  flowShowDroneDetail=function flowShowDroneDetailEnhanced(droneId){
    if(typeof flowReconcileState==='function')flowReconcileState();
    const drone=flowDrone(droneId);if(!drone)return;
    const battery=flowBattery(drone.batteryId);
    const snapshot=typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot():null;
    const activePair=snapshot?.pairs?.find(item=>item.drone?.id===drone.id);
    const mission=activePair?.mission||state.missions.find(item=>item.droneId===drone.id&&!['COMPLETED','CANCELLED'].includes(item.status));
    const telemetry=latestTelemetryFor(drone.id);
    const command=latestCommandFor(drone.id);
    const receivedAt=telemetry?.recordedAt||telemetry?.receivedAt||null;
    const ageSec=secondsSince(receivedAt);
    const source=telemetry?.source||(state.settings.mode==='gateway'?'GATEWAY':'SIMULATION');
    const live={
      altitude:flowRound1(valueFromTelemetry(telemetry,['altitude','altitudeM'],drone.altitude)),
      speed:flowRound1(valueFromTelemetry(telemetry,['speed','groundSpeedKmh'],drone.speed)),
      batterySoc:flowRound1(valueFromTelemetry(telemetry,['battery','batterySocPct'],battery?.soc||drone.battery)),
      temperature:flowRound1(valueFromTelemetry(telemetry,['temperature','batteryTempC'],battery?.temp||0)),
      link:flowRound1(valueFromTelemetry(telemetry,['link','linkQualityPct'],drone.link)),
      satellites:flowRound1(valueFromTelemetry(telemetry,['satellites'],drone.satellites)),
      flightMode:valueFromTelemetry(telemetry,['flightMode'],drone.flightMode||'-'),
      lat:valueFromTelemetry(telemetry,['lat'],drone.lat),
      lng:valueFromTelemetry(telemetry,['lng'],drone.lng)
    };
    const [conditionLabel,conditionTone,conditionReason]=aircraftCondition(drone,battery,ageSec,live);
    const batteryState=battery?batteryStatus(battery.status):['미장착','gray'];
    const commandName=command?(FLOW_ACTION_LABELS[command.action]||command.action||'-'):'기록 없음';
    const commandTime=command?.appliedAt||command?.acknowledgedAt||command?.requestedAt||null;
    const missionStage=mission?flowCurrentStageName(mission):'연결 임무 없음';
    const missionNext=mission?flowNextAction(mission):'관제센터에서 신규 임무를 배정하십시오.';
    const currentStatus=activePair?(STATUS[activePair.mission.status]?.[0]||activePair.mission.status):(STATUS[drone.status]?.[0]||drone.status);

    $('#modal-root').innerHTML=`<div class="modal-backdrop drone-detail-backdrop"><div class="modal drone-detail-modal" role="dialog" aria-modal="true" aria-labelledby="drone-detail-title" onclick="event.stopPropagation()">
      <div class="modal-head drone-detail-head"><div><div class="drone-detail-title-row"><h2 id="drone-detail-title">${escapeHtml(drone.name)}</h2><span class="status ${conditionTone}">${conditionLabel}</span></div><p>${drone.id} · ${escapeHtml(drone.model)} · ${escapeHtml(conditionReason)}</p></div><button class="btn icon" data-modal-close aria-label="팝업 닫기">${ICONS.close}</button></div>

      <div class="modal-body drone-detail-body">
        <section class="drone-live-strip ${ageSec!==null&&ageSec>15?'stale':''}">
          <div><span>데이터 출처</span><strong>${escapeHtml(sourceLabel(source))}</strong></div>
          <div><span>최종 수신</span><strong>${receivedAt?fmtDateTime(receivedAt):'수신 기록 없음'}</strong></div>
          <div><span>데이터 신선도</span><strong>${ageSec===null?'-':flowFmt1(ageSec,'초 전')}</strong></div>
          <div><span>최근 명령</span><strong>${escapeHtml(commandName)}</strong><small>${commandTime?fmtDateTime(commandTime):''}</small></div>
        </section>

        <section class="drone-detail-section flight-status-section">
          ${sectionHead('01','실시간 비행 상태','현재 텔레메트리와 비행제어 상태',`<span class="status ${live.link>=80?'green':live.link>=65?'amber':'red'}">통신 ${flowFmt1(live.link,'%')}</span>`)}
          <div class="drone-detail-grid">
            <div class="drone-detail-item"><span>기체 상태</span><strong>${escapeHtml(currentStatus)}</strong></div>
            <div class="drone-detail-item"><span>비행모드 / Armed</span><strong>${escapeHtml(live.flightMode)} · ${drone.armed?'ARMED':'DISARMED'}</strong></div>
            <div class="drone-detail-item"><span>고도</span><strong>${flowFmt1(live.altitude,'m')}</strong></div>
            <div class="drone-detail-item"><span>지상속도</span><strong>${flowFmt1(live.speed,'km/h')}</strong></div>
            <div class="drone-detail-item"><span>통신품질</span><strong>${flowFmt1(live.link,'%')}</strong></div>
            <div class="drone-detail-item"><span>GNSS 위성</span><strong>${flowFmt1(live.satellites,'개')}</strong></div>
            <div class="drone-detail-item full"><span>현재 위치 · WGS84</span><strong class="mono">${flowFmtCoordinate(live.lat)} / ${flowFmtCoordinate(live.lng)}</strong></div>
          </div>
        </section>

        <section class="drone-detail-section energy-status-section">
          ${sectionHead('02','배터리·정비 상태','임무 지속 가능성과 예방정비 판단',`<span class="status ${batteryState[1]}">${batteryState[0]}</span>`)}
          <div class="drone-detail-grid">
            <div class="drone-detail-item"><span>배터리 ID</span><strong>${battery?.id||'미장착'}</strong></div>
            <div class="drone-detail-item"><span>SOC</span><strong>${flowFmt1(live.batterySoc,'%')}</strong></div>
            <div class="drone-detail-item"><span>SOH</span><strong>${battery?flowFmt1(battery.soh,'%'):'-'}</strong></div>
            <div class="drone-detail-item"><span>온도</span><strong>${flowFmt1(live.temperature,'℃')}</strong></div>
            <div class="drone-detail-item"><span>셀 편차</span><strong>${battery?flowFmt1(battery.cellDiff*1000,'mV'):'-'}</strong></div>
            <div class="drone-detail-item"><span>충방전 사이클</span><strong>${battery?flowFmt1(battery.cycles,'회'):'-'}</strong></div>
            <div class="drone-detail-item"><span>예상 잔여비행</span><strong>${flowFmt1(Math.max(0,live.batterySoc*.29),'분')}</strong></div>
            <div class="drone-detail-item"><span>누적 비행시간</span><strong>${flowFmt1(drone.flightHours,'h')}</strong></div>
            <div class="drone-detail-item full"><span>정비 잔여시간</span><strong>${flowFmt1(drone.maintenance,'h')}</strong></div>
          </div>
        </section>

        <section class="drone-detail-section mission-link-section">
          ${sectionHead('03','연결 임무','임무 진행상태와 다음 수행 작업',mission?statusBadge(mission.status):'<span class="status gray">미배정</span>')}
          ${mission?`<div class="mission-link-title"><strong>${mission.id} · ${escapeHtml(mission.title)}</strong><span>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)}</span></div>
          <div class="drone-detail-grid mission-grid">
            <div class="drone-detail-item"><span>현재 단계</span><strong>${escapeHtml(missionStage)}</strong></div>
            <div class="drone-detail-item"><span>진행률</span><strong>${flowFmt1(mission.progress,'%')}</strong></div>
            <div class="drone-detail-item"><span>ETA</span><strong>${flowFmt1(mission.etaMin,'분')}</strong></div>
            <div class="drone-detail-item"><span>조종자</span><strong>${escapeHtml(mission.pilot||'미배정')}</strong></div>
            <div class="drone-detail-item"><span>화물</span><strong>${escapeHtml(mission.cargo)}</strong></div>
            <div class="drone-detail-item"><span>중량</span><strong>${flowFmt1(mission.payloadKg,'kg')}</strong></div>
            <div class="drone-detail-item full next-work-item"><span>다음 작업</span><strong>${escapeHtml(missionNext)}</strong></div>
          </div>`:`<div class="drone-detail-empty">현재 연결된 배송임무가 없습니다.</div>`}
        </section>
      </div>

      <div class="modal-foot drone-detail-foot"><button class="btn" data-modal-close>닫기</button>${mission?`<button class="btn primary" data-select-mission="${mission.id}" data-go-missions>임무 상세보기</button>`:''}</div>
    </div></div>`;
  };
})();
