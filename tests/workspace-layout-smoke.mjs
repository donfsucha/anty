import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const errors=[];

async function enterAdmin(page){
  page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
  page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});
  await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
  await page.locator('[data-enter-role="admin"]').click();
  await page.locator('body[data-app-view="dashboard"]').waitFor();
}

async function setView(page,view){
  await page.evaluate(next=>setView(next),view);
  await page.locator(`body[data-app-view="${view}"]`).waitFor();
  await page.waitForTimeout(80);
}

async function assertNoHorizontalOverflow(page,label){
  const dimensions=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,bodyScroll:document.body.scrollWidth}));
  if(dimensions.scroll>dimensions.viewport+2||dimensions.bodyScroll>dimensions.viewport+2){
    throw new Error(`${label} horizontal overflow: viewport=${dimensions.viewport}, html=${dimensions.scroll}, body=${dimensions.bodyScroll}`);
  }
}

/* Desktop: mission list and detail must use the full width sequentially. */
const desktop=await browser.newPage({viewport:{width:1680,height:1000}});
await enterAdmin(desktop);
await setView(desktop,'missions');
const workspace=desktop.locator('.mission-workspace');
await workspace.waitFor();
const listPane=desktop.locator('.mission-list-pane');
const detailPane=desktop.locator('.mission-detail-pane');
const [workspaceBox,listBox,detailBox]=await Promise.all([workspace.boundingBox(),listPane.boundingBox(),detailPane.boundingBox()]);
if(!workspaceBox||!listBox||!detailBox)throw new Error('Mission workspace panes are missing.');
if(listBox.width<workspaceBox.width*.97||detailBox.width<workspaceBox.width*.97){
  throw new Error(`Mission panes do not use full width: workspace=${workspaceBox.width}, list=${listBox.width}, detail=${detailBox.width}`);
}
if(detailBox.y<listBox.y+listBox.height-2)throw new Error('Mission detail is still placed beside or over the mission list.');
if(listBox.height>560)throw new Error(`Mission list is excessively tall and leaves dead space: ${listBox.height}`);
const listColumns=await workspace.evaluate(element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
if(listColumns!==1)throw new Error(`Mission workspace must have one desktop column, received ${listColumns}.`);
const preflightColumns=await desktop.locator('.mission-detail-pane .pf-grid').evaluate(element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
if(preflightColumns<3)throw new Error(`Wide mission verification grid should use at least three columns, received ${preflightColumns}.`);
await assertNoHorizontalOverflow(desktop,'desktop missions');

/* Every major desktop screen must fill the page without layout overflow. */
for(const view of ['dashboard','fleet','batteries','safety','proofs','reports','connection']){
  await setView(desktop,view);
  const pageBox=await desktop.locator('.page').boundingBox();
  const mainBox=await desktop.locator('.main').boundingBox();
  if(!pageBox||!mainBox)throw new Error(`${view} page shell is missing.`);
  if(pageBox.width<mainBox.width*.9)throw new Error(`${view} page does not use the available workspace width.`);
  await assertNoHorizontalOverflow(desktop,`desktop ${view}`);
}

/* Phone: mission table becomes readable cards and every page remains one-column safe. */
const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await enterAdmin(phone);
await setView(phone,'missions');
await phone.locator('.mission-workspace').waitFor();
const phoneColumns=await phone.locator('.mission-workspace').evaluate(element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
if(phoneColumns!==1)throw new Error(`Phone mission workspace must be one column, received ${phoneColumns}.`);
const headerDisplay=await phone.locator('.mission-table thead').evaluate(element=>getComputedStyle(element).display);
if(headerDisplay!=='none')throw new Error('Phone mission table header was not converted to card labels.');
const firstRowDisplay=await phone.locator('.mission-table tbody tr').first().evaluate(element=>getComputedStyle(element).display);
if(firstRowDisplay!=='block')throw new Error(`Phone mission row is not a card: ${firstRowDisplay}.`);
const labels=await phone.locator('.mission-table tbody tr').first().locator('td').evaluateAll(cells=>cells.map(cell=>cell.dataset.label).filter(Boolean));
if(labels.length<6)throw new Error(`Phone mission cells are missing readable labels: ${labels.length}.`);
const phoneList=await phone.locator('.mission-list-pane').boundingBox();
const phoneDetail=await phone.locator('.mission-detail-pane').boundingBox();
if(!phoneList||!phoneDetail||phoneDetail.y<phoneList.y+phoneList.height-2)throw new Error('Phone mission detail is not sequenced after the list.');
await assertNoHorizontalOverflow(phone,'phone missions');

for(const view of ['dashboard','fleet','batteries','safety','proofs','reports','connection']){
  await setView(phone,view);
  await assertNoHorizontalOverflow(phone,`phone ${view}`);
  const pageBox=await phone.locator('.page').boundingBox();
  if(!pageBox||pageBox.width<360)throw new Error(`${view} phone page is narrower than the usable viewport.`);
}

if(errors.length)throw new Error(errors.join('\n'));
console.log('D-LOGIS all-screen workspace density smoke test passed.');
await browser.close();
