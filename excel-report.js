'use strict';

/*
 * Professional XLSX reporting for D-LOGIS.
 * - Replaces the flat CSV export with a formatted, multi-sheet workbook.
 * - All display dates are KST wall-clock values.
 * - Operational numbers use one decimal place; WGS84 coordinates retain six decimals.
 */
(function installProfessionalExcelReport(){
  const REPORT_VERSION='XLSX-1.0';
  const EXCELJS_URLS=[
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    'https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js'
  ];
  const COLORS={
    navy:'0B1F3A',navy2:'173D6D',blue:'2874E8',blueLight:'EAF2FF',green:'0D946C',greenLight:'EAF8F3',
    amber:'D97706',amberLight:'FFF5E6',red:'D92D20',redLight:'FFF0EF',violet:'6D4AFF',violetLight:'F0EDFF',
    gray900:'101828',gray700:'344054',gray600:'475467',gray500:'667085',gray300:'D0D5DD',gray200:'EAECF0',gray100:'F2F4F7',white:'FFFFFF'
  };
  const DATE_FORMAT='yyyy-mm-dd hh:mm:ss';
  const NUMBER_FORMAT='0.0';
  const PERCENT_FORMAT='0.0"%"';
  const ITEM_TITLES={airframe:'기체 외관·프로펠러',battery:'배터리 장착·잠금',cargo:'화물 적재·잠금',link:'통신·GNSS 링크',route:'항로·공역 승인',weather:'기상·풍속'};
  const ITEM_METHODS={airframe:'현장 사진 + 직접 확인',battery:'BMS 자동검증',cargo:'실측 중량 + 적재 사진',link:'텔레메트리 자동검증',route:'승인번호 + 항로 지문',weather:'현장 풍속·가시거리'};
  let libraryPromise=null;
  let exporting=false;

  function excelIcon(){return typeof ICONS!=='undefined'&&ICONS.download?ICONS.download:'⇩';}
  function asArray(value){return Array.isArray(value)?value:[];}
  function text(value,fallback=''){return value===null||value===undefined?fallback:String(value);}
  function number1(value){const n=Number(value);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*10)/10:0;}
  function number6(value){const n=Number(value);return Number.isFinite(n)?Math.round(n*1000000)/1000000:null;}
  function statusLabel(code){return typeof STATUS!=='undefined'&&STATUS[code]?STATUS[code][0]:text(code,'-');}
  function priorityText(value){return ({URGENT:'긴급',HIGH:'높음',NORMAL:'일반'})[value]||text(value,'-');}
  function batteryStatusText(value){return ({READY:'사용 가능',IN_USE:'사용 중',CHARGING:'충전 중',QUARANTINE:'격리'})[value]||text(value,'-');}
  function dataSource(){return state.settings?.mode==='gateway'?'GATEWAY':'SIMULATION';}
  function sourceText(value){return ({SIMULATION:'시뮬레이션',GATEWAY:'실기체 게이트웨이',SYSTEM:'시스템',MANUAL:'수동 입력'})[value]||text(value,'-');}
  function kstParts(value){
    if(!value)return null;const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return null;
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts={};formatter.formatToParts(date).forEach(part=>{if(part.type!=='literal')parts[part.type]=part.value;});
    return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};
  }
  function kstDate(value){const p=kstParts(value);return p?new Date(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)):null;}
  function kstText(value){
    const p=kstParts(value);if(!p)return '-';
    return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')} ${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`;
  }
  function fileStamp(value=new Date()){
    const p=kstParts(value);return p?`${p.year}${String(p.month).padStart(2,'0')}${String(p.day).padStart(2,'0')}_${String(p.hour).padStart(2,'0')}${String(p.minute).padStart(2,'0')}`:'report';
  }
  function currentStage(mission){return typeof flowCurrentStageName==='function'?flowCurrentStageName(mission):statusLabel(mission.status);}
  function latestOperation(missionId){
    const rows=asArray(state.operations).filter(item=>item.missionId===missionId);
    return rows.length?rows[rows.length-1]:null;
  }
  function droneFor(id){return asArray(state.drones).find(item=>item.id===id)||null;}
  function batteryFor(id){return asArray(state.batteries).find(item=>item.id===id)||null;}
  function proofFor(missionId){return asArray(state.proofs).find(item=>item.missionId===missionId)||null;}
  function preflightFor(missionId){return asArray(state.preflightVerifications).find(item=>item.missionId===missionId&&!item.supersededAt)||null;}
  function routeApproval(record){return record?.items?.route?.snapshot?.approvalRef||'';}
  function preflightStatus(record){
    if(!record)return '미등록';
    if(record.lockedAt&&record.signoff)return record.signoff.legacy?'이전 기록':'검증·서명 완료';
    const items=Object.values(record.items||{});const verified=items.filter(item=>item.status==='VERIFIED').length;
    if(items.some(item=>item.status==='FAILED'))return `검증 실패 (${verified}/6)`;
    return `검증 진행 (${verified}/6)`;
  }
  function evidenceSummary(key,item){
    const s=item?.snapshot||{};
    if(key==='airframe')return [s.physicalConfirmed?'현장 확인 완료':'현장 확인 미완료',s.note].filter(Boolean).join(' · ');
    if(key==='battery')return `SOC ${number1(s.soc)}% / SOH ${number1(s.soh)}% / ${number1(s.temperatureC)}℃ / 셀 편차 ${number1(s.cellDeltaMv)}mV`;
    if(key==='cargo')return `신고 ${number1(s.declaredWeightKg)}kg / 실측 ${number1(s.measuredWeightKg)}kg / 오차 ${number1(s.weightDifferenceKg)}kg / 잠금 ${s.latchConfirmed?'확인':'미확인'}`;
    if(key==='link')return `통신 ${number1(s.linkPct)}% / GNSS ${number1(s.satellites)}개 / ${text(s.flightMode,'-')} / 수신지연 ${s.dataAgeSec===null||s.dataAgeSec===undefined?'-':number1(s.dataAgeSec)+'초'}`;
    if(key==='route')return `승인 ${text(s.approvalRef,'-')} / 항로 지문 ${text(s.routeHash,'-')}`;
    if(key==='weather')return `풍속 ${number1(s.windMs)}m/s / 가시거리 ${number1(s.visibilityKm)}km / ${text(s.weatherSource,'-')}`;
    return item?.note||'';
  }
  function operationalSnapshot(){
    if(typeof flowOperationalSnapshot==='function')return flowOperationalSnapshot();
    const activeStatuses=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);
    const activeMissions=asArray(state.missions).filter(item=>activeStatuses.has(item.status));
    const pairs=activeMissions.map(mission=>({mission,drone:droneFor(mission.droneId),battery:batteryFor(mission.batteryId)}));
    return {activeMissions,pairs,activeDrones:pairs.map(item=>item.drone).filter(Boolean),activeBatteries:pairs.map(item=>item.battery).filter(Boolean),mapActiveCount:pairs.filter(item=>item.drone).length,audit:state.consistencyAudit||null};
  }

  function loadScript(url){
    return new Promise((resolve,reject)=>{
      const prior=[...document.scripts].find(script=>script.src===url);
      if(prior){if(window.ExcelJS)return resolve(window.ExcelJS);prior.addEventListener('load',()=>resolve(window.ExcelJS),{once:true});prior.addEventListener('error',()=>reject(new Error('Excel 모듈 로딩 실패')),{once:true});return;}
      const script=document.createElement('script');script.src=url;script.async=true;script.crossOrigin='anonymous';script.dataset.dlogisExceljs='1';
      script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('Excel 모듈 초기화 실패'));
      script.onerror=()=>{script.remove();reject(new Error('Excel 모듈 다운로드 실패'));};document.head.appendChild(script);
    });
  }
  async function ensureExcelJS(){
    if(window.ExcelJS)return window.ExcelJS;if(libraryPromise)return libraryPromise;
    libraryPromise=(async()=>{let lastError=null;for(const url of EXCELJS_URLS){try{return await loadScript(url);}catch(error){lastError=error;}}throw lastError||new Error('Excel 모듈을 불러오지 못했습니다.');})();
    try{return await libraryPromise;}catch(error){libraryPromise=null;throw error;}
  }

  function border(){return {top:{style:'thin',color:{argb:COLORS.gray200}},left:{style:'thin',color:{argb:COLORS.gray200}},bottom:{style:'thin',color:{argb:COLORS.gray200}},right:{style:'thin',color:{argb:COLORS.gray200}}};}
  function titleStyle(cell){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.navy}};cell.font={name:'맑은 고딕',size:18,bold:true,color:{argb:COLORS.white}};cell.alignment={vertical:'middle',horizontal:'left'};}
  function subtitleStyle(cell){cell.font={name:'맑은 고딕',size:10,color:{argb:COLORS.gray600}};cell.alignment={vertical:'middle',horizontal:'left'};}
  function metaStyle(cell,warning=false){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:warning?COLORS.amberLight:COLORS.blueLight}};cell.font={name:'맑은 고딕',size:9,bold:warning,color:{argb:warning?COLORS.amber:COLORS.navy2}};cell.alignment={vertical:'middle',horizontal:'left',wrapText:true};cell.border=border();}
  function headerStyle(cell){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.navy2}};cell.font={name:'맑은 고딕',size:9,bold:true,color:{argb:COLORS.white}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border();}
  function dataStyle(cell,rowIndex){cell.font={name:'맑은 고딕',size:9,color:{argb:COLORS.gray900}};cell.alignment={vertical:'middle',horizontal:'left',wrapText:true};cell.border=border();if(rowIndex%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'F8FAFC'}};}
  function statusColors(value){
    const v=text(value).toUpperCase();
    if(/완료|정상|PASS|SUCCESS|VERIFIED|사용 가능|운항 중|비행중/.test(v))return [COLORS.greenLight,COLORS.green];
    if(/복귀|대기|충전|주의|WARNING|PROCESSING|검증 진행|승인 완료/.test(v))return [COLORS.amberLight,COLORS.amber];
    if(/실패|오류|격리|취소|차단|CRITICAL|FAILED|ERROR|만료|변경됨/.test(v))return [COLORS.redLight,COLORS.red];
    if(/승인|GATEWAY|SYSTEM/.test(v))return [COLORS.violetLight,COLORS.violet];
    return [COLORS.gray100,COLORS.gray600];
  }
  function applyStatusCell(cell,value){const [fill,font]=statusColors(value);cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};cell.font={name:'맑은 고딕',size:9,bold:true,color:{argb:font}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border();}
  function applySourceCell(cell,value){const gateway=text(value).includes('GATEWAY')||text(value).includes('실기체');cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:gateway?COLORS.greenLight:COLORS.amberLight}};cell.font={name:'맑은 고딕',size:9,bold:true,color:{argb:gateway?COLORS.green:COLORS.amber}};cell.alignment={vertical:'middle',horizontal:'center'};cell.border=border();}
  function styleWorkbookSheet(ws,lastColumn,title,subtitle,generatedAt,source){
    ws.mergeCells(1,1,1,lastColumn);ws.getCell(1,1).value=title;titleStyle(ws.getCell(1,1));ws.getRow(1).height=31;
    ws.mergeCells(2,1,2,lastColumn);ws.getCell(2,1).value=subtitle;subtitleStyle(ws.getCell(2,1));ws.getRow(2).height=22;
    ws.mergeCells(3,1,3,lastColumn);ws.getCell(3,1).value=`보고서 생성 ${kstText(generatedAt)} KST  |  데이터 출처 ${sourceText(source)}  |  D-LOGIS ${REPORT_VERSION}`;metaStyle(ws.getCell(3,1),source==='SIMULATION');ws.getRow(3).height=24;
    ws.mergeCells(4,1,4,lastColumn);ws.getCell(4,1).value=source==='SIMULATION'?'※ 현재 보고서는 시뮬레이션 운항 데이터입니다. 실운영 제출 전 GATEWAY 원본 여부를 확인하십시오.':'※ 모든 시각은 Asia/Seoul(KST), 좌표는 WGS84 기준입니다.';metaStyle(ws.getCell(4,1),source==='SIMULATION');ws.getRow(4).height=25;
    ws.views=[{state:'frozen',xSplit:0,ySplit:5,topLeftCell:'A6',showGridLines:false}];
    ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.45,bottom:.45,header:.2,footer:.2}};
    ws.headerFooter={oddHeader:'&LD-LOGIS CONTROL&C'+title+'&R'+sourceText(source),oddFooter:'&L생성 '+kstText(generatedAt)+' KST&CPage &P / &N&R'+REPORT_VERSION};
    ws.properties.defaultRowHeight=20;
  }
  function addDataSheet(workbook,config){
    const ws=workbook.addWorksheet(config.name,{properties:{tabColor:{argb:config.tabColor||COLORS.blue}},views:[{showGridLines:false}]});
    const lastColumn=config.columns.length;styleWorkbookSheet(ws,lastColumn,config.title,config.subtitle,config.generatedAt,config.source);
    ws.columns=config.columns.map(column=>({key:column.key,width:column.width||14}));
    const headerRow=5;const tableRows=config.rows.map(row=>config.columns.map(column=>row[column.key]??''));
    ws.addTable({name:config.tableName,ref:`A${headerRow}`,headerRow:true,totalsRow:false,style:{theme:config.tableTheme||'TableStyleMedium2',showFirstColumn:false,showLastColumn:false,showRowStripes:false,showColumnStripes:false},columns:config.columns.map(column=>({name:column.header,filterButton:true})),rows:tableRows});
    const tableHeader=ws.getRow(headerRow);tableHeader.height=31;tableHeader.eachCell(cell=>headerStyle(cell));
    const dataStart=headerRow+1;const dataEnd=headerRow+tableRows.length;
    for(let rowIndex=dataStart;rowIndex<=dataEnd;rowIndex+=1){
      const row=ws.getRow(rowIndex);row.height=config.rowHeight||26;
      config.columns.forEach((column,index)=>{
        const cell=row.getCell(index+1);dataStyle(cell,rowIndex-dataStart);
        if(column.type==='date'&&cell.value){cell.numFmt=DATE_FORMAT;cell.alignment={vertical:'middle',horizontal:'center',wrapText:false};}
        if(column.type==='number'){cell.numFmt=column.numFmt||NUMBER_FORMAT;cell.alignment={vertical:'middle',horizontal:'right'};}
        if(column.type==='percent'){cell.numFmt=PERCENT_FORMAT;cell.alignment={vertical:'middle',horizontal:'right'};}
        if(column.type==='coordinate'){cell.numFmt='0.000000';cell.alignment={vertical:'middle',horizontal:'right'};}
        if(column.type==='center')cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};
        if(column.type==='status')applyStatusCell(cell,cell.value);
        if(column.type==='source')applySourceCell(cell,cell.value);
        if(column.type==='hash'){cell.font={name:'Consolas',size:8,color:{argb:COLORS.gray700}};cell.alignment={vertical:'middle',horizontal:'left',wrapText:false};}
      });
    }
    if(!tableRows.length){ws.getCell(dataStart,1).value='현재 저장된 기록이 없습니다.';ws.mergeCells(dataStart,1,dataStart,lastColumn);metaStyle(ws.getCell(dataStart,1),false);ws.getRow(dataStart).height=30;}
    if(config.freezeColumns)ws.views=[{state:'frozen',xSplit:config.freezeColumns,ySplit:5,topLeftCell:String.fromCharCode(65+Math.min(config.freezeColumns,25))+'6',showGridLines:false}];
    ws.autoFilter={from:{row:headerRow,column:1},to:{row:Math.max(headerRow,dataEnd),column:lastColumn}};
    ws.pageSetup.printTitlesRow='1:5';ws.pageSetup.printArea=`A1:${excelColumnName(lastColumn)}${Math.max(dataEnd,6)}`;
    return ws;
  }
  function excelColumnName(index){let name='';for(let n=index;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
  function addKpi(ws,range,label,value,unit,tone='blue'){
    ws.mergeCells(range);const cell=ws.getCell(range.split(':')[0]);cell.value=`${label}\n${value}${unit||''}`;
    const palette={blue:[COLORS.blueLight,COLORS.blue],green:[COLORS.greenLight,COLORS.green],amber:[COLORS.amberLight,COLORS.amber],red:[COLORS.redLight,COLORS.red],violet:[COLORS.violetLight,COLORS.violet]}[tone]||[COLORS.gray100,COLORS.gray700];
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:palette[0]}};cell.font={name:'맑은 고딕',size:12,bold:true,color:{argb:palette[1]}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border();
  }
  function summarySheet(workbook,generatedAt,source,snapshot){
    const ws=workbook.addWorksheet('00_운영요약',{properties:{tabColor:{argb:COLORS.navy}},views:[{showGridLines:false}]});
    ['A','B','C','D','E','F','G','H'].forEach(column=>{ws.getColumn(column).width=17;});
    ws.mergeCells('A1:H1');ws.getCell('A1').value='D-LOGIS 드론배송 운영보고서';titleStyle(ws.getCell('A1'));ws.getRow(1).height=36;
    ws.mergeCells('A2:H2');ws.getCell('A2').value='임무·기체·배터리·비행로그·안전검증·명령·경보·증빙을 Mission ID로 연결한 통합 기록';subtitleStyle(ws.getCell('A2'));ws.getRow(2).height=24;
    ws.mergeCells('A3:H3');ws.getCell('A3').value=`생성시각 ${kstText(generatedAt)} KST  |  시간대 Asia/Seoul  |  좌표 WGS84  |  출처 ${sourceText(source)}`;metaStyle(ws.getCell('A3'),source==='SIMULATION');ws.getRow(3).height=25;
    const missions=asArray(state.missions);const completed=missions.filter(item=>item.status==='COMPLETED').length;const pending=missions.filter(item=>item.status==='READY').length;const unack=asArray(state.alerts).filter(item=>!item.ack).length;const verified=asArray(state.preflightVerifications).filter(item=>item.lockedAt&&item.signoff).length;
    addKpi(ws,'A5:B7','전체 임무',number1(missions.length),'건','blue');addKpi(ws,'C5:D7','수행 중 임무',number1(snapshot.activeMissions.length),'건','green');addKpi(ws,'E5:F7','완료 임무',number1(completed),'건','green');addKpi(ws,'G5:H7','승인 대기',number1(pending),'건','amber');
    addKpi(ws,'A9:B11','운항 드론',number1(snapshot.activeDrones.length),'대','blue');addKpi(ws,'C9:D11','사용 배터리',number1(snapshot.activeBatteries.length),'개','violet');addKpi(ws,'E9:F11','미확인 경보',number1(unack),'건',unack?'red':'green');addKpi(ws,'G9:H11','검증 잠금',number1(verified),'건','green');
    ws.mergeCells('A13:D13');ws.getCell('A13').value='운영 상태 요약';headerStyle(ws.getCell('A13'));ws.mergeCells('E13:H13');ws.getCell('E13').value='데이터 품질·기준';headerStyle(ws.getCell('E13'));
    const statusRows=[
      ['운항 중',missions.filter(item=>item.status==='IN_FLIGHT').length,'복귀 중',missions.filter(item=>item.status==='RETURNING').length],
      ['일시대기',missions.filter(item=>item.status==='HOLDING').length,'완료',completed],
      ['승인 완료',missions.filter(item=>item.status==='APPROVED').length,'취소',missions.filter(item=>item.status==='CANCELLED').length],
      ['전체 비행로그',asArray(state.telemetryLogs).length,'배송증빙',asArray(state.proofs).length]
    ];
    statusRows.forEach((values,index)=>{
      const row=14+index;ws.getCell(row,1).value=values[0];ws.getCell(row,2).value=number1(values[1]);ws.getCell(row,3).value=values[2];ws.getCell(row,4).value=number1(values[3]);
      [1,2,3,4].forEach(col=>dataStyle(ws.getCell(row,col),index));ws.getCell(row,2).numFmt='0.0';ws.getCell(row,4).numFmt='0.0';
    });
    const audit=snapshot.audit||state.consistencyAudit||{};const qualityRows=[
      ['화면 데이터 일치',audit.status==='WARNING'?'확인 필요':'정상'],['불일치 항목',number1(asArray(audit.issues).length)+'건'],['최근 일치 점검',kstText(audit.checkedAt)],['운항 수치 표기','소수점 한 자리'],['날짜·시간','KST 실제 날짜 셀'],['좌표','WGS84 소수점 6자리'],['보고서 형식','Excel XLSX 다중 시트'],['데이터 출처',sourceText(source)]
    ];
    qualityRows.forEach((values,index)=>{const row=14+index;ws.getCell(row,5).value=values[0];ws.getCell(row,6).value=values[1];ws.mergeCells(row,6,row,8);dataStyle(ws.getCell(row,5),index);dataStyle(ws.getCell(row,6),index);if(values[0]==='화면 데이터 일치'||values[0]==='데이터 출처')applyStatusCell(ws.getCell(row,6),values[1]);});
    ws.mergeCells('A23:H23');ws.getCell('A23').value='시트 안내';headerStyle(ws.getCell('A23'));
    const indexRows=[
      ['01_임무현황','임무별 경로·상태·자원·검증·정확한 KST 시각'],['02_비행로그','텔레메트리 수치와 데이터 수신기록'],['03_비행전검증','사진·BMS·중량·통신·승인번호·기상 검증'],['04_명령이력','명령 요청·전송·ACK·적용 결과'],['05_경보이력','경보 등급·발생·확인자·확인시각'],['06_배터리현황','SOC·SOH·온도·셀 편차·사이클·임무 연결'],['07_배송증빙','수령·OTP·완료좌표·완료시각'],['08_감사로그','사용자 작업·처리결과·대상 연결'],['09_자산현황','기체 상태·운항수치·정비 잔여시간'],['10_용어·기준','필드 의미·단위·운영 기록 기준']
    ];
    indexRows.forEach((values,index)=>{const row=24+index;ws.getCell(row,1).value={text:values[0],hyperlink:`#'${values[0]}'!A1`};ws.mergeCells(row,1,row,2);ws.getCell(row,3).value=values[1];ws.mergeCells(row,3,row,8);dataStyle(ws.getCell(row,1),index);dataStyle(ws.getCell(row,3),index);ws.getCell(row,1).font={name:'맑은 고딕',size:9,bold:true,color:{argb:COLORS.blue},underline:true};});
    ws.views=[{state:'frozen',ySplit:3,topLeftCell:'A4',showGridLines:false}];ws.pageSetup={orientation:'portrait',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1,margins:{left:.35,right:.35,top:.45,bottom:.45,header:.2,footer:.2}};ws.headerFooter={oddHeader:'&LD-LOGIS CONTROL&C운영요약&R'+sourceText(source),oddFooter:'&L'+kstText(generatedAt)+' KST&CPage &P / &N&R'+REPORT_VERSION};
    return ws;
  }

  function missionRows(){return asArray(state.missions).map((mission,index)=>{
    const drone=droneFor(mission.droneId),battery=batteryFor(mission.batteryId),record=preflightFor(mission.id),proof=proofFor(mission.id),operation=latestOperation(mission.id);
    return {no:index+1,missionId:mission.id,orderNo:mission.orderNo,title:mission.title,priority:priorityText(mission.priority),status:statusLabel(mission.status),stage:currentStage(mission),progress:number1(mission.progress),eta:number1(mission.etaMin),origin:mission.origin,destination:mission.destination,droneName:drone?.name||'',droneId:drone?.id||'',model:drone?.model||'',batteryId:mission.batteryId||'',batterySoc:battery?number1(battery.soc):null,pilot:mission.pilot||'',cargo:mission.cargo||'',payload:number1(mission.payloadKg),recipient:mission.recipient||'',phone:mission.phone||'',approvalRef:routeApproval(record),preflight:preflightStatus(record),verificationId:record?.id||'',createdAt:kstDate(mission.createdAt),approvedAt:kstDate(mission.approvedAt),departedAt:kstDate(mission.departedAt),deliveredAt:kstDate(mission.deliveredAt),completedAt:kstDate(mission.completedAt),proofId:proof?.id||'',lastAction:operation?`${operation.title} · ${operation.status==='SUCCESS'?'완료':operation.status==='ERROR'?'실패':'진행 중'}`:'',source:sourceText(dataSource())};
  });}
  function telemetryRows(){return asArray(state.telemetryLogs).slice().sort((a,b)=>new Date(a.recordedAt||a.receivedAt||0)-new Date(b.recordedAt||b.receivedAt||0)).map((row,index)=>{
    const drone=droneFor(row.droneId),mission=asArray(state.missions).find(item=>item.id===row.missionId);
    const lat=number6(row.lat),lng=number6(row.lng);const missing=[];if(lat===null||lng===null)missing.push('위치 미수집');if(row.recordedAt===undefined&&row.receivedAt===undefined)missing.push('시각 미수집');
    return {no:index+1,receivedAt:kstDate(row.receivedAt||row.recordedAt),recordedAt:kstDate(row.recordedAt||row.sentAt),recordId:row.id||'',missionId:row.missionId||'',missionTitle:mission?.title||'',droneName:drone?.name||'',droneId:row.droneId||'',batteryId:row.batteryId||'',lat,lng,altitude:number1(row.altitude??row.altitudeM),speed:number1(row.speed??row.groundSpeedKmh),heading:number1(row.headingDeg),battery:number1(row.battery??row.batterySocPct),temperature:number1(row.temperature??row.batteryTempC),link:number1(row.link??row.linkQualityPct),satellites:number1(row.satellites),flightMode:row.flightMode||'',armed:row.armed===undefined?'':row.armed?'ARMED':'DISARMED',delay:number1(row.dataDelayMs),source:sourceText(row.source||dataSource()),quality:missing.length?missing.join(', '):'정상'};
  });}
  function preflightRows(){const rows=[];asArray(state.missions).forEach(mission=>{const record=preflightFor(mission.id);if(!record)return;Object.entries(ITEM_TITLES).forEach(([key,title],index)=>{const item=record.items?.[key]||{};rows.push({verificationId:record.id,missionId:mission.id,missionTitle:mission.title,itemNo:index+1,itemKey:key,itemTitle:title,status:item.status==='VERIFIED'?'검증 완료':item.status==='FAILED'?'검증 실패':item.status||'미검증',result:item.result||'',method:ITEM_METHODS[key],source:item.source||'',verifiedBy:item.verifiedBy||'',verifiedAt:kstDate(item.verifiedAt),expiresAt:kstDate(item.expiresAt),evidenceFile:item.evidence?.fileName||'',fileSize:item.evidence?.sizeBytes||null,evidenceHash:item.evidenceHash||'',summary:evidenceSummary(key,item),approvalRef:item.snapshot?.approvalRef||'',routeHash:item.snapshot?.routeHash||'',signedBy:record.signoff?.signedBy||'',signedAt:kstDate(record.signoff?.signedAt),recordHash:record.signoff?.recordHash||'',lockedAt:kstDate(record.lockedAt),note:item.note||''});});});return rows;}
  function commandRows(){return asArray(state.commandLogs).slice().sort((a,b)=>new Date(a.requestedAt||0)-new Date(b.requestedAt||0)).map((row,index)=>{const mission=asArray(state.missions).find(item=>item.id===row.missionId),drone=droneFor(row.droneId);return {no:index+1,commandId:row.id||'',missionId:row.missionId||'',missionTitle:mission?.title||'',droneName:drone?.name||'',droneId:row.droneId||'',command:row.action||row.command||'',status:row.status||'',result:row.result||'',requestedBy:row.requestedBy||'',requestedAt:kstDate(row.requestedAt),sentAt:kstDate(row.sentAt),ackAt:kstDate(row.acknowledgedAt),appliedAt:kstDate(row.appliedAt),latency:row.appliedAt&&row.requestedAt?number1(new Date(row.appliedAt)-new Date(row.requestedAt)):null,source:sourceText(dataSource())};});}
  function alertRows(){return asArray(state.alerts).slice().sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0)).map((row,index)=>({no:index+1,alertId:row.id||'',severity:row.severity||'',title:row.title||'',message:row.message||'',missionId:row.missionId||'',droneId:row.droneId||'',batteryId:row.batteryId||'',currentValue:row.currentValue===undefined?'':number1(row.currentValue),threshold:row.threshold===undefined?'':number1(row.threshold),unit:row.unit||'',createdAt:kstDate(row.createdAt),ack:row.ack?'확인 완료':'미확인',ackBy:row.acknowledgedBy||'',ackAt:kstDate(row.acknowledgedAt),source:sourceText(row.source||dataSource())}));}
  function batteryRows(){return asArray(state.batteries).map((battery,index)=>{const drone=droneFor(battery.droneId),mission=asArray(state.missions).find(item=>item.batteryId===battery.id&&!['COMPLETED','CANCELLED'].includes(item.status));const raw=Number(battery.cellDiff)||0;const delta=number1(Math.abs(raw)<=1?raw*1000:raw);return {no:index+1,batteryId:battery.id,status:batteryStatusText(battery.status),soc:number1(battery.soc),soh:number1(battery.soh),temperature:number1(battery.temp),cellDelta:delta,cycles:number1(battery.cycles),estimatedFlight:number1(Number(battery.soc||0)*.29),droneName:drone?.name||'',droneId:drone?.id||'',missionId:mission?.id||'',missionTitle:mission?.title||'',stage:mission?currentStage(mission):'',updatedAt:kstDate(battery.updatedAt||state.lastFlowTelemetryAt),source:sourceText(dataSource())};});}
  function proofRows(){return asArray(state.proofs).map((proof,index)=>{const mission=asArray(state.missions).find(item=>item.id===proof.missionId),drone=droneFor(mission?.droneId);return {no:index+1,proofId:proof.id||'',missionId:proof.missionId||'',orderNo:proof.orderNo||mission?.orderNo||'',missionTitle:mission?.title||'',recipient:proof.recipient||mission?.recipient||'',otp:proof.otp||'',method:proof.method||'OTP·전자 인수확인',completedAt:kstDate(proof.completedAt||proof.deliveredAt),lat:number6(proof.lat),lng:number6(proof.lng),droneName:drone?.name||'',droneId:drone?.id||'',photo:proof.photoFileName||'',signature:proof.signature||'',tempRange:proof.tempRange||'',source:sourceText(proof.source||dataSource())};});}
  function auditRows(){const rows=[];asArray(state.auditLogs).forEach(item=>rows.push({eventAt:kstDate(item.createdAt||item.occurredAt),recordType:'감사로그',recordId:item.id||'',actor:item.actor||'',action:item.action||'',targetType:item.targetType||'',targetId:item.targetId||'',missionId:item.targetType==='MISSION'?item.targetId:'',droneId:'',status:'기록',summary:item.detail||'',requestedAt:null,completedAt:null,source:'시스템'}));asArray(state.operations).forEach(item=>rows.push({eventAt:kstDate(item.completedAt||item.requestedAt),recordType:'작업처리',recordId:item.id||'',actor:item.requestedBy||'',action:item.title||item.action||'',targetType:'MISSION',targetId:item.missionId||'',missionId:item.missionId||'',droneId:item.droneId||'',status:item.status||'',summary:item.message||item.error||'',requestedAt:kstDate(item.requestedAt),completedAt:kstDate(item.completedAt),source:sourceText(dataSource())}));return rows.sort((a,b)=>(a.eventAt?.getTime()||0)-(b.eventAt?.getTime()||0));}
  function assetRows(){return asArray(state.drones).map((drone,index)=>{const battery=batteryFor(drone.batteryId),mission=asArray(state.missions).find(item=>item.droneId===drone.id&&!['COMPLETED','CANCELLED'].includes(item.status));return {no:index+1,droneName:drone.name,droneId:drone.id,model:drone.model,status:statusLabel(drone.status),flightMode:drone.flightMode||'',armed:drone.armed?'ARMED':'DISARMED',altitude:number1(drone.altitude),speed:number1(drone.speed),batteryId:drone.batteryId||'',batterySoc:battery?number1(battery.soc):number1(drone.battery),link:number1(drone.link),satellites:number1(drone.satellites),lat:number6(drone.lat),lng:number6(drone.lng),flightHours:number1(drone.flightHours),maintenance:number1(drone.maintenance),missionId:mission?.id||'',missionTitle:mission?.title||'',stage:mission?currentStage(mission):'',source:sourceText(dataSource())};});}

  function buildWorkbook(ExcelJS,scopeMissionId=null){
    const workbook=new ExcelJS.Workbook();const generatedAt=new Date();const source=dataSource();const snapshot=operationalSnapshot();
    workbook.creator='D-LOGIS CONTROL';workbook.lastModifiedBy='D-LOGIS CONTROL';workbook.created=generatedAt;workbook.modified=generatedAt;workbook.company='D-LOGIS';workbook.subject='드론배송 통합 운영보고서';workbook.title=scopeMissionId?`${scopeMissionId} 운항 검증보고서`:'D-LOGIS 드론배송 운영보고서';workbook.description='Mission ID 기준 임무·기체·배터리·비행·검증·명령·경보·배송증빙 통합기록';workbook.keywords='drone delivery mission telemetry preflight audit';workbook.calcProperties.fullCalcOnLoad=true;workbook.calcProperties.forceFullCalc=true;
    summarySheet(workbook,generatedAt,source,snapshot);
    let missions=missionRows();if(scopeMissionId)missions=missions.filter(row=>row.missionId===scopeMissionId);
    addDataSheet(workbook,{name:'01_임무현황',title:'임무 운영현황',subtitle:'Mission ID 기준으로 경로·자원·검증·진행상태·정확한 KST 시각을 연결합니다.',generatedAt,source,tabColor:COLORS.blue,tableName:'DLOGIS_MISSIONS',freezeColumns:7,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'Mission ID',key:'missionId',width:20},{header:'주문번호',key:'orderNo',width:19},{header:'임무명',key:'title',width:25},{header:'우선순위',key:'priority',width:10,type:'status'},{header:'상태',key:'status',width:12,type:'status'},{header:'현재 단계',key:'stage',width:16,type:'status'},{header:'진행률(%)',key:'progress',width:12,type:'percent'},{header:'ETA(분)',key:'eta',width:10,type:'number'},{header:'출발지',key:'origin',width:23},{header:'배송지',key:'destination',width:25},{header:'드론명',key:'droneName',width:17},{header:'기체 ID',key:'droneId',width:12},{header:'모델',key:'model',width:12},{header:'배터리 ID',key:'batteryId',width:13},{header:'배터리 SOC(%)',key:'batterySoc',width:14,type:'percent'},{header:'조종자',key:'pilot',width:12},{header:'화물',key:'cargo',width:22},{header:'중량(kg)',key:'payload',width:11,type:'number'},{header:'수령인',key:'recipient',width:14},{header:'연락처',key:'phone',width:16},{header:'운항승인 번호',key:'approvalRef',width:22},{header:'비행 전 검증',key:'preflight',width:17,type:'status'},{header:'검증 ID',key:'verificationId',width:20},{header:'생성시각(KST)',key:'createdAt',width:20,type:'date'},{header:'승인시각(KST)',key:'approvedAt',width:20,type:'date'},{header:'출발시각(KST)',key:'departedAt',width:20,type:'date'},{header:'배송완료시각(KST)',key:'deliveredAt',width:20,type:'date'},{header:'임무종료시각(KST)',key:'completedAt',width:20,type:'date'},{header:'배송증빙 ID',key:'proofId',width:18},{header:'최근 작업',key:'lastAction',width:24},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:missions});
    let telemetry=telemetryRows();if(scopeMissionId)telemetry=telemetry.filter(row=>row.missionId===scopeMissionId);
    addDataSheet(workbook,{name:'02_비행로그',title:'비행 텔레메트리 로그',subtitle:'원본 수신시각과 운항 수치를 행 단위로 기록합니다. 위치 미수집 값은 임의 보정하지 않습니다.',generatedAt,source,tabColor:COLORS.green,tableName:'DLOGIS_TELEMETRY',freezeColumns:8,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'수신시각(KST)',key:'receivedAt',width:20,type:'date'},{header:'기록시각(KST)',key:'recordedAt',width:20,type:'date'},{header:'기록 ID',key:'recordId',width:20},{header:'Mission ID',key:'missionId',width:20},{header:'임무명',key:'missionTitle',width:23},{header:'드론명',key:'droneName',width:17},{header:'기체 ID',key:'droneId',width:12},{header:'배터리 ID',key:'batteryId',width:13},{header:'위도(WGS84)',key:'lat',width:15,type:'coordinate'},{header:'경도(WGS84)',key:'lng',width:15,type:'coordinate'},{header:'고도(m)',key:'altitude',width:10,type:'number'},{header:'지상속도(km/h)',key:'speed',width:14,type:'number'},{header:'방위(°)',key:'heading',width:10,type:'number'},{header:'배터리 SOC(%)',key:'battery',width:14,type:'percent'},{header:'배터리 온도(℃)',key:'temperature',width:14,type:'number'},{header:'통신품질(%)',key:'link',width:12,type:'percent'},{header:'GNSS 위성 수',key:'satellites',width:12,type:'number'},{header:'비행모드',key:'flightMode',width:13,type:'center'},{header:'Armed',key:'armed',width:11,type:'status'},{header:'수신지연(ms)',key:'delay',width:13,type:'number'},{header:'데이터 출처',key:'source',width:15,type:'source'},{header:'데이터 완전성',key:'quality',width:16,type:'status'}
    ],rows:telemetry,tableTheme:'TableStyleMedium4'});
    let preflight=preflightRows();if(scopeMissionId)preflight=preflight.filter(row=>row.missionId===scopeMissionId);
    addDataSheet(workbook,{name:'03_비행전검증',title:'증빙 기반 비행 전 검증',subtitle:'사진·BMS·중량·통신·승인번호·기상 검증과 SHA-256 기록을 보존합니다.',generatedAt,source,tabColor:COLORS.violet,tableName:'DLOGIS_PREFLIGHT',freezeColumns:6,rowHeight:34,columns:[
      {header:'검증 ID',key:'verificationId',width:20},{header:'Mission ID',key:'missionId',width:20},{header:'임무명',key:'missionTitle',width:23},{header:'항목번호',key:'itemNo',width:9,type:'number',numFmt:'0'},{header:'항목코드',key:'itemKey',width:12},{header:'점검항목',key:'itemTitle',width:22},{header:'검증상태',key:'status',width:13,type:'status'},{header:'결과',key:'result',width:9,type:'status'},{header:'검증방식',key:'method',width:23},{header:'데이터 출처',key:'source',width:22},{header:'검증자',key:'verifiedBy',width:14},{header:'검증시각(KST)',key:'verifiedAt',width:20,type:'date'},{header:'유효종료(KST)',key:'expiresAt',width:20,type:'date'},{header:'증빙파일',key:'evidenceFile',width:22},{header:'파일크기(byte)',key:'fileSize',width:15,type:'number',numFmt:'#,##0'},{header:'증빙 SHA-256',key:'evidenceHash',width:35,type:'hash'},{header:'검증값 요약',key:'summary',width:45},{header:'운항승인 번호',key:'approvalRef',width:22},{header:'항로 지문',key:'routeHash',width:35,type:'hash'},{header:'최종 서명자',key:'signedBy',width:14},{header:'서명시각(KST)',key:'signedAt',width:20,type:'date'},{header:'기록 해시',key:'recordHash',width:35,type:'hash'},{header:'잠금시각(KST)',key:'lockedAt',width:20,type:'date'},{header:'비고',key:'note',width:32}
    ],rows:preflight,tableTheme:'TableStyleMedium5'});
    let commands=commandRows();if(scopeMissionId)commands=commands.filter(row=>row.missionId===scopeMissionId);
    addDataSheet(workbook,{name:'04_명령이력',title:'운항 명령 처리이력',subtitle:'요청·전송·ACK·적용 시각과 처리결과를 구분합니다.',generatedAt,source,tabColor:COLORS.amber,tableName:'DLOGIS_COMMANDS',freezeColumns:7,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'명령 ID',key:'commandId',width:20},{header:'Mission ID',key:'missionId',width:20},{header:'임무명',key:'missionTitle',width:23},{header:'드론명',key:'droneName',width:17},{header:'기체 ID',key:'droneId',width:12},{header:'명령',key:'command',width:18},{header:'상태',key:'status',width:13,type:'status'},{header:'결과',key:'result',width:23,type:'status'},{header:'요청자',key:'requestedBy',width:14},{header:'요청시각(KST)',key:'requestedAt',width:20,type:'date'},{header:'전송시각(KST)',key:'sentAt',width:20,type:'date'},{header:'ACK 수신시각(KST)',key:'ackAt',width:20,type:'date'},{header:'적용확인시각(KST)',key:'appliedAt',width:20,type:'date'},{header:'요청→적용(ms)',key:'latency',width:14,type:'number'},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:commands,tableTheme:'TableStyleMedium9'});
    let alerts=alertRows();if(scopeMissionId)alerts=alerts.filter(row=>row.missionId===scopeMissionId);
    addDataSheet(workbook,{name:'05_경보이력',title:'안전경보·확인이력',subtitle:'경보 발생값·기준값·확인자·확인시각을 함께 기록합니다.',generatedAt,source,tabColor:COLORS.red,tableName:'DLOGIS_ALERTS',freezeColumns:5,rowHeight:30,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'경보 ID',key:'alertId',width:18},{header:'등급',key:'severity',width:11,type:'status'},{header:'제목',key:'title',width:28},{header:'내용',key:'message',width:45},{header:'Mission ID',key:'missionId',width:20},{header:'기체 ID',key:'droneId',width:12},{header:'배터리 ID',key:'batteryId',width:13},{header:'현재값',key:'currentValue',width:11,type:'number'},{header:'기준값',key:'threshold',width:11,type:'number'},{header:'단위',key:'unit',width:9,type:'center'},{header:'발생시각(KST)',key:'createdAt',width:20,type:'date'},{header:'확인상태',key:'ack',width:12,type:'status'},{header:'확인자',key:'ackBy',width:14},{header:'확인시각(KST)',key:'ackAt',width:20,type:'date'},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:alerts,tableTheme:'TableStyleMedium10'});
    addDataSheet(workbook,{name:'06_배터리현황',title:'스마트배터리 운용현황',subtitle:'현재 SOC·SOH·온도·셀 편차·사이클과 장착 기체·임무 연결을 표시합니다.',generatedAt,source,tabColor:COLORS.green,tableName:'DLOGIS_BATTERIES',freezeColumns:4,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'배터리 ID',key:'batteryId',width:14},{header:'상태',key:'status',width:12,type:'status'},{header:'SOC(%)',key:'soc',width:10,type:'percent'},{header:'SOH(%)',key:'soh',width:10,type:'percent'},{header:'온도(℃)',key:'temperature',width:10,type:'number'},{header:'셀 편차(mV)',key:'cellDelta',width:13,type:'number'},{header:'충방전 사이클(회)',key:'cycles',width:15,type:'number'},{header:'예상 잔여비행(분)',key:'estimatedFlight',width:16,type:'number'},{header:'장착 드론',key:'droneName',width:17},{header:'기체 ID',key:'droneId',width:12},{header:'연결 Mission ID',key:'missionId',width:20},{header:'연결 임무',key:'missionTitle',width:25},{header:'현재 단계',key:'stage',width:16,type:'status'},{header:'최종 갱신(KST)',key:'updatedAt',width:20,type:'date'},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:batteryRows(),tableTheme:'TableStyleMedium4'});
    let proofs=proofRows();if(scopeMissionId)proofs=proofs.filter(row=>row.missionId===scopeMissionId);
    addDataSheet(workbook,{name:'07_배송증빙',title:'배송 완료 증빙',subtitle:'수령·OTP·완료시각·완료좌표·전자 인수기록을 Mission ID로 연결합니다.',generatedAt,source,tabColor:COLORS.green,tableName:'DLOGIS_PROOFS',freezeColumns:6,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'증빙 ID',key:'proofId',width:18},{header:'Mission ID',key:'missionId',width:20},{header:'주문번호',key:'orderNo',width:18},{header:'임무명',key:'missionTitle',width:24},{header:'수령인',key:'recipient',width:15},{header:'OTP',key:'otp',width:10,type:'center'},{header:'인증방식',key:'method',width:20},{header:'완료시각(KST)',key:'completedAt',width:20,type:'date'},{header:'완료 위도',key:'lat',width:15,type:'coordinate'},{header:'완료 경도',key:'lng',width:15,type:'coordinate'},{header:'드론명',key:'droneName',width:17},{header:'기체 ID',key:'droneId',width:12},{header:'사진파일',key:'photo',width:22},{header:'전자 인수확인',key:'signature',width:22},{header:'온도범위',key:'tempRange',width:15},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:proofs,tableTheme:'TableStyleMedium4'});
    let audits=auditRows();if(scopeMissionId)audits=audits.filter(row=>row.missionId===scopeMissionId||row.targetId===scopeMissionId);
    addDataSheet(workbook,{name:'08_감사로그',title:'사용자 작업·감사로그',subtitle:'누가, 언제, 어떤 대상에 어떤 작업을 수행했고 결과가 무엇인지 기록합니다.',generatedAt,source,tabColor:COLORS.navy2,tableName:'DLOGIS_AUDIT',freezeColumns:6,rowHeight:30,columns:[
      {header:'기준시각(KST)',key:'eventAt',width:20,type:'date'},{header:'기록유형',key:'recordType',width:12,type:'status'},{header:'기록 ID',key:'recordId',width:20},{header:'실행자',key:'actor',width:14},{header:'행동·작업',key:'action',width:24},{header:'대상유형',key:'targetType',width:13},{header:'대상 ID',key:'targetId',width:20},{header:'Mission ID',key:'missionId',width:20},{header:'기체 ID',key:'droneId',width:12},{header:'처리상태',key:'status',width:13,type:'status'},{header:'상세내용·결과',key:'summary',width:50},{header:'요청시각(KST)',key:'requestedAt',width:20,type:'date'},{header:'완료시각(KST)',key:'completedAt',width:20,type:'date'},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:audits,tableTheme:'TableStyleMedium2'});
    addDataSheet(workbook,{name:'09_자산현황',title:'드론 기체 운항·정비 현황',subtitle:'기체별 비행상태·위치·통신·배터리·정비 잔여시간과 연결 임무를 표시합니다.',generatedAt,source,tabColor:COLORS.blue,tableName:'DLOGIS_ASSETS',freezeColumns:5,columns:[
      {header:'번호',key:'no',width:7,type:'number',numFmt:'0'},{header:'드론명',key:'droneName',width:17},{header:'기체 ID',key:'droneId',width:12},{header:'모델',key:'model',width:12},{header:'상태',key:'status',width:12,type:'status'},{header:'비행모드',key:'flightMode',width:13,type:'center'},{header:'Armed',key:'armed',width:11,type:'status'},{header:'고도(m)',key:'altitude',width:10,type:'number'},{header:'속도(km/h)',key:'speed',width:12,type:'number'},{header:'배터리 ID',key:'batteryId',width:13},{header:'배터리 SOC(%)',key:'batterySoc',width:14,type:'percent'},{header:'통신품질(%)',key:'link',width:12,type:'percent'},{header:'GNSS 위성 수',key:'satellites',width:12,type:'number'},{header:'위도(WGS84)',key:'lat',width:15,type:'coordinate'},{header:'경도(WGS84)',key:'lng',width:15,type:'coordinate'},{header:'누적 비행시간(h)',key:'flightHours',width:15,type:'number'},{header:'정비 잔여시간(h)',key:'maintenance',width:15,type:'number'},{header:'연결 Mission ID',key:'missionId',width:20},{header:'연결 임무',key:'missionTitle',width:25},{header:'현재 단계',key:'stage',width:16,type:'status'},{header:'데이터 출처',key:'source',width:15,type:'source'}
    ],rows:assetRows(),tableTheme:'TableStyleMedium2'});
    const dictionaryRows=[
      {field:'Mission ID',meaning:'배송 주문부터 기체·배터리·운항·증빙을 연결하는 임무 고유번호',unit:'-',rule:'한 임무에 하나의 고유값'},
      {field:'기체 ID',meaning:'드론 기체의 시스템 고유 식별값',unit:'-',rule:'드론명과 별도로 관리'},
      {field:'SOC',meaning:'현재 배터리 잔량',unit:'%',rule:'소수점 한 자리'},
      {field:'SOH',meaning:'배터리 건강상태',unit:'%',rule:'소수점 한 자리'},
      {field:'셀 편차',meaning:'배터리 셀 간 전압 차이',unit:'mV',rule:'소수점 한 자리'},
      {field:'GNSS',meaning:'항법에 사용 중인 위성 수',unit:'개',rule:'소수점 한 자리'},
      {field:'ACK',meaning:'드론 또는 게이트웨이가 명령을 수신했다는 응답',unit:'-',rule:'요청·전송·ACK·적용시각 분리'},
      {field:'Armed',meaning:'모터 구동 가능한 비행 준비상태',unit:'-',rule:'ARMED / DISARMED'},
      {field:'KST',meaning:'대한민국 표준시 Asia/Seoul',unit:'UTC+9',rule:'날짜 셀 yyyy-mm-dd hh:mm:ss'},
      {field:'WGS84',meaning:'전 세계 위도·경도 좌표 기준',unit:'도',rule:'소수점 6자리 유지'},
      {field:'SIMULATION',meaning:'시연용 가상 운항 데이터',unit:'-',rule:'실운영 증빙으로 오인하지 않음'},
      {field:'GATEWAY',meaning:'실기체 또는 연동 서버에서 수신한 데이터',unit:'-',rule:'수신시각과 원천시각 구분'},
      {field:'검증기록 해시',meaning:'항목별 증빙과 최종 서명을 묶은 내부 감사추적용 값',unit:'SHA-256',rule:'정부 승인·공인전자서명 대체 아님'}
    ];
    addDataSheet(workbook,{name:'10_용어·기준',title:'보고서 용어·표기 기준',subtitle:'실무자가 별도 해석 없이 보고서를 검토할 수 있도록 핵심 용어와 단위를 정리합니다.',generatedAt,source,tabColor:COLORS.gray600,tableName:'DLOGIS_DICTIONARY',columns:[{header:'필드·용어',key:'field',width:22},{header:'의미',key:'meaning',width:55},{header:'단위',key:'unit',width:14,type:'center'},{header:'기록·표기 기준',key:'rule',width:45}],rows:dictionaryRows,tableTheme:'TableStyleMedium2'});
    return {workbook,generatedAt};
  }

  function saveBuffer(buffer,fileName){
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function setBusy(value){exporting=value;patchExportButtons();}
  function patchExportButtons(){
    const labels=exporting?`${excelIcon()} Excel 생성 중...`:`${excelIcon()} Excel 운영보고서`;
    document.querySelectorAll('[data-export-csv],[data-export-workbook]').forEach(button=>{button.innerHTML=labels;button.disabled=exporting;button.title='서식·필터·KST 날짜·소수점·다중시트가 적용된 XLSX 보고서';button.classList.toggle('excel-exporting',exporting);});
    document.querySelectorAll('[data-preflight-export]').forEach(button=>{const id=button.dataset.preflightExport;button.dataset.exportPreflightXlsx=id;delete button.dataset.preflightExport;button.innerHTML=`${excelIcon()} 검증기록 Excel`;button.title='현재 Mission ID의 임무·비행·검증·명령·증빙을 XLSX로 저장';});
    if(state?.role==='admin'&&['dashboard','reports'].includes(state.view)){
      const actions=document.querySelector('.page-head .actions');if(actions&&!actions.querySelector('[data-export-workbook]')){const button=document.createElement('button');button.className='btn';button.dataset.exportWorkbook='';button.innerHTML=labels;button.disabled=exporting;actions.prepend(button);}
    }
  }
  async function exportWorkbook(scopeMissionId=null){
    if(exporting)return;setBusy(true);toast(scopeMissionId?'검증보고서 생성 중':'Excel 운영보고서 생성 중','서식·필터·정확한 KST 날짜·다중 시트를 구성하고 있습니다.','info');
    try{
      if(typeof flowReconcileState==='function')flowReconcileState();const ExcelJS=await ensureExcelJS();const {workbook,generatedAt}=buildWorkbook(ExcelJS,scopeMissionId);const buffer=await workbook.xlsx.writeBuffer();
      const fileName=scopeMissionId?`DLOGIS_${scopeMissionId}_검증보고서_${fileStamp(generatedAt)}.xlsx`:`DLOGIS_운영보고서_${fileStamp(generatedAt)}.xlsx`;saveBuffer(buffer,fileName);
      toast('Excel 보고서 생성 완료',`${scopeMissionId||'전체 운영데이터'} · 11개 시트 · KST 날짜·필터·서식 적용`,'success');
    }catch(error){console.error(error);toast('Excel 보고서를 생성하지 못했습니다',error.message||'네트워크와 브라우저 상태를 확인하십시오.','error');}
    finally{setBusy(false);}
  }

  const priorRender=render;
  render=function renderWithExcelControls(){const result=priorRender();queueMicrotask(patchExportButtons);return result;};
  flowExportMissions=()=>exportWorkbook(null);exportMissions=flowExportMissions;
  window.dlogisExcelReport={version:REPORT_VERSION,exportWorkbook,buildWorkbook,ensureExcelJS};
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-export-workbook],[data-export-preflight-xlsx]');if(!target)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    exportWorkbook(target.dataset.exportPreflightXlsx||null);
  },true);
  patchExportButtons();
})();
