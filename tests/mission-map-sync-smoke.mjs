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

/* Open the real map and intentionally prepare a zero-aircraft state. */
if(await page.evaluate(()=>state.flowUi?.inlineMapMode)!=='live'){
  await page.locator('[data-inline-map-toggle]').click();
}
await page.locator('#ops-inline-live-map.leaflet-container').waitFor({timeout:20000});

const prepared=await page.evaluate(()=>{
  const active=new Set(['IN_FLIGHT','HOLDING','DELIVERED','RETURNING','LANDING']);
  state.missions.forEach(mission=>{
    if(active.has(mission.status)){
      mission.status='COMPLETED';mission.progress=100;mission.etaMin=0;
      mission.completedAt=mission.completedAt||new Date().toISOString();
    }
  });
  state.drones.forEach(drone=>{
    if(drone.status==='MAINTENANCE')return;
    drone.status='READY';drone.flightMode='STANDBY';drone.armed=false;drone.altitude=0;drone.speed=0;drone.missionId=null;
  });
  state.batteries.forEach(battery=>{if(battery.status==='IN_USE')battery.status='READY';});

  const mission=state.missions.find(item=>item.id==='MSN-260726-003')||state.missions.find(item=>item.status==='READY');
  if(!mission)throw new Error('No mission is available for the map synchronization test.');
  let drone=flowDrone(mission.droneId);
  if(!drone||drone.status==='MAINTENANCE')drone=state.drones.find(item=>item.status==='READY');
  let battery=flowBattery(mission.batteryId);
  if(!battery||battery.status==='QUARANTINE')battery=state.batteries.find(item=>item.status==='READY'&&Number(item.soc)>=40);
  if(!drone||!battery)throw new Error('No drone or battery is available for the map synchronization test.');

  mission.status='APPROVED';mission.approvalState='APPROVED';mission.approvedAt=new Date().toISOString();
  mission.droneId=drone.id;mission.batteryId=battery.id;mission.resourceAssignedAt=new Date().toISOString();
  mission.progress=0;mission.etaMin=15;mission.departedAt=null;mission.completedAt=null;
  mission.checks={airframe:true,battery:true,cargo:true,link:true,route:true,weather:true};
  drone.status='READY';drone.missionId=mission.id;drone.batteryId=battery.id;
  battery.status='READY';battery.droneId=drone.id;
  state.selectedMission=mission.id;state.flowUi.inlineMapMode='live';state.flowUi.selectedMapDroneId=null;
  persist();render();
  return {missionId:mission.id,droneId:drone.id,droneName:drone.name};
});

await page.locator('#ops-inline-live-map.leaflet-container').waitFor({timeout:20000});
await page.waitForFunction(()=>document.querySelectorAll('.inline-live-drone').length===0,null,{timeout:8000});

/* Simulate the accepted take-off state while the live dashboard is already open. */
await page.evaluate(({missionId})=>{
  const mission=flowMission(missionId);
  flowApplyAction(mission,'START');
  persist();
},prepared);

await page.waitForFunction(({missionId,droneId})=>{
  const snapshot=window.dlogisMissionMapSync?.synchronizedSnapshot?.();
  return Boolean(
    snapshot?.pairs?.some(pair=>pair.mission?.id===missionId&&pair.drone?.id===droneId)&&
    document.querySelector('.inline-live-drone')&&
    document.querySelector('.ops-live-flight-card')?.textContent.includes(missionId)
  );
},prepared,{timeout:20000});

const liveDroneText=await page.locator('.inline-live-drone').first().innerText();
if(!liveDroneText.includes(prepared.droneName))throw new Error(`Started drone is missing from the actual map marker: ${liveDroneText}`);
const sideText=await page.locator('.ops-live-flight-card').innerText();
if(!sideText.includes(prepared.missionId)||!sideText.includes(prepared.droneId))throw new Error('Started mission is not linked to the live-map side card.');
const snapshot=await page.evaluate(()=>{
  const value=window.dlogisMissionMapSync.synchronizedSnapshot();
  return {missionCount:value.activeMissions.length,droneCount:value.activeDrones.length,mapCount:value.mapActiveCount,selected:state.flowUi.selectedMapDroneId,mode:state.flowUi.inlineMapMode};
});
if(snapshot.missionCount!==snapshot.droneCount||snapshot.droneCount!==snapshot.mapCount)throw new Error(`Mission/map count mismatch after start: ${JSON.stringify(snapshot)}`);
if(snapshot.selected!==prepared.droneId||snapshot.mode!=='live')throw new Error('The started drone was not selected in live-map mode.');

/* Active mission detail must provide a direct, reliable tracking action. */
await page.locator('.sidebar [data-view="missions"]').click();
await page.getByRole('heading',{name:'배송임무 관리'}).waitFor();
await page.locator(`tr[data-select-mission="${prepared.missionId}"]`).click();
const trackButton=page.locator(`[data-track-mission="${prepared.missionId}"]`);
await trackButton.waitFor();
await trackButton.click();
await page.getByRole('heading',{name:'통합관제 대시보드'}).waitFor();
await page.locator('#ops-inline-live-map.leaflet-container').waitFor({timeout:20000});
await page.waitForFunction(({missionId})=>document.querySelector('.ops-live-flight-card')?.textContent.includes(missionId),prepared,{timeout:10000});

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS active mission-to-map synchronization smoke test passed.');
await browser.close();
