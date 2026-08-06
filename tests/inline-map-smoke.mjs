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

const activeMapState=await page.evaluate(()=>{
  const map=window.dlogisMapResilience?.lastMap;
  const layer=window.dlogisMapResilience?.lastTileLayer;
  return {loaded:Boolean(map?._loaded),zoom:map?.getZoom?.(),tileUrl:layer?._url||''};
});
if(!activeMapState.loaded||!Number.isFinite(activeMapState.zoom))throw new Error('Active actual map has no valid center and zoom.');
if(activeMapState.tileUrl!=='https://tile.openstreetmap.org/{z}/{x}/{y}.png')throw new Error(`Unexpected OSM tile URL: ${activeMapState.tileUrl}`);

await page.locator('[data-inline-map-toggle]').click();
await page.locator('.ops-map-canvas:not(.is-inline-live)').waitFor();
if(page.url()!==originalUrl)throw new Error('Returning to the operational diagram changed the page URL.');

// Regression: no active mission previously left Leaflet without a center/zoom,
// which produced zoom controls over a completely blank map background.
await page.evaluate(()=>{
  const activeStatuses=new Set(['IN_FLIGHT','HOLDING','RETURNING','DELIVERED','LANDING']);
  state.missions.forEach(mission=>{
    if(activeStatuses.has(mission.status)){
      mission.status='COMPLETED';
      mission.progress=100;
      mission.etaMin=0;
      mission.completedAt=mission.completedAt||new Date().toISOString();
    }
  });
  state.drones.forEach(drone=>{
    if(drone.status==='MAINTENANCE')return;
    drone.status='READY';drone.altitude=0;drone.speed=0;drone.armed=false;drone.flightMode='STANDBY';
  });
  state.batteries.forEach(battery=>{if(battery.status==='IN_USE')battery.status='READY';});
  state.flowUi.inlineMapMode='schematic';
  persist();render();
});
await page.getByText('통합관제 대시보드',{exact:true}).waitFor();
if(await page.locator('.ops-drone-marker').count())throw new Error('Active operational markers remain after preparing the empty-map scenario.');

await page.locator('[data-inline-map-toggle]').click();
await page.locator('#ops-inline-live-map.leaflet-container').waitFor({timeout:20000});
await page.waitForFunction(()=>Boolean(window.dlogisMapResilience?.lastMap?._loaded),null,{timeout:5000});

const emptyMapState=await page.evaluate(()=>{
  const map=window.dlogisMapResilience?.lastMap;
  const layer=window.dlogisMapResilience?.lastTileLayer;
  const center=map?.getCenter?.();
  const container=document.getElementById('ops-inline-live-map');
  return {
    loaded:Boolean(map?._loaded),
    zoom:map?.getZoom?.(),
    lat:center?.lat,
    lng:center?.lng,
    tileUrl:layer?._url||'',
    tileElements:container?.querySelectorAll('.leaflet-tile').length||0,
    width:container?.getBoundingClientRect().width||0,
    height:container?.getBoundingClientRect().height||0
  };
});
if(!emptyMapState.loaded)throw new Error('Actual map without active missions was not initialized.');
if(emptyMapState.zoom!==13)throw new Error(`Empty actual map did not use the default zoom: ${emptyMapState.zoom}`);
if(Math.abs(emptyMapState.lat-37.5032)>.002||Math.abs(emptyMapState.lng-126.7652)>.002)throw new Error(`Empty actual map did not use the Bucheon default center: ${emptyMapState.lat}, ${emptyMapState.lng}`);
if(emptyMapState.tileUrl!=='https://tile.openstreetmap.org/{z}/{x}/{y}.png')throw new Error(`Empty actual map uses an invalid tile endpoint: ${emptyMapState.tileUrl}`);
if(emptyMapState.tileElements<1)throw new Error('No OSM tile elements were generated for the empty actual map.');
if(emptyMapState.width<400||emptyMapState.height<300)throw new Error(`Actual map container has an invalid size: ${emptyMapState.width}x${emptyMapState.height}`);
if(!(await page.locator('.ops-map-empty').innerText()).includes('운항 중 기체가 없습니다'))throw new Error('Empty actual map guidance is missing.');

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS inline actual map smoke test passed for active and empty mission states.');
await browser.close();