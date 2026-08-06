import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

function numericText(text){const match=String(text).match(/-?\d+(?:\.\d+)?/);return match?Number(match[0]):0;}
async function overviewValue(label){const card=page.locator('.flow-overview-item').filter({hasText:label}).first();await card.waitFor();return numericText(await card.locator('strong').innerText());}
async function openNav(view,heading){await page.locator(`.sidebar [data-view="${view}"]`).click();await page.getByRole('heading',{name:heading}).waitFor();}
async function waitOperation(timeout=20000){await page.locator('#flow-operation-overlay').waitFor({timeout:5000});await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout});}

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByRole('heading',{name:'통합관제 대시보드'}).waitFor();

const initialMissionCount=await overviewValue('수행 중 임무');
const initialDroneCount=await overviewValue('운항 중 드론');
const initialMapCount=await page.locator('.ops-drone-marker').count();
if(initialMissionCount!==initialDroneCount||initialDroneCount!==initialMapCount)throw new Error(`Initial canonical-state mismatch: ${initialMissionCount}/${initialDroneCount}/${initialMapCount}`);
await page.getByText('전체 화면 데이터 일치',{exact:true}).waitFor();
await page.locator('.ops-map-shell').waitFor();

await openNav('missions','배송임무 관리');
const missionId='MSN-260726-003';
await page.locator(`tr[data-select-mission="${missionId}"]`).click();
await page.locator(`[data-mission-action="APPROVE"][data-mission-id="${missionId}"]`).click();
await waitOperation();
await page.locator('.detail-panel .mission-status-badge[data-mission-status-code="APPROVED"]').waitFor();
await page.locator(`[data-auto-assign="${missionId}"]`).click();
await waitOperation();

await page.locator('.mc-dispatch-panel').waitFor();
if(await page.locator('.pf-shell.mc-legacy-preflight:visible').count())throw new Error('Detailed six-card evidence workflow should be collapsed by default.');
const dispatchText=await page.locator('.mc-dispatch-panel').innerText();
for(const label of ['기체 정기점검','자동 상태검증','임무 확인·서명'])if(!dispatchText.includes(label))throw new Error(`Dispatch workflow label missing: ${label}`);

await page.locator(`[data-open-quick-dispatch="${missionId}"]`).click();
await page.locator('#mc-quick-dispatch-form').waitFor();
for(const checkbox of await page.locator('#mc-quick-dispatch-form input[type="checkbox"]').all())await checkbox.check();
const automatic=await page.evaluate(id=>window.dlogisMaintenanceClearance.automaticReadiness(flowMission(id)),missionId);
if(!automatic.automaticPass)throw new Error(`Automatic quick-dispatch checks failed: ${JSON.stringify(automatic)}`);
await page.locator('[data-quick-dispatch-action="START"]').click();
await waitOperation(22000);
await page.locator('.detail-panel .mission-status-badge[data-mission-status-code="IN_FLIGHT"]').waitFor();
const signed=await page.evaluate(id=>{const mission=flowMission(id),record=window.flowPreflightRecordFor(mission,false);return {quick:Boolean(mission.quickDispatch),ready:window.flowPreflightReady(mission),items:Object.values(record?.items||{}).filter(item=>item.status==='VERIFIED').length,hash:record?.signoff?.recordHash||''};},missionId);
if(!signed.quick||!signed.ready||signed.items!==6||signed.hash.length<8)throw new Error(`Quick-dispatch evidence is incomplete: ${JSON.stringify(signed)}`);

await openNav('dashboard','통합관제 대시보드');
const activeMissionCount=await overviewValue('수행 중 임무');
const activeDroneCount=await overviewValue('운항 중 드론');
const activeMapCount=await page.locator('.ops-drone-marker').count();
if(activeMissionCount!==activeDroneCount||activeDroneCount!==activeMapCount)throw new Error(`Post-start canonical-state mismatch: ${activeMissionCount}/${activeDroneCount}/${activeMapCount}`);
if(activeDroneCount<2)throw new Error('Quick-start mission did not appear as an additional active drone.');

await openNav('fleet','드론 운항·정비 관리');
await page.locator('.fleet-command-hero').waitFor();
await page.locator('.mc-board').waitFor();
if(await page.locator('.fleet-aircraft-card').count()!==4)throw new Error('Fleet card count mismatch.');
if(!(await page.locator('.mc-board').innerText()).includes('정기점검 기반 출동 준비'))throw new Error('Periodic-clearance board is missing from aircraft management.');

await openNav('batteries','배터리 에너지·건전성 관리');
await page.locator('.energy-command-hero').waitFor();
if(await page.locator('.energy-battery-card').count()!==6)throw new Error('Battery card count mismatch.');

await openNav('safety','안전경보 센터');
await openNav('proofs','배송 완료 증빙');
await openNav('reports','운영리포트');
await page.getByText('임무 완료율',{exact:true}).waitFor();
await openNav('connection','기체 연결 설정');

const bodyText=await page.locator('body').innerText();
if(/\d+\.\d{2,}(?=%|m\b|km\/h|℃|h\b|분|건|대|개|mV)/.test(bodyText))throw new Error('An operational value is displayed with more than one decimal place.');
if(errors.length)throw new Error(errors.join('\n'));

console.log('D-LOGIS periodic-clearance core mission flow smoke test passed.');
await browser.close();
