'use strict';

/*
 * Button stability layer.
 * - Prevents type-less buttons from submitting a surrounding form.
 * - Keeps one user click mapped to one action.
 * - Restores the current screen only if an unexpected runtime error empties #app.
 */
(function installButtonStability(){
  let scheduled=false;
  let recovering=false;

  function normalizeButtons(){
    scheduled=false;
    document.querySelectorAll('button:not([type])').forEach(button=>{
      button.type='button';
    });
  }

  function scheduleNormalize(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(normalizeButtons);
  }

  function recoverEmptyApp(){
    if(recovering||typeof state==='undefined'||!state.role)return;
    const root=document.getElementById('app');
    if(!root||root.childElementCount>0)return;
    recovering=true;
    try{
      if(typeof render==='function')render();
      if(typeof toast==='function')toast('화면 복구 완료','현재 역할과 작업 화면을 다시 불러왔습니다.','warning');
    }finally{
      recovering=false;
    }
  }

  const previousRender=render;
  render=function renderWithStableButtons(){
    const result=previousRender();
    scheduleNormalize();
    return result;
  };

  document.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(!button.type)button.type='button';
    requestAnimationFrame(recoverEmptyApp);
  },true);

  window.addEventListener('error',event=>{
    console.error('D-LOGIS runtime error',event.error||event.message);
    requestAnimationFrame(recoverEmptyApp);
  });

  window.addEventListener('unhandledrejection',event=>{
    console.error('D-LOGIS unhandled rejection',event.reason);
    requestAnimationFrame(recoverEmptyApp);
  });

  window.dlogisButtonStability={version:'1.0.0',normalizeButtons,recoverEmptyApp};
  scheduleNormalize();
})();
