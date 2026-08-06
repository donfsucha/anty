'use strict';

/*
 * Adds stable page/view hooks after every render.
 * The visual work remains in workspace-layout.css; this file only labels the
 * current screen and turns dense data tables into readable cards on phones.
 */
(function installLayoutOptimizer(){
  let queued=false;

  function labelTable(table){
    const headers=[...table.querySelectorAll('thead th')].map(cell=>cell.textContent.trim());
    table.classList.add('responsive-data-table');
    table.querySelectorAll('tbody tr').forEach(row=>{
      [...row.children].forEach((cell,index)=>{
        if(cell.tagName==='TD'&&headers[index])cell.dataset.label=headers[index];
      });
    });
  }

  function markMissionWorkspace(page){
    const workspace=page.querySelector('.split');
    if(!workspace)return;
    workspace.classList.add('mission-workspace');
    const panes=[...workspace.children];
    const listPane=panes[0];
    const detailPane=panes.find(node=>node.classList?.contains('detail-panel'))||panes[1];
    if(listPane){
      listPane.classList.add('mission-list-pane');
      listPane.setAttribute('aria-label','배송임무 목록');
      const table=listPane.querySelector('.table');
      if(table){table.classList.add('mission-table');labelTable(table);}
      const tableWrap=listPane.querySelector('.table-wrap');
      if(tableWrap){tableWrap.tabIndex=0;tableWrap.setAttribute('aria-label','배송임무 목록 스크롤 영역');}
    }
    if(detailPane){
      detailPane.classList.add('mission-detail-pane');
      detailPane.setAttribute('aria-label','선택 임무 상세정보');
    }
  }

  function optimizeLayout(){
    queued=false;
    if(typeof state==='undefined')return;
    const role=state.role||'welcome';
    const view=role==='admin'?(state.view||'dashboard'):role;
    document.body.dataset.appRole=role;
    document.body.dataset.appView=view;
    const page=document.querySelector('.page');
    if(!page)return;
    page.classList.add('layout-optimized');
    page.dataset.view=view;
    page.querySelectorAll('.table').forEach(labelTable);
    if(view==='missions')markMissionWorkspace(page);
  }

  function scheduleOptimize(){
    if(queued)return;queued=true;
    requestAnimationFrame(optimizeLayout);
  }

  const baseRender=render;
  render=function renderWithOptimizedLayout(){
    const result=baseRender();
    scheduleOptimize();
    return result;
  };

  window.addEventListener('resize',scheduleOptimize,{passive:true});
  window.addEventListener('orientationchange',scheduleOptimize,{passive:true});
  scheduleOptimize();
})();
