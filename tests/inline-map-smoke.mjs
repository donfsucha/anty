import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByText('통합관제 대시보드',{exact:true}).waitFor();

const originalUrl=page.url();
const originalPageCount=context.pages().length;
const activeMarkers=await page.locator('.ops-drone-marker').count();
if(activeMarkers<1)throw new Error('No active operational drone exists before switching map mode.');

await page.locator('[data-inline-map-toggle]').click();
await page.locator('.ops-map-canvas.is-inline-live').waitFor();
await page.locator('#ops-inline-live-map').waitFor();
await page.locator('.ops-live-flight-card').waitFor();

if(page.url()!==originalUrl)throw new Error(`Inline actual map navigated away from the dashboard: ${page.url()}`);
if(context.pages().length!==originalPageCount)throw new Error('Inline actual map opened a separate browser tab.');
if(await page.evaluate(()=>state.flowUi?.inlineMapMode)!=='live')throw new Error('Inline map mode was not stored in the current application state.');

await page.locator('#ops-inline-live-map.leaflet-container').waitFor({timeout:20000});
const actualMapMarkers=await page.locator('#ops-inline-live-map .leaflet-marker-icon').count();
if(actualMapMarkers<activeMarkers)throw new Error(`Actual map marker count is smaller than the canonical active-drone count: actual=${actualMapMarkers}, expected>=${activeMarkers}`);

const sideText=await page.locator('.ops-live-flight-card').innerText();
for(const label of ['현재 WGS84','승인','수신','OpenStreetMap']){
  if(!sideText.includes(label))throw new Error(`Inline actual-map information is missing: ${label}`);
}

await page.locator('[data-inline-map-toggle]').click();
await page.locator('.ops-map-canvas:not(.is-inline-live)').waitFor();
if(page.url()!==originalUrl)throw new Error('Returning to the operational diagram changed the page URL.');
if(errors.length)throw new Error(errors.join('\n'));

console.log('D-LOGIS inline actual map smoke test passed.');
await browser.close();
