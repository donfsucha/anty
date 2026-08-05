'use strict';

/* Derived reports and precision-safe battery diagnostics. */
(function installDataQualityLayer(){
  const demoCellDeltaV={'BAT-001':0.018,'BAT-002':0.025,'BAT-003':0.012,'BAT-004':0.031,'BAT-005':0.015,'BAT-006':0.068};

  function initializeCellDelta(battery){
    const current=Number(battery._cellDiffRaw);
    if(Number.isFinite(current)&&current>=0)return;
    const stored=Number(battery.cellDiff);
    if(Number.isFinite(stored)&&stored>0&&stored<1)battery._cellDiffRaw=stored;
    else if(Number.isFinite(Number(battery.cellDiffMv)))battery._cellDiffRaw=Number(battery.cellDiffMv)/1000;
    else battery._cellDiffRaw=demoCellDeltaV[battery.id]??0;
  }
  function restoreCellDelta(){
    state.batteries.forEach(battery=>{
      initializeCellDelta(battery);
      battery.cellDiff=battery._cellDiffRaw;
      battery.cellDiffMv=flowRound1(battery._cellDiffRaw*1000);
    });
  }
  window.flowCellDeltaMv=function flowCellDeltaMv(battery){
    if(!battery)return 0;
    initializeCellDelta(battery);
    return flowRound1(battery._cellDiffRaw*1000);
  };

  restoreCellDelta();
  const previousEnsure=flowEnsureState;
  flowEnsureState=function ensurePrecisionState(){restoreCellDelta();const result=previousEnsure();restoreCellDelta();return result;};
  const previousPersist=persist;
  persist=function persistPrecisionState(){restoreCellDelta();const result=previousPersist();restoreCellDelta();try{localStorage.setItem(APP_KEY,JSON.stringify(state));}catch{}return result;};

  function derivedReportMetrics(){
    const snapshot=typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot():{activeMissions:getActiveMissions(),activeDrones:[],activeBatteries:[]};
    const missions=state.missions.filter(mission=>mission.status!=='CANCELLED');
    const completed=missions.filter(mission=>mission.status==='COMPLETED');
    const proofMissionIds=new Set(state.proofs.map(proof=>proof.missionId));
    const completedWithProof=completed.filter(mission=>proofMissionIds.has(mission.id));
    const acknowledged=state.alerts.filter(alert=>alert.ack).length;
    return {
      total:missions.length,completed:completed.length,active:snapshot.activeMissions.length,
      activeDrones:snapshot.activeDrones.length,completionRate:missions.length?completed.length/missions.length*100:0,
      proofRate:completed.length?completedWithProof.length/completed.length*100:0,
      alertResolutionRate:state.alerts.length?acknowledged/state.alerts.length*100:100,
      commandCount:(state.commandLogs||[]).length,operationCount:(state.operations||[]).length,
      issueCount:state.consistencyAudit?.issues?.length||0
    };
  }
  function dateKey(value){
    const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function lastSevenDays(){
    const rows=[];
    for(let offset=6;offset>=0;offset-=1){
      const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-offset);
      const key=dateKey(date);
      rows.push({key,label:new Intl.DateTimeFormat('ko-KR',{weekday:'short'}).format(date),count:state.missions.filter(mission=>mission.status==='COMPLETED'&&dateKey(mission.completedAt)===key).length});
    }
    return rows;
  }

  flowBatteryView=function flowBatteryViewQuality(){
    if(typeof flowReconcileState==='function')flowReconcileState();restoreCellDelta();
    return `${pageHead('스마트배터리','통합관제와 동일한 임무 연결 상태와 정밀 셀 편차를 표시합니다.')}<section class="grid entity-grid">${state.batteries.map(battery=>{const status=batteryStatus(battery.status);const mission=state.missions.find(item=>item.batteryId===battery.id&&!['COMPLETED','CANCELLED'].includes(item.status));const cellMv=flowCellDeltaMv(battery);const risk=battery.soh<85||cellMv>50||battery.status==='QUARANTINE';return `<article class="entity"><div class="entity-top"><div><h3>${battery.id}</h3><p>${battery.droneId?`${battery.droneId} 장착`:'보관 랙'}</p></div><span class="status ${risk?'red':status[1]}">${risk?'점검 필요':status[0]}</span></div><div class="metric-row"><div class="metric"><span>SOC</span><strong>${flowFmt1(battery.soc,'%')}</strong></div><div class="metric"><span>SOH</span><strong>${flowFmt1(battery.soh,'%')}</strong></div><div class="metric"><span>온도</span><strong>${flowFmt1(battery.temp,'℃')}</strong></div><div class="metric"><span>사이클</span><strong>${flowFmt1(battery.cycles,'회')}</strong></div><div class="metric"><span>셀 편차</span><strong>${flowFmt1(cellMv,'mV')}</strong></div><div class="metric"><span>예상비행</span><strong>${flowFmt1(Math.max(0,battery.soc*.29),'분')}</strong></div></div><div class="bar ${risk?'danger':battery.soc<55?'warning':''}"><span style="width:${battery.soc}%"></span></div><div class="flow-entity-link"><span>연결 임무</span><strong>${mission?`${mission.id} · ${escapeHtml(mission.title)} · ${STATUS[mission.status]?.[0]||mission.status}`:'배정된 임무 없음'}</strong></div>${battery.status!=='IN_USE'?`<div class="actions" style="margin-top:13px"><button class="btn small ${battery.status==='QUARANTINE'?'primary':'danger'} flow-action-btn" data-toggle-battery="${battery.id}">${battery.status==='QUARANTINE'?'격리 해제':'정비 격리'}</button></div>`:''}</article>`}).join('')}</section>`;
  };

  flowReportsView=function flowReportsViewDerived(){
    const metrics=derivedReportMetrics();const daily=lastSevenDays();const max=Math.max(1,...daily.map(item=>item.count));
    return `${pageHead('운영리포트','현재 저장된 임무·명령·경보·증빙 데이터만으로 지표를 계산합니다.',`<button class="btn" data-print>인쇄</button><button class="btn primary" data-export-report>${ICONS.download} 리포트 CSV</button>`)}<section class="grid kpi-grid"><article class="kpi"><div class="kpi-label">임무 완료율</div><div class="kpi-value">${flowFmt1(metrics.completionRate,'%')}</div><div class="kpi-foot">완료 ${flowFmt1(metrics.completed,'건')} / 전체 ${flowFmt1(metrics.total,'건')}</div></article><article class="kpi"><div class="kpi-label">현재 운항</div><div class="kpi-value">${flowFmt1(metrics.activeDrones,'대')}</div><div class="kpi-foot">수행 임무 ${flowFmt1(metrics.active,'건')}</div></article><article class="kpi"><div class="kpi-label">배송증빙 생성률</div><div class="kpi-value">${flowFmt1(metrics.proofRate,'%')}</div><div class="kpi-foot">완료 임무 기준</div></article><article class="kpi"><div class="kpi-label">경보 조치율</div><div class="kpi-value">${flowFmt1(metrics.alertResolutionRate,'%')}</div><div class="kpi-foot">누적 ${flowFmt1(state.alerts.length,'건')}</div></article></section><section class="grid dashboard-grid"><article class="card"><div class="card-head"><div><h2>최근 7일 완료 임무</h2><p>완료시각 기준 실제 저장 건수</p></div></div><div class="chart">${daily.map(item=>`<div class="chart-col"><div class="chart-bar" style="height:${item.count/max*100}%" title="${flowFmt1(item.count,'건')}"></div><strong class="chart-value">${flowFmt1(item.count,'건')}</strong><small>${item.label}</small></div>`).join('')}</div></article><article class="card"><div class="card-head"><div><h2>데이터 품질 요약</h2><p>페이지 간 동일 상태 기준 점검</p></div></div><div class="card-body report-quality-list"><div><span>명령 기록</span><strong>${flowFmt1(metrics.commandCount,'건')}</strong></div><div><span>작업 수행 기록</span><strong>${flowFmt1(metrics.operationCount,'건')}</strong></div><div><span>상태 불일치</span><strong class="${metrics.issueCount?'warning-text':''}">${flowFmt1(metrics.issueCount,'건')}</strong></div><div><span>최종 점검시각</span><strong>${fmtDateTime(state.consistencyAudit?.checkedAt||flowNow())}</strong></div></div></article></section>`;
  };

  function exportDerivedReport(){
    const metrics=derivedReportMetrics();const snapshot=flowOperationalSnapshot();
    const rows=[['생성시각','전체 임무','완료 임무','수행 중 임무','운항 중 드론','완료율(%)','증빙 생성률(%)','경보 조치율(%)','명령 기록','작업 기록','상태 불일치'],[flowNow(),metrics.total,metrics.completed,metrics.active,metrics.activeDrones,flowRound1(metrics.completionRate),flowRound1(metrics.proofRate),flowRound1(metrics.alertResolutionRate),metrics.commandCount,metrics.operationCount,metrics.issueCount]];
    download(`DLOGIS_report_${new Date().toISOString().slice(0,10)}.csv`,csv(rows),'text/csv;charset=utf-8');toast('운영리포트 생성 완료','현재 저장 데이터 기준으로 CSV를 생성했습니다.','success');
  }

  const previousTopbar=topbar;
  topbar=function topbarWithConsistency(){
    const html=previousTopbar();const issueCount=state.consistencyAudit?.issues?.length||0;
    if(!issueCount)return html;
    return html.replace('class="live-pill"','class="live-pill warning"').replace('시스템 정상',`상태 확인 ${issueCount}건`);
  };

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-export-report]');if(!button)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();exportDerivedReport();
  },true);

  restoreCellDelta();
})();
