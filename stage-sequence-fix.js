'use strict';

/*
 * Mission stage sequence fix.
 * A stage is completed only after its own workflow action and all prior stages are complete.
 */
(function enforceSequentialMissionStages(){
  const originalAssignResources=flowAssignResources;

  flowAssignResources=function flowAssignResourcesWithTimestamp(mission){
    originalAssignResources(mission);
    mission.resourceAssignedAt=flowNow();
  };

  flowMissionStages=function flowMissionStagesSequential(mission){
    const status=mission.status;
    const allChecks=Object.values(mission.checks||{}).every(Boolean);
    const hasProof=state.proofs.some(item=>item.missionId===mission.id);
    const advancedFlightState=['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status);
    const assignmentOperation=(state.operations||[]).some(item=>
      item.missionId===mission.id&&item.action==='AUTO_ASSIGN'&&item.status==='SUCCESS'
    );

    const created=Boolean(mission.id||mission.createdAt);
    const approved=created&&Boolean(
      mission.approvalState==='APPROVED'||
      mission.approvedAt||
      ['APPROVED','IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status)
    );

    /* Merely having a droneId/batteryId is a preliminary selection, not a completed assignment stage. */
    const assignmentConfirmed=Boolean(
      mission.resourceAssignedAt||
      assignmentOperation||
      mission.departedAt||
      advancedFlightState
    );
    const assigned=approved&&assignmentConfirmed&&Boolean(mission.droneId&&mission.batteryId);
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
