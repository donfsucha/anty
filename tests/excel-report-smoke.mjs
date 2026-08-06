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

const agencyButton=page.locator('[data-agency-report="agency"]').first();
await agencyButton.waitFor();
const buttonText=await agencyButton.innerText();
if(!buttonText.includes('기관보고서 Excel'))throw new Error(`Agency report button label mismatch: ${buttonText}`);
if(await page.locator('[data-export-csv]').count())throw new Error('Legacy CSV mission export button is still visible.');

const downloadPromise=page.waitForEvent('download',{timeout:90000});
await agencyButton.click();
const download=await downloadPromise;
const suggested=download.suggestedFilename();
if(!suggested.endsWith('.xlsx'))throw new Error(`Expected XLSX filename, received ${suggested}`);
if(!suggested.includes('기관보고서'))throw new Error(`Expected agency report filename, received ${suggested}`);

const target='/tmp/dlogis-agency-report.xlsx';
await download.saveAs(target);
if(!fs.existsSync(target)||fs.statSync(target).size<10000)throw new Error('Generated agency workbook is missing or unexpectedly small.');
if(fs.readFileSync(target).subarray(0,4).toString('hex')!=='504b0304')throw new Error('Generated file is not a valid ZIP-based XLSX workbook.');

const list=execFileSync('unzip',['-l',target],{encoding:'utf8'});
for(const required of ['xl/workbook.xml','xl/styles.xml','xl/tables/table1.xml','xl/worksheets/sheet1.xml']){
  if(!list.includes(required))throw new Error(`XLSX package entry missing: ${required}`);
}
const tableCount=(list.match(/xl\/tables\/table\d+\.xml/g)||[]).length;
if(tableCount<7)throw new Error(`Expected concise formatted Excel tables, received ${tableCount}`);

const workbookXml=execFileSync('unzip',['-p',target,'xl/workbook.xml'],{encoding:'utf8'});
for(const sheetName of ['00_제출요약','01_임무별_종합','02_운항안전_요약','03_검증승인_요약','04_배송증빙','05_안전경보_조치','06_자산배터리_현황','10_용어_기준']){
  if(!workbookXml.includes(sheetName))throw new Error(`Agency workbook sheet missing: ${sheetName}`);
}
if(workbookXml.includes('02_비행로그'))throw new Error('Raw telemetry log sheet should not be included in the agency report.');
if(workbookXml.includes('04_명령이력'))throw new Error('Raw command history sheet should not be included in the agency report.');

const stylesXml=execFileSync('unzip',['-p',target,'xl/styles.xml'],{encoding:'utf8'});
if(!stylesXml.includes('yyyy-mm-dd hh:mm:ss'))throw new Error('KST date-time number format is missing.');
if(!stylesXml.includes('0.0'))throw new Error('One-decimal operational number format is missing.');
const missionSheet=execFileSync('unzip',['-p',target,'xl/worksheets/sheet2.xml'],{encoding:'utf8'});
if(!missionSheet.includes('<pane'))throw new Error('Frozen panes are missing from the mission sheet.');
if(!missionSheet.includes('<autoFilter'))throw new Error('Auto filter is missing from the mission sheet.');

await page.locator('.sidebar [data-view="proofs"]').click();
await page.getByText('배송 완료 증빙',{exact:true}).waitFor();
const proofButton=page.locator('[data-agency-report="proofs"]').first();
await proofButton.waitFor();
if(!(await proofButton.innerText()).includes('배송증빙 Excel'))throw new Error('Proof CSV button was not converted to 배송증빙 Excel.');

await page.locator('.sidebar [data-view="reports"]').click();
await page.getByText('운영리포트',{exact:true}).waitFor();
const reportButton=page.locator('[data-agency-report="operations"]').first();
await reportButton.waitFor();
if(!(await reportButton.innerText()).includes('운영리포트 Excel'))throw new Error('Report CSV button was not converted to 운영리포트 Excel.');

if(errors.length)throw new Error(errors.join('\n'));
console.log(`D-LOGIS concise agency Excel report smoke test passed: ${suggested}`);
await browser.close();
