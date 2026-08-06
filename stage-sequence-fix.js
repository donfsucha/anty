'use strict';

/*
 * Mission stage sequence fix.
 * A stage is completed only after its own workflow action and all prior stages are complete.
 */
(function enforceSequentialMissionStages(){
  const originalAssignResources=flowAssignResources;
  const originalValidateAction=flowValidateAction;

  function assignmentOperationCompleted(mission){
    return (state.operations||[]).some(item=>
      item.missionId===mission.id&&item.action==='AUTO_ASSIGN'&&item.status==='SUCCESS'
    );
  }

  function assignmentConfirmed(mission){
    const advancedFlightState=['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(mission.status);
    return Boolean(
      mission.resourceAssignedAt||
      assignmentOperationCompleted(mission)||
      mission.departedAt||
      advancedFlightState
    );
  }

  flowAssignResources=function flowAssignResourcesWithTimestamp(mission){
    originalAssignResources(mission);
    mission.resourceAssignedAt=flowNow();
  };

  flowValidateAction=function flowValidateActionSequential(mission,action){
    if(action==='START'&&!assignmentConfirmed(mission)){
      return '자원 배정 단계를 먼저 완료하십시오.';
    }
    return originalValidateAction(mission,action);
  };

  flowNextAction=function flowNextActionSequential(mission){
    const allDone=Object.values(mission.checks||{}).every(Boolean);
    if(mission.status==='READY')return '관제 운영자의 운항 승인이 필요합니다.';
    if(mission.status==='APPROVED'&&!assignmentConfirmed(mission))return '기체와 배터리 자원 배정을 완료하십시오.';
    if(mission.status==='APPROVED'&&!allDone)return '비행 전 안전점검을 완료하십시오.';
    if(mission.status==='APPROVED')return '이륙·임무 시작을 실행하십시오.';
    if(mission.status==='IN_FLIGHT')return '운항 수치와 배송지 접근 상태를 확인하십시오.';
    if(mission.status==='HOLDING')return '안전조건 확인 후 운항을 재개하거나 복귀하십시오.';
    if(mission.status==='RETURNING')return '거점 도착 후 착륙·임무 종료를 실행하십시오.';
    if(mission.status==='COMPLETED')return '배송증빙과 운영기록을 확인하십시오.';
    return '임무 상태를 확인하십시오.';
  };

  flowMissionStages=function flowMissionStagesSequential(mission){
    const status=mission.status;
    const allChecks=Object.values(mission.checks||{}).every(Boolean);
    const hasProof=state.proofs.some(item=>item.missionId===mission.id);
    const advancedFlightState=['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status);

    const created=Boolean(mission.id||mission.createdAt);
    const approved=created&&Boolean(
      mission.approvalState==='APPROVED'||
      mission.approvedAt||
      ['APPROVED','IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status)
    );

    /* Merely having a droneId/batteryId is a preliminary selection, not a completed assignment stage. */
    const assigned=approved&&assignmentConfirmed(mission)&&Boolean(mission.droneId&&mission.batteryId);
    const checked=assigned&&allChecks;
    const departed=checked&&Boolean(mission.departedAt||advancedFlightState);
    const delivered=departed&&Boolean(
      mission.deliveredAt||
      hasProof||
      ['DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status)
    );
    const returned=delivered&&status==='COMPLETED';
    const closed=returned&&status==='COMPLETED';

    const completed=[created,approved,assigned,checked,departed,delivered,returned,closed];
    let activeIndex=completed.findIndex(value=>!value);
    if(activeIndex<0)activeIndex=completed.length-1;

    return FLOW_STAGE_LABELS.map((label,index)=>({
      label,
      status:completed[index]?'DONE':index===activeIndex?'ACTIVE':'WAITING'
    }));
  };
})();
