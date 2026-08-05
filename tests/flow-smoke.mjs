import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
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

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByText('통합관제 대시보드',{exact:true}).waitFor();

/* Dashboard, map and fleet counts must come from one canonical snapshot. */
const initialMissionCount=await overviewValue('수행 중 임무');
const initialDroneCount=await overviewValue('운항 중 드론');
const initialMapCount=await page.locator('.drone-marker.active').count();
if(initialMissionCount!==initialDroneCount||initialDroneCount!==initialMapCount){
  throw new Error(`Initial state mismatch: missions=${initialMissionCount}, drones=${initialDroneCount}, map=${initialMapCount}`);
}
await page.getByText('전체 화면 데이터 일치',{exact:true}).waitFor();

/* Run the full approval → assignment → inspection → start path. */
await openNav('missions','배송임무 관리');
const readyRow=page.locator('tr[data-select-mission="MSN-260726-003"]');
await readyRow.click();
await page.locator('[data-mission-action="APPROVE"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:12000});
await page.locator('.detail-panel').getByText('승인 완료',{exact:true}).waitFor();

await page.locator('[data-auto-assign="MSN-260726-003"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:12000});
await page.getByText('자원 배정',{exact:true}).first().waitFor();

await page.locator('[data-check-all="MSN-260726-003"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:12000});
await page.locator('[data-mission-action="START"]').waitFor();
await page.locator('[data-mission-action="START"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:15000});
await page.locator('.detail-panel').getByText('운항 중',{exact:true}).waitFor();

/* Re-check dashboard counts after the state transition. */
await openNav('dashboard','통합관제 대시보드');
const activeMissionCount=await overviewValue('수행 중 임무');
const activeDroneCount=await overviewValue('운항 중 드론');
const activeMapCount=await page.locator('.drone-marker.active').count();
if(activeMissionCount!==activeDroneCount||activeDroneCount!==activeMapCount){
  throw new Error(`Post-start mismatch: missions=${activeMissionCount}, drones=${activeDroneCount}, map=${activeMapCount}`);
}
if(activeDroneCount<2)throw new Error('Started mission did not increase the active drone count.');

/* Fleet popup must be visually separated and close only by explicit buttons. */
await openNav('fleet','드론 관리');
await page.locator('[data-select-drone="DR-001"]').click();
await page.locator('.drone-detail-modal').waitFor();
await page.locator('.flight-status-section').waitFor();
await page.locator('.energy-status-section').waitFor();
await page.locator('.mission-link-section').waitFor();
await page.locator('.drone-detail-item').first().click();
if(!await page.locator('.drone-detail-modal').isVisible())throw new Error('Popup closed when its content was clicked.');
await page.locator('.drone-detail-foot [data-modal-close]').click();
await page.locator('.drone-detail-modal').waitFor({state:'detached'});

/* Battery precision is displayed in mV while other operational values use one decimal. */
await openNav('batteries','스마트배터리');
const bat1=page.locator('.entity').filter({hasText:'BAT-001'}).first();
await bat1.waitFor();
if(!/18\.0mV/.test(await bat1.innerText()))throw new Error('Battery cell delta precision was lost.');

/* Visit every major admin page and verify that it renders without runtime errors. */
await openNav('safety','안전경보 센터');
await openNav('proofs','배송 완료 증빙');
await openNav('reports','운영리포트');
await page.getByText('임무 완료율',{exact:true}).waitFor();
await openNav('connection','기체 연결 설정');

const bodyText=await page.locator('body').innerText();
if(/\d+\.\d{2,}(?=%|m\b|km\/h|℃|h\b|분|건|대|개)/.test(bodyText)){
  throw new Error('An operational value is displayed with more than one decimal place.');
}
if(errors.length)throw new Error(errors.join('\n'));

console.log('D-LOGIS cross-page consistency smoke test passed.');
await browser.close();
