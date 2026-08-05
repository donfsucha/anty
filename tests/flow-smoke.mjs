import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.locator('text=통합관제 대시보드').waitFor();
await page.locator('[data-view="missions"]').click();
await page.locator('text=배송임무 관리').waitFor();

const readyRow=page.locator('[data-select-mission="MSN-260726-003"]');
await readyRow.click();
await page.locator('[data-mission-action="APPROVE"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:12000});
await page.locator('text=승인 완료').first().waitFor();

await page.locator('[data-check-all="MSN-260726-003"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:12000});
await page.locator('[data-mission-action="START"]').waitFor();
await page.locator('[data-mission-action="START"]').click();
await page.locator('#flow-operation-overlay').waitFor();
await page.locator('#flow-operation-overlay').waitFor({state:'detached',timeout:15000});

const bodyText=await page.locator('body').innerText();
if(!bodyText.includes('D-LOGIS B1'))throw new Error('Drone display name is missing from mission/fleet-linked UI.');
if(/\d+\.\d{3,}/.test(bodyText))throw new Error('A displayed operational number has more than one decimal place.');
if(errors.length)throw new Error(errors.join('\n'));

console.log('Connected mission flow smoke test passed.');
await browser.close();
