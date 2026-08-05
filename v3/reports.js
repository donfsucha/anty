async function ensureXLSX(){
  if(window.XLSX)return window.XLSX;
  throw new Error('Excel 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
}
function excelTime(value){return value?fmtKST(value,true):'';}
function makeSheet(XLSX,rows,widths=[]){
  const safeRows=rows.length?rows:[{'데이터':'기록 없음'}];
  const ws=XLSX.utils.json_to_sheet(safeRows);
  ws['!cols']=widths.map(w=>({wch:w}));
  if(ws['!ref']){
    const range=XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:0,c:range.e.c}})};
    ws['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};
  }
  return ws;
}
function applyFormats(XLSX,ws,headers){
  if(!ws['!ref'])return;
  const oneDecimal=new Set(['거리(km)','중량(kg)','진행률(%)','수신지연(ms)','고도(m)','지상속도(km/h)','방위(°)','배터리SOC(%)','배터리온도(℃)','통신품질(%)','GNSS위성수','현재값','기준값','SOC(%)','SOH(%)','온도(℃)','셀편차(mV)','사이클(회)','최저온도(℃)','최고온도(℃)','데이터 신선도(초)','명령 적용시간(ms)']);
  const range=XLSX.utils.decode_range(ws['!ref']);
  headers.forEach((header,column)=>{
    if(!oneDecimal.has(header))return;
    for(let row=1;row<=range.e.r;row++){
      const cell=ws[XLSX.utils.encode_cell({r:row,c:column})];
      if(cell&&cell.t==='n')cell.z='0.0';
    }
  });
}
async function exportOperationalWorkbook(){
  try{
    toast('운영보고서 생성 중','현재 시각 기준 로그를 정리하고 있습니다.');
    const XLSX=await ensureXLSX();
    const [telemetry,commands,alerts,batteryLogs,checks,audits]=await Promise.all([
      DLogisDB.all('telemetry'),DLogisDB.all('command'),DLogisDB.all('alert'),DLogisDB.all('battery'),DLogisDB.all('check'),DLogisDB.all('audit')
    ]);
    const generatedAt=nowIso(),wb=XLSX.utils.book_new();
    wb.Props={Title:'D-LOGIS 드론배송 운영보고서',Subject:'임무·비행·명령·경보·배터리·증빙 통합기록',Author:state.meta.centerName,CreatedDate:new Date()};

    const summary=[
      {'항목':'보고서 생성시각(KST)','값':excelTime(generatedAt),'단위':'','설명':'현재 브라우저에서 보고서를 생성한 시각'},
      {'항목':'운영센터','값':state.meta.centerName,'단위':'','설명':'관제 기준 센터'},
      {'항목':'시간 기준','값':'Asia/Seoul','단위':'KST','설명':'화면과 보고서의 시각 기준'},
      {'항목':'좌표 기준','값':'WGS84 / DMS 표시','단위':'','설명':'좌표는 초 단위 소수점 한 자리로 표시'},
      {'항목':'전체 임무','값':round1(state.missions.length),'단위':'건','설명':'저장된 전체 임무'},
      {'항목':'진행 중 임무','값':round1(activeMissions().length),'단위':'건','설명':'비행·대기·배송·복귀 중'},
      {'항목':'완료 임무','값':round1(state.missions.filter(m=>m.status==='COMPLETED').length),'단위':'건','설명':'배송 완료 기록'},
      {'항목':'정시 배송률','값':onTimeRate(),'단위':'%','설명':'완료 임무 중 정시 완료 비율'},
      {'항목':'미확인 경보','값':round1(state.alerts.filter(a=>!a.acknowledged).length),'단위':'건','설명':'운영자 확인이 필요한 경보'},
      {'항목':'비행로그','값':round1(telemetry.length),'단위':'건','설명':'IndexedDB에 저장된 텔레메트리'},
      {'항목':'최종 데이터 수신','값':excelTime(state.meta.lastDataAt),'단위':'','설명':'가장 최근 텔레메트리 수신시각'},
      {'항목':'데이터 신선도(초)','값':dataFreshness(),'단위':'초','설명':'현재시각과 최종 수신시각 차이'}
    ];
    const missionRows=state.missions.map(m=>({
      'Mission ID':m.id,'주문번호':m.orderNo,'임무명':m.title,'상태':STATUS[m.status]?.[0]||m.status,'우선순위':m.priority,
      '출발지':locationById(m.originId)?.name||'','도착지':locationById(m.destinationId)?.name||'','거리(km)':round1(m.distanceKm),
      '화물':m.cargo,'중량(kg)':round1(m.payloadKg),'기체':m.droneId||'','배터리':m.batteryId||'','조종자':m.pilot,'수령인':m.recipient,
      '진행률(%)':round1(m.progress),'생성시각(KST)':excelTime(m.createdAt),'승인시각(KST)':excelTime(m.approvedAt),
      '출발시각(KST)':excelTime(m.departedAt),'예정도착시각(KST)':excelTime(m.etaAt),'완료시각(KST)':excelTime(m.completedAt),
      '정시여부':m.onTime===null?'':m.onTime?'정시':'지연'
    }));
    const telemetryRows=telemetry.map(t=>({
      '기록ID':t.id,'Mission ID':t.missionId||'','기체ID':t.droneId,'배터리ID':t.batteryId||'',
      '드론 전송시각(KST)':excelTime(t.sentAt),'서버 수신시각(KST)':excelTime(t.receivedAt),'수신지연(ms)':round1(t.dataDelayMs),
      '위도(DMS)':t.latitudeDms||coordToDms(t.lat,true),'경도(DMS)':t.longitudeDms||coordToDms(t.lng,false),
      '고도(m)':round1(t.altitudeM),'지상속도(km/h)':round1(t.groundSpeedKmh),'방위(°)':round1(t.headingDeg),
      '배터리SOC(%)':round1(t.batterySocPct),'배터리온도(℃)':round1(t.batteryTempC),'통신품질(%)':round1(t.linkQualityPct),
      'GNSS위성수':round1(t.satellites),'비행모드':t.flightMode,'Armed':t.armed?'Y':'N','데이터출처':t.source
    }));
    const commandRows=commands.map(c=>({
      '명령ID':c.id,'Mission ID':c.missionId||'','기체ID':c.droneId||'','명령':c.command,'상태':c.status,'결과':c.result||'',
      '요청자':c.requestedBy,'요청시각(KST)':excelTime(c.requestedAt),'전송시각(KST)':excelTime(c.sentAt),
      'ACK 수신시각(KST)':excelTime(c.acknowledgedAt),'적용확인시각(KST)':excelTime(c.appliedAt),
      '명령 적용시간(ms)':c.appliedAt&&c.requestedAt?round1(new Date(c.appliedAt)-new Date(c.requestedAt)):'','데이터출처':c.source||'SIMULATION'
    }));
    const alertRows=[...state.alerts,...alerts.filter(x=>!state.alerts.some(a=>a.id===x.id))].map(a=>({
      '경보ID':a.id,'등급':a.severity,'분류':a.category,'제목':a.title,'내용':a.message,'Mission ID':a.missionId||'',
      '기체ID':a.droneId||'','배터리ID':a.batteryId||'','현재값':a.currentValue===null?'':round1(a.currentValue),
      '기준값':a.threshold===null?'':round1(a.threshold),'단위':a.unit||'','발생시각(KST)':excelTime(a.createdAt),
      '확인여부':a.acknowledged?'Y':'N','확인자':a.acknowledgedBy||'','확인시각(KST)':excelTime(a.acknowledgedAt),'데이터출처':a.source||'SYSTEM'
    }));
    const batteryRows=batteryLogs.map(b=>({
      '기록ID':b.id,'기록시각(KST)':excelTime(b.recordedAt),'Mission ID':b.missionId||'','기체ID':b.droneId||'',
      '배터리ID':b.batteryId,'SOC(%)':round1(b.soc),'SOH(%)':round1(b.soh),'온도(℃)':round1(b.temperatureC),
      '셀편차(mV)':round1(b.cellDeltaMv),'사이클(회)':round1(b.cycles),'상태':b.status,'데이터출처':b.source||'SIMULATION'
    }));
    const proofRows=state.proofs.map(p=>({
      '증빙ID':p.id,'Mission ID':p.missionId,'주문번호':p.orderNo,'수령인':p.recipient,'인증방식':p.method,'OTP 일치':p.otpMatched?'Y':'N',
      '화물함 개방시각(KST)':excelTime(p.lockerOpenedAt),'전달완료시각(KST)':excelTime(p.deliveredAt),'위도(DMS)':p.latitudeDms,'경도(DMS)':p.longitudeDms,
      '사진파일':p.photoFileName||'','전자서명':p.signature||'','최저온도(℃)':round1(p.temperatureMinC),'최고온도(℃)':round1(p.temperatureMaxC)
    }));
    const checkRows=checks.map(c=>({
      '점검ID':c.id,'Mission ID':c.missionId,'항목코드':c.itemKey,'점검항목':c.itemName,'통과여부':c.passed?'Y':'N',
      '점검자':c.checkedBy,'점검시각(KST)':excelTime(c.checkedAt),'비고':c.note||'','데이터출처':c.source||'MANUAL'
    }));
    const auditRows=[...state.auditLogs,...audits.filter(x=>!state.auditLogs.some(a=>a.id===x.id))].map(a=>({
      '감사ID':a.id,'발생시각(KST)':excelTime(a.occurredAt),'사용자':a.actor,'행동':a.action,'대상유형':a.targetType,'대상ID':a.targetId,'상세내용':a.detail,'데이터출처':a.source||'MANUAL'
    }));
    const currentAssets=[...state.drones.map(d=>({'구분':'드론','자산ID':d.id,'자산명':d.name,'상태':d.status,'SOC(%)':round1(batteryById(d.batteryId)?.soc||0),'SOH(%)':round1(batteryById(d.batteryId)?.soh||0),'온도(℃)':round1(batteryById(d.batteryId)?.temperatureC||0),'통신품질(%)':round1(d.linkQualityPct),'정비잔여(h)':round1(d.maintenanceDueHours),'최종확인시각(KST)':excelTime(state.meta.lastDataAt)})),...state.batteries.map(b=>({'구분':'배터리','자산ID':b.id,'자산명':b.droneId?`${b.droneId} 장착`:'보관 랙','상태':b.status,'SOC(%)':round1(b.soc),'SOH(%)':round1(b.soh),'온도(℃)':round1(b.temperatureC),'통신품질(%)':'','정비잔여(h)':'','최종확인시각(KST)':excelTime(b.lastInspectionAt)}))];

    const definitions=[
      ['01_운영요약',summary,[28,30,12,48]],['02_임무목록',missionRows,[20,18,28,12,11,22,22,12,22,11,12,12,12,15,12,22,22,22,22,22,10]],
      ['03_비행로그',telemetryRows,[20,20,12,12,22,22,14,18,18,11,17,11,16,16,14,12,13,9,13]],
      ['04_명령이력',commandRows,[20,20,12,13,12,24,12,22,22,22,22,18,13]],['05_경보이력',alertRows,[20,11,13,28,48,20,12,12,11,11,9,22,10,12,22,13]],
      ['06_배터리기록',batteryRows,[20,22,20,12,12,10,10,10,12,12,12,13]],['07_배송증빙',proofRows,[20,20,18,15,20,10,22,22,18,18,25,22,13,13]],
      ['08_비행전점검',checkRows,[20,20,13,24,10,12,22,30,13]],['09_감사로그',auditRows,[20,22,14,18,13,20,50,13]],['10_자산현황',currentAssets,[10,14,20,14,11,11,11,14,14,22]]
    ];
    definitions.forEach(([name,rows,widths])=>{
      const ws=makeSheet(XLSX,rows,widths);applyFormats(XLSX,ws,Object.keys(rows[0]||{}));XLSX.utils.book_append_sheet(wb,ws,name);
    });
    const date=new Intl.DateTimeFormat('sv-SE',{timeZone:TIME_ZONE}).format(new Date()).replaceAll('-','');
    const time=fmtTime(generatedAt,true).replaceAll(':','');
    XLSX.writeFile(wb,`DLOGIS_운영보고서_${date}_${time}.xlsx`,{compression:true,bookSST:true});
    toast('운영보고서 저장 완료',`${definitions.length}개 시트에 현재 수치와 정확한 KST 시각을 저장했습니다.`,'success');
  }catch(error){console.error(error);toast('Excel 생성 실패',error.message,'error');}
}
async function exportJsonBackup(){
  const logs=await DLogisDB.all();const payload={exportedAt:nowIso(),state,logs};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`DLOGIS_backup_${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
  toast('JSON 백업 완료','상태와 정밀 로그 전체를 저장했습니다.','success');
}
