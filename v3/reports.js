async function ensureXLSX(){
  if(window.XLSX)return window.XLSX;
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('엑셀 모듈 초기화 실패'));
    s.onerror=()=>reject(new Error('엑셀 모듈 다운로드 실패'));document.head.appendChild(s);
  });
}
function excelTime(value){return value?fmtKST(value,true):'';}
function sheetFromRows(XLSX,rows,widths=[]){
  const ws=XLSX.utils.json_to_sheet(rows,{skipHeader:false});
  ws['!cols']=widths.map(w=>({wch:w}));
  if(rows.length){
    const ref=XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:0,c:ref.e.c}})};
  }
  return ws;
}
function setNumberFormats(XLSX,ws,headers,formats){
  if(!ws['!ref'])return;
  const range=XLSX.utils.decode_range(ws['!ref']);
  headers.forEach((header,index)=>{
    if(!formats[header])return;
    for(let r=1;r<=range.e.r;r++){
      const cell=ws[XLSX.utils.encode_cell({r,c:index})];
      if(cell&&cell.t==='n')cell.z=formats[header];
    }
  });
}
async function exportOperationalWorkbook(){
  try{
    toast('운영보고서 생성 중','현재 시간 기준 데이터를 정리하고 있습니다.');
    const XLSX=await ensureXLSX();
    const wb=XLSX.utils.book_new();
    wb.Props={Title:'D-LOGIS 드론배송 운영보고서',Subject:'임무·비행·명령·경보·배터리·증빙 통합기록',Author:state.meta.centerName,CreatedDate:new Date()};
    const generatedAt=nowIso();
    const completed=state.missions.filter(m=>m.status==='COMPLETED');
    const summary=[
      {'항목':'보고서 생성시각(KST)','값':excelTime(generatedAt),'단위':'','설명':'브라우저에서 보고서를 생성한 시각'},
      {'항목':'운영센터','값':state.meta.centerName,'단위':'','설명':'관제 기준 센터'},
      {'항목':'시간대','값':'Asia/Seoul','단위':'KST','설명':'모든 표시 시각의 기준'},
      {'항목':'전체 임무','값':round1(state.missions.length),'단위':'건','설명':'저장된 전체 임무'},
      {'항목':'진행 중 임무','값':round1(activeMissions().length),'단위':'건','설명':'비행·대기·배송·복귀 중'},
      {'항목':'완료 임무','값':round1(completed.length),'단위':'건','설명':'배송 완료 기록'},
      {'항목':'정시 배송률','값':onTimeRate(),'단위':'%','설명':'완료 임무 중 정시 완료 비율'},
      {'항목':'미확인 경보','값':round1(state.alerts.filter(a=>!a.acknowledged).length),'단위':'건','설명':'운영자가 확인하지 않은 경보'},
      {'항목':'텔레메트리 기록','값':round1(state.telemetryLogs.length),'단위':'건','설명':'수집된 위치·비행·배터리 데이터'},
      {'항목':'최종 데이터 수신','값':excelTime(state.meta.lastDataAt),'단위':'','설명':'가장 최근 텔레메트리 수신시각'},
      {'항목':'데이터 신선도','값':dataFreshness(),'단위':'초','설명':'현재시각과 최종 수신시각 차이'}
    ];
    const missionRows=state.missions.map(m=>{
      const o=locationById(m.originId),d=locationById(m.destinationId);
      return {
        'Mission ID':m.id,'주문번호':m.orderNo,'임무명':m.title,'상태':STATUS[m.status]?.[0]||m.status,'우선순위':m.priority,
        '출발지':o?.name||'','도착지':d?.name||'','거리(km)':round1(m.distanceKm),'화물':m.cargo,'중량(kg)':round1(m.payloadKg),
        '기체':m.droneId||'','배터리':m.batteryId||'','조종자':m.pilot,'수령인':m.recipient,'진행률(%)':round1(m.progress),
        '생성시각(KST)':excelTime(m.createdAt),'승인시각(KST)':excelTime(m.approvedAt),'출발시각(KST)':excelTime(m.departedAt),
        '예정도착시각(KST)':excelTime(m.etaAt),'완료시각(KST)':excelTime(m.completedAt),'정시여부':m.onTime===null?'':m.onTime?'정시':'지연'
      };
    });
    const telemetryRows=state.telemetryLogs.map(t=>({
      '기록ID':t.id,'Mission ID':t.missionId||'','기체ID':t.droneId,'배터리ID':t.batteryId||'',
      '드론 전송시각(KST)':excelTime(t.sentAt),'수신시각(KST)':excelTime(t.receivedAt),'수신지연(ms)':round1(t.dataDelayMs),
      '위도(WGS84)':roundCoord(t.lat),'경도(WGS84)':roundCoord(t.lng),'고도(m)':round1(t.altitudeM),'지상속도(km/h)':round1(t.groundSpeedKmh),
      '방위(°)':round1(t.headingDeg),'배터리SOC(%)':round1(t.batterySocPct),'배터리온도(℃)':round1(t.batteryTempC),
      '통신품질(%)':round1(t.linkQualityPct),'GNSS위성수':round1(t.satellites),'비행모드':t.flightMode,'Armed':t.armed?'Y':'N'
    }));
    const commandRows=state.commandLogs.map(c=>({
      '명령ID':c.id,'Mission ID':c.missionId||'','기체ID':c.droneId||'','명령':c.command,'상태':c.status,'결과':c.result||'',
      '요청자':c.requestedBy,'요청시각(KST)':excelTime(c.requestedAt),'전송시각(KST)':excelTime(c.sentAt),
      'ACK 수신시각(KST)':excelTime(c.acknowledgedAt),'적용확인시각(KST)':excelTime(c.appliedAt),
      '요청→적용(ms)':c.appliedAt&&c.requestedAt?round1(new Date(c.appliedAt)-new Date(c.requestedAt)):''
    }));
    const alertRows=state.alerts.map(a=>({
      '경보ID':a.id,'등급':a.severity,'분류':a.category,'제목':a.title,'내용':a.message,'Mission ID':a.missionId||'',
      '기체ID':a.droneId||'','배터리ID':a.batteryId||'','현재값':a.currentValue===null?'':round1(a.currentValue),
      '기준값':a.threshold===null?'':round1(a.threshold),'단위':a.unit||'','발생시각(KST)':excelTime(a.createdAt),
      '확인여부':a.acknowledged?'Y':'N','확인자':a.acknowledgedBy||'','확인시각(KST)':excelTime(a.acknowledgedAt)
    }));
    const batteryRows=state.batteryLogs.map(b=>({
      '기록ID':b.id,'기록시각(KST)':excelTime(b.recordedAt),'Mission ID':b.missionId||'','기체ID':b.droneId||'',
      '배터리ID':b.batteryId,'SOC(%)':round1(b.soc),'SOH(%)':round1(b.soh),'온도(℃)':round1(b.temperatureC),
      '셀편차(mV)':round1(b.cellDeltaMv),'사이클(회)':round1(b.cycles),'상태':b.status
    }));
    const proofRows=state.proofs.map(p=>({
      '증빙ID':p.id,'Mission ID':p.missionId,'주문번호':p.orderNo,'수령인':p.recipient,'인증방식':p.method,
      'OTP 일치':p.otpMatched?'Y':'N','화물함 개방시각(KST)':excelTime(p.lockerOpenedAt),'전달완료시각(KST)':excelTime(p.deliveredAt),
      '위도(WGS84)':roundCoord(p.lat),'경도(WGS84)':roundCoord(p.lng),'사진파일':p.photoFileName||'','전자서명':p.signature||'',
      '최저온도(℃)':round1(p.temperatureMinC),'최고온도(℃)':round1(p.temperatureMaxC)
    }));
    const checkRows=state.checklistLogs.map(c=>({
      '점검ID':c.id,'Mission ID':c.missionId,'항목코드':c.itemKey,'점검항목':c.itemName,'통과여부':c.passed?'Y':'N',
      '점검자':c.checkedBy,'점검시각(KST)':excelTime(c.checkedAt),'비고':c.note||''
    }));
    const auditRows=state.auditLogs.map(a=>({
      '감사ID':a.id,'발생시각(KST)':excelTime(a.occurredAt),'사용자':a.actor,'행동':a.action,
      '대상유형':a.targetType,'대상ID':a.targetId,'상세내용':a.detail
    }));
    const defs=[
      ['운영요약',summary,[28,25,10,48]],
      ['임무목록',missionRows,[20,18,28,12,10,22,22,12,22,10,12,12,12,15,12,21,21,21,21,21,10]],
      ['비행로그',telemetryRows,[20,20,12,12,22,22,12,16,16,11,16,11,16,16,13,12,13,9]],
      ['명령이력',commandRows,[20,20,12,13,12,24,12,22,22,22,22,16]],
      ['경보이력',alertRows,[20,11,13,28,48,20,12,12,11,11,9,22,10,12,22]],
      ['배터리기록',batteryRows,[20,22,20,12,12,10,10,10,12,12,12]],
      ['배송증빙',proofRows,[20,20,18,15,20,10,22,22,16,16,25,22,13,13]],
      ['점검표',checkRows,[20,20,13,24,10,12,22,30]],
      ['감사로그',auditRows,[20,22,14,18,13,20,50]]
    ];
    const formats={'거리(km)':'0.0','중량(kg)':'0.0','진행률(%)':'0.0','수신지연(ms)':'0.0','고도(m)':'0.0','지상속도(km/h)':'0.0','방위(°)':'0.0','배터리SOC(%)':'0.0','배터리온도(℃)':'0.0','통신품질(%)':'0.0','GNSS위성수':'0.0','현재값':'0.0','기준값':'0.0','SOC(%)':'0.0','SOH(%)':'0.0','온도(℃)':'0.0','셀편차(mV)':'0.0','사이클(회)':'0.0','최저온도(℃)':'0.0','최고온도(℃)':'0.0','위도(WGS84)':'0.000000','경도(WGS84)':'0.000000','요청→적용(ms)':'0.0'};
    defs.forEach(([name,rows,widths])=>{
      const ws=sheetFromRows(XLSX,rows,widths);
      setNumberFormats(XLSX,ws,Object.keys(rows[0]||{}),formats);
      XLSX.utils.book_append_sheet(wb,ws,name);
    });
    const date=new Intl.DateTimeFormat('sv-SE',{timeZone:TIME_ZONE,dateStyle:'short'}).format(new Date()).replaceAll('-','');
    const fileName=`DLOGIS_운영보고서_${date}_${fmtTime(generatedAt,true).replaceAll(':','')}.xlsx`;
    XLSX.writeFile(wb,fileName,{compression:true,bookSST:true});
    toast('운영보고서 저장 완료',`${defs.length}개 시트와 현재 수치·시각 데이터를 저장했습니다.`,'success');
  }catch(error){
    console.error(error);toast('엑셀 생성 실패',error.message,'error');
  }
}
function exportJsonBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`DLOGIS_backup_${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  toast('JSON 백업 완료','브라우저 운영데이터 전체를 저장했습니다.','success');
}
