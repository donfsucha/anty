'use strict';

/*
 * Keeps controls stable while the user is about to click, type, or choose an item.
 * Telemetry continues to update the saved state every second, but its full-screen
 * render is postponed while an interactive control is under the pointer or focused.
 */
(function installInteractionStability(){
  const VERSION='1.0.0';
  const INTERACTIVE_SELECTOR=[
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="dialog"]',
    '.operation-dock',
    '.modal'
  ].join(',');

  let pointerX=-1;
  let pointerY=-1;
  let pointerKnown=false;
  let pointerDown=false;
  let interactionHoldUntil=0;
  let suppressedRenderCount=0;
  let pendingTelemetryRender=false;
  let lastTelemetryRenderAt=0;

  function markInteraction(duration=1200){
    interactionHoldUntil=Math.max(interactionHoldUntil,Date.now()+duration);
  }

  function interactiveAtPointer(){
    if(!pointerKnown||pointerX<0||pointerY<0)return null;
    const element=document.elementFromPoint(pointerX,pointerY);
    return element?.closest?.(INTERACTIVE_SELECTOR)||null;
  }

  function focusedInteractive(){
    const active=document.activeElement;
    if(!active||active===document.body||active===document.documentElement)return null;
    return active.closest?.(INTERACTIVE_SELECTOR)||null;
  }

  function userIsInteracting(){
    return pointerDown||Date.now()<interactionHoldUntil||Boolean(interactiveAtPointer())||Boolean(focusedInteractive());
  }

  function updatePointer(event){
    pointerX=event.clientX;
    pointerY=event.clientY;
    pointerKnown=true;
    if(event.target?.closest?.(INTERACTIVE_SELECTOR))markInteraction(900);
  }

  document.addEventListener('pointermove',updatePointer,{passive:true,capture:true});
  document.addEventListener('pointerover',event=>{
    updatePointer(event);
    if(event.target.closest?.(INTERACTIVE_SELECTOR))markInteraction(1200);
  },true);
  document.addEventListener('pointerdown',event=>{
    updatePointer(event);
    pointerDown=true;
    markInteraction(2200);
  },true);
  document.addEventListener('pointerup',event=>{
    updatePointer(event);
    pointerDown=false;
    markInteraction(900);
  },true);
  document.addEventListener('pointercancel',()=>{
    pointerDown=false;
    markInteraction(500);
  },true);
  document.addEventListener('focusin',event=>{
    if(event.target.closest?.(INTERACTIVE_SELECTOR))markInteraction(1500);
  },true);
  document.addEventListener('keydown',event=>{
    if(event.target.closest?.(INTERACTIVE_SELECTOR))markInteraction(1800);
  },true);
  document.addEventListener('click',event=>{
    if(event.target.closest?.(INTERACTIVE_SELECTOR))markInteraction(800);
  },true);
  window.addEventListener('blur',()=>{pointerDown=false;pointerKnown=false;});

  if(typeof flowTelemetryTick!=='function')return;
  const originalTelemetryTick=flowTelemetryTick;

  function stableTelemetryTick(){
    const locked=userIsInteracting();
    const activeRender=render;
    let requested=false;

    if(locked){
      render=function deferTelemetryRender(){
        requested=true;
        pendingTelemetryRender=true;
        suppressedRenderCount+=1;
      };
    }

    try{
      originalTelemetryTick();
    }finally{
      if(locked)render=activeRender;
    }

    if(!locked){
      pendingTelemetryRender=false;
      lastTelemetryRenderAt=Date.now();
    }else if(requested){
      pendingTelemetryRender=true;
    }
  }

  flowTelemetryTick=stableTelemetryTick;
  if(typeof timer!=='undefined'){
    clearInterval(timer);
    timer=setInterval(flowTelemetryTick,1000);
  }

  window.dlogisInteractionStability={
    version:VERSION,
    userIsInteracting,
    markInteraction,
    get pendingTelemetryRender(){return pendingTelemetryRender;},
    get suppressedRenderCount(){return suppressedRenderCount;},
    get lastTelemetryRenderAt(){return lastTelemetryRenderAt;}
  };
})();
