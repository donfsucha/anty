'use strict';

/*
 * Renders report controls at the view source instead of removing and rebuilding
 * them after paint. This prevents the report button from briefly disappearing.
 */
(function installStableReportControls(){
  const VERSION='1.0.0';
  const LABEL='종합보고서 Excel';
  const LEGACY_ATTRIBUTES=[
    'data-export-csv',
    'data-export-workbook',
    'data-export-proof',
    'data-export-report',
    'data-agency-report',
    'data-preflight-export',
    'data-export-preflight-xlsx'
  ];
  const attributePattern=LEGACY_ATTRIBUTES.join('|');
  const legacyButtonPattern=new RegExp(`<button\\b(?=[^>]*(?:${attributePattern}))[^>]*>[\\s\\S]*?<\\/button>`,'gi');

  function removeLegacyReportButtons(html){
    return String(html||'').replace(legacyButtonPattern,'');
  }

  function addUnifiedReportButton(html){
    const clean=removeLegacyReportButtons(html);
    if(clean.includes('data-unified-report'))return clean;
    const button=`<button type="button" class="btn primary unified-report-btn" data-unified-report="agency" title="임무·운항·검증·배송증빙·경보·자산 데이터를 하나의 XLSX 파일로 저장합니다.">${LABEL}</button>`;
    return clean.replace('<div class="actions">',`<div class="actions">${button}`);
  }

  const originalMissionsView=missionsView;
  const originalProofsView=proofsView;
  const originalReportsView=reportsView;

  missionsView=function missionsViewWithoutDuplicateReports(...args){
    return removeLegacyReportButtons(originalMissionsView(...args));
  };
  proofsView=function proofsViewWithoutDuplicateReports(...args){
    return removeLegacyReportButtons(originalProofsView(...args));
  };
  reportsView=function reportsViewWithStableUnifiedReport(...args){
    return addUnifiedReportButton(originalReportsView(...args));
  };

  window.dlogisStableReportControls={
    version:VERSION,
    removeLegacyReportButtons,
    addUnifiedReportButton
  };
})();
