import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1680,height:1050}});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByRole('heading',{name:'통합관제 대시보드'}).waitFor();
await page.locator('.sidebar [data-view="missions"]').click();
await page.getByRole('heading',{name:'배송임무 관리'}).waitFor();

const expectedCodes=['ALL','READY','APPROVED','IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING','COMPLETED','CANCELLED'];
const actualCodes=await page.locator('#mission-status option').evaluateAll(options=>options.map(option=>option.value));
if(JSON.stringify(actualCodes)!==JSON.stringify(expectedCodes))throw new Error(`Mission status order mismatch: ${actualCodes.join(',')}`);
for(const invalid of ['MAINTENANCE','CHARGING','OFFLINE','QUARANTINE']){
  if(actualCodes.includes(invalid))throw new Error(`Non-mission status leaked into mission filter: ${invalid}`);
}
const optionText=(await page.locator('#mission-status').innerText()).replace(/\s+/g,' ');
for(const label of ['승인 대기','승인 완료·출동 준비','배송 운항','복귀 운항','임무 종료']){
  if(!optionText.includes(label))throw new Error(`Ordered mission label missing: ${label}`);
}

const scopeButtons=page.locator('[data-mission-scope]');
if(await scopeButtons.count()!==3)throw new Error('Expected 전체 임무, 진행·대기, 완료 이력 scope tabs.');
await page.locator('[data-mission-scope="ARCHIVE"]').click();
await page.locator('[data-mission-scope="ARCHIVE"][aria-selected="true"]').waitFor();

const sourceId='MSN-260725-018';
const sourceRow=page.locator(`tr[data-select-mission="${sourceId}"]`);
await sourceRow.waitFor();
const before=await page.evaluate(id=>({
  count:state.missions.length,
  source:structuredClone(state.missions.find(mission=>mission.id===id))
}),sourceId);

await sourceRow.locator(`[data-repeat-mission="${sourceId}"]`).click();
await page.getByRole('heading',{name:'지난 수행 재수행'}).waitFor();
const modalText=await page.locator('.mission-repeat-modal').innerText();
for(const label of ['원본 수행','복사되는 정보','복사되지 않는 정보','원본 수행기록은 변경하지 않고']){
  if(!modalText.includes(label))throw new Error(`Repeat confirmation information missing: ${label}`);
}
await page.locator('input[name="preserveOriginal"]').check();
await page.locator('#mission-repeat-form button[type="submit"]').click();
await page.locator('.mission-repeat-modal').waitFor({state:'detached'});

const result=await page.evaluate(id=>{
  const source=state.missions.find(mission=>mission.id===id);
  const repeated=state.missions.find(mission=>mission.repeatOfMissionId===id);
  return {
    count:state.missions.length,
    source,
    repeated,
    selectedMission:state.selectedMission,
    scope:state.flowUi?.missionScope,
    missionStatus
  };
},sourceId);

if(result.count!==before.count+1)throw new Error('Repeated mission did not create exactly one new Mission ID.');
if(!result.repeated)throw new Error('Repeated mission lineage was not saved.');
if(result.repeated.id===sourceId)throw new Error('Original Mission ID was reused instead of creating a new record.');
if(result.repeated.status!=='READY'||result.repeated.approvalState!=='PENDING')throw new Error('Repeated mission did not restart at approval pending.');
if(result.repeated.progress!==0)throw new Error('Repeated mission progress was not reset.');
if(result.repeated.droneId!==null||result.repeated.batteryId!==null)throw new Error('Previous operational assignment was copied as an active assignment.');
if(!Object.values(result.repeated.checks||{}).every(value=>value===false))throw new Error('Previous safety verification was copied into the repeated mission.');
for(const field of ['approvedAt','resourceAssignedAt','departedAt','deliveredAt','completedAt']){
  if(result.repeated[field])throw new Error(`Operational timestamp should have been reset: ${field}`);
}
if(result.repeated.rootMissionId!==sourceId||result.repeated.repeatSequence!==2)throw new Error('Repeat lineage or sequence is incorrect.');
if(result.source.status!=='COMPLETED'||result.source.completedAt!==before.source.completedAt)throw new Error('Original completed mission was modified.');
if(result.selectedMission!==result.repeated.id||result.scope!=='ACTIVE'||result.missionStatus!=='ALL')throw new Error('The new repeated mission was not opened in the active workflow.');

await page.locator(`tr[data-select-mission="${result.repeated.id}"]`).waitFor();
const newRowText=await page.locator(`tr[data-select-mission="${result.repeated.id}"]`).innerText();
if(!newRowText.includes('재수행 2회차')||!newRowText.includes('승인 대기'))throw new Error('Repeat lineage or mission status is not visible in the mission list.');

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS ordered mission status and repeat-from-history smoke test passed.');
await browser.close();
