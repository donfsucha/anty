'use strict';

/*
 * Single report mode.
 * Keeps one visible report export only: 종합보고서 Excel on the 운영리포트 screen.
 * All CSV/proof/operations/agency export buttons are removed from other screens.
 */
(function installUnifiedReportMode(){
  const VERSION='1.0.0';
  const LABEL='종합보고서 Excel';
  const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const REPORT_SELECTOR=[
    '[data-export-csv]',
    '[data-export-workbook]',
    '[data-export-proof]',
    '[data-export-report]',
    '[data-agency-report]',
    '[data-unified-report]'
  ].join(',');
  let scheduled=false;
  let exporting=false;

  function kstParts(value=new Date()){
    const date=value instanceof Date?value:new Date(value);
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts={};
    formatter.formatToParts(date).forEach(part=>{if(part.type!=='literal')parts[part.type]=part.value;});
    return parts;
  }

  function fileStamp(value=new Date()){
    const p=kstParts(value);
    return `${p.year}${p.month}${p.day}_${p.hour}${p.minute}`;
  }

  function toastSafe(title,message,type='info'){
    if(typeof toast==='function')toast(title,message,type);
  }

  function ensureExcelJS(){
    if(window.dlogisExcelReport?.ensureExcelJS)return window.dlogisExcelReport.ensureExcelJS();
    if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-dlogis-unified-exceljs]');
      if(existing){
        existing.addEventListener('load',()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('Excel 모듈 초기화 실패')),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Excel 모듈 다운로드 실패')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.async=true;
      script.crossOrigin='anonymous';
      script.dataset.dlogisUnifiedExceljs='1';
      script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('Excel 모듈 초기화 실패'));
      script.onerror=()=>reject(new Error('Excel 모듈 다운로드 실패'));
      document.head.appendChild(script);
    });
  }

  function saveXlsx(buffer,generatedAt){
    const blob=new Blob([buffer],{type:XLSX_MIME});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=`DLOGIS_종합보고서_${fileStamp(generatedAt)}.xlsx`;
    anchor.rel='noopener';
    anchor.type=XLSX_MIME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function exportUnifiedReport(){
    if(exporting)return;
    if(!window.dlogisAgencyReports?.buildWorkbook){
      toastSafe('보고서 생성 불가','보고서 모듈을 아직 불러오지 못했습니다. 새로고침 후 다시 실행하십시오.','error');
      return;
    }
    exporting=true;
    normalizeReportButtons();
    toastSafe('종합보고서 생성 중','임무·운항·검증·배송증빙·경보·자산 데이터를 하나의 Excel 파일로 정리합니다.','info');
    try{
      const ExcelJS=await ensureExcelJS();
      const {wb,generatedAt}=window.dlogisAgencyReports.buildWorkbook(ExcelJS,'agency');
      wb.title='D-LOGIS 종합보고서';
      wb.subject='드론 배송 종합 운영·검증·증빙 보고서';
      wb.description='기관 제출용 단일 종합 XLSX 보고서';
      const buffer=await wb.xlsx.writeBuffer();
      saveXlsx(buffer,generatedAt||new Date());
      toastSafe('종합보고서 생성 완료','Excel 전용 .xlsx 형식으로 저장되었습니다.','success');
    }catch(error){
      console.error(error);
      toastSafe('종합보고서 생성 실패',error.message||'Excel 파일 생성 중 문제가 발생했습니다.','error');
    }finally{
      exporting=false;
      normalizeReportButtons();
    }
  }

  function removeReportButtons(){
    document.querySelectorAll(REPORT_SELECTOR).forEach(button=>button.remove());
  }

  function normalizeReportButtons(){
    scheduled=false;
    removeReportButtons();
    if(typeof state==='undefined'||state.role!=='admin'||state.view!=='reports')return;
    const actions=document.querySelector('.page-head .actions')||document.querySelector('.page-head');
    if(!actions)return;
    const button=document.createElement('button');
    button.type='button';
    button.className='btn primary unified-report-btn';
    button.dataset.unifiedReport='agency';
    button.textContent=exporting?'Excel 생성 중...':LABEL;
    button.disabled=exporting;
    button.title='CSV 없이 하나의 기관 제출용 XLSX 파일로 저장합니다.';
    actions.prepend(button);
  }

  function scheduleNormalize(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(normalizeReportButtons);
  }

  const previousRender=render;
  render=function renderWithUnifiedReportMode(){
    const result=previousRender();
    scheduleNormalize();
    return result;
  };

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-unified-report]');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    exportUnifiedReport();
  },true);

  window.dlogisUnifiedReportMode={version:VERSION,normalizeReportButtons,exportUnifiedReport};
  scheduleNormalize();
})();
