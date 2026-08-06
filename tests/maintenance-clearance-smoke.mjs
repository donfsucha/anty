import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByRole('heading',{name:'통합관제 대시보드'}).waitFor();

// Periodic clearance must be visible from aircraft management.
await page.locator('.sidebar [data-view="fleet"]').click();
await page.getByRole('heading',{name:'드론 운항·정비 관리'}).waitFor();
await page.locator('.mc-board').waitFor();
const boardText=await page.locator('.mc-board').innerText();
for(const text of ['정기점검 기반 출동 준비','운항 적합','점검 임박','출동 차단','빠른점검 유효']){
  if(!boardText.includes(text))throw new Error(`Periodic-clearance board is missing: ${text}`);
}
const clearanceState=await page.evaluate(()=>{
  const api=window.dlogisMaintenanceClearance;
  return state.drones.map(drone=>({id:drone.id,...api.clearanceFor(drone)})).map(row=>({id:row.id,valid:row.valid,label:row.label,inspectionId:row.record?.id||null}));
});
if(clearanceState.filter(row=>row.valid).length<2)throw new Error(`Expected at least two simulation-cleared aircraft: ${JSON.stringify(clearanceState)}`);
if(clearanceState.some(row=>row.valid&&!row.inspectionId))throw new Error('A valid aircraft has no periodic inspection record.');

// Inspection modal must require actual checklist and traceable identifiers.
await page.locator('[data-open-periodic-inspection="DR-002"]').click();
await page.locator('#mc-inspection-form').waitFor();
const inspectionText=await page.locator('#mc-inspection-form').innerText();
for(const text of ['점검자 성명','정비기록 번호','기체 구조·외관·프로펠러','모터·ESC·구동계','실제 점검했으며']){
  if(!inspectionText.includes(text))throw new Error(`Periodic inspection modal is missing: ${text}`);
}
await page.locator('.mc-inspection-modal [data-modal-close]').first().click();
await page.locator('#mc-inspection-form').waitFor({state:'detached'});

// An approved and assigned mission should use the one-screen quick dispatch flow.
await page.locator('.sidebar [data-view="missions"]').click();
await page.getByRole('heading',{name:'배송임무 관리'}).waitFor();
const missionId=await page.evaluate(()=>{
  const mission=state.missions.find(item=>item.status==='APPROVED'&&item.droneId&&item.batteryId&&window.dlogisMaintenanceClearance.clearanceFor(item.droneId).valid);
  if(!mission)throw new Error('No approved mission with a valid periodic clearance exists.');
  state.selectedMission=mission.id;persist();render();return mission.id;
});
await page.locator(`tr[data-select-mission="${missionId}"]`).click();
await page.locator('.mc-dispatch-panel').waitFor();
const dispatchText=await page.locator('.mc-dispatch-panel').innerText();
for(const text of ['기체 정기점검','자동 상태검증','임무 확인·서명','빠른 출동 확인']){
  if(!dispatchText.includes(text))throw new Error(`Quick-dispatch panel is missing: ${text}`);
}
if(await page.locator('.pf-shell.mc-legacy-preflight:visible').count())throw new Error('Legacy six-card preflight should be collapsed by default.');

await page.locator(`[data-open-quick-dispatch="${missionId}"]`).click();
await page.locator('#mc-quick-dispatch-form').waitFor();
const quickText=await page.locator('#mc-quick-dispatch-form').innerText();
for(const text of ['정기 기체점검','배터리 BMS','통신·GNSS','실측 화물중량','현장 풍속','확인 후 바로 이륙']){
  if(!quickText.includes(text))throw new Error(`Quick dispatch form is missing: ${text}`);
}
const autoPass=await page.evaluate(id=>window.dlogisMaintenanceClearance.automaticReadiness(flowMission(id)).automaticPass,missionId);
if(!autoPass)throw new Error('Automatic dispatch criteria did not pass for the selected simulation mission.');
for(const checkbox of await page.locator('#mc-quick-dispatch-form input[type="checkbox"]').all())await checkbox.check();
await page.locator('[data-quick-dispatch-action="READY"]').click();
await page.waitForFunction(id=>Boolean(flowMission(id)?.quickDispatch&&window.flowPreflightReady?.(flowMission(id))),missionId,{timeout:10000});
await page.locator('.mc-dispatch-panel.ready').waitFor();

const saved=await page.evaluate(id=>{
  const mission=flowMission(id);const clearance=window.dlogisMaintenanceClearance.clearanceFor(mission.droneId);const record=window.flowPreflightRecordFor(mission,false);
  return {
    ready:window.flowPreflightReady(mission),
    clearanceId:clearance.record?.id,
    quickClearanceId:mission.quickDispatch?.clearanceId,
    itemCount:Object.values(record?.items||{}).filter(item=>item.status==='VERIFIED').length,
    signed:Boolean(record?.signoff?.recordHash),
    history:(mission.history||[]).map(row=>row[0]).join('|')
  };
},missionId);
if(!saved.ready||saved.clearanceId!==saved.quickClearanceId||saved.itemCount!==6||!saved.signed)throw new Error(`Quick dispatch was not stored as a complete traceable record: ${JSON.stringify(saved)}`);
if(!saved.history.includes('빠른 출동 확인 완료'))throw new Error('Quick-dispatch completion was not written to mission history.');

// Detailed evidence remains available on demand, but is no longer the default workflow.
await page.locator(`[data-toggle-preflight-detail="${missionId}"]`).click();
await page.locator('.pf-shell.mc-legacy-preflight.is-expanded').waitFor();

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS periodic aircraft clearance and one-screen quick dispatch smoke test passed.');
await browser.close();
