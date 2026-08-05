'use strict';

/*
 * Modal interaction fix.
 * The modal container stops bubbling, so delegated document handlers did not
 * receive clicks from Close / Mission detail buttons. Handle them in capture
 * phase before the modal stops propagation.
 */
(function enableModalActions(){
  function modalRoot(){return document.getElementById('modal-root');}
  function closeActiveModal(){
    const root=modalRoot();
    if(root)root.innerHTML='';
  }

  document.addEventListener('click',event=>{
    const root=modalRoot();
    if(!root||!root.contains(event.target))return;

    /* Mission navigation must run before the generic close action because
       this button intentionally has both navigation and close attributes. */
    const missionButton=event.target.closest('[data-select-mission][data-go-missions]');
    if(missionButton){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const missionId=missionButton.dataset.selectMission;
      const mission=state.missions.find(item=>item.id===missionId);
      if(!mission){
        closeActiveModal();
        toast('임무를 찾을 수 없습니다',missionId||'Mission ID가 없습니다.','error');
        return;
      }

      state.selectedMission=missionId;
      state.view='missions';
      state.role='admin';
      state.sidebar=false;
      closeActiveModal();
      persist();
      render();
      window.scrollTo({top:0,behavior:'smooth'});
      toast('임무 상세로 이동',`${mission.id} · ${mission.title}`,'success');
      return;
    }

    const closeButton=event.target.closest('[data-modal-close]');
    if(closeButton){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeActiveModal();
    }
  },true);

  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const root=modalRoot();
    if(root&&root.childElementCount){
      event.preventDefault();
      closeActiveModal();
    }
  },true);
})();
