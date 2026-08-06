'use strict';

/* Keep precision-only values intact after the one-decimal UI normalizer runs. */
(function preservePrecisionRuntime(){
  const defaults={'BAT-001':0.018,'BAT-002':0.025,'BAT-003':0.012,'BAT-004':0.031,'BAT-005':0.015,'BAT-006':0.068};
  function restore(){
    state.batteries.forEach(battery=>{
      if(!Number.isFinite(Number(battery._cellDiffRaw))){
        const current=Number(battery.cellDiff);
        battery._cellDiffRaw=current>0&&current<1?current:(defaults[battery.id]??0);
      }
      battery.cellDiff=Number(battery._cellDiffRaw);
      battery.cellDiffMv=flowRound1(battery.cellDiff*1000);
    });
  }
  const previousRender=render;
  render=function renderWithPrecisionRestore(){restore();const result=previousRender();restore();return result;};
  const previousTick=flowTelemetryTick;
  flowTelemetryTick=function tickWithPrecisionRestore(){restore();const result=previousTick();restore();return result;};
  restore();
})();
