import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});

async function enterAdmin(page){
  await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
  const roleButton=page.locator('[data-enter-role="admin"]');
  if(await roleButton.count())await roleButton.click();
  await page.getByText('통합관제 대시보드',{exact:true}).waitFor();
  await page.locator('.ops-map-shell').waitFor();
}
function columnCount(template){
  return String(template||'').trim().split(/\s+/).filter(Boolean).length;
}

/* Wide desktop: map uses the full content width and the three support cards sit below it. */
const desktopContext=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const desktop=await desktopContext.newPage();
const desktopErrors=[];
desktop.on('pageerror',error=>desktopErrors.push(error.message));
desktop.on('console',message=>{if(message.type()==='error')desktopErrors.push(message.text());});
await enterAdmin(desktop);
const desktopLayout=await desktop.evaluate(()=>{
  const grid=document.querySelector('.consistency-banner + .dashboard-grid');
  const mapCard=grid?.querySelector(':scope > .card');
  const stack=grid?.querySelector(':scope > .stack');
  const shell=mapCard?.querySelector('.ops-map-shell');
  const mapLayout=mapCard?.querySelector('.ops-map-layout');
  const canvas=mapCard?.querySelector('.ops-map-canvas');
  const kpis=[...document.querySelectorAll('.consistency-overview .flow-overview-item')];
  return {
    viewport:window.innerWidth,
    documentWidth:document.documentElement.scrollWidth,
    gridColumns:getComputedStyle(grid).gridTemplateColumns,
    stackColumns:getComputedStyle(stack).gridTemplateColumns,
    mapColumns:getComputedStyle(mapLayout).gridTemplateColumns,
    gridWidth:grid.getBoundingClientRect().width,
    mapWidth:mapCard.getBoundingClientRect().width,
    canvasWidth:canvas.getBoundingClientRect().width,
    mapBottom:mapCard.getBoundingClientRect().bottom,
    shellBottom:shell.getBoundingClientRect().bottom,
    stackTop:stack.getBoundingClientRect().top,
    stackCards:[...stack.children].map(card=>({height:card.getBoundingClientRect().height,top:card.getBoundingClientRect().top})),
    kpiTops:[...new Set(kpis.map(card=>Math.round(card.getBoundingClientRect().top)))],
    sidebarDisplay:getComputedStyle(document.querySelector('.sidebar')).display,
    sidebarWidth:document.querySelector('.sidebar').getBoundingClientRect().width,
    mainMargin:getComputedStyle(document.querySelector('.main')).marginLeft,
    responsiveCss:Boolean([...document.styleSheets].some(sheet=>String(sheet.href||'').includes('responsive-layout.css')))
  };
});
if(!desktopLayout.responsiveCss)throw new Error('Responsive layout stylesheet was not loaded.');
if(columnCount(desktopLayout.gridColumns)!==1)throw new Error(`Desktop dashboard must have one full-width map column: ${desktopLayout.gridColumns}`);
if(columnCount(desktopLayout.stackColumns)!==3)throw new Error(`Desktop support cards must use three columns: ${desktopLayout.stackColumns}`);
if(columnCount(desktopLayout.mapColumns)!==3)throw new Error(`Desktop operational map must use fleet/map/detail columns: ${desktopLayout.mapColumns}`);
if(desktopLayout.mapWidth<desktopLayout.gridWidth*.98)throw new Error(`Desktop map does not use the available width: ${desktopLayout.mapWidth}/${desktopLayout.gridWidth}`);
if(desktopLayout.canvasWidth<700)throw new Error(`Desktop map canvas remains compressed: ${desktopLayout.canvasWidth}px`);
if(Math.abs(desktopLayout.mapBottom-desktopLayout.shellBottom)>4)throw new Error(`Blank space remains below the map shell: ${desktopLayout.mapBottom-desktopLayout.shellBottom}px`);
if(desktopLayout.stackTop<desktopLayout.mapBottom-2)throw new Error('Desktop support cards overlap or sit beside the map instead of below it.');
if(desktopLayout.kpiTops.length!==1)throw new Error(`Six desktop KPI cards are not aligned on one row: ${desktopLayout.kpiTops}`);
if(desktopLayout.documentWidth>desktopLayout.viewport+1)throw new Error(`Desktop horizontal overflow detected: ${desktopLayout.documentWidth}/${desktopLayout.viewport}`);
if(desktopErrors.length)throw new Error(desktopErrors.join('\n'));
await desktopContext.close();

/* Phone: drawer navigation and a single, readable information column. */
const phoneContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const phone=await phoneContext.newPage();
const phoneErrors=[];
phone.on('pageerror',error=>phoneErrors.push(error.message));
phone.on('console',message=>{if(message.type()==='error')phoneErrors.push(message.text());});
await enterAdmin(phone);
const phoneLayout=await phone.evaluate(()=>{
  const grid=document.querySelector('.consistency-banner + .dashboard-grid');
  const stack=grid?.querySelector(':scope > .stack');
  const mapLayout=grid?.querySelector('.ops-map-layout');
  const canvas=grid?.querySelector('.ops-map-canvas');
  const sidebar=document.querySelector('.sidebar');
  const menu=document.querySelector('.menu-btn');
  return {
    viewport:window.innerWidth,
    documentWidth:document.documentElement.scrollWidth,
    gridColumns:getComputedStyle(grid).gridTemplateColumns,
    stackColumns:getComputedStyle(stack).gridTemplateColumns,
    mapColumns:getComputedStyle(mapLayout).gridTemplateColumns,
    canvasWidth:canvas.getBoundingClientRect().width,
    canvasHeight:canvas.getBoundingClientRect().height,
    mainMargin:getComputedStyle(document.querySelector('.main')).marginLeft,
    sidebarTransform:getComputedStyle(sidebar).transform,
    sidebarWidth:sidebar.getBoundingClientRect().width,
    menuDisplay:getComputedStyle(menu).display,
    modeDisplay:getComputedStyle(document.querySelector('.mode-pill')).display,
    actionsColumns:document.querySelector('.page-head .actions')?getComputedStyle(document.querySelector('.page-head .actions')).gridTemplateColumns:''
  };
});
if(columnCount(phoneLayout.gridColumns)!==1||columnCount(phoneLayout.stackColumns)!==1)throw new Error(`Phone dashboard must be one column: grid=${phoneLayout.gridColumns}, stack=${phoneLayout.stackColumns}`);
if(columnCount(phoneLayout.mapColumns)!==1)throw new Error(`Phone map must use one reading column: ${phoneLayout.mapColumns}`);
if(phoneLayout.canvasWidth<345)throw new Error(`Phone map canvas is too narrow: ${phoneLayout.canvasWidth}px`);
if(phoneLayout.canvasHeight<350||phoneLayout.canvasHeight>480)throw new Error(`Phone map height is outside the usable range: ${phoneLayout.canvasHeight}px`);
if(parseFloat(phoneLayout.mainMargin)!==0)throw new Error(`Phone main content still reserves sidebar width: ${phoneLayout.mainMargin}`);
if(phoneLayout.menuDisplay==='none')throw new Error('Phone menu button is hidden.');
if(phoneLayout.modeDisplay!=='none')throw new Error('Phone top bar still shows the wide mode pill.');
if(phoneLayout.documentWidth>phoneLayout.viewport+1)throw new Error(`Phone horizontal overflow detected: ${phoneLayout.documentWidth}/${phoneLayout.viewport}`);

await phone.locator('.menu-btn').click();
await phone.locator('.sidebar.open').waitFor();
const openDrawer=await phone.locator('.sidebar.open').evaluate(sidebar=>({left:sidebar.getBoundingClientRect().left,right:sidebar.getBoundingClientRect().right,width:sidebar.getBoundingClientRect().width,viewport:window.innerWidth}));
if(openDrawer.left<-.5||openDrawer.right>openDrawer.viewport+.5||openDrawer.width>340)throw new Error(`Phone navigation drawer is outside the viewport: ${JSON.stringify(openDrawer)}`);
await phone.locator('.sidebar.open [data-view="dashboard"]').click();
await phone.locator('.sidebar:not(.open)').waitFor();
if(phoneErrors.length)throw new Error(phoneErrors.join('\n'));
await phoneContext.close();

console.log('D-LOGIS desktop and phone responsive layout smoke test passed.');
await browser.close();
