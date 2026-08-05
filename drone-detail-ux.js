'use strict';

/*
 * Drone quick-detail panel.
 * Shows the minimum operational data needed to judge current condition and
 * navigate to the connected mission without duplicating the full mission page.
 */
(function enhanceDroneQuickDetail(){
  function latestTelemetryFor(droneId){
    const rows=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){
      if(rows[index].droneId===droneId)return rows[index];
    }
    return null;
  }

  function latestCommandFor(droneId){
    const rows=Array.isArray(state.commandLogs)?state.commandLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){
      if(rows[index].droneId===droneId)return rows[index];
    }
    return null;
  }

  function secondsSince(value){
    if(!value)return null;
    const time=new Date(value).getTime();
    return Number.isFinite(time)?flowRound1(Math.max(0,(Date.now()-time)/1000)):null;
  }

  function sourceLabel(source){
    return ({SIMULATION:'시뮬레이션',GATEWAY:'실기체 게이트웨이',SYSTEM:'시스템',MANUAL:'수동 입력'})[source]||source||'데이터 없음';
  }

  function aircraftCondition(drone,battery,ageSec){
    if(drone.status==='MAINTENANCE'||!drone.armed&&drone.flightMode==='OFFLINE')return ['운항 차단','red'];
    if(battery?.status==='QUARANTINE'||Number(battery?.soh)<85||Number(battery?.cellDiff)>.05)return ['점검 필요','red'];
    if(Number(drone.link)<65||Number(battery?.soc)<30||(ageSec!==null&&ageSec>15))return ['주의 확인','amber'];
    return [drone.status==='READY'?'출동 가능':'운항 정상','green'];
  }

  flowShowDroneDetail=function flowShowDroneDetailEnhanced(droneId){
    const drone=flowDrone(droneId);if(!drone)return;
    const battery=flowBattery(drone.batteryId);
    const mission=state.missions.find(item=>item.droneId===drone.id&&!['COMPLETED','CANCELLED'].includes(item.status));
    const telemetry=latestTelemetryFor(drone.id);
    const command=latestCommandFor(drone.id);
    const receivedAt=telemetry?.recordedAt||telemetry?.receivedAt||null;
    const ageSec=secondsSince(receivedAt);
    const source=telemetry?.source||(state.settings.mode==='gateway'?'GATEWAY':'SIMULATION');
    const [conditionLabel,conditionTone]=aircraftCondition(drone,battery,ageSec);
    const batteryState=battery?batteryStatus(battery.status):['미장착','gray'];
    const commandName=command?(FLOW_ACTION_LABELS[command.action]||command.action||'-'):'기록 없음';
    const commandTime=command?.appliedAt||command?.acknowledgedAt||command?.requestedAt||null;
    const missionStage=mission?flowCurrentStageName(mission):'연결 임무 없음';
    const missionNext=mission?flowNextAction(mission):'관제센터에서 신규 임무를 배정하십시오.';

    $('#modal-root').innerHTML=`<div class="modal-backdrop drone-detail-backdrop"><div class="modal drone-detail-modal" role="dialog" aria-modal="true" aria-labelledby="drone-detail-title" onclick="event.stopPropagation()">
      <div class="modal-head drone-detail-head"><div><div class="drone-detail-title-row"><h2 id="drone-detail-title">${escapeHtml(drone.name)}</h2><span class="status ${conditionTone}">${conditionLabel}</span></div><p>${drone.id} · ${escapeHtml(drone.model)} · 기체 실시간 상태 요약</p></div><button class="btn icon" data-modal-close aria-label="팝업 닫기">${ICONS.close}</button></div>

      <div class="modal-body drone-detail-body">
        <section class="drone-live-strip ${ageSec!==null&&ageSec>15?'stale':''}">
          <div><span>데이터 출처</span><strong>${escapeHtml(sourceLabel(source))}</strong></div>
          <div><span>최종 수신</span><strong>${receivedAt?fmtDateTime(receivedAt):'수신 기록 없음'}</strong></div>
          <div><span>데이터 신선도</span><strong>${ageSec===null?'-':flowFmt1(ageSec,'초 전')}</strong></div>
          <div><span>최근 명령</span><strong>${escapeHtml(commandName)}</strong><small>${commandTime?fmtDateTime(commandTime):''}</small></div>
        </section>

        <section class="drone-detail-section"><div class="drone-detail-section-head"><div><h3>실시간 비행 상태</h3><p>현재 텔레메트리와 비행제어 상태</p></div><span class="status ${drone.link>=80?'green':drone.link>=65?'amber':'red'}">통신 ${flowFmt1(drone.link,'%')}</span></div>
          <div class="drone-detail-grid">
            <div class="drone-detail-item"><span>기체 상태</span><strong>${STATUS[drone.status]?.[0]||escapeHtml(drone.status)}</strong></div>
            <div class="drone-detail-item"><span>비행모드 / Armed</span><strong>${escapeHtml(drone.flightMode||'-')} · ${drone.armed?'ARMED':'DISARMED'}</strong></div>
            <div class="drone-detail-item"><span>고도 / 지상속도</span><strong>${flowFmt1(drone.altitude,'m')} · ${flowFmt1(drone.speed,'km/h')}</strong></div>
            <div class="drone-detail-item"><span>통신 / GNSS</span><strong>${flowFmt1(drone.link,'%')} · ${flowFmt1(drone.satellites,'개')}</strong></div>
            <div class="drone-detail-item full"><span>현재 위치 · WGS84</span><strong class="mono">${flowFmtCoordinate(drone.lat)} / ${flowFmtCoordinate(drone.lng)}</strong></div>
          </div>
        </section>

        <section class="drone-detail-section"><div class="drone-detail-section-head"><div><h3>배터리·정비 상태</h3><p>임무 지속 가능성과 예방정비 판단 데이터</p></div><span class="status ${batteryState[1]}">${batteryState[0]}</span></div>
          <div class="drone-detail-grid three">
            <div class="drone-detail-item"><span>배터리 / SOC</span><strong>${battery?`${battery.id} · ${flowFmt1(battery.soc,'%')}`:'미장착'}</strong></div>
            <div class="drone-detail-item"><span>SOH / 온도</span><strong>${battery?`${flowFmt1(battery.soh,'%')} · ${flowFmt1(battery.temp,'℃')}`:'-'}</strong></div>
            <div class="drone-detail-item"><span>셀 편차 / 사이클</span><strong>${battery?`${flowFmt1(battery.cellDiff*1000,'mV')} · ${flowFmt1(battery.cycles,'회')}`:'-'}</strong></div>
            <div class="drone-detail-item"><span>예상 잔여비행</span><strong>${battery?flowFmt1(Math.max(0,battery.soc*.29),'분'):'-'}</strong></div>
            <div class="drone-detail-item"><span>누적 비행시간</span><strong>${flowFmt1(drone.flightHours,'h')}</strong></div>
            <div class="drone-detail-item"><span>정비 잔여시간</span><strong>${flowFmt1(drone.maintenance,'h')}</strong></div>
          </div>
        </section>

        <section class="drone-detail-section mission-link-section"><div class="drone-detail-section-head"><div><h3>연결 임무</h3><p>임무 진행상태와 다음 수행 작업</p></div>${mission?statusBadge(mission.status):'<span class="status gray">미배정</span>'}</div>
          ${mission?`<div class="mission-link-title"><strong>${mission.id} · ${escapeHtml(mission.title)}</strong><span>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)}</span></div>
          <div class="drone-detail-grid three">
            <div class="drone-detail-item"><span>현재 단계</span><strong>${escapeHtml(missionStage)}</strong></div>
            <div class="drone-detail-item"><span>진행률 / ETA</span><strong>${flowFmt1(mission.progress,'%')} · ${flowFmt1(mission.etaMin,'분')}</strong></div>
            <div class="drone-detail-item"><span>조종자</span><strong>${escapeHtml(mission.pilot||'미배정')}</strong></div>
            <div class="drone-detail-item"><span>화물 / 중량</span><strong>${escapeHtml(mission.cargo)} · ${flowFmt1(mission.payloadKg,'kg')}</strong></div>
            <div class="drone-detail-item full"><span>다음 작업</span><strong>${escapeHtml(missionNext)}</strong></div>
          </div>`:`<div class="drone-detail-empty">현재 연결된 배송임무가 없습니다.</div>`}
        </section>
      </div>

      <div class="modal-foot drone-detail-foot"><button class="btn" data-modal-close>닫기</button>${mission?`<button class="btn primary" data-select-mission="${mission.id}" data-go-missions>임무 상세보기</button>`:''}</div>
    </div></div>`;
  };
})();
