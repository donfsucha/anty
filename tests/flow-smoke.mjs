import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

function numericText(text){
  const matched=String(text).match(/-?\d+(?:\.\d+)?/);
  return matched?Number(matched[0]):0;
}
async function overviewValue(label){
  const card=page.locator('.flow-overview-item').filter({hasText:label}).first();
  await card.waitFor();
  return numericText(await card.locator('strong').innerText());
}
async function openNav(view,heading){
  await page.locator(`.sidebar [data-view="${view}"]`).click();
  await page.getByText(heading,{exact:true}).first().waitFor();
}
async function waitOperation(timeout=15000){
  await page.locator('#flow-operation-overlay').waitFor();
  await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout});
}
async function openPreflight(key){
  await page.locator(`[data-verify-preflight="MSN-260726-003"][data-preflight-key="${key}"]`).click();
  await page.locator('#pf-verification-form').waitFor();
}
async function submitPreflight(){
  await page.locator('#pf-verification-form button[type="submit"]').click();
  await page.locator('#pf-verification-form').waitFor({state:'detached',timeout:8000});
}
async function assertSvgRoute(selector,label){
  const layer=page.locator(selector).first();
  if(await layer.count()!==1)throw new Error(`${label} SVG layer is missing.`);
  const points=(await layer.getAttribute('points')||'').trim();
  if(!points)throw new Error(`${label} SVG layer has no route coordinates.`);
}
const testPhoto={name:'evidence.jpg',mimeType:'image/jpeg',buffer:Buffer.from('D-LOGIS evidence image test')};

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByText('통합관제 대시보드',{exact:true}).waitFor();

/* Dashboard, map and fleet counts must come from one canonical snapshot. */
const initialMissionCount=await overviewValue('수행 중 임무');
const initialDroneCount=await overviewValue('운항 중 드론');
const initialMapCount=await page.locator('.ops-drone-marker').count();
if(initialMissionCount!==initialDroneCount||initialDroneCount!==initialMapCount){
  throw new Error(`Initial state mismatch: missions=${initialMissionCount}, drones=${initialDroneCount}, map=${initialMapCount}`);
}
await page.getByText('전체 화면 데이터 일치',{exact:true}).waitFor();
await page.locator('.ops-map-shell').waitFor();
await page.locator('.ops-flight-card').waitFor();
await page.locator('.ops-map-legend').waitFor();
await assertSvgRoute('.ops-map-planned','Planned route');
await assertSvgRoute('.ops-map-flown','Flown route');

/* Run approval and assignment. */
await openNav('missions','배송임무 관리');
const readyRow=page.locator('tr[data-select-mission="MSN-260726-003"]');
await readyRow.click();
await page.locator('[data-mission-action="APPROVE"]').click();
await waitOperation();
await page.locator('.detail-panel').getByText('승인 완료·출동 준비',{exact:true}).waitFor();
await page.locator('[data-auto-assign="MSN-260726-003"]').click();
await waitOperation();
await page.locator('.pf-shell').waitFor();
if(await page.locator('[data-check-all="MSN-260726-003"]').count())throw new Error('Unsafe one-click complete checklist is still visible.');
if(await page.locator('.pf-item').count()!==6)throw new Error('Preflight verification item count is not six.');

/* A manual item cannot pass from a simple click; it requires a photo and declaration. */
await openPreflight('airframe');
await page.locator('#pf-verification-form [data-modal-close]').first().click();
await page.locator('#pf-verification-form').waitFor({state:'detached'});
if(!await page.locator('.pf-item.pending').first().isVisible())throw new Error('Manual item changed state without evidence.');
await openPreflight('airframe');
await page.locator('#pf-verification-form input[name="evidenceFile"]').setInputFiles(testPhoto);
await page.locator('#pf-verification-form input[name="physicalConfirm"]').check();
await submitPreflight();

/* BMS and link items are validated against live values and saved as snapshots. */
await openPreflight('battery');
await page.getByText('자동 기준 통과',{exact:true}).waitFor();
await submitPreflight();

await openPreflight('cargo');
await page.locator('#pf-verification-form input[name="measuredWeight"]').fill('0.9');
await page.locator('#pf-verification-form input[name="evidenceFile"]').setInputFiles(testPhoto);
await page.locator('#pf-verification-form input[name="latchConfirm"]').check();
await submitPreflight();

await openPreflight('link');
await page.getByText('자동 기준 통과',{exact:true}).waitFor();
await submitPreflight();

await openPreflight('route');
await page.locator('#pf-verification-form input[name="approvalRef"]').fill('INT-OPS-QA-003');
await page.locator('#pf-verification-form input[name="routeConfirm"]').check();
await submitPreflight();

await openPreflight('weather');
await page.locator('#pf-verification-form input[name="windMs"]').fill('3.2');
await page.locator('#pf-verification-form input[name="visibilityKm"]').fill('10.0');
await submitPreflight();

/* Final sign-off hashes and locks the six evidence items. */
await page.locator('[data-preflight-sign="MSN-260726-003"]').click();
await page.locator('#pf-signoff-form').waitFor();
await page.locator('#pf-signoff-form input[name="signerName"]').fill('이서연');
await page.locator('#pf-signoff-form input[name="declaration"]').check();
await page.locator('#pf-signoff-form button[type="submit"]').click();
await page.locator('#pf-signoff-form').waitFor({state:'detached',timeout:8000});
await page.locator('.pf-shell.ready').waitFor();
await page.getByText('검증기록 잠금 완료 · 이륙 가능',{exact:true}).waitFor();

/* Start is allowed only after evidence and sign-off. */
const startButton=page.locator('[data-mission-action="START"]');
await startButton.waitFor();
if(await startButton.isDisabled())throw new Error('Start remained disabled after verified sign-off.');
await startButton.click();
await waitOperation(18000);
await page.locator('.detail-panel').getByText('배송 운항',{exact:true}).waitFor();

/* Re-check dashboard counts and enriched map after the state transition. */
await openNav('dashboard','통합관제 대시보드');
const activeMissionCount=await overviewValue('수행 중 임무');
const activeDroneCount=await overviewValue('운항 중 드론');
const activeMapCount=await page.locator('.ops-drone-marker').count();
if(activeMissionCount!==activeDroneCount||activeDroneCount!==activeMapCount){
  throw new Error(`Post-start mismatch: missions=${activeMissionCount}, drones=${activeDroneCount}, map=${activeMapCount}`);
}
if(activeDroneCount<2)throw new Error('Started mission did not increase the active drone count.');
const flightCardText=await page.locator('.ops-flight-card').innerText();
for(const label of ['항로 편차','잔여 거리','승인','수신']){
  if(!flightCardText.includes(label))throw new Error(`Operational map detail missing: ${label}`);
}
await assertSvgRoute('.ops-map-planned','Updated planned route');
await assertSvgRoute('.ops-map-flown','Updated flown route');

/* Fleet view must be flight/maintenance centric and visually independent. */
await openNav('fleet','드론 운항·정비 관리');
await page.locator('.fleet-command-hero').waitFor();
if(await page.locator('.fleet-aircraft-card').count()!==4)throw new Error('Fleet card count does not match registered drones.');
const aircraftCard=page.locator('.fleet-aircraft-card[data-aircraft-id="DR-001"]');
await aircraftCard.waitFor();
const aircraftText=await aircraftCard.innerText();
for(const label of ['LIVE TELEMETRY','ASSET READINESS','WGS84 위치','정비 잔여','연결 임무']){
  if(!aircraftText.includes(label))throw new Error(`Fleet information missing: ${label}`);
}
await aircraftCard.locator('[data-select-drone="DR-001"]').click();
await page.locator('.drone-detail-modal').waitFor();
await page.locator('.flight-status-section').waitFor();
await page.locator('.energy-status-section').waitFor();
await page.locator('.mission-link-section').waitFor();
await page.locator('.drone-detail-item').first().click();
if(!await page.locator('.drone-detail-modal').isVisible())throw new Error('Popup closed when its content was clicked.');
await page.locator('.drone-detail-foot [data-modal-close]').click();
await page.locator('.drone-detail-modal').waitFor({state:'detached'});

/* Battery view must use a separate energy/health visual language. */
await openNav('batteries','배터리 에너지·건전성 관리');
await page.locator('.energy-command-hero').waitFor();
if(await page.locator('.energy-battery-card').count()!==6)throw new Error('Battery card count does not match registered batteries.');
if(await page.locator('.fleet-aircraft-card').count()!==0)throw new Error('Fleet card layout leaked into the battery page.');
const bat1=page.locator('.energy-battery-card[data-battery-id="BAT-001"]');
await bat1.waitFor();
const batteryText=await bat1.innerText();
for(const label of ['SOC','SOH','셀 편차','충방전 사이클','예상 잔여비행','연결 임무']){
  if(!batteryText.includes(label))throw new Error(`Battery information missing: ${label}`);
}
if(!/18\.0mV/.test(batteryText))throw new Error('Battery cell delta precision was lost.');
await bat1.locator('[data-battery-detail="BAT-001"]').click();
await page.locator('.battery-detail-modal').waitFor();
for(const heading of ['에너지 상태','건전성·셀 균형','기체·임무 연결','데이터 신뢰성'])await page.getByText(heading,{exact:true}).waitFor();
await page.locator('.battery-detail-foot [data-modal-close]').click();
await page.locator('.battery-detail-modal').waitFor({state:'detached'});

/* Visit every major admin page and verify that it renders without runtime errors. */
await openNav('safety','안전경보 센터');
await openNav('proofs','배송 완료 증빙');
await openNav('reports','운영리포트');
await page.getByText('임무 완료율',{exact:true}).waitFor();
await openNav('connection','기체 연결 설정');

const bodyText=await page.locator('body').innerText();
if(/\d+\.\d{2,}(?=%|m\b|km\/h|℃|h\b|분|건|대|개|mV)/.test(bodyText))throw new Error('An operational value is displayed with more than one decimal place.');
if(errors.length)throw new Error(errors.join('\n'));

console.log('D-LOGIS evidence preflight and operational map smoke test passed.');
await browser.close();
