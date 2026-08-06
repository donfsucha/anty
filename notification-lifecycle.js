'use strict';

/*
 * Operation notification lifecycle.
 * Completed operation docks previously remained on screen because every render
 * recreated the latest completed operation. This layer gives each dock an
 * absolute expiry, a manual close control, and a persisted dismissed state.
 */
(function installNotificationLifecycle(){
  const VERSION='1.0.0';
  const SUCCESS_VISIBLE_MS=4600;
  const ERROR_VISIBLE_MS=8500;
  let dismissTimer=null;
  let scheduledOperationId=null;
  let scheduledDeadline=0;

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

  function operationDeadline(operation){
    const completed=Date.parse(operation?.completedAt||'');
    const requested=Date.parse(operation?.requestedAt||'');
    const base=Number.isFinite(completed)?completed:Number.isFinite(requested)?requested:Date.now();
    return base+visibleDuration(operation);
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

  function decorateDock(dock,operation){
    if(!dock||dock.dataset.lifecycleManaged==='true')return dock;
    const content=dock.innerHTML;
    const managed=document.createElement('div');
    managed.id='flow-operation-dock';
    managed.className=`${dock.className} notification-managed`;
    managed.dataset.operationDock=operation.id;
    managed.dataset.lifecycleManaged='true';
    managed.setAttribute('role','status');
    managed.setAttribute('aria-live','polite');
    managed.innerHTML=`<button type="button" class="operation-dock-main" data-operation-open aria-label="${escapeHtml(operation.title)} 상세 열기">${content}<span class="operation-dock-autoclose">잠시 후 자동으로 닫힙니다.</span></button><button type="button" class="operation-dock-dismiss" data-operation-dismiss="${operation.id}" aria-label="알림 닫기">×</button>`;
    dock.replaceWith(managed);
    return managed;
  }

  function scheduleDismiss(operation){
    if(!operation||operation.status==='PROCESSING'||ensureUiState().operationOpen)return;
    const deadline=operationDeadline(operation);
    const remaining=deadline-Date.now();
    if(remaining<=0){dismissOperation(operation.id,{animate:false});return;}
    if(dismissTimer&&scheduledOperationId===operation.id&&scheduledDeadline===deadline)return;
    clearDismissTimer();
    scheduledOperationId=operation.id;
    scheduledDeadline=deadline;
    dismissTimer=setTimeout(()=>{
      const ui=ensureUiState();
      if(ui.operationOpen||ui.operationId!==operation.id)return;
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
    clearDismissTimer
  };

  flowMountOperationCenter();
})();
