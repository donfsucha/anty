'use strict';

/*
 * Mission-only status taxonomy and repeat-from-history workflow.
 * Completed records stay immutable. Repeating a prior run always creates a new
 * Mission ID, resets approval/verification/flight state, and keeps lineage to
 * the original mission for audit and reporting.
 */
(function installMissionRepeatWorkflow(){
  const VERSION='1.0.0';
  const ACTIVE_STATUSES=new Set(['READY','APPROVED','IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);
  const ARCHIVE_STATUSES=new Set(['COMPLETED','CANCELLED']);
  const MISSION_STATUS_GROUPS=[
    {label:'준비 단계',items:[
      {code:'READY',label:'승인 대기',tone:'gray'},
      {code:'APPROVED',label:'승인 완료·출동 준비',tone:'blue'}
    ]},
    {label:'운항 단계',items:[
      {code:'IN_FLIGHT',label:'배송 운항',tone:'green'},
      {code:'HOLDING',label:'일시 대기',tone:'amber'},
      {code:'DELIVERED',label:'배송 완료·복귀 준비',tone:'blue'},
      {code:'RETURNING',label:'복귀 운항',tone:'amber'},
      {code:'LANDING',label:'착륙·종료 처리',tone:'amber'}
    ]},
    {label:'종료 이력',items:[
      {code:'COMPLETED',label:'임무 종료',tone:'green'},
      {code:'CANCELLED',label:'취소',tone:'red'}
    ]}
  ];
  const MISSION_STATUS_ITEMS=MISSION_STATUS_GROUPS.flatMap(group=>group.items);
  const MISSION_STATUS_MAP=new Map(MISSION_STATUS_ITEMS.map(item=>[item.code,item]));
  const REPEATABLE_STATUSES=new Set(['COMPLETED','CANCELLED']);
  const ROUTE_COPY_FIELDS=['originLat','originLng','destinationLat','destinationLng','routeId','maxAltitudeM','serviceType','temperatureRequirement','notes'];
  const baseMissionDetail=flowMissionDetail;
  const baseMissionButtons=flowMissionButtons;
  const baseAssignResources=flowAssignResources;

  function uiState(){
    state.flowUi=state.flowUi&&typeof state.flowUi==='object'?state.flowUi:{};
    const scope=state.flowUi.missionScope;
    state.flowUi.missionScope=['ALL','ACTIVE','ARCHIVE'].includes(scope)?scope:'ALL';
    return state.flowUi;
  }

  function missionStatusItem(code){
    return MISSION_STATUS_MAP.get(code)||{code,label:`상태 확인 필요 · ${code||'-'}`,tone:'red'};
  }

  function missionStatusLabel(code){return missionStatusItem(code).label;}

  function missionStatusBadge(code){
    const item=missionStatusItem(code);
    return `<span class="status ${item.tone} mission-status-badge" data-mission-status-code="${escapeHtml(item.code)}">${escapeHtml(item.label)}</span>`;
  }

  function validMissionStatus(code){return code==='ALL'||MISSION_STATUS_MAP.has(code);}

  function scopeMatches(mission,scope){
    if(scope==='ACTIVE')return ACTIVE_STATUSES.has(mission.status);
    if(scope==='ARCHIVE')return ARCHIVE_STATUSES.has(mission.status);
    return true;
  }

  function normalizeFilters(){
    const ui=uiState();
    if(!validMissionStatus(missionStatus))missionStatus='ALL';
    if(ui.missionScope==='ACTIVE'&&ARCHIVE_STATUSES.has(missionStatus))missionStatus='ALL';
    if(ui.missionScope==='ARCHIVE'&&ACTIVE_STATUSES.has(missionStatus))missionStatus='ALL';
    return ui;
  }

  function statusOptions(){
    return `<option value="ALL" ${missionStatus==='ALL'?'selected':''}>전체 임무 상태</option>${MISSION_STATUS_GROUPS.map(group=>`<optgroup label="${escapeHtml(group.label)}">${group.items.map(item=>`<option value="${item.code}" ${missionStatus===item.code?'selected':''}>${escapeHtml(item.label)}</option>`).join('')}</optgroup>`).join('')}`;
  }

  function missionDateValue(mission){
    const raw=mission.completedAt||mission.cancelledAt||mission.deliveredAt||mission.departedAt||mission.createdAt;
    const value=new Date(raw||0).getTime();
    return Number.isFinite(value)?value:0;
  }

  function orderMissions(rows,scope){
    return [...rows].sort((a,b)=>{
      if(scope==='ALL'){
        const aArchive=ARCHIVE_STATUSES.has(a.status)?1:0;
        const bArchive=ARCHIVE_STATUSES.has(b.status)?1:0;
        if(aArchive!==bArchive)return aArchive-bArchive;
      }
      return missionDateValue(b)-missionDateValue(a);
    });
  }

  function missionSearchText(mission){
    return [mission.id,mission.orderNo,mission.title,mission.origin,mission.destination,mission.cargo,mission.recipient,mission.repeatOfMissionId,mission.rootMissionId]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function repeatChildren(missionId){return state.missions.filter(item=>item.repeatOfMissionId===missionId).length;}

  function repeatSequenceFor(mission){
    if(Number.isFinite(Number(mission.repeatSequence)))return Number(mission.repeatSequence);
    return mission.repeatOfMissionId?2:1;
  }

  function repeatChip(mission){
    if(!mission.repeatOfMissionId)return '';
    return `<span class="mission-repeat-chip">재수행 ${repeatSequenceFor(mission)}회차</span>`;
  }

  function scopeTabs(scope,activeCount,archiveCount){
    const tabs=[
      {code:'ALL',label:'전체 임무',count:state.missions.length},
      {code:'ACTIVE',label:'진행·대기',count:activeCount},
      {code:'ARCHIVE',label:'완료 이력',count:archiveCount}
    ];
    return `<div class="mission-scope-bar"><div class="mission-scope-tabs" role="tablist" aria-label="배송임무 범위">${tabs.map(tab=>`<button type="button" role="tab" aria-selected="${scope===tab.code?'true':'false'}" class="mission-scope-tab ${scope===tab.code?'active':''}" data-mission-scope="${tab.code}"><span>${tab.label}</span><b>${flowFmt1(tab.count,'건')}</b></button>`).join('')}</div><p>상태는 배송임무의 실제 진행 순서만 표시합니다. 기체·배터리 상태는 포함하지 않습니다.</p></div>`;
  }

  function archiveTime(mission){
    const value=mission.completedAt||mission.cancelledAt||mission.deliveredAt||mission.createdAt;
    return value?fmtDateTime(value):'-';
  }

  function missionTimingCell(mission){
    if(ARCHIVE_STATUSES.has(mission.status))return `<strong>${escapeHtml(archiveTime(mission))}</strong><small>${mission.status==='CANCELLED'?'취소 기록':'완료 기록'}</small>`;
    return mission.etaMin?`<strong>${flowFmt1(mission.etaMin,'분')}</strong><small>예상 소요</small>`:'-';
  }

  function missionRepeatCell(mission){
    if(REPEATABLE_STATUSES.has(mission.status)){
      const children=repeatChildren(mission.id);
      return `<button type="button" class="btn small mission-repeat-btn" data-repeat-mission="${mission.id}">↻ 재수행</button>${children?`<small class="mission-repeat-count">파생 임무 ${flowFmt1(children,'건')}</small>`:''}`;
    }
    if(mission.repeatOfMissionId)return `${repeatChip(mission)}<small class="mission-repeat-count">원본 ${escapeHtml(mission.repeatOfMissionId)}</small>`;
    return '<span class="muted">-</span>';
  }

  function rowMarkup(mission,selected){
    const drone=flowDrone(mission.droneId);const operation=flowLatestOperation(mission.id);
    const stage=operation?.status==='PROCESSING'?operation.message:flowCurrentStageName(mission);
    const next=operation?.status==='PROCESSING'?`작업 ${flowFmt1(operation.progress,'%')}`:flowNextAction(mission);
    return `<tr data-select-mission="${mission.id}" class="${selected?.id===mission.id?'selected':''} ${mission.repeatOfMissionId?'is-repeat':''}">
      <td><strong>${escapeHtml(mission.title)}</strong><small>${mission.id} · ${priorityLabel(mission.priority)} ${repeatChip(mission)}</small></td>
      <td><strong>${escapeHtml(mission.origin)}</strong><small>→ ${escapeHtml(mission.destination)}</small></td>
      <td>${drone?`<span class="drone-name">${escapeHtml(drone.name)}</span><span class="drone-meta">${drone.id} · ${escapeHtml(drone.model)}</span><span class="drone-meta">조종자 ${escapeHtml(mission.pilot||'미배정')}</span>`:'<span class="drone-name">미배정</span><span class="drone-meta">승인 후 자원배정 필요</span>'}</td>
      <td>${missionStatusBadge(mission.status)}</td>
      <td><strong>${escapeHtml(stage)}</strong><small>${escapeHtml(next)}</small></td>
      <td><strong class="num">${flowFmt1(mission.progress,'%')}</strong><div class="progress mission-row-progress"><span style="width:${clamp(mission.progress,0,100)}%"></span></div></td>
      <td>${missionTimingCell(mission)}</td>
      <td class="mission-repeat-action">${missionRepeatCell(mission)}</td>
    </tr>`;
  }

  function repeatLineageBanner(mission){
    if(!mission?.repeatOfMissionId)return '';
    const source=flowMission(mission.repeatOfMissionId);
    const root=mission.rootMissionId||mission.repeatOfMissionId;
    return `<div class="mission-lineage-banner"><div><span>재수행 연결 기록</span><strong>${repeatSequenceFor(mission)}회차 · 원본 ${escapeHtml(mission.repeatOfMissionId)}</strong><small>원본 수행기록은 변경하지 않고 새 Mission ID로 생성되었습니다.${root!==mission.repeatOfMissionId?` · 최초 원본 ${escapeHtml(root)}`:''}</small></div>${source?`<button type="button" class="btn small" data-select-mission="${source.id}">원본 수행 보기</button>`:''}</div>`;
  }

  function repeatAwareMissionDetail(mission){
    let html=baseMissionDetail(mission);
    if(!mission)return html;
    const badge=missionStatusBadge(mission.status);
    html=html.replace(/(<div class="detail-hero-top"><span class="mono">[^<]*<\/span>)(<span class="status[^>]*>.*?<\/span>)(<\/div>)/,`$1${badge}$3`);
    const lineage=repeatLineageBanner(mission);
    if(lineage)html=html.replace('</p></div>',`</p></div>${lineage}`);
    return html;
  }

  function repeatAwareMissionButtons(mission,ready){
    const base=baseMissionButtons(mission,ready);
    if(!REPEATABLE_STATUSES.has(mission.status))return base;
    return `${base}<button type="button" class="btn primary mission-repeat-btn" data-repeat-mission="${mission.id}">↻ 이 임무 재수행</button>`;
  }

  function repeatAwareMissionsView(){
    const ui=normalizeFilters();const scope=ui.missionScope;
    const activeCount=state.missions.filter(item=>ACTIVE_STATUSES.has(item.status)).length;
    const archiveCount=state.missions.filter(item=>ARCHIVE_STATUSES.has(item.status)).length;
    const airborneCount=state.missions.filter(item=>['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING'].includes(item.status)).length;
    const query=String(missionQuery||'').trim().toLowerCase();
    const rows=orderMissions(state.missions.filter(mission=>scopeMatches(mission,scope)&&(missionStatus==='ALL'||mission.status===missionStatus)&&(!query||missionSearchText(mission).includes(query))),scope);
    let selected=rows.find(mission=>mission.id===state.selectedMission)||rows[0]||null;
    if(selected&&state.selectedMission!==selected.id){state.selectedMission=selected.id;persist();}
    return `${pageHead('배송임무 관리','임무 상태를 실제 수행 흐름으로 정렬하고, 완료 이력을 원본 보존 방식으로 재수행합니다.',`<button class="btn primary" data-new-mission>${ICONS.plus} 신규 임무</button>`)}
      <section class="flow-overview"><article class="flow-overview-item"><span>조회 결과</span><strong>${flowFmt1(rows.length,'건')}</strong></article><article class="flow-overview-item"><span>진행·대기</span><strong>${flowFmt1(activeCount,'건')}</strong></article><article class="flow-overview-item"><span>실제 운항</span><strong>${flowFmt1(airborneCount,'건')}</strong></article><article class="flow-overview-item"><span>완료 이력</span><strong>${flowFmt1(archiveCount,'건')}</strong></article></section>
      ${scopeTabs(scope,activeCount,archiveCount)}
      <section class="split"><article class="card"><div class="toolbar"><div class="filters"><input class="input" id="mission-search" value="${escapeHtml(missionQuery)}" placeholder="Mission ID·주문·임무·노선 검색"><select class="select mission-status-select" id="mission-status" aria-label="임무 상태 필터">${statusOptions()}</select></div><span class="muted mission-filter-result">총 ${flowFmt1(rows.length,'건')}</span></div><div class="table-wrap"><table class="table mission-repeat-table"><thead><tr><th>임무</th><th>노선</th><th>배정 드론</th><th>임무 상태</th><th>현재 단계</th><th>진행률</th><th>일정·완료</th><th>재수행</th></tr></thead><tbody>${rows.map(mission=>rowMarkup(mission,selected)).join('')||'<tr><td colspan="8"><div class="empty">조건에 맞는 배송임무가 없습니다.</div></td></tr>'}</tbody></table></div></article>${repeatAwareMissionDetail(selected)}</section>`;
  }

  function kstDateKey(){
    const parts={};
    new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).forEach(part=>{if(part.type!=='literal')parts[part.type]=part.value;});
    return `${parts.year}${parts.month}${parts.day}`;
  }

  function nextMissionId(){
    const prefix=`MSN-${kstDateKey()}-`;
    const max=state.missions.reduce((value,mission)=>{
      if(!String(mission.id||'').startsWith(prefix))return value;
      const suffix=Number(String(mission.id).slice(prefix.length));
      return Number.isFinite(suffix)?Math.max(value,suffix):value;
    },0);
    return `${prefix}${String(max+1).padStart(3,'0')}`;
  }

  function nextOrderNo(){
    const now=new Date();
    const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).replaceAll(':','');
    return `ORD-${kstDateKey()}-${clock}`;
  }

  function rootMissionId(source){return source.rootMissionId||source.repeatOfMissionId||source.id;}

  function nextRepeatSequence(source){
    const root=rootMissionId(source);
    const max=state.missions.reduce((value,mission)=>{
      const sameRoot=mission.id===root||mission.rootMissionId===root||mission.repeatOfMissionId===root;
      if(!sameRoot)return value;
      return Math.max(value,repeatSequenceFor(mission));
    },1);
    return max+1;
  }

  function resourceAvailability(source){
    const drone=flowDrone(source.droneId),battery=flowBattery(source.batteryId);
    const droneReady=Boolean(drone&&drone.status==='READY'&&!flowReservedDrone(drone.id,'__repeat_preview__'));
    const batteryReady=Boolean(battery&&battery.status==='READY'&&Number(battery.soc)>=60&&Number(battery.soh)>=85&&!flowReservedBattery(battery.id,'__repeat_preview__'));
    return {drone,battery,droneReady,batteryReady,both:droneReady&&batteryReady};
  }

  function showRepeatModal(sourceId){
    const source=flowMission(sourceId);
    if(!source||!REPEATABLE_STATUSES.has(source.status)){toast('재수행할 수 없는 임무','완료 또는 취소된 수행기록만 새 임무로 재수행할 수 있습니다.','error');return;}
    const availability=resourceAvailability(source);const sequence=nextRepeatSequence(source);
    const preferred=Boolean(source.droneId&&source.batteryId);
    const resourceText=source.droneId||source.batteryId?`${source.droneId||'기체 없음'} · ${source.batteryId||'배터리 없음'}`:'기존 배정 자원 없음';
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal mission-repeat-modal" role="dialog" aria-modal="true" aria-labelledby="repeat-modal-title"><div class="modal-head"><div><h2 id="repeat-modal-title">지난 수행 재수행</h2><p>원본 기록을 보존하고 새로운 Mission ID를 생성합니다.</p></div><button type="button" class="btn icon" data-modal-close aria-label="닫기">${ICONS.close}</button></div><form id="mission-repeat-form" data-repeat-source="${source.id}"><div class="modal-body"><div class="repeat-source-summary"><div><span>원본 수행</span><strong>${source.id} · ${escapeHtml(source.title)}</strong><small>${escapeHtml(source.origin)} → ${escapeHtml(source.destination)}</small></div><div><span>완료·종료 기록</span><strong>${escapeHtml(archiveTime(source))}</strong><small>${missionStatusLabel(source.status)} · ${escapeHtml(source.pilot||'조종자 미기록')}</small></div><div><span>새 수행 회차</span><strong>${sequence}회차</strong><small>새 Mission ID · 승인부터 다시 진행</small></div></div><div class="repeat-copy-info"><strong>복사되는 정보</strong><span>임무명·노선·화물·중량·수령인·연락처·우선순위·조종자</span><strong>복사되지 않는 정보</strong><span>승인·안전검증·비행로그·경보·배송증빙·진행률·완료시각</span></div><fieldset class="repeat-policy"><legend>자원 배정 방식</legend><label class="repeat-policy-option ${preferred?'recommended':''}"><input type="radio" name="resourcePolicy" value="PREFER_PREVIOUS" ${preferred?'checked':'disabled'}><span><strong>기존 자원 우선 요청</strong><small>${escapeHtml(resourceText)} · ${availability.both?'현재 사용 가능':'불가 시 다른 자원으로 자동 대체'}</small></span></label><label class="repeat-policy-option"><input type="radio" name="resourcePolicy" value="AUTO_ASSIGN" ${preferred?'':'checked'}><span><strong>새 자원 자동배정</strong><small>승인 후 현재 가용 기체와 배터리를 다시 선정합니다.</small></span></label></fieldset><label class="repeat-confirm"><input type="checkbox" name="preserveOriginal" required><span>원본 수행기록은 변경하지 않고 새 임무로 생성함을 확인합니다.</span></label></div><div class="modal-foot"><button type="button" class="btn" data-modal-close>취소</button><button type="submit" class="btn primary">${sequence}회차 임무 생성</button></div></form></div></div>`;
  }

  function copyOptionalFields(source,target){
    ROUTE_COPY_FIELDS.forEach(key=>{if(source[key]!==undefined)target[key]=source[key];});
  }

  function createRepeatedMission(sourceId,policy){
    const source=flowMission(sourceId);
    if(!source||!REPEATABLE_STATUSES.has(source.status))throw new Error('완료 또는 취소된 원본 수행기록을 찾지 못했습니다.');
    const createdAt=flowNow();const root=rootMissionId(source);const sequence=nextRepeatSequence(source);const preferPrevious=policy==='PREFER_PREVIOUS';
    const mission={
      id:nextMissionId(),orderNo:nextOrderNo(),title:source.title,cargo:source.cargo,payloadKg:flowRound1(source.payloadKg),
      origin:source.origin,destination:source.destination,recipient:source.recipient,phone:source.phone,pilot:source.pilot,
      droneId:null,batteryId:null,preferredDroneId:preferPrevious?source.droneId||null:null,preferredBatteryId:preferPrevious?source.batteryId||null:null,
      resourcePolicy:preferPrevious?'PREFER_PREVIOUS':'AUTO_ASSIGN',status:'READY',approvalState:'PENDING',priority:source.priority||'NORMAL',
      progress:0,etaMin:flowRound1(source.plannedEtaMin||source.initialEtaMin||15),createdAt,approvedAt:null,resourceAssignedAt:null,
      checkedAt:null,checkedBy:null,departedAt:null,deliveredAt:null,completedAt:null,cancelledAt:null,returnProgress:0,
      checks:{airframe:false,battery:false,cargo:false,link:false,route:false,weather:false},
      history:[[`재수행 임무 생성 · 원본 ${source.id}`,Date.now(),flowActor()]],
      repeatOfMissionId:source.id,rootMissionId:root,repeatSequence:sequence,
      repeatSource:{missionId:source.id,orderNo:source.orderNo||'',completedAt:source.completedAt||source.cancelledAt||null,droneId:source.droneId||null,batteryId:source.batteryId||null,copiedAt:createdAt,copiedBy:flowActor()}
    };
    copyOptionalFields(source,mission);
    state.missions.unshift(mission);state.selectedMission=mission.id;uiState().missionScope='ACTIVE';missionStatus='ALL';missionQuery='';
    state.stats=state.stats||{};state.stats.today=Number(state.stats.today||0)+1;
    if(typeof flowAudit==='function')flowAudit('MISSION_REPEAT_CREATE','MISSION',mission.id,`원본 ${source.id} · ${sequence}회차 · ${mission.resourcePolicy}`);
    closeModal();persist();render();toast('재수행 임무 생성 완료',`${mission.id} · 원본 ${source.id} · 운항 승인부터 다시 진행합니다.`,'success');
    return mission;
  }

  flowAssignResources=function repeatPreferredResourceAssignment(mission){
    let preferredApplied=false;
    if(mission?.resourcePolicy==='PREFER_PREVIOUS'){
      const drone=flowDrone(mission.preferredDroneId),battery=flowBattery(mission.preferredBatteryId);
      const droneReady=Boolean(drone&&drone.status==='READY'&&!flowReservedDrone(drone.id,mission.id));
      const batteryReady=Boolean(battery&&battery.status==='READY'&&Number(battery.soc)>=60&&Number(battery.soh)>=85&&!flowReservedBattery(battery.id,mission.id));
      if(droneReady&&batteryReady){mission.droneId=drone.id;mission.batteryId=battery.id;preferredApplied=true;}
    }
    baseAssignResources(mission);
    mission.preferredResourceApplied=preferredApplied;
    mission.resourceAssignmentPolicyResult=preferredApplied?'기존 자원 우선배정':'현재 가용 자원 자동배정';
  };

  flowMissionDetail=repeatAwareMissionDetail;missionDetail=flowMissionDetail;
  flowMissionButtons=repeatAwareMissionButtons;missionButtons=flowMissionButtons;
  flowMissionsView=repeatAwareMissionsView;missionsView=flowMissionsView;

  document.addEventListener('click',event=>{
    const scopeButton=event.target.closest('[data-mission-scope]');
    if(scopeButton){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();uiState().missionScope=scopeButton.dataset.missionScope;missionStatus='ALL';persist();render();return;}
    const repeatButton=event.target.closest('[data-repeat-mission]');
    if(repeatButton){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();showRepeatModal(repeatButton.dataset.repeatMission);}
  },true);

  document.addEventListener('submit',event=>{
    if(event.target.id!=='mission-repeat-form')return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const form=event.target;const data=new FormData(form);
    if(!data.get('preserveOriginal')){toast('원본 보존 확인 필요','원본 수행기록 보존 항목을 확인하십시오.','error');return;}
    try{createRepeatedMission(form.dataset.repeatSource,data.get('resourcePolicy')||'AUTO_ASSIGN');}
    catch(error){toast('재수행 임무 생성 실패',error.message||'임무를 생성하지 못했습니다.','error');}
  },true);

  state.missions.forEach(mission=>{
    if(mission.repeatOfMissionId&&!mission.rootMissionId)mission.rootMissionId=mission.repeatOfMissionId;
    if(mission.repeatOfMissionId&&!mission.repeatSequence)mission.repeatSequence=2;
  });
  normalizeFilters();persist();

  window.dlogisMissionRepeat={
    version:VERSION,
    statusGroups:MISSION_STATUS_GROUPS,
    createRepeatedMission,
    showRepeatModal,
    missionStatusLabel,
    activeStatuses:[...ACTIVE_STATUSES],
    archiveStatuses:[...ARCHIVE_STATUSES]
  };
})();
