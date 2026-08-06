'use strict';

/* Injects periodic-clearance dispatch UX into the final repeat-aware mission view. */
(function installMaintenanceViewIntegration(){
  const api=window.dlogisMaintenanceClearance;
  if(!api||typeof flowMissionsView!=='function')return;
  const baseMissionsView=flowMissionsView;
  const ADVANCED=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED']);
  const fmt=(value,unit='')=>typeof flowFmt1==='function'?flowFmt1(value,unit):`${Number(value||0).toFixed(1)}${unit}`;
  const esc=value=>typeof escapeHtml==='function'?escapeHtml(value):String(value??'');
  function dateText(value){if(!value)return '-';try{return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}catch{return String(value);}}
  function panel(mission){
    if(!mission)return '';
    const readiness=api.automaticReadiness(mission),clearance=readiness.clearance;
    const ready=typeof window.flowPreflightReady==='function'?window.flowPreflightReady(mission):Object.values(mission.checks||{}).every(Boolean);
    const advanced=ADVANCED.has(mission.status),expanded=state.flowUi?.expandedPreflightMissionId===mission.id;
    const assigned=Boolean(mission.droneId&&mission.batteryId),approved=mission.status==='APPROVED',canQuick=approved&&assigned&&clearance.valid;
    let action='';
    if(!advanced&&!clearance.valid&&mission.droneId)action=`<button type="button" class="btn primary" data-open-periodic-inspection="${mission.droneId}">정기점검 등록</button>`;
    else if(!advanced&&canQuick&&!ready)action=`<button type="button" class="btn primary" data-open-quick-dispatch="${mission.id}">빠른 출동 확인</button>`;
    else if(!advanced&&!assigned)action='<span class="mc-panel-note">기체와 배터리를 먼저 배정하십시오.</span>';
    else if(!advanced&&!approved)action='<span class="mc-panel-note">관제 승인을 먼저 완료하십시오.</span>';
    else if(ready)action=`<span class="mc-ready-stamp">${dateText(mission.quickDispatch?.completedAt||mission.preflightSignedAt)} 완료</span>`;
    return `<section class="mc-dispatch-panel ${advanced||ready?'ready':clearance.valid?'warning':'danger'}"><div class="mc-dispatch-head"><div><span class="mc-eyebrow">PERIODIC CLEARANCE + MISSION CHECK</span><h3>${advanced?'운항 출동기록':ready?'출동 준비 완료':clearance.valid?'빠른 출동 확인':'정기점검 필요'}</h3><p>기체 고정 상태는 정기점검 기록을 재사용하고, 배터리·통신·화물·항로·기상은 현재 임무 기준으로 확인합니다.</p></div>${action}</div><div class="mc-dispatch-steps"><div class="${clearance.valid?'done':'blocked'}"><i>${clearance.valid?'✓':'1'}</i><span>기체 정기점검</span><strong>${clearance.valid?`${fmt(clearance.remainingDays,'일')} · ${fmt(clearance.remainingHours,'h')} 잔여`:'등록 필요'}</strong></div><div class="${ready?'done':readiness.automaticPass?'current':'waiting'}"><i>${ready?'✓':'2'}</i><span>자동 상태검증</span><strong>${ready?'완료':readiness.automaticPass?'통과 가능':'확인 필요'}</strong></div><div class="${ready?'done':'waiting'}"><i>${ready?'✓':'3'}</i><span>임무 확인·서명</span><strong>${ready?'출동 가능':'대기'}</strong></div></div><div class="mc-dispatch-meta"><span>기체 <b>${mission.droneId||'미배정'}</b></span><span>배터리 <b>${mission.batteryId||'미배정'}</b></span><span>점검 ID <b>${clearance.record?.id||'-'}</b></span><span>임무점검 <b>${fmt(api.policy().quickValidityMinutes,'분')}</b></span><button type="button" class="mc-detail-toggle" data-toggle-preflight-detail="${mission.id}">${expanded?'상세 검증기록 접기':'상세 검증기록 보기'}</button></div></section>`;
  }
  function inject(html,mission){
    if(!mission||html.includes('mc-dispatch-panel'))return html;
    const expanded=state.flowUi?.expandedPreflightMissionId===mission.id;
    const marker='<section class="pf-shell';
    if(html.includes(marker))return html.replace(marker,`${panel(mission)}<section class="pf-shell mc-legacy-preflight${expanded?' is-expanded':''}`);
    const next='<div class="next-action-box">';
    if(html.includes(next))return html.replace(next,`${panel(mission)}${next}`);
    return html;
  }
  flowMissionsView=function maintenanceAwareMissionsView(){
    const html=baseMissionsView();
    const selected=state.missions.find(mission=>mission.id===state.selectedMission)||null;
    return inject(html,selected);
  };
  missionsView=flowMissionsView;
  window.dlogisMaintenanceViewIntegration={version:'1.0.0',inject,panel};
})();
