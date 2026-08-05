'use strict';

/*
 * Mission stage sequence fix.
 * A later stage is never marked complete until every previous stage is complete.
 */
(function enforceSequentialMissionStages(){
  flowMissionStages=function flowMissionStagesSequential(mission){
    const status=mission.status;
    const allChecks=Object.values(mission.checks||{}).every(Boolean);
    const hasProof=state.proofs.some(item=>item.missionId===mission.id);

    const created=Boolean(mission.id||mission.createdAt);
    const approved=created&&Boolean(
      mission.approvalState==='APPROVED'||
      mission.approvedAt||
      ['APPROVED','IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status)
    );
    const assigned=approved&&Boolean(mission.droneId&&mission.batteryId);
    const checked=assigned&&allChecks;
    const departed=checked&&Boolean(
      mission.departedAt||
      ['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED'].includes(status)
    );
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
