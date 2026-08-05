'use strict';

/* Rebind the original router names to the latest patched view functions. */
(function bindLatestOperationalViews(){
  dashboard=flowDashboard;
  missionsView=flowMissionsView;
  fleetView=flowFleetView;
  batteryView=flowBatteryView;
  safetyView=flowSafetyView;
  proofsView=flowProofsView;
  reportsView=flowReportsView;
  pilotView=flowPilotView;
  recipientView=flowRecipientView;
})();
