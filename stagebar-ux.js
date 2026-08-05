'use strict';

/* Mission stepper usability patch: completed/current/waiting/error are visually distinct. */
(function applyMissionStagebarUx(){
  function stageStateLabel(status){
    if(status==='DONE')return '완료';
    if(status==='ACTIVE')return '현재';
    return '대기';
  }

  function operationTone(operation){
    if(operation?.status==='ERROR')return 'error';
    if(operation?.status==='PROCESSING')return 'processing';
    if(operation?.status==='SUCCESS')return 'success';
    return 'waiting';
  }

  function summaryStatus(operation,mission){
    if(operation?.status==='ERROR')return `작업 실패 · ${operation.message||'원인을 확인해 주세요.'}`;
    if(operation?.status==='PROCESSING')return `작업 진행 중 · ${operation.message||'처리 상태를 확인하고 있습니다.'}`;
    if(operation?.status==='SUCCESS')return `최근 작업 완료 · ${operation.title}`;
    return '현재 단계의 작업을 시작할 수 있습니다.';
  }

  flowStageBar=function flowStageBarV2(mission){
    const stages=flowMissionStages(mission);
    const operation=flowLatestOperation(mission.id);
    let activeIndex=stages.findIndex(stage=>stage.status==='ACTIVE');
    if(activeIndex<0)activeIndex=Math.max(0,stages.length-1);
    const currentStage=stages[activeIndex]||stages.at(-1);
    const completedCount=stages.filter(stage=>stage.status==='DONE').length;
    const hasError=operation?.status==='ERROR';

    const items=stages.map((stage,index)=>{
      const isError=hasError&&index===activeIndex;
      const stateClass=isError?'error':stage.status==='DONE'?'done':stage.status==='ACTIVE'?'active':'waiting';
      const next=stages[index+1];
      let connector='waiting';
      if(index<stages.length-1){
        if(stage.status==='DONE'&&next?.status==='DONE')connector='done';
        else if(stage.status==='DONE'&&next?.status==='ACTIVE')connector=hasError?'error':'active';
        else if(isError)connector='error';
      }
      const marker=isError?'!':stage.status==='DONE'?'✓':String(index+1);
      const currentAttr=stage.status==='ACTIVE'?' aria-current="step"':'';
      return `<div class="stage-item-v2 ${stateClass}" role="listitem"${currentAttr}>
        <div class="stage-marker-v2"><i>${marker}</i>${stage.status==='ACTIVE'?'<b>현재</b>':''}</div>
        <span class="stage-name-v2">${escapeHtml(stage.label)}</span>
        <small class="stage-state-v2">${isError?'문제':stageStateLabel(stage.status)}</small>
        ${index<stages.length-1?`<span class="stage-connector-v2 ${connector}" aria-hidden="true"></span>`:''}
      </div>`;
    }).join('');

    const tone=operationTone(operation);
    return `<section class="mission-stage-shell" aria-label="임무 진행 현황">
      <div class="mission-stage-head-v2">
        <div><strong>임무 진행 단계</strong><small>${completedCount}/${stages.length}단계 완료</small></div>
        <div class="stage-legend-v2" aria-label="단계 색상 안내"><span class="done">완료</span><span class="active">현재</span><span class="waiting">대기</span></div>
      </div>
      <div class="mission-stage-scroll-v2"><div class="mission-stagebar-v2" role="list">${items}</div></div>
      <div class="stage-summary-v2 ${tone}">
        <div><span>현재 단계</span><strong>${escapeHtml(currentStage?.label||'종료·증빙')}</strong></div>
        <div><span>현재 상태</span><strong>${escapeHtml(summaryStatus(operation,mission))}</strong></div>
        <div><span>다음 작업</span><strong>${escapeHtml(mission.status==='COMPLETED'?'모든 단계가 완료되었습니다.':flowNextAction(mission))}</strong></div>
      </div>
    </section>`;
  };
})();
