import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1680,height:1000}});
const errors=[];
let pageClosed=false;

page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});
page.on('close',()=>{pageClosed=true;});

async function assertResponsive(label){
  if(pageClosed||page.isClosed())throw new Error(`${label}: browser page closed unexpectedly.`);

  const stateSnapshot=await page.evaluate(()=>({
    role:typeof state==='undefined'?null:state.role,
    view:typeof state==='undefined'?null:state.view,
    appChildren:document.getElementById('app')?.childElementCount||0,
    appText:document.getElementById('app')?.textContent?.trim().length||0,
    typeLessButtons:document.querySelectorAll('button:not([type])').length,
    guardLeaked:Boolean(window.__dlogisNativeMutationObserver)
  }));

  if(stateSnapshot.role!=='admin')throw new Error(`${label}: admin role was lost (${stateSnapshot.role}).`);
  if(stateSnapshot.appChildren<1||stateSnapshot.appText<20)throw new Error(`${label}: #app was emptied.`);
  if(stateSnapshot.typeLessButtons!==0)throw new Error(`${label}: ${stateSnapshot.typeLessButtons} type-less buttons remain.`);
  if(stateSnapshot.guardLeaked)throw new Error(`${label}: MutationObserver guard was not released.`);

  await page.evaluate(()=>new Promise((resolve,reject)=>{
    let frames=0;
    const timer=setTimeout(()=>reject(new Error('animation frame timeout')),1800);
    const step=()=>{
      frames+=1;
      if(frames>=3){clearTimeout(timer);resolve(true);return;}
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
}

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByRole('heading',{name:'통합관제 대시보드'}).waitFor();
await assertResponsive('initial dashboard');

const views=['missions','fleet','batteries','safety','proofs','reports','connection','dashboard'];
for(const view of views){
  await page.locator(`.sidebar [data-view="${view}"]`).click();
  await page.waitForTimeout(80);
  await assertResponsive(`sidebar ${view}`);
}

await page.locator('.sidebar [data-view="missions"]').click();
await page.getByRole('heading',{name:'배송임무 관리'}).waitFor();
await page.locator('[data-select-mission]').first().click();
await assertResponsive('mission row selection');

await page.locator('[data-new-mission]').first().click();
await page.locator('#mission-form').waitFor();
await page.locator('#modal-root [data-modal-close]').last().click();
await page.locator('#mission-form').waitFor({state:'detached'});
await assertResponsive('mission modal close');

const roleMenuButton=page.locator('[data-role-menu]').first();
await roleMenuButton.click();
await assertResponsive('role menu open');
await roleMenuButton.click();
await assertResponsive('role menu close');

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS button stability smoke test passed.');
await browser.close();
