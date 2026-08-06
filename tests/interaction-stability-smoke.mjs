import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByText('통합관제 대시보드',{exact:true}).waitFor();

// A control under the pointer must not be replaced by the one-second telemetry render.
await page.locator('.sidebar [data-view="safety"]').click();
await page.getByRole('heading',{name:'안전경보 센터'}).waitFor();
const alertButton=page.locator('[data-ack-alert]').first();
await alertButton.waitFor();
await alertButton.hover();
const alertHandle=await alertButton.elementHandle();
await page.waitForTimeout(2600);
if(!await alertHandle.evaluate(element=>element.isConnected)){
  throw new Error('Safety action button was replaced before the user could click it.');
}
await alertButton.click();

// Completed operation controls stay open while hovered/focused, even beyond the old 4.6s timeout.
const dismissButton=page.locator('[data-operation-dismiss]');
await dismissButton.waitFor({timeout:10000});
await dismissButton.hover();
const dockHandle=await page.locator('#flow-operation-dock').elementHandle();
await page.waitForTimeout(6000);
if(!await dockHandle.evaluate(element=>element.isConnected)){
  throw new Error('Operation message disappeared while the close button was being used.');
}
const pausedCopy=await page.locator('.operation-dock-autoclose').innerText();
if(!pausedCopy.includes('일시정지'))throw new Error(`Auto-close was not paused during interaction: ${pausedCopy}`);
await dismissButton.click();
await page.locator('#flow-operation-dock').waitFor({state:'detached'});

// The single report button also remains attached while the pointer is over it.
await page.locator('.sidebar [data-view="reports"]').click();
await page.getByRole('heading',{name:'운영리포트'}).waitFor();
const reportButton=page.locator('[data-unified-report]');
await reportButton.waitFor();
await reportButton.hover();
const reportHandle=await reportButton.elementHandle();
await page.waitForTimeout(2600);
if(!await reportHandle.evaluate(element=>element.isConnected)){
  throw new Error('Unified report button was replaced before the user could click it.');
}

const suppressionCount=await page.evaluate(()=>window.dlogisInteractionStability?.suppressedRenderCount||0);
if(suppressionCount<1)throw new Error('Telemetry interaction guard did not suppress any disruptive render.');
if(errors.length)throw new Error(errors.join('\n'));

console.log('D-LOGIS interaction and button stability smoke test passed.');
await browser.close();
