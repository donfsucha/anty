'use strict';

/*
 * Operation notification lifecycle.
 * Completed operation messages close automatically, but the countdown pauses
 * while the user is hovering, touching, or focusing the message controls.
 */
(function installNotificationLifecycle(){
  const VERSION='1.1.0';
  const SUCCESS_VISIBLE_MS=12000;
  const ERROR_VISIBLE_MS=18000;
  const MIN_RESUME_MS=4500;
  let dismissTimer=null;
  let scheduledOperationId=null;
  let scheduledDeadline=0;
  let pausedOperationId=null;
  const deadlineByOperation=new Map();
  const remainingByOperation=new Map();

  const originalMount=flowMountOperationCenter;

  function ensureUiState(){
    state.flowUi=state.flowUi&&typeof state.flowUi==='object'
      ?state.flowUi
      :{operationOpen:false,operationId:null};
    return state.flowUi;
  }

  function operationById(id){
    return (state.operations||[]).find(item=>item.id===id)||null;
  }

  function operationCandidate(){
    const ui=ensureUiState();
    const selected=ui.operationId?operationById(ui.operationId):null;
    if(selected)return selected;
    const processing=[...(state.operations||[])].reverse().find(item=>item.status==='PROCESSING');
    return processing||flowLatestOperation();
  }

  function visibleDuration(operation){
    return operation?.status==='ERROR'?ERROR_VISIBLE_MS:SUCCESS_VISIBLE_MS;
  }

  function initialDeadline(operation){
    const completed=Date.parse(operation?.completedAt||'');
    const requested=Date.parse(operation?.requestedAt||'');
    const base=Number.isFinite(completed)?completed:Number.isFinite(requested)?requested:Date.now();
    return base+visibleDuration(operation);
  }

  function operationDeadline(operation){
    if(!operation)return 0;
    if(!deadlineByOperation.has(operation.id))deadlineByOperation.set(operation.id,initialDeadline(operation));
    return deadlineByOperation.get(operation.id);
  }

  function clearDismissTimer(){
    if(dismissTimer)clearTimeout(dismissTimer);
    dismissTimer=null;
    scheduledOperationId=null;
    scheduledDeadline=0;
  }

  function removeOperationVisuals(animate=true){
    document.getElementById('flow-operation-overlay')?.remove();
    const dock=document.getElementById('flow-operation-dock');
    if(!dock)return;
    if(!animate){dock.remove();return;}
    dock.classList.add('is-leaving');
    setTimeout(()=>dock.remove(),220);
  }

  function dismissOperation(operationId,{animate=true}={}){
    if(!operationId)return;
    clearDismissTimer();
    pausedOperationId=null;
    remainingByOperation.delete(operationId);
    deadlineByOperation.delete(operationId);
    const ui=ensureUiState();
    ui.operationOpen=false;
    if(ui.operationId===operationId)ui.operationId=null;
    ui.dismissedOperationId=operationId;
    ui.dismissedAt=typeof flowNow==='function'?flowNow():new Date().toISOString();
    persist();
    removeOperationVisuals(animate);
  }

  function isDismissedOrExpired(operation){
    if(!operation||operation.status==='PROCESSING')return false;
    const ui=ensureUiState();
    return ui.dismissedOperationId===operation.id||Date.now()>=operationDeadline(operation);
  }

  function updateAutoCloseLabel(operationId,paused=false){
    const dock=document.querySelector(`#flow-operation-dock[data-operation-dock="${CSS.escape(operationId)}"]`);
    if(!dock)return;
    dock.classList.toggle('notification-paused',paused);
    const label=dock.querySelector('.operation-dock-autoclose');
    if(!label)return;
    if(paused){
      label.textContent='자동 닫힘 일시정지 · 버튼을 눌러 확인하세요.';
      return;
    }
    const operation=operationById(operationId);
    const seconds=Math.max(1,Math.ceil((operationDeadline(operation)-Date.now())/1000));
    label.textContent=`약 ${seconds}초 후 자동으로 닫힙니다.`;
  }

  function pauseDismiss(operationId){
    const operation=operationById(operationId);
    if(!operation||operation.status==='PROCESSING')return;
    const remaining=Math.max(MIN_RESUME_MS,operationDeadline(operation)-Date.now());
    remainingByOperation.set(operationId,remaining);
    pausedOperationId=operationId;
    clearDismissTimer();
    updateAutoCloseLabel(operationId,true);
  }

  function resumeDismiss(operationId){
    if(pausedOperationId!==operationId)return;
    const operation=operationById(operationId);
    pausedOperationId=null;
    if(!operation||operation.status==='PROCESSING'||ensureUiState().operationOpen)return;
    const remaining=Math.max(MIN_RESUME_MS,remainingByOperation.get(operationId)||MIN_RESUME_MS);
    deadlineByOperation.set(operationId,Date.now()+remaining);
    remainingByOperation.delete(operationId);
    updateAutoCloseLabel(operationId,false);
    scheduleDismiss(operation);
  }

  function decorateDock(dock,operation){
    if(!dock)return null;
    if(dock.dataset.lifecycleManaged==='true')return dock;
    const content=dock.innerHTML;
    const managed=document.createElement('div');
    managed.id='flow-operation-dock';
    managed.className=`${dock.className} notification-managed`;
    managed.dataset.operationDock=operation.id;
    managed.dataset.lifecycleManaged='true';
    managed.setAttribute('role','status');
    managed.setAttribute('aria-live','polite');
    managed.innerHTML=`<button type="button" class="operation-dock-main" data-operation-open aria-label="${escapeHtml(operation.title)} 상세 열기">${content}<span class="operation-dock-autoclose"></span></button><button type="button" class="operation-dock-dismiss" data-operation-dismiss="${operation.id}" aria-label="알림 닫기">×</button>`;
    dock.replaceWith(managed);

    managed.addEventListener('pointerenter',()=>pauseDismiss(operation.id));
    managed.addEventListener('pointerleave',()=>resumeDismiss(operation.id));
    managed.addEventListener('pointerdown',()=>pauseDismiss(operation.id),{passive:true});
    managed.addEventListener('focusin',()=>pauseDismiss(operation.id));
    managed.addEventListener('focusout',()=>setTimeout(()=>{
      if(!managed.contains(document.activeElement))resumeDismiss(operation.id);
    },0));

    updateAutoCloseLabel(operation.id,false);
    return managed;
  }

  function scheduleDismiss(operation){
    if(!operation||operation.status==='PROCESSING'||ensureUiState().operationOpen||pausedOperationId===operation.id)return;
    const deadline=operationDeadline(operation);
    const remaining=deadline-Date.now();
    if(remaining<=0){dismissOperation(operation.id,{animate:false});return;}
    if(dismissTimer&&scheduledOperationId===operation.id&&scheduledDeadline===deadline)return;
    clearDismissTimer();
    scheduledOperationId=operation.id;
    scheduledDeadline=deadline;
    dismissTimer=setTimeout(()=>{
      const ui=ensureUiState();
      if(ui.operationOpen||ui.operationId!==operation.id||pausedOperationId===operation.id)return;
      dismissOperation(operation.id);
    },remaining);
  }

  flowMountOperationCenter=function mountOperationCenterWithLifecycle(){
    const operation=operationCandidate();
    if(!operation){
      clearDismissTimer();
      removeOperationVisuals(false);
      return;
    }

    if(isDismissedOrExpired(operation)){
      dismissOperation(operation.id,{animate:false});
      return;
    }

    originalMount();

    if(ensureUiState().operationOpen){
      clearDismissTimer();
      return;
    }

    const dock=decorateDock(document.getElementById('flow-operation-dock'),operation);
    if(dock)scheduleDismiss(operation);
  };

  document.addEventListener('click',event=>{
    const close=event.target.closest('[data-operation-dismiss]');
    if(!close)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dismissOperation(close.dataset.operationDismiss);
  },true);

  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const dock=document.getElementById('flow-operation-dock');
    if(!dock)return;
    dismissOperation(dock.dataset.operationDock);
  });

  const originalToast=toast;
  toast=function toastWithQueueLimit(...args){
    originalToast(...args);
    const root=document.getElementById('toast-root');
    if(!root)return;
    const items=[...root.querySelectorAll('.toast')];
    items.slice(0,Math.max(0,items.length-3)).forEach(item=>item.remove());
  };

  window.dlogisNotificationLifecycle={
    version:VERSION,
    dismissOperation,
    pauseDismiss,
    resumeDismiss,
    clearDismissTimer
  };

  flowMountOperationCenter();
})();
