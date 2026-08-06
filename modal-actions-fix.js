'use strict';

/*
 * Modal interaction rules.
 * - Clicking inside the popup never closes it.
 * - Clicking the dimmed backdrop never closes it.
 * - Only the top-right X button, the bottom Close button, or the Mission detail
 *   navigation button can end the popup interaction.
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

    /* Mission navigation must run before close handling because this button
       intentionally also carries data-modal-close. */
    const missionButton=event.target.closest('button[data-select-mission][data-go-missions]');
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

    /* The backdrop also has data-modal-close in legacy markup. Restricting the
       selector to BUTTON prevents the popup or backdrop from closing on click. */
    const closeButton=event.target.closest('button[data-modal-close]');
    if(closeButton){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeActiveModal();
    }
  },true);
})();
