'use strict';

/*
 * Evidence-based preflight verification.
 * A green state is produced only after data/evidence validation and an audit record.
 * This is an internal operational control, not a government-issued approval or qualified e-signature.
 */
(function installEvidenceBasedPreflight(){
  const SCHEMA_VERSION='PFV-2.0';
  const ADVANCED_STATES=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED']);
  const ITEM_ORDER=['airframe','battery','cargo','link','route','weather'];
  const ITEM_DEFINITIONS={
    airframe:{title:'기체 외관·프로펠러',method:'PHOTO_HASH',source:'현장 사진 + 조종자 확인',manual:true,description:'기체 4방향 외관과 프로펠러 손상 여부를 사진으로 남깁니다.'},
    battery:{title:'배터리 장착·잠금',method:'BMS_SNAPSHOT',source:'배터리 BMS 자동값',manual:false,description:'배터리 ID, SOC, SOH, 온도, 셀 편차와 장착 연결을 자동 검증합니다.'},
    cargo:{title:'화물 적재·잠금',method:'WEIGHT_PHOTO_HASH',source:'실측 중량 + 적재 사진',manual:true,description:'실측 중량, 화물함 잠금 확인과 적재 사진을 기록합니다.'},
    link:{title:'통신·GNSS 링크',method:'LINK_HEALTH_TEST',source:'기체 텔레메트리 자동값',manual:false,description:'통신품질, GNSS 위성 수, 비행제어 모드와 데이터 수신 상태를 확인합니다.'},
    route:{title:'항로·공역 승인',method:'APPROVAL_REFERENCE',source:'승인번호 + 항로 지문',manual:true,description:'드론원스톱 또는 내부 운항승인 번호와 항로 변경 여부를 기록합니다.'},
    weather:{title:'기상·풍속',method:'FIELD_WEATHER_SNAPSHOT',source:'현장 실측 + 시스템 기상값',manual:true,description:'현장 풍속과 가시거리를 입력하고 운영 기준과 비교합니다.'}
  };
  const DEFAULT_POLICY={
    validityMinutes:30,
    batterySocMin:40,
    batterySohMin:85,
    batteryTempMin:5,
    batteryTempMax:45,
    cellDeltaMaxMv:50,
    linkMin:70,
    satellitesMin:12,
    cargoToleranceKg:.2,
    windMaxMs:7,
    visibilityMinKm:3
  };

  function pfNow(){return new Date().toISOString();}
  function pfActor(){return typeof flowActor==='function'?flowActor():(state.role==='pilot'?'현장 조종자':'관제 관리자');}
  function pfDeviceId(){state.deviceId=state.deviceId||uid('DEV');return state.deviceId;}
  function pfFingerprint(mission){
    return [mission.id,mission.droneId||'',mission.batteryId||'',mission.origin||'',mission.destination||'',flowRound1(mission.payloadKg||0)].join('|');
  }
  function pfLatestTelemetry(droneId){
    const rows=Array.isArray(state.telemetryLogs)?state.telemetryLogs:[];
    for(let index=rows.length-1;index>=0;index-=1){if(rows[index].droneId===droneId)return rows[index];}
    return null;
  }
  function pfCellDeltaMv(battery){
    if(!battery)return 0;
    if(typeof flowCellDeltaMv==='function')return flowCellDeltaMv(battery);
    const raw=Number(battery.cellDiff)||0;
    return flowRound1(Math.abs(raw)<=1?raw*1000:raw);
  }
  function pfAgeSeconds(value){
    if(!value)return null;
    const time=new Date(value).getTime();
    return Number.isFinite(time)?flowRound1(Math.max(0,(Date.now()-time)/1000)):null;
  }
  async function pfHashBytes(buffer){
    if(window.crypto?.subtle){
      const digest=await crypto.subtle.digest('SHA-256',buffer);
      return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
    }
    const bytes=new Uint8Array(buffer);let hash=2166136261;
    bytes.forEach(value=>{hash^=value;hash=Math.imul(hash,16777619);});
    return `FNV-${(hash>>>0).toString(16).padStart(8,'0')}`;
  }
  async function pfHashText(text){return pfHashBytes(new TextEncoder().encode(String(text)));}
  async function pfFileEvidence(file,evidenceId){
    if(!(file instanceof File)||!file.size)throw new Error('현장 증빙 사진을 첨부하십시오.');
    const hash=await pfHashBytes(await file.arrayBuffer());
    const blobKey=await pfStoreBlob(evidenceId,file).catch(()=>null);
    return {fileName:file.name,mimeType:file.type||'application/octet-stream',sizeBytes:file.size,sha256:hash,blobKey};
  }
  function pfStoreBlob(key,file){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB)return reject(new Error('IndexedDB unavailable'));
      const request=indexedDB.open('dlogis-evidence-v1',1);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files');};
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,key);
        tx.oncomplete=()=>{db.close();resolve(key);};tx.onerror=()=>{db.close();reject(tx.error);};
      };
    });
  }
  function pfRouteHash(mission){return `${mission.origin||'-'} → ${mission.destination||'-'} · ${flowFmt1(mission.payloadKg,'kg')}`;}
  function pfSource(){return state.settings?.mode==='gateway'?'GATEWAY':'SIMULATION';}
  function pfRecordFor(mission,create=true){
    state.preflightVerifications=Array.isArray(state.preflightVerifications)?state.preflightVerifications:[];
    let record=state.preflightVerifications.find(item=>item.missionId===mission.id&&!item.supersededAt);
    if(!record&&create){
      record={id:uid('PFV'),schemaVersion:SCHEMA_VERSION,missionId:mission.id,createdAt:pfNow(),updatedAt:pfNow(),fingerprint:pfFingerprint(mission),items:{},signoff:null,status:'NOT_STARTED',source:pfSource(),deviceId:pfDeviceId()};
      state.preflightVerifications.push(record);
    }
    return record||null;
  }
  function pfMigrateHistorical(mission,record){
    const fingerprint=pfFingerprint(mission);
    const at=mission.departedAt||mission.completedAt||mission.createdAt||pfNow();
    ITEM_ORDER.forEach(key=>{
      record.items[key]={id:uid('EVD'),key,status:'VERIFIED',result:'PASS',method:'LEGACY_IMPORT',source:'이전 운항 데이터',verifiedAt:at,verifiedBy:mission.pilot||'시스템 마이그레이션',expiresAt:null,fingerprint,deviceId:pfDeviceId(),snapshot:{legacy:true},evidenceHash:'LEGACY-NO-HASH',note:'기존 운항 이력 보존용. 향후 운항에는 재사용되지 않습니다.'};
      mission.checks[key]=true;
    });
    record.signoff={signedAt:at,signedBy:mission.pilot||'시스템 마이그레이션',method:'LEGACY_IMPORT',fingerprint,recordHash:'LEGACY-NO-HASH',deviceId:pfDeviceId(),legacy:true};
    record.status='LOCKED_LEGACY';record.lockedAt=mission.departedAt||mission.completedAt||at;record.fingerprint=fingerprint;record.updatedAt=pfNow();
  }
  function pfEnsureState(){
    state.preflightPolicy={...DEFAULT_POLICY,...(state.preflightPolicy||{})};
    state.preflightVerifications=Array.isArray(state.preflightVerifications)?state.preflightVerifications:[];
    state.flowUi=state.flowUi&&typeof state.flowUi==='object'?state.flowUi:{};
    pfDeviceId();
    state.missions.forEach(mission=>{
      mission.checks=mission.checks||Object.fromEntries(ITEM_ORDER.map(key=>[key,false]));
      const record=pfRecordFor(mission,true);
      if(!Object.keys(record.items||{}).length){
        if(ADVANCED_STATES.has(mission.status)||mission.departedAt||mission.completedAt)pfMigrateHistorical(mission,record);
        else ITEM_ORDER.forEach(key=>{mission.checks[key]=false;});
      }
    });
  }
  function pfItemState(mission,key){
    const record=pfRecordFor(mission,false);const item=record?.items?.[key];
    if(!item)return {status:'PENDING',item:null,label:'미검증'};
    if(item.status==='FAILED')return {status:'FAILED',item,label:'실패'};
    if(item.fingerprint!==pfFingerprint(mission))return {status:'STALE',item,label:'변경됨'};
    if(item.expiresAt&&Date.now()>new Date(item.expiresAt).getTime()&&!ADVANCED_STATES.has(mission.status))return {status:'EXPIRED',item,label:'만료'};
    return {status:item.status,item,label:item.status==='VERIFIED'?'검증 완료':'미검증'};
  }
  function pfAutomaticCriterion(mission,key){
    const drone=flowDrone(mission.droneId);const battery=flowBattery(mission.batteryId);const policy=state.preflightPolicy;
    if(key==='battery'){
      if(!drone||!battery)return {pass:false,reason:'기체 또는 배터리가 배정되지 않았습니다.'};
      const delta=pfCellDeltaMv(battery);
      const pass=battery.status!=='QUARANTINE'&&battery.id===drone.batteryId&&battery.soc>=policy.batterySocMin&&battery.soh>=policy.batterySohMin&&battery.temp>=policy.batteryTempMin&&battery.temp<=policy.batteryTempMax&&delta<=policy.cellDeltaMaxMv;
      return {pass,reason:pass?'BMS 기준 통과':`SOC·SOH·온도·셀 편차 또는 장착 ID가 운영 기준을 충족하지 않습니다.`,snapshot:{batteryId:battery.id,droneBatteryId:drone.batteryId,soc:flowRound1(battery.soc),soh:flowRound1(battery.soh),temperatureC:flowRound1(battery.temp),cellDeltaMv:delta,status:battery.status,policy:{socMin:policy.batterySocMin,sohMin:policy.batterySohMin,tempMin:policy.batteryTempMin,tempMax:policy.batteryTempMax,cellDeltaMaxMv:policy.cellDeltaMaxMv}}};
    }
    if(key==='link'){
      if(!drone)return {pass:false,reason:'기체가 배정되지 않았습니다.'};
      const telemetry=pfLatestTelemetry(drone.id);const receivedAt=telemetry?.recordedAt||telemetry?.receivedAt||null;const age=pfAgeSeconds(receivedAt);
      const dataFresh=state.settings?.mode!=='gateway'||(age!==null&&age<=15);
      const pass=drone.link>=policy.linkMin&&drone.satellites>=policy.satellitesMin&&drone.flightMode!=='OFFLINE'&&dataFresh;
      return {pass,reason:pass?'통신·GNSS 기준 통과':'통신품질, GNSS 또는 데이터 신선도가 운영 기준을 충족하지 않습니다.',snapshot:{droneId:drone.id,linkPct:flowRound1(drone.link),satellites:flowRound1(drone.satellites),flightMode:drone.flightMode,dataAgeSec:age,source:pfSource(),policy:{linkMin:policy.linkMin,satellitesMin:policy.satellitesMin,maxAgeSec:15}}};
    }
    return {pass:true,reason:'수동 증빙 항목'};
  }
  function pfReady(mission){
    const record=pfRecordFor(mission,false);if(!record)return false;
    if(ADVANCED_STATES.has(mission.status)&&record.lockedAt)return true;
    const fingerprint=pfFingerprint(mission);
    const itemsReady=ITEM_ORDER.every(key=>{
      const stateItem=pfItemState(mission,key);
      if(stateItem.status!=='VERIFIED')return false;
      if((key==='battery'||key==='link')&&!pfAutomaticCriterion(mission,key).pass)return false;
      return true;
    });
    return Boolean(itemsReady&&record.signoff&&record.signoff.fingerprint===fingerprint&&!record.signoff.legacy);
  }
  function pfSyncChecks(mission){ITEM_ORDER.forEach(key=>{mission.checks[key]=pfItemState(mission,key).status==='VERIFIED';});}
  function pfSummary(mission){
    const states=ITEM_ORDER.map(key=>pfItemState(mission,key));
    return {verified:states.filter(item=>item.status==='VERIFIED').length,failed:states.filter(item=>['FAILED','STALE','EXPIRED'].includes(item.status)).length,total:ITEM_ORDER.length,ready:pfReady(mission),signed:Boolean(pfRecordFor(mission,false)?.signoff)};
  }
  function pfStatusBadge(stateItem){
    const tone={VERIFIED:'green',FAILED:'red',STALE:'amber',EXPIRED:'amber',PENDING:'gray'}[stateItem.status]||'gray';
    return `<span class="pf-status ${tone}"><i>${stateItem.status==='VERIFIED'?'✓':stateItem.status==='FAILED'?'!':stateItem.status==='PENDING'?'·':'↻'}</i>${stateItem.label}</span>`;
  }
  function pfEvidenceLine(stateItem){
    const item=stateItem.item;if(!item)return '증빙이 등록되지 않았습니다.';
    const source=escapeHtml(item.source||'-');const actor=escapeHtml(item.verifiedBy||'-');const time=item.verifiedAt?fmtDateTime(item.verifiedAt):'-';
    const hash=item.evidenceHash&&item.evidenceHash!=='LEGACY-NO-HASH'?`${item.evidenceHash.slice(0,12)}…`:'해시 없음';
    return `${source} · ${actor} · ${time} · ${hash}`;
  }
  function pfPanel(mission,compact=false){
    pfSyncChecks(mission);
    const record=pfRecordFor(mission,true);const summary=pfSummary(mission);
    const locked=Boolean(record.lockedAt||ADVANCED_STATES.has(mission.status));
    return `<section class="pf-shell ${summary.ready?'ready':''}" aria-label="증빙 기반 비행 전 검증">
      <div class="pf-head"><div><div class="pf-kicker">EVIDENCE-BASED PREFLIGHT</div><h3>비행 전 안전검증</h3><p>단순 체크가 아니라 자동수치·사진·승인번호·전자서명을 하나의 검증기록으로 남깁니다.</p></div><div class="pf-score"><strong>${summary.verified}/${summary.total}</strong><span>${summary.ready?'이륙 검증 완료':summary.failed?'재검증 필요':'검증 진행 중'}</span></div></div>
      <div class="pf-record-bar"><span>검증 ID <b class="mono">${record.id}</b></span><span>기체 <b>${mission.droneId||'미배정'}</b></span><span>배터리 <b>${mission.batteryId||'미배정'}</b></span><span>유효시간 <b>${state.preflightPolicy.validityMinutes}분</b></span><button class="btn small" data-preflight-export="${mission.id}">기록 CSV</button></div>
      <div class="pf-grid ${compact?'compact':''}">${ITEM_ORDER.map((key,index)=>{const definition=ITEM_DEFINITIONS[key],stateItem=pfItemState(mission,key);return `<article class="pf-item ${stateItem.status.toLowerCase()}"><div class="pf-item-number">${String(index+1).padStart(2,'0')}</div><div class="pf-item-main"><div class="pf-item-title"><div><strong>${definition.title}</strong><small>${definition.source}</small></div>${pfStatusBadge(stateItem)}</div><p>${definition.description}</p><div class="pf-evidence">${escapeHtml(pfEvidenceLine(stateItem))}</div></div><button class="btn small ${stateItem.status==='VERIFIED'?'':'primary'}" data-verify-preflight="${mission.id}" data-preflight-key="${key}" ${locked?'disabled':''}>${stateItem.status==='VERIFIED'?'재검증':definition.manual?'증빙 등록':'자동 검증'}</button></article>`}).join('')}</div>
      <div class="pf-release"><div><span>최종 운항 적합 판정</span><strong>${summary.ready?'검증기록 잠금 완료 · 이륙 가능':summary.verified===summary.total?'내부 전자서명이 필요합니다.':'6개 항목의 검증을 완료하십시오.'}</strong><small>${record.signoff?`${escapeHtml(record.signoff.signedBy)} · ${fmtDateTime(record.signoff.signedAt)} · ${escapeHtml(record.signoff.recordHash.slice(0,16))}…`:'서명 전에는 이륙 명령이 차단됩니다.'}</small></div><button class="btn ${summary.ready?'green':'primary'}" data-preflight-sign="${mission.id}" ${summary.verified!==summary.total||locked?'disabled':''}>${summary.ready?'서명 완료':'검증기록 서명·잠금'}</button></div>
    </section>`;
  }
  function pfModalFields(mission,key){
    const definition=ITEM_DEFINITIONS[key];const drone=flowDrone(mission.droneId);const battery=flowBattery(mission.batteryId);const policy=state.preflightPolicy;
    if(key==='airframe')return `<div class="pf-form-callout"><strong>필수 증빙</strong><span>기체 전체와 프로펠러가 식별되는 현장 사진을 첨부합니다.</span></div><div class="field full"><label>현장 사진 <em>*</em></label><input class="input" type="file" name="evidenceFile" accept="image/*" capture="environment" required></div><label class="pf-confirm"><input type="checkbox" name="physicalConfirm" required><span>동체 균열, 암 변형, 모터 이물, 프로펠러 손상·체결을 직접 확인했습니다.</span></label><div class="field full"><label>점검 메모</label><textarea class="input pf-textarea" name="note" placeholder="교체 부품 또는 특이사항"></textarea></div>`;
    if(key==='battery'){const criterion=pfAutomaticCriterion(mission,key);return `<div class="pf-auto-result ${criterion.pass?'pass':'fail'}"><strong>${criterion.pass?'자동 기준 통과':'자동 기준 미충족'}</strong><span>${escapeHtml(criterion.reason)}</span></div><div class="pf-snapshot-grid"><div><span>배터리</span><strong>${battery?.id||'-'}</strong></div><div><span>SOC / SOH</span><strong>${flowFmt1(battery?.soc,'%')} / ${flowFmt1(battery?.soh,'%')}</strong></div><div><span>온도</span><strong>${flowFmt1(battery?.temp,'℃')}</strong></div><div><span>셀 편차</span><strong>${flowFmt1(pfCellDeltaMv(battery),'mV')}</strong></div><div><span>장착 기체</span><strong>${drone?.id||'-'}</strong></div><div><span>운영 기준</span><strong>SOC ≥ ${flowFmt1(policy.batterySocMin,'%')} · SOH ≥ ${flowFmt1(policy.batterySohMin,'%')}</strong></div></div>`;}
    if(key==='cargo')return `<div class="field"><label>실측 중량(kg) <em>*</em></label><input class="input" type="number" name="measuredWeight" min="0" step="0.1" value="${flowRound1(mission.payloadKg)}" required></div><div class="field"><label>신고 중량</label><input class="input" value="${flowFmt1(mission.payloadKg,'kg')}" disabled></div><div class="field full"><label>적재 사진 <em>*</em></label><input class="input" type="file" name="evidenceFile" accept="image/*" capture="environment" required></div><label class="pf-confirm"><input type="checkbox" name="latchConfirm" required><span>화물 고정, 무게중심, 화물함 잠금 센서와 외부 래치를 확인했습니다.</span></label>`;
    if(key==='link'){const criterion=pfAutomaticCriterion(mission,key);return `<div class="pf-auto-result ${criterion.pass?'pass':'fail'}"><strong>${criterion.pass?'자동 기준 통과':'자동 기준 미충족'}</strong><span>${escapeHtml(criterion.reason)}</span></div><div class="pf-snapshot-grid"><div><span>통신품질</span><strong>${flowFmt1(drone?.link,'%')}</strong></div><div><span>GNSS</span><strong>${flowFmt1(drone?.satellites,'개')}</strong></div><div><span>비행모드</span><strong>${escapeHtml(drone?.flightMode||'-')}</strong></div><div><span>기준</span><strong>통신 ≥ ${flowFmt1(policy.linkMin,'%')} · GNSS ≥ ${flowFmt1(policy.satellitesMin,'개')}</strong></div></div>`;}
    if(key==='route')return `<div class="field full"><label>비행승인 / 내부 운항승인 번호 <em>*</em></label><input class="input mono" name="approvalRef" minlength="4" placeholder="예: D-ONE-20260805-001 또는 INT-OPS-001" required></div><div class="pf-route-proof"><span>항로 지문</span><strong>${escapeHtml(pfRouteHash(mission))}</strong></div><label class="pf-confirm"><input type="checkbox" name="routeConfirm" required><span>최신 공역·금지구역·관제권 정보와 승인 항로가 일치함을 확인했습니다.</span></label>`;
    if(key==='weather')return `<div class="field"><label>현장 풍속(m/s) <em>*</em></label><input class="input" type="number" name="windMs" min="0" step="0.1" value="3.8" required></div><div class="field"><label>가시거리(km) <em>*</em></label><input class="input" type="number" name="visibilityKm" min="0" step="0.1" value="12.0" required></div><div class="pf-form-callout"><strong>앱 운영 기준</strong><span>풍속 ≤ ${flowFmt1(policy.windMaxMs,'m/s')} · 가시거리 ≥ ${flowFmt1(policy.visibilityMinKm,'km')} · 유효 ${policy.validityMinutes}분</span></div><div class="field full"><label>측정장비 / 기상 출처</label><input class="input" name="weatherSource" value="현장 풍속계 + 관제 기상정보" required></div>`;
    return `<div class="notice">${escapeHtml(definition.description)}</div>`;
  }
  function pfOpenVerification(missionId,key){
    const mission=flowMission(missionId);if(!mission)return;
    const definition=ITEM_DEFINITIONS[key];if(!definition)return;
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal pf-modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><div class="modal-head"><div><div class="pf-kicker">${definition.method}</div><h2>${escapeHtml(definition.title)} 검증</h2><p>${escapeHtml(mission.id)} · ${escapeHtml(mission.title)}</p></div><button class="btn icon" data-modal-close aria-label="닫기">${ICONS.close}</button></div><form id="pf-verification-form" data-mission-id="${mission.id}" data-preflight-key="${key}"><div class="modal-body form-grid">${pfModalFields(mission,key)}</div><div class="modal-foot"><button type="button" class="btn" data-modal-close>취소</button><button type="submit" class="btn primary">검증 실행·기록</button></div></form></div></div>`;
  }
  async function pfVerifyForm(form){
    const mission=flowMission(form.dataset.missionId);const key=form.dataset.preflightKey;if(!mission||!ITEM_DEFINITIONS[key])return;
    const fd=new FormData(form);const definition=ITEM_DEFINITIONS[key];const fingerprint=pfFingerprint(mission);const verifiedAt=pfNow();const evidenceId=uid('EVD');
    const snapshot={missionId:mission.id,droneId:mission.droneId||null,batteryId:mission.batteryId||null,source:pfSource()};
    let evidence={};let pass=true;let reason='검증 기준 통과';
    try{
      if(key==='airframe'){
        evidence=await pfFileEvidence(fd.get('evidenceFile'),evidenceId);
        snapshot.physicalConfirmed=fd.get('physicalConfirm')==='on';snapshot.note=String(fd.get('note')||'');pass=snapshot.physicalConfirmed;reason=pass?'사진 해시와 현장 확인 저장':'현장 확인 선언이 필요합니다.';
      }else if(key==='cargo'){
        evidence=await pfFileEvidence(fd.get('evidenceFile'),evidenceId);
        snapshot.measuredWeightKg=flowRound1(fd.get('measuredWeight'));snapshot.declaredWeightKg=flowRound1(mission.payloadKg);snapshot.latchConfirmed=fd.get('latchConfirm')==='on';
        snapshot.weightDifferenceKg=flowRound1(Math.abs(snapshot.measuredWeightKg-snapshot.declaredWeightKg));pass=snapshot.latchConfirmed&&snapshot.weightDifferenceKg<=state.preflightPolicy.cargoToleranceKg;reason=pass?'중량 오차와 잠금 기준 통과':`중량 오차 ${flowFmt1(snapshot.weightDifferenceKg,'kg')} 또는 잠금 확인이 운영 기준을 충족하지 않습니다.`;
      }else if(key==='battery'||key==='link'){
        const criterion=pfAutomaticCriterion(mission,key);pass=criterion.pass;reason=criterion.reason;Object.assign(snapshot,criterion.snapshot||{});
      }else if(key==='route'){
        snapshot.approvalRef=String(fd.get('approvalRef')||'').trim();snapshot.routeHash=await pfHashText(pfRouteHash(mission));snapshot.routeConfirmed=fd.get('routeConfirm')==='on';pass=snapshot.approvalRef.length>=4&&snapshot.routeConfirmed;reason=pass?'승인번호와 항로 지문 저장':'승인번호와 항로 확인이 필요합니다.';
      }else if(key==='weather'){
        snapshot.windMs=flowRound1(fd.get('windMs'));snapshot.visibilityKm=flowRound1(fd.get('visibilityKm'));snapshot.weatherSource=String(fd.get('weatherSource')||'').trim();pass=snapshot.windMs<=state.preflightPolicy.windMaxMs&&snapshot.visibilityKm>=state.preflightPolicy.visibilityMinKm&&Boolean(snapshot.weatherSource);reason=pass?'현장 기상 운영 기준 통과':'풍속 또는 가시거리가 앱 운영 기준을 충족하지 않습니다.';
      }
      const evidenceHash=evidence.sha256||await pfHashText(JSON.stringify({key,fingerprint,snapshot,verifiedAt}));
      const record=pfRecordFor(mission,true);
      record.fingerprint=fingerprint;record.updatedAt=verifiedAt;record.source=pfSource();record.signoff=null;
      record.items[key]={id:evidenceId,key,status:pass?'VERIFIED':'FAILED',result:pass?'PASS':'FAIL',method:definition.method,source:definition.source,verifiedAt,verifiedBy:pfActor(),expiresAt:ADVANCED_STATES.has(mission.status)?null:new Date(Date.now()+state.preflightPolicy.validityMinutes*60000).toISOString(),fingerprint,deviceId:pfDeviceId(),snapshot,evidence,evidenceHash,note:reason};
      mission.checks[key]=pass;record.status=pass?'IN_PROGRESS':'FAILED';
      flowHistory(mission,`${definition.title} ${pass?'증빙 검증 완료':'검증 실패'}`,pfActor());
      flowAudit(pass?'PREFLIGHT_VERIFY':'PREFLIGHT_FAILED','MISSION',mission.id,`${key} · ${reason} · ${evidenceHash}`);
      closeModal();persist();render();toast(pass?'검증 기록 완료':'검증 실패',reason,pass?'success':'error');
    }catch(error){toast('증빙 검증을 완료하지 못했습니다',error.message,'error');}
  }
  function pfOpenSignoff(missionId){
    const mission=flowMission(missionId);if(!mission)return;const summary=pfSummary(mission);if(summary.verified!==summary.total)return toast('서명 차단','모든 검증 항목을 먼저 완료하십시오.','error');
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal pf-sign-modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><div class="modal-head"><div><div class="pf-kicker">INTERNAL ELECTRONIC SIGN-OFF</div><h2>검증기록 서명·잠금</h2><p>${mission.id} · 검증 6개 항목</p></div><button class="btn icon" data-modal-close>${ICONS.close}</button></div><form id="pf-signoff-form" data-mission-id="${mission.id}"><div class="modal-body"><div class="notice warning">이 서명은 내부 감사 추적용입니다. 정부기관의 비행승인이나 공인전자서명을 대체하지 않습니다.</div><div class="field" style="margin-top:14px"><label>서명자 성명 <em>*</em></label><input class="input" name="signerName" value="${escapeHtml(mission.pilot||pfActor())}" required></div><label class="pf-confirm"><input type="checkbox" name="declaration" required><span>현재 배정 기체·배터리·항로와 검증 증빙을 확인했으며, 기록이 변경되면 재검증이 필요함을 확인합니다.</span></label></div><div class="modal-foot"><button type="button" class="btn" data-modal-close>취소</button><button type="submit" class="btn primary">서명하고 기록 잠금</button></div></form></div></div>`;
  }
  async function pfSignoff(form){
    const mission=flowMission(form.dataset.missionId);if(!mission)return;const summary=pfSummary(mission);if(summary.verified!==summary.total)return toast('서명 차단','모든 항목을 재검증하십시오.','error');
    const fd=new FormData(form);const signer=String(fd.get('signerName')||'').trim();if(!signer||fd.get('declaration')!=='on')return toast('서명 정보 확인','성명과 확인 선언이 필요합니다.','error');
    const record=pfRecordFor(mission,true);const fingerprint=pfFingerprint(mission);const signedAt=pfNow();
    const digestPayload={schemaVersion:SCHEMA_VERSION,recordId:record.id,missionId:mission.id,fingerprint,items:ITEM_ORDER.map(key=>({key,id:record.items[key]?.id,hash:record.items[key]?.evidenceHash,at:record.items[key]?.verifiedAt,result:record.items[key]?.result})),signedBy:signer,signedAt,deviceId:pfDeviceId()};
    const recordHash=await pfHashText(JSON.stringify(digestPayload));
    record.signoff={signedAt,signedBy:signer,method:'INTERNAL_TYPED_DECLARATION',fingerprint,recordHash,deviceId:pfDeviceId(),legacy:false};record.status='VERIFIED';record.updatedAt=signedAt;
    mission.preflightSignedAt=signedAt;mission.preflightRecordId=record.id;pfSyncChecks(mission);
    flowHistory(mission,`비행 전 검증기록 서명·잠금 · ${record.id}`,signer);flowAudit('PREFLIGHT_SIGNOFF','MISSION',mission.id,`${record.id} · ${recordHash}`,signer);
    closeModal();persist();render();toast('검증기록 서명 완료',`${record.id} · 이륙 조건에 반영되었습니다.`,'success');
  }
  function pfExport(missionId){
    const mission=flowMission(missionId);const record=mission&&pfRecordFor(mission,false);if(!mission||!record)return;
    const rows=[['검증ID','Mission ID','항목','결과','검증방법','데이터출처','검증자','검증시각','만료시각','기체ID','배터리ID','증빙해시','기록해시','비고']];
    ITEM_ORDER.forEach(key=>{const item=record.items[key]||{};rows.push([record.id,mission.id,ITEM_DEFINITIONS[key].title,item.result||'PENDING',item.method||'',item.source||'',item.verifiedBy||'',item.verifiedAt||'',item.expiresAt||'',mission.droneId||'',mission.batteryId||'',item.evidenceHash||'',record.signoff?.recordHash||'',item.note||'']);});
    download(`DLOGIS_preflight_${mission.id}_${new Date().toISOString().slice(0,10)}.csv`,csv(rows),'text/csv;charset=utf-8');toast('검증기록 CSV 생성','항목별 증빙해시와 서명 기록을 저장했습니다.','success');
  }

  pfEnsureState();
  const baseAssign=flowAssignResources;
  flowAssignResources=function assignAndInvalidateEvidence(mission){
    const before=pfFingerprint(mission);baseAssign(mission);const after=pfFingerprint(mission);
    if(before!==after){const record=pfRecordFor(mission,true);record.signoff=null;record.updatedAt=pfNow();record.status='STALE';ITEM_ORDER.forEach(key=>{mission.checks[key]=false;});flowAudit('PREFLIGHT_INVALIDATED','MISSION',mission.id,'기체 또는 배터리 배정 변경으로 재검증 필요');}
  };
  const baseValidate=flowValidateAction;
  flowValidateAction=function validateWithEvidence(mission,action){
    if(action==='CHECK_ALL')return '전체 일괄 체크는 사용할 수 없습니다. 항목별 증빙 검증을 진행하십시오.';
    if(action==='START'&&!pfReady(mission))return '증빙 기반 비행 전 검증과 내부 전자서명을 완료하십시오.';
    return baseValidate(mission,action);
  };
  const baseNextAction=flowNextAction;
  flowNextAction=function nextEvidenceAction(mission){
    if(mission.status==='APPROVED'&&!pfReady(mission))return '자동수치·현장증빙·승인번호 검증과 기록 서명을 완료하십시오.';
    return baseNextAction(mission);
  };
  const baseStages=flowMissionStages;
  flowMissionStages=function stagesWithEvidence(mission){pfSyncChecks(mission);return baseStages(mission);};

  flowMissionDetail=function missionDetailWithEvidence(mission){
    if(!mission)return '<article class="card detail-panel"><div class="empty"><div class="empty-icon">↗</div>임무를 선택해 주세요.</div></article>';
    const ready=pfReady(mission);const drone=flowDrone(mission.droneId);const battery=flowBattery(mission.batteryId);
    return `<article class="card detail-panel"><div class="detail-hero"><div class="detail-hero-top"><span class="mono">${mission.id}</span>${statusBadge(mission.status)}</div><h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)}</p></div>${flowStageBar(mission)}${flowMissionOperationPanel(mission)}
      <div class="detail-grid"><div class="detail-item"><span>배정 드론</span><strong>${drone?escapeHtml(drone.name):'미배정'}</strong><small class="drone-meta">${drone?`${drone.id} · ${escapeHtml(drone.model)}`:'자동배정 필요'}</small></div><div class="detail-item"><span>조종자</span><strong>${escapeHtml(mission.pilot||'미배정')}</strong></div><div class="detail-item"><span>배터리</span><strong>${mission.batteryId||'미배정'} · ${flowFmt1(battery?.soc,'%')}</strong><small class="drone-meta">SOH ${flowFmt1(battery?.soh,'%')} · ${flowFmt1(battery?.temp,'℃')}</small></div><div class="detail-item"><span>화물</span><strong>${escapeHtml(mission.cargo)} · ${flowFmt1(mission.payloadKg,'kg')}</strong></div><div class="detail-item"><span>진행률</span><strong>${flowFmt1(mission.progress,'%')} · ETA ${flowFmt1(mission.etaMin,'분')}</strong></div><div class="detail-item"><span>통신 / GNSS</span><strong>${flowFmt1(drone?.link,'%')} · ${flowFmt1(drone?.satellites,'개')}</strong></div></div>
      ${pfPanel(mission,false)}<div class="next-action-box"><span>다음 작업</span><strong>${escapeHtml(flowNextAction(mission))}</strong></div><div class="detail-actions">${flowMissionButtons(mission,ready)}</div>${flowMissionHistory(mission)}</article>`;
  };
  missionDetail=flowMissionDetail;

  const basePilotView=flowPilotView;
  flowPilotView=function pilotViewWithEvidence(){
    const mission=state.missions.find(item=>item.pilot==='김도윤'&&['READY','APPROVED','IN_FLIGHT','HOLDING','RETURNING'].includes(item.status))||state.missions.find(item=>['READY','APPROVED','IN_FLIGHT'].includes(item.status));
    if(!mission)return basePilotView();
    const drone=flowDrone(mission.droneId),battery=flowBattery(mission.batteryId),ready=pfReady(mission);
    return mobileShell(`<div class="page-head"><div><h1>현장 운항</h1><p>${escapeHtml(mission.pilot||'배정 조종자')} · ${mission.id}</p></div><button class="btn icon" data-role-menu>⌄</button></div><section class="mobile-hero"><div>${statusBadge(mission.status)}</div><h1>${escapeHtml(mission.title)}</h1><p>${escapeHtml(mission.origin)} → ${escapeHtml(mission.destination)}</p><div class="mobile-stats"><div class="mobile-stat"><span>드론</span><strong>${drone?escapeHtml(drone.name):'미배정'}</strong><small>${drone?`${drone.id} · ${escapeHtml(drone.model)}`:''}</small></div><div class="mobile-stat"><span>배터리</span><strong>${flowFmt1(battery?.soc,'%')}</strong></div><div class="mobile-stat"><span>ETA</span><strong>${flowFmt1(mission.etaMin,'분')}</strong></div></div></section>${flowStageBar(mission)}${flowMissionOperationPanel(mission)}${pfPanel(mission,true)}<article class="card" style="margin-top:14px"><div class="card-head"><h2>운항 상태</h2><span class="status ${drone&&drone.link>80?'green':'amber'}">통신 ${flowFmt1(drone?.link,'%')}</span></div><div class="card-body"><div class="metric-row"><div class="metric"><span>고도</span><strong>${flowFmt1(drone?.altitude,'m')}</strong></div><div class="metric"><span>속도</span><strong>${flowFmt1(drone?.speed,'km/h')}</strong></div><div class="metric"><span>GNSS</span><strong>${flowFmt1(drone?.satellites,'개')}</strong></div></div></div></article><div class="bottom-actions">${flowMissionButtons(mission,ready)}</div>`);
  };
  pilotView=flowPilotView;

  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-verify-preflight],[data-preflight-sign],[data-preflight-export],[data-toggle-check],[data-check-all]');if(!target)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    if(target.dataset.verifyPreflight)return pfOpenVerification(target.dataset.verifyPreflight,target.dataset.preflightKey);
    if(target.dataset.preflightSign)return pfOpenSignoff(target.dataset.preflightSign);
    if(target.dataset.preflightExport)return pfExport(target.dataset.preflightExport);
    const missionId=target.dataset.toggleCheck||target.dataset.checkAll;
    if(missionId){const key=target.dataset.checkKey||'airframe';pfOpenVerification(missionId,key);}
  },true);
  document.addEventListener('submit',event=>{
    if(event.target.id==='pf-verification-form'){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();pfVerifyForm(event.target);}
    if(event.target.id==='pf-signoff-form'){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();pfSignoff(event.target);}
  },true);

  window.flowPreflightReady=pfReady;
  window.flowPreflightPanel=pfPanel;
  window.flowPreflightRecordFor=pfRecordFor;
})();
