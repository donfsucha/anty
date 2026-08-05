import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});

await page.goto('http://127.0.0.1:5500',{waitUntil:'networkidle'});
await page.locator('[data-enter-role="admin"]').click();
await page.getByText('통합관제 대시보드',{exact:true}).waitFor();
await page.locator('.sidebar [data-view="missions"]').click();
await page.getByText('배송임무 관리',{exact:true}).waitFor();

const button=page.locator('[data-export-csv]').first();
await button.waitFor();
const buttonText=await button.innerText();
if(!buttonText.includes('Excel'))throw new Error(`Export button was not converted to Excel: ${buttonText}`);

const downloadPromise=page.waitForEvent('download',{timeout:90000});
await button.click();
const download=await downloadPromise;
const suggested=download.suggestedFilename();
if(!suggested.endsWith('.xlsx'))throw new Error(`Expected XLSX filename, received ${suggested}`);
if(suggested.endsWith('.csv'))throw new Error('Legacy CSV export is still active.');

const target='/tmp/dlogis-professional-report.xlsx';
await download.saveAs(target);
if(!fs.existsSync(target)||fs.statSync(target).size<12000)throw new Error('Generated Excel workbook is missing or unexpectedly small.');
const signature=fs.readFileSync(target).subarray(0,4).toString('hex');
if(signature!=='504b0304')throw new Error('Generated file is not a valid ZIP-based XLSX workbook.');

const list=execFileSync('unzip',['-l',target],{encoding:'utf8'});
for(const required of ['xl/workbook.xml','xl/styles.xml','xl/tables/table1.xml','xl/worksheets/sheet1.xml']){
  if(!list.includes(required))throw new Error(`XLSX package entry missing: ${required}`);
}
const tableCount=(list.match(/xl\/tables\/table\d+\.xml/g)||[]).length;
if(tableCount<10)throw new Error(`Expected at least 10 formatted Excel tables, received ${tableCount}`);

const workbookXml=execFileSync('unzip',['-p',target,'xl/workbook.xml'],{encoding:'utf8'});
for(const sheetName of ['00_운영요약','01_임무현황','02_비행로그','03_비행전검증','04_명령이력','05_경보이력','06_배터리현황','07_배송증빙','08_감사로그','09_자산현황','10_용어·기준']){
  if(!workbookXml.includes(sheetName))throw new Error(`Workbook sheet missing: ${sheetName}`);
}
const stylesXml=execFileSync('unzip',['-p',target,'xl/styles.xml'],{encoding:'utf8'});
if(!stylesXml.includes('yyyy-mm-dd hh:mm:ss'))throw new Error('KST date-time number format is missing.');
if(!stylesXml.includes('0.0'))throw new Error('One-decimal operational number format is missing.');
const missionSheet=execFileSync('unzip',['-p',target,'xl/worksheets/sheet2.xml'],{encoding:'utf8'});
if(!missionSheet.includes('<pane'))throw new Error('Frozen panes are missing from the mission sheet.');
if(!missionSheet.includes('<autoFilter'))throw new Error('Auto filter is missing from the mission sheet.');
if(errors.length)throw new Error(errors.join('\n'));

console.log(`D-LOGIS professional Excel report smoke test passed: ${suggested}`);
await browser.close();
