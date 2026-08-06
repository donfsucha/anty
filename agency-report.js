'use strict';

/*
 * D-LOGIS agency report module
 * Replaces scattered CSV-style exports with concise, non-duplicated XLSX reports.
 * The default agency report is designed for institution submission: one row per mission,
 * one row per proof, one row per aircraft/battery, and no raw telemetry dump unless needed.
 */
(function installAgencyReportModule(){
  const VERSION='AGENCY-XLSX-1.0';
  const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DATE_FORMAT='yyyy-mm-dd hh:mm:ss';
  const NUM1='0.0';
  const PCT1='0.0"%"';
  const COLORS={
    navy:'0B1F3A',blue:'2874E8',blueLight:'EAF2FF',green:'0D946C',greenLight:'EAF8F3',amber:'D97706',amberLight:'FFF5E6',red:'D92D20',redLight:'FFF1F0',gray:'667085',grayLight:'F8FAFC',line:'D0D5DD',white:'FFFFFF'
  };
  const ITEM_KEYS=['airframe','battery','cargo','link','route','weather'];
  const ITEM_LABELS={airframe:'기체 외관',battery:'배터리 장착',cargo:'화물 잠금',link:'통신·GNSS',route:'항로·공역',weather:'기상·풍속'};
  let busy=false;

  function n1(value){const n=Number(value);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*10)/10:null;}
  function n6(value){const n=Number(value);return Number.isFinite(n)?Math.round(n*1e6)/1e6:null;}
  function text(value,fallback=''){return value===null||value===undefined||value===''?fallback:String(value);}
  function sourceCode(){return state?.settings?.mode==='gateway'?'GATEWAY':'SIMULATION';}
  function sourceLabel(value=sourceCode()){return value==='GATEWAY'?'실기체 게이트웨이':'시뮬레이션';}
  function statusLabel(code){return STATUS?.[code]?.[0]||text(code,'-');}
  function priorityLabelText(code){return ({URGENT:'긴급',HIGH:'높음',NORMAL:'일반'})[code]||text(code,'-');}
  function batteryStatusText(code){return ({READY:'사용 가능',IN_USE:'사용 중',CHARGING:'충전 중',QUARANTINE:'격리'})[code]||text(code,'-');}
  function drone(id){return (state.drones||[]).find(item=>item.id===id)||null;}
  function battery(id){return (state.batteries||[]).find(item=>item.id===id)||null;}
  function mission(id){return (state.missions||[]).find(item=>item.id===id)||null;}
  function currentStage(m){return typeof flowCurrentStageName==='function'?flowCurrentStageName(m):statusLabel(m?.status);}
  function approvalRef(record){return record?.items?.route?.snapshot?.approvalRef||'';}
  function recordHash(record){return record?.signoff?.recordHash||'';}
  function preflightRecord(missionId){return (state.preflightVerifications||[]).find(item=>item.missionId===missionId&&!item.supersededAt)||null;}
  function preflightLabel(record){
    if(!record)return '미등록';
    if(record.lockedAt&&record.signoff)return record.signoff.legacy?'이전 기록':'검증·서명 완료';
    const items=Object.values(record.items||{});const done=items.filter(item=>item.status==='VERIFIED').length;
    if(items.some(item=>item.status==='FAILED'))return `검증 실패 ${done}/6`;
    return `검증 진행 ${done}/6`;
  }
  function itemOk(record,key){return record?.items?.[key]?.status==='VERIFIED'?'완료':'미완료';}
  function alertCount(missionId){return (state.alerts||[]).filter(item=>!missionId||item.missionId===missionId).length;}
  function unackAlertCount(missionId){return (state.alerts||[]).filter(item=>(!missionId||item.missionId===missionId)&&!item.ack).length;}
  function commandCount(missionId){return [...(state.commandLogs||[]),...(state.operations||[])].filter(item=>item.missionId===missionId).length;}
  function latestOperation(missionId){const rows=(state.operations||[]).filter(item=>item.missionId===missionId);return rows.at(-1)||null;}
  function latestTelemetry(missionId,droneId){
    const rows=(state.telemetryLogs||[]).filter(item=>(missionId&&item.missionId===missionId)||(droneId&&item.droneId===droneId));
    return rows.sort((a,b)=>new Date(a.receivedAt||a.recordedAt||a.sentAt||0)-new Date(b.receivedAt||b.recordedAt||b.sentAt||0)).at(-1)||null;
  }
  function kstParts(value){
    if(!value)return null;const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return null;
    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts={};fmt.formatToParts(date).forEach(part=>{if(part.type!=='literal')parts[part.type]=part.value;});
    return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};
  }
  function kstDate(value){const p=kstParts(value);return p?new Date(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)):null;}
  function stamp(value=new Date()){const p=kstParts(value);return `${p.year}${String(p.month).padStart(2,'0')}${String(p.day).padStart(2,'0')}_${String(p.hour).padStart(2,'0')}${String(p.minute).padStart(2,'0')}`;}
  function kstText(value){const p=kstParts(value);return p?`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')} ${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`:'-';}
  function border(){return {top:{style:'thin',color:{argb:COLORS.line}},left:{style:'thin',color:{argb:COLORS.line}},bottom:{style:'thin',color:{argb:COLORS.line}},right:{style:'thin',color:{argb:COLORS.line}}};}
  function safeTableName(name){return name.replace(/[^A-Za-z0-9_]/g,'_').slice(0,28);}
  function colName(index){let s='';for(let n=index;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}

  async function ensureExcelJS(){
    if(window.dlogisExcelReport?.ensureExcelJS)return window.dlogisExcelReport.ensureExcelJS();
    if(window.ExcelJS)return window.ExcelJS;
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Excel 모듈 다운로드 실패'));document.head.appendChild(script);});
    if(!window.ExcelJS)throw new Error('Excel 모듈 초기화 실패');return window.ExcelJS;
  }

  function styleTitle(ws,title,subtitle,generatedAt,source){
    const last=ws.columnCount||8;ws.mergeCells(1,1,1,last);ws.mergeCells(2,1,2,last);ws.mergeCells(3,1,3,last);ws.mergeCells(4,1,4,last);
    const c1=ws.getCell(1,1);c1.value=title;c1.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.navy}};c1.font={name:'맑은 고딕',size:17,bold:true,color:{argb:COLORS.white}};c1.alignment={vertical:'middle',horizontal:'left'};ws.getRow(1).height=30;
    const c2=ws.getCell(2,1);c2.value=subtitle;c2.font={name:'맑은 고딕',size:10,color:{argb:COLORS.gray}};c2.alignment={vertical:'middle',horizontal:'left'};
    const c3=ws.getCell(3,1);c3.value=`생성시각 ${kstText(generatedAt)} KST  |  데이터 출처 ${sourceLabel(source)}  |  ${VERSION}`;c3.fill={type:'pattern',pattern:'solid',fgColor:{argb:source==='SIMULATION'?COLORS.amberLight:COLORS.blueLight}};c3.font={name:'맑은 고딕',size:9,bold:true,color:{argb:source==='SIMULATION'?COLORS.amber:COLORS.blue}};c3.alignment={vertical:'middle',wrapText:true};c3.border=border();
    const c4=ws.getCell(4,1);c4.value=source==='SIMULATION'?'※ 시연용 데이터입니다. 기관 제출 전 실기체 GATEWAY 원천 데이터 여부를 확인하십시오.':'※ 모든 시각은 Asia/Seoul(KST), 좌표는 WGS84 기준입니다.';c4.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.grayLight}};c4.font={name:'맑은 고딕',size:9,color:{argb:COLORS.gray}};c4.alignment={vertical:'middle',wrapText:true};c4.border=border();
  }
  function applyStatus(cell){const v=String(cell.value||'');let fill=COLORS.grayLight,font=COLORS.gray;if(/완료|정상|사용 가능|검증·서명|배송 완료|운항 중/.test(v)){fill=COLORS.greenLight;font=COLORS.green;}else if(/대기|승인|진행|복귀|충전|확인 필요/.test(v)){fill=COLORS.amberLight;font=COLORS.amber;}else if(/실패|격리|취소|미완료|미확인|차단|오류/.test(v)){fill=COLORS.redLight;font=COLORS.red;}cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};cell.font={name:'맑은 고딕',size:9,bold:true,color:{argb:font}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border();}
  function addSheet(wb,{name,title,subtitle,columns,rows,source,generatedAt,theme='TableStyleMedium2',tabColor=COLORS.blue}){
    const ws=wb.addWorksheet(name,{properties:{tabColor:{argb:tabColor}},views:[{showGridLines:false}]});
    ws.columns=columns.map(column=>({key:column.key,width:column.width||14}));
    styleTitle(ws,title,subtitle,generatedAt,source);
    const tableRows=rows.map(row=>columns.map(column=>row[column.key]??''));
    ws.addTable({name:safeTableName(`T_${name}`),ref:'A5',headerRow:true,totalsRow:false,style:{theme,showRowStripes:false},columns:columns.map(column=>({name:column.header,filterButton:true})),rows:tableRows});
    ws.getRow(5).height=31;ws.getRow(5).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.navy}};cell.font={name:'맑은 고딕',size:9,bold:true,color:{argb:COLORS.white}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border();});
    for(let r=6;r<=5+rows.length;r+=1){const row=ws.getRow(r);row.height=26;columns.forEach((column,i)=>{const cell=row.getCell(i+1);cell.font={name:'맑은 고딕',size:9,color:{argb:'101828'}};cell.alignment={vertical:'middle',horizontal:column.align||'left',wrapText:true};cell.border=border();if((r-6)%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FCFCFD'}};if(column.type==='date'&&cell.value){cell.numFmt=DATE_FORMAT;cell.alignment={vertical:'middle',horizontal:'center'};}if(column.type==='number'){cell.numFmt=column.format||NUM1;cell.alignment={vertical:'middle',horizontal:'right'};}if(column.type==='percent'){cell.numFmt=PCT1;cell.alignment={vertical:'middle',horizontal:'right'};}if(column.type==='coord'){cell.numFmt='0.000000';cell.alignment={vertical:'middle',horizontal:'right'};}if(column.type==='status')applyStatus(cell);if(column.type==='hash'){cell.font={name:'Consolas',size:8,color:{argb:COLORS.gray}};cell.alignment={vertical:'middle',horizontal:'left',wrapText:false};}});}
    ws.views=[{state:'frozen',xSplit:Math.min(columns.length>8?2:0,2),ySplit:5,topLeftCell:'A6',showGridLines:false}];
    ws.autoFilter={from:{row:5,column:1},to:{row:Math.max(5,5+rows.length),column:columns.length}};
    ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.45,bottom:.45,header:.2,footer:.2}};
    ws.headerFooter={oddHeader:`&LD-LOGIS&C${title}&R${sourceLabel(source)}`,oddFooter:`&L생성 ${kstText(generatedAt)} KST&CPage &P / &N&R${VERSION}`};
    ws.pageSetup.printTitlesRow='1:5';ws.pageSetup.printArea=`A1:${colName(columns.length)}${Math.max(6,5+rows.length)}`;
    return ws;
  }

  function summaryRows(){const missions=state.missions||[];const active=(typeof flowOperationalSnapshot==='function'?flowOperationalSnapshot().activeMissions:missions.filter(m=>['IN_FLIGHT','HOLDING','RETURNING','LANDING'].includes(m.status)))||[];const completed=missions.filter(m=>m.status==='COMPLETED').length;const preflights=(state.preflightVerifications||[]).filter(item=>item.lockedAt&&item.signoff&&!item.supersededAt).length;return [
    {item:'전체 임무',value:n1(missions.length),unit:'건',note:'저장된 Mission ID 기준'},
    {item:'수행 중 임무',value:n1(active.length),unit:'건',note:'비행·대기·복귀 등 운항 상태'},
    {item:'완료 임무',value:n1(completed),unit:'건',note:'배송 완료 또는 종료'},
    {item:'검증 잠금 기록',value:n1(preflights),unit:'건',note:'증빙 기반 비행 전 검증 완료'},
    {item:'배송증빙',value:n1((state.proofs||[]).length),unit:'건',note:'수령·OTP·좌표 기록'},
    {item:'미확인 경보',value:n1(unackAlertCount()),unit:'건',note:'운영자 확인 필요'},
    {item:'보고서 데이터 출처',value:sourceLabel(),unit:'',note:sourceCode()==='SIMULATION'?'시연용 데이터':'실기체 연동 데이터'}
  ];}
  function missionRows(){return (state.missions||[]).map((m,index)=>{const d=drone(m.droneId),b=battery(m.batteryId),pf=preflightRecord(m.id),op=latestOperation(m.id),proof=(state.proofs||[]).find(p=>p.missionId===m.id);return {no:index+1,missionId:m.id,orderNo:m.orderNo,title:m.title,priority:priorityLabelText(m.priority),status:statusLabel(m.status),stage:currentStage(m),progress:n1(m.progress),eta:n1(m.etaMin),origin:m.origin,destination:m.destination,drone:d?.name||'',droneId:d?.id||'',model:d?.model||'',batteryId:m.batteryId||'',batterySoc:b?n1(b.soc):null,pilot:m.pilot||'',cargo:m.cargo||'',payload:n1(m.payloadKg),recipient:m.recipient||'',approval:approvalRef(pf),preflight:preflightLabel(pf),proof:proof?'있음':'없음',alerts:alertCount(m.id),commands:commandCount(m.id),createdAt:kstDate(m.createdAt),departedAt:kstDate(m.departedAt),completedAt:kstDate(m.completedAt),lastAction:op?`${op.title||op.action||''} · ${op.status||''}`:''};});}
  function flightRows(){return (state.missions||[]).map((m,index)=>{const d=drone(m.droneId),b=battery(m.batteryId),t=latestTelemetry(m.id,m.droneId);return {no:index+1,missionId:m.id,title:m.title,drone:d?.name||'',droneId:m.droneId||'',status:statusLabel(m.status),lastData:kstDate(t?.receivedAt||t?.recordedAt||state.lastFlowTelemetryAt),altitude:n1(t?.altitude??t?.altitudeM??d?.altitude),speed:n1(t?.speed??t?.groundSpeedKmh??d?.speed),battery:n1(t?.battery??t?.batterySocPct??b?.soc??d?.battery),link:n1(t?.link??t?.linkQualityPct??d?.link),satellites:n1(t?.satellites??d?.satellites),mode:t?.flightMode||d?.flightMode||'',armed:t?.armed===undefined?(d?.armed?'ARMED':'DISARMED'):(t.armed?'ARMED':'DISARMED'),lat:n6(t?.lat??d?.lat),lng:n6(t?.lng??d?.lng),alertCount:alertCount(m.id),unack:unackAlertCount(m.id),source:sourceLabel(t?.source||sourceCode())};});}
  function verificationRows(){return (state.missions||[]).map((m,index)=>{const pf=preflightRecord(m.id);return {no:index+1,missionId:m.id,title:m.title,status:preflightLabel(pf),verificationId:pf?.id||'',approval:approvalRef(pf),airframe:itemOk(pf,'airframe'),battery:itemOk(pf,'battery'),cargo:itemOk(pf,'cargo'),link:itemOk(pf,'link'),route:itemOk(pf,'route'),weather:itemOk(pf,'weather'),signedBy:pf?.signoff?.signedBy||'',signedAt:kstDate(pf?.signoff?.signedAt),lockedAt:kstDate(pf?.lockedAt),recordHash:recordHash(pf)};});}
  function proofRows(){return (state.proofs||[]).map((p,index)=>{const m=mission(p.missionId),d=drone(m?.droneId);return {no:index+1,proofId:p.id,missionId:p.missionId,orderNo:p.orderNo||m?.orderNo||'',title:m?.title||'',recipient:p.recipient||m?.recipient||'',otp:p.otp||'',completedAt:kstDate(p.completedAt||p.deliveredAt),lat:n6(p.lat),lng:n6(p.lng),drone:d?.name||'',droneId:d?.id||'',method:p.method||'OTP·전자 인수확인',temperature:p.tempRange||'',signature:p.signature||'전자 인수확인'};});}
  function alertRows(){return (state.alerts||[]).map((a,index)=>({no:index+1,alertId:a.id,severity:a.severity||'',title:a.title||'',message:a.message||'',missionId:a.missionId||'',droneId:a.droneId||'',batteryId:a.batteryId||'',createdAt:kstDate(a.createdAt),status:a.ack?'확인 완료':'미확인',ackBy:a.acknowledgedBy||'',ackAt:kstDate(a.acknowledgedAt),current:n1(a.currentValue),threshold:n1(a.threshold),unit:a.unit||''}));}
  function assetRows(){return (state.drones||[]).map((d,index)=>{const b=battery(d.batteryId),m=(state.missions||[]).find(item=>item.droneId===d.id&&!['COMPLETED','CANCELLED'].includes(item.status));return {no:index+1,drone:d.name,droneId:d.id,model:d.model,status:statusLabel(d.status),mode:d.flightMode||'',armed:d.armed?'ARMED':'DISARMED',altitude:n1(d.altitude),speed:n1(d.speed),link:n1(d.link),satellites:n1(d.satellites),lat:n6(d.lat),lng:n6(d.lng),flightHours:n1(d.flightHours),maintenance:n1(d.maintenance),batteryId:d.batteryId||'',batteryStatus:b?batteryStatusText(b.status):'',soc:b?n1(b.soc):null,soh:b?n1(b.soh):null,temp:b?n1(b.temp):null,cellDelta:b?n1(Math.abs(Number(b.cellDiff||0))<=1?Number(b.cellDiff||0)*1000:b.cellDiff):null,cycles:b?n1(b.cycles):null,missionId:m?.id||'',missionTitle:m?.title||''};});}
  function dictionaryRows(){return [
    {field:'기관보고서 Excel',meaning:'기관 제출용 통합 요약 파일. Mission ID 기준으로 필요한 정보만 모아 중복을 줄임',rule:'기본 다운로드 권장'},
    {field:'배송증빙 Excel',meaning:'배송 완료·수령·OTP·좌표 증빙만 필요한 경우 사용하는 축약 파일',rule:'증빙 제출 요청 시 사용'},
    {field:'운영리포트 Excel',meaning:'성과·운항·자산·경보 중심의 운영관리용 축약 파일',rule:'내부 보고와 회의용'},
    {field:'원시 CSV',meaning:'가공되지 않은 단일 표 텍스트 파일',rule:'기관 제출 기본 형식에서 제외'},
    {field:'KST',meaning:'대한민국 표준시 Asia/Seoul',rule:'Excel 날짜 셀 yyyy-mm-dd hh:mm:ss'},
    {field:'WGS84',meaning:'위도·경도 좌표 기준',rule:'정확도를 위해 소수점 6자리 유지'},
    {field:'SIMULATION',meaning:'시연용 가상 데이터',rule:'실운영 증빙으로 오인하지 않도록 상단 경고 표기'},
    {field:'GATEWAY',meaning:'실기체 또는 게이트웨이 수신 데이터',rule:'기관 제출 전 원천 데이터 여부 확인'}
  ];}

  const columns={
    summary:[{header:'항목',key:'item',width:24},{header:'값',key:'value',width:14,type:'number'},{header:'단위',key:'unit',width:10},{header:'확인 내용',key:'note',width:55}],
    missions:[{header:'번호',key:'no',width:7,type:'number',format:'0'},{header:'Mission ID',key:'missionId',width:20},{header:'주문번호',key:'orderNo',width:18},{header:'임무명',key:'title',width:24},{header:'우선순위',key:'priority',width:10,type:'status'},{header:'상태',key:'status',width:12,type:'status'},{header:'현재 단계',key:'stage',width:16,type:'status'},{header:'진행률',key:'progress',width:10,type:'percent'},{header:'ETA(분)',key:'eta',width:10,type:'number'},{header:'출발지',key:'origin',width:22},{header:'배송지',key:'destination',width:24},{header:'드론명',key:'drone',width:16},{header:'기체 ID',key:'droneId',width:12},{header:'모델',key:'model',width:12},{header:'배터리',key:'batteryId',width:12},{header:'배터리 SOC',key:'batterySoc',width:12,type:'percent'},{header:'조종자',key:'pilot',width:12},{header:'화물',key:'cargo',width:22},{header:'중량(kg)',key:'payload',width:10,type:'number'},{header:'수령인',key:'recipient',width:14},{header:'운항승인 번호',key:'approval',width:20},{header:'비행 전 검증',key:'preflight',width:16,type:'status'},{header:'배송증빙',key:'proof',width:10,type:'status'},{header:'경보 수',key:'alerts',width:9,type:'number',format:'0'},{header:'명령 수',key:'commands',width:9,type:'number',format:'0'},{header:'생성시각',key:'createdAt',width:20,type:'date'},{header:'출발시각',key:'departedAt',width:20,type:'date'},{header:'완료시각',key:'completedAt',width:20,type:'date'},{header:'최근 작업',key:'lastAction',width:24}],
    flight:[{header:'번호',key:'no',width:7,type:'number',format:'0'},{header:'Mission ID',key:'missionId',width:20},{header:'임무명',key:'title',width:24},{header:'드론명',key:'drone',width:16},{header:'기체 ID',key:'droneId',width:12},{header:'상태',key:'status',width:12,type:'status'},{header:'최종 수신시각',key:'lastData',width:20,type:'date'},{header:'고도(m)',key:'altitude',width:10,type:'number'},{header:'속도(km/h)',key:'speed',width:12,type:'number'},{header:'배터리',key:'battery',width:10,type:'percent'},{header:'통신',key:'link',width:10,type:'percent'},{header:'GNSS',key:'satellites',width:10,type:'number'},{header:'비행모드',key:'mode',width:12},{header:'Armed',key:'armed',width:12,type:'status'},{header:'위도',key:'lat',width:14,type:'coord'},{header:'경도',key:'lng',width:14,type:'coord'},{header:'경보 수',key:'alertCount',width:9,type:'number',format:'0'},{header:'미확인',key:'unack',width:9,type:'number',format:'0'},{header:'데이터 출처',key:'source',width:16,type:'status'}],
    verification:[{header:'번호',key:'no',width:7,type:'number',format:'0'},{header:'Mission ID',key:'missionId',width:20},{header:'임무명',key:'title',width:24},{header:'검증상태',key:'status',width:17,type:'status'},{header:'검증 ID',key:'verificationId',width:20},{header:'운항승인 번호',key:'approval',width:20},...ITEM_KEYS.map(key=>({header:ITEM_LABELS[key],key,width:12,type:'status'})),{header:'서명자',key:'signedBy',width:12},{header:'서명시각',key:'signedAt',width:20,type:'date'},{header:'잠금시각',key:'lockedAt',width:20,type:'date'},{header:'기록 해시',key:'recordHash',width:34,type:'hash'}],
    proofs:[{header:'번호',key:'no',width:7,type:'number',format:'0'},{header:'증빙 ID',key:'proofId',width:16},{header:'Mission ID',key:'missionId',width:20},{header:'주문번호',key:'orderNo',width:18},{header:'임무명',key:'title',width:24},{header:'수령인',key:'recipient',width:14},{header:'OTP',key:'otp',width:9},{header:'완료시각',key:'completedAt',width:20,type:'date'},{header:'위도',key:'lat',width:14,type:'coord'},{header:'경도',key:'lng',width:14,type:'coord'},{header:'드론명',key:'drone',width:16},{header:'기체 ID',key:'droneId',width:12},{header:'인증방식',key:'method',width:20},{header:'온도기록',key:'temperature',width:14},{header:'인수확인',key:'signature',width:18,type:'status'}],
    alerts:[{header:'번호',key:'no',width:7,type:'number',format:'0'},{header:'경보 ID',key:'alertId',width:16},{header:'등급',key:'severity',width:10,type:'status'},{header:'제목',key:'title',width:26},{header:'내용',key:'message',width:45},{header:'Mission ID',key:'missionId',width:20},{header:'기체 ID',key:'droneId',width:12},{header:'배터리 ID',key:'batteryId',width:12},{header:'발생시각',key:'createdAt',width:20,type:'date'},{header:'확인상태',key:'status',width:12,type:'status'},{header:'확인자',key:'ackBy',width:12},{header:'확인시각',key:'ackAt',width:20,type:'date'},{header:'현재값',key:'current',width:10,type:'number'},{header:'기준값',key:'threshold',width:10,type:'number'},{header:'단위',key:'unit',width:8}],
    assets:[{header:'번호',key:'no',width:7,type:'number',format:'0'},{header:'드론명',key:'drone',width:16},{header:'기체 ID',key:'droneId',width:12},{header:'모델',key:'model',width:12},{header:'상태',key:'status',width:12,type:'status'},{header:'비행모드',key:'mode',width:12},{header:'Armed',key:'armed',width:11,type:'status'},{header:'고도',key:'altitude',width:9,type:'number'},{header:'속도',key:'speed',width:9,type:'number'},{header:'통신',key:'link',width:9,type:'percent'},{header:'GNSS',key:'satellites',width:9,type:'number'},{header:'위도',key:'lat',width:14,type:'coord'},{header:'경도',key:'lng',width:14,type:'coord'},{header:'누적비행(h)',key:'flightHours',width:12,type:'number'},{header:'정비잔여(h)',key:'maintenance',width:12,type:'number'},{header:'배터리',key:'batteryId',width:12},{header:'배터리상태',key:'batteryStatus',width:12,type:'status'},{header:'SOC',key:'soc',width:9,type:'percent'},{header:'SOH',key:'soh',width:9,type:'percent'},{header:'온도',key:'temp',width:9,type:'number'},{header:'셀편차(mV)',key:'cellDelta',width:12,type:'number'},{header:'사이클',key:'cycles',width:9,type:'number'},{header:'연결 Mission ID',key:'missionId',width:20},{header:'연결 임무',key:'missionTitle',width:24}],
    dictionary:[{header:'구분',key:'field',width:22},{header:'의미',key:'meaning',width:56},{header:'사용 기준',key:'rule',width:45}]
  };

  function buildWorkbook(ExcelJS,kind='agency'){
    if(typeof flowReconcileState==='function')flowReconcileState();
    const wb=new ExcelJS.Workbook();const generatedAt=new Date();const source=sourceCode();
    wb.creator='D-LOGIS CONTROL';wb.lastModifiedBy='D-LOGIS CONTROL';wb.created=generatedAt;wb.modified=generatedAt;wb.company='D-LOGIS';wb.title=kind==='proofs'?'D-LOGIS 배송증빙 보고서':kind==='operations'?'D-LOGIS 운영리포트':'D-LOGIS 기관보고서';wb.subject='드론배송 통합 운영기록';wb.description='중복 원시데이터를 제외하고 기관 보고에 필요한 핵심 정보만 정리한 XLSX 보고서';
    addSheet(wb,{name:'00_제출요약',title:'D-LOGIS 기관 제출 요약',subtitle:'임무·검증·운항·증빙·자산의 핵심값만 요약합니다.',columns:columns.summary,rows:summaryRows(),source,generatedAt,tabColor:COLORS.navy});
    if(kind!=='proofs')addSheet(wb,{name:'01_임무별_종합',title:'임무별 종합 현황',subtitle:'Mission ID당 한 행으로 상태·자원·검증·증빙을 연결합니다.',columns:columns.missions,rows:missionRows(),source,generatedAt,tabColor:COLORS.blue});
    if(kind!=='proofs')addSheet(wb,{name:'02_운항안전_요약',title:'운항·안전 요약',subtitle:'반복 텔레메트리 대신 임무별 최종 수신값과 경보 건수를 요약합니다.',columns:columns.flight,rows:flightRows(),source,generatedAt,tabColor:COLORS.green});
    if(kind==='agency')addSheet(wb,{name:'03_검증승인_요약',title:'비행 전 검증·승인 요약',subtitle:'6개 검증항목과 승인번호, 서명·해시를 임무별로 압축 표시합니다.',columns:columns.verification,rows:verificationRows(),source,generatedAt,tabColor:COLORS.amber});
    addSheet(wb,{name:'04_배송증빙',title:'배송증빙',subtitle:'배송완료, 수령, OTP, 완료좌표만 별도로 제출할 수 있게 정리합니다.',columns:columns.proofs,rows:proofRows(),source,generatedAt,tabColor:COLORS.green});
    if(kind!=='proofs')addSheet(wb,{name:'05_안전경보_조치',title:'안전경보·조치 요약',subtitle:'경보는 중복 임무정보를 제외하고 발생·확인 상태 중심으로 기록합니다.',columns:columns.alerts,rows:alertRows(),source,generatedAt,tabColor:COLORS.red});
    if(kind!=='proofs')addSheet(wb,{name:'06_자산배터리_현황',title:'기체·배터리 현황',subtitle:'기체와 장착 배터리를 한 행에 묶어 중복표를 줄였습니다.',columns:columns.assets,rows:assetRows(),source,generatedAt,tabColor:COLORS.blue});
    addSheet(wb,{name:'10_용어_기준',title:'문서 용어·제출 기준',subtitle:'보고서의 각 형식과 필드 의미를 설명합니다.',columns:columns.dictionary,rows:dictionaryRows(),source,generatedAt,tabColor:COLORS.gray});
    return {wb,generatedAt};
  }
  function save(buffer,fileName){const blob=new Blob([buffer],{type:XLSX_MIME});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function reportLabel(kind){return kind==='proofs'?'배송증빙 Excel':kind==='operations'?'운영리포트 Excel':'기관보고서 Excel';}
  function filePrefix(kind){return kind==='proofs'?'DLOGIS_배송증빙':kind==='operations'?'DLOGIS_운영리포트':'DLOGIS_기관보고서';}
  async function exportAgencyReport(kind='agency'){
    if(busy)return;busy=true;patchButtons();toast(`${reportLabel(kind)} 생성 중`,'중복 원시데이터를 제외하고 핵심 시트만 정리합니다.','info');
    try{const ExcelJS=await ensureExcelJS();const {wb,generatedAt}=buildWorkbook(ExcelJS,kind);const buffer=await wb.xlsx.writeBuffer();save(buffer,`${filePrefix(kind)}_${stamp(generatedAt)}.xlsx`);toast(`${reportLabel(kind)} 생성 완료`,'기관 제출용 서식·필터·KST 날짜가 적용되었습니다.','success');}
    catch(error){console.error(error);toast('보고서 생성 실패',error.message||'Excel 파일 생성 중 문제가 발생했습니다.','error');}
    finally{busy=false;patchButtons();}
  }

  function convertButton(button,kind){
    if(!button)return;button.dataset.agencyReport=kind;delete button.dataset.exportCsv;delete button.dataset.exportWorkbook;delete button.dataset.exportProof;delete button.dataset.exportReport;button.classList.add('agency-report-btn');button.disabled=busy;button.innerHTML=busy?'Excel 생성 중...':reportLabel(kind);button.title='CSV가 아닌 기관 보고용 XLSX 파일로 저장합니다.';
  }
  function patchButtons(){
    document.querySelectorAll('[data-export-csv],[data-export-workbook]').forEach(button=>convertButton(button,'agency'));
    document.querySelectorAll('[data-export-proof]').forEach(button=>convertButton(button,'proofs'));
    document.querySelectorAll('[data-export-report]').forEach(button=>convertButton(button,'operations'));
    const reportPage=document.querySelector('[data-app-view="reports"] .page-head .actions');
    if(reportPage&&!reportPage.querySelector('[data-agency-report="agency"]')){const b=document.createElement('button');b.className='btn primary agency-report-btn';b.dataset.agencyReport='agency';b.textContent='기관보고서 Excel';reportPage.prepend(b);}
  }
  const previousRender=render;render=function renderWithAgencyReports(){const result=previousRender();queueMicrotask(patchButtons);return result;};
  exportMissions=()=>exportAgencyReport('agency');
  window.dlogisAgencyReports={version:VERSION,exportAgencyReport,buildWorkbook};
  document.addEventListener('click',event=>{const button=event.target.closest('[data-agency-report]');if(!button)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();exportAgencyReport(button.dataset.agencyReport||'agency');},true);
  const observer=new MutationObserver(()=>patchButtons());observer.observe(document.documentElement,{childList:true,subtree:true});
  patchButtons();
})();
