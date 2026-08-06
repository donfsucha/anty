'use strict';

/* Restore the browser's native observer immediately after agency-report.js. */
(function releaseAgencyReportObserverGuard(){
  const NativeMutationObserver=window.__dlogisNativeMutationObserver;
  if(!NativeMutationObserver)return;
  window.MutationObserver=NativeMutationObserver;
  delete window.__dlogisNativeMutationObserver;
})();
