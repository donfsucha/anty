import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByRole('heading',{name:'통합관제 대시보드'}).waitFor();
await page.locator('.sidebar [data-view="safety"]').click();
await page.getByRole('heading',{name:'안전경보 센터'}).waitFor();

const firstAck=page.locator('[data-ack-alert]').first();
await firstAck.waitFor();
await firstAck.click();
await page.locator('#flow-operation-overlay').waitFor({state:'visible',timeout:5000});
await page.locator('#flow-operation-dock').waitFor({state:'visible',timeout:8000});

const managedDock=page.locator('#flow-operation-dock.notification-managed');
await managedDock.waitFor();
const dockText=await managedDock.innerText();
if(!dockText.includes('자동으로 닫힙니다'))throw new Error('Auto-dismiss guidance is missing from the completed operation dock.');
if(await page.locator('[data-operation-dismiss]').count()!==1)throw new Error('Manual notification close control is missing.');

await managedDock.waitFor({state:'detached',timeout:16000});
await page.waitForTimeout(1400);
if(await page.locator('#flow-operation-dock').count())throw new Error('Completed operation notification reappeared after automatic dismissal.');

await page.locator('[data-create-alert]').click();
await page.waitForTimeout(150);
await page.locator('[data-ack-alert]').first().click();
await page.locator('#flow-operation-dock').waitFor({state:'visible',timeout:8000});
await page.locator('[data-operation-dismiss]').click();
await page.locator('#flow-operation-dock').waitFor({state:'detached',timeout:2000});
await page.waitForTimeout(1400);
if(await page.locator('#flow-operation-dock').count())throw new Error('Manually dismissed operation notification reappeared.');

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS notification lifecycle smoke test passed.');
await browser.close();
