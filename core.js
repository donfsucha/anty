'use strict';

const APP_KEY = 'dlogis-control-live-v1';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const nowIso = () => new Date().toISOString();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const uid = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const fmtTime = (v) => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(v));
const fmtDateTime = (v) => new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
const escapeHtml = (v = '') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

const ICONS = {
  logo: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4 27 10.3v11.4L16 28 5 21.7V10.3L16 4Z" stroke="currentColor" stroke-width="2.2"/><path d="m10.2 15.8 4.1 4.1 7.8-8.1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dashboard:'▦', missions:'↗', fleet:'✥', battery:'▰', safety:'!', proof:'✓', report:'⌁', connect:'◉', plus:'＋', menu:'☰', close:'×', drone:'✈', box:'□', user:'●', check:'✓', copy:'⧉', download:'⇩', reset:'↻'
};

const STATUS = {
  READY:['대기','gray'], APPROVED:['승인 완료','blue'], IN_FLIGHT:['운항 중','green'], HOLDING:['일시 대기','amber'], RETURNING:['복귀 중','amber'], COMPLETED:['배송 완료','green'], CANCELLED:['취소','red']
};
const CHECK_LABELS = { airframe:'기체 외관·프로펠러', battery:'배터리 장착·잠금', cargo:'화물함 적재·잠금', link:'통신 링크·조종기', route:'항로·공역 확인', weather:'기상·풍속 확인' };

function seedState(){
  const t = Date.now();
  return {
    version:1, role:null, view:'dashboard', selectedMission:'MSN-260726-001', sidebar:false,
    settings:{ mode:'simulation', gatewayUrl:'', apiKey:'', gatewayStatus:'idle', lastGatewayCheck:null, simulationSpeed:1 },
    drones:[
      {id:'DR-001',name:'D-LOGIS A1',model:'DLV-X8',status:'IN_FLIGHT',batteryId:'BAT-001',battery:76,lat:37.5032,lng:126.7652,x:34,y:57,altitude:72,speed:38,link:96,satellites:22,flightMode:'MISSION',armed:true,flightHours:184.6,maintenance:21},
      {id:'DR-002',name:'D-LOGIS A2',model:'DLV-X8',status:'READY',batteryId:'BAT-003',battery:94,lat:37.4881,lng:126.7821,x:66,y:31,altitude:0,speed:0,link:100,satellites:19,flightMode:'STANDBY',armed:false,flightHours:121.2,maintenance:44},
      {id:'DR-003',name:'D-LOGIS B1',model:'DLV-H6',status:'READY',batteryId:'BAT-005',battery:88,lat:37.5128,lng:126.7385,x:25,y:25,altitude:0,speed:0,link:99,satellites:24,flightMode:'STANDBY',armed:false,flightHours:79.4,maintenance:67},
      {id:'DR-004',name:'D-LOGIS B2',model:'DLV-H6',status:'MAINTENANCE',batteryId:null,battery:0,lat:37.476,lng:126.748,x:51,y:79,altitude:0,speed:0,link:0,satellites:0,flightMode:'OFFLINE',armed:false,flightHours:206.8,maintenance:0}
    ],
    batteries:[
      {id:'BAT-001',soc:76,soh:96,temp:34.2,cycles:84,cellDiff:0.018,status:'IN_USE',droneId:'DR-001'},
      {id:'BAT-002',soc:100,soh:93,temp:24.1,cycles:127,cellDiff:0.025,status:'READY',droneId:null},
      {id:'BAT-003',soc:94,soh:98,temp:25.2,cycles:43,cellDiff:0.012,status:'READY',droneId:'DR-002'},
      {id:'BAT-004',soc:42,soh:91,temp:28.4,cycles:166,cellDiff:0.031,status:'CHARGING',droneId:null},
      {id:'BAT-005',soc:88,soh:97,temp:24.8,cycles:55,cellDiff:0.015,status:'READY',droneId:'DR-003'},
      {id:'BAT-006',soc:100,soh:79,temp:26.3,cycles:312,cellDiff:0.068,status:'QUARANTINE',droneId:null}
    ],
    missions:[
      {id:'MSN-260726-001',orderNo:'ORD-260726-1042',title:'긴급 의약품 배송',cargo:'검체 운송 키트',payloadKg:1.8,origin:'부천 물류거점 A',destination:'가톨릭대 부천성모병원',recipient:'의료지원팀',phone:'010-4321-8850',pilot:'김도윤',droneId:'DR-001',batteryId:'BAT-001',status:'IN_FLIGHT',priority:'URGENT',progress:43,etaMin:9,createdAt:new Date(t-62*60000).toISOString(),departedAt:new Date(t-18*60000).toISOString(),checks:{airframe:true,battery:true,cargo:true,link:true,route:true,weather:true},history:[['임무 생성',t-62*60000],['이륙 승인',t-21*60000],['자동 운항 시작',t-18*60000]]},
      {id:'MSN-260726-002',orderNo:'ORD-260726-1043',title:'산업단지 긴급부품',cargo:'센서 모듈 2EA',payloadKg:2.4,origin:'부천 물류거점 A',destination:'오정산업단지 3공장',recipient:'설비보전팀',phone:'010-5252-3370',pilot:'박서준',droneId:'DR-002',batteryId:'BAT-003',status:'APPROVED',priority:'HIGH',progress:0,etaMin:17,createdAt:new Date(t-35*60000).toISOString(),departedAt:null,checks:{airframe:true,battery:true,cargo:true,link:true,route:true,weather:true},history:[['임무 생성',t-35*60000],['비행 전 점검 완료',t-8*60000]]},
      {id:'MSN-260726-003',orderNo:'ORD-260726-1044',title:'도서관 자료 이송',cargo:'문서 보관함',payloadKg:.9,origin:'시청 자료실',destination:'상동도서관',recipient:'자료운영팀',phone:'010-8871-2011',pilot:'이서연',droneId:'DR-003',batteryId:'BAT-005',status:'READY',priority:'NORMAL',progress:0,etaMin:12,createdAt:new Date(t-22*60000).toISOString(),departedAt:null,checks:{airframe:false,battery:false,cargo:false,link:false,route:false,weather:false},history:[['임무 생성',t-22*60000]]},
      {id:'MSN-260725-018',orderNo:'ORD-260725-0911',title:'연구소 샘플 배송',cargo:'비위험 연구 샘플',payloadKg:1.2,origin:'테크노파크 1동',destination:'테크노파크 5동',recipient:'연구개발실',phone:'010-7712-1120',pilot:'김도윤',droneId:'DR-001',batteryId:'BAT-002',status:'COMPLETED',priority:'NORMAL',progress:100,etaMin:0,createdAt:new Date(t-23*3600000).toISOString(),departedAt:new Date(t-22.5*3600000).toISOString(),completedAt:new Date(t-22.2*3600000).toISOString(),checks:{airframe:true,battery:true,cargo:true,link:true,route:true,weather:true},history:[['임무 생성',t-23*3600000],['배송 완료',t-22.2*3600000]]}
    ],
    alerts:[
      {id:'ALT-001',severity:'WARNING',title:'DR-001 배터리 안전여유 확인',message:'예상 착륙 잔량 31% · 현재 운항은 정상 범위입니다.',createdAt:new Date(t-4*60000).toISOString(),ack:false},
      {id:'ALT-002',severity:'INFO',title:'풍속 변화 감지',message:'실증구역 평균 풍속이 3.8m/s로 상승했습니다.',createdAt:new Date(t-13*60000).toISOString(),ack:false},
      {id:'ALT-003',severity:'CRITICAL',title:'BAT-006 셀 편차 초과',message:'정비 격리 처리됨 · 임무 배정이 차단되었습니다.',createdAt:new Date(t-44*60000).toISOString(),ack:true}
    ],
    proofs:[
      {id:'PRF-001',missionId:'MSN-260725-018',orderNo:'ORD-260725-0911',recipient:'연구개발실',otp:'5812',completedAt:new Date(t-22.2*3600000).toISOString(),lat:37.49812,lng:126.76951,tempRange:'21.8~23.1℃'}
    ],
    stats:{today:12,success:11,onTime:10}
  };
}

function loadState(){
  try{ const saved=JSON.parse(localStorage.getItem(APP_KEY)); return saved && saved.version===1 ? saved : seedState(); }
  catch{ return seedState(); }
}
let state=loadState();
let missionQuery='';
let missionStatus='ALL';
let timer=null;

function persist(){ localStorage.setItem(APP_KEY,JSON.stringify(state)); }
function saveRender(){ persist(); render(); }
function statusBadge(code){ const x=STATUS[code]||[code,'gray']; return `<span class="status ${x[1]}">${x[0]}</span>`; }
function priorityLabel(v){ return ({URGENT:'긴급',HIGH:'높음',NORMAL:'일반'})[v]||v; }
function batteryStatus(v){ return ({READY:['사용 가능','green'],IN_USE:['사용 중','blue'],CHARGING:['충전 중','amber'],QUARANTINE:['격리','red']})[v]||[v,'gray']; }
function toast(title,message='',type='info'){
  const id=uid('toast');
  const el=document.createElement('div'); el.className=`toast ${type}`; el.id=id;
  el.innerHTML=`<div class="toast-icon">${type==='success'?'✓':type==='error'?'!':'i'}</div><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div><button data-toast-close="${id}" aria-label="닫기">×</button>`;
  $('#toast-root').appendChild(el); setTimeout(()=>el.remove(),4300);
}

function shellIcon(){ return `<span class="brand-symbol">${ICONS.logo}</span>`; }
function welcome(){
  return `<section class="welcome"><div class="welcome-card">${shellIcon()}<div class="eyebrow">DRONE DELIVERY OPERATIONS</div><h1>D-LOGIS CONTROL</h1><p class="welcome-copy">배송 주문 접수부터 비행 전 점검, 실시간 관제, 이상상황 대응, 배송 완료 증빙까지 하나의 화면에서 실행하는 드론 배송 통합관제 데모입니다.</p><div class="role-grid"><button class="role-card primary" data-enter-role="admin"><span class="role-icon">${ICONS.dashboard}</span><span><strong>관제센터로 시작</strong><small>전체 임무·기체·배터리·경보 통합관리</small></span></button><button class="role-card" data-enter-role="pilot"><span class="role-icon">${ICONS.drone}</span><span><strong>현장 조종자</strong><small>점검·이륙·운항·복귀 실행</small></span></button><button class="role-card" data-enter-role="recipient"><span class="role-icon">${ICONS.box}</span><span><strong>배송 수령인</strong><small>배송조회·OTP·인수증 확인</small></span></button></div><div class="welcome-note"><span>브라우저 시뮬레이션 모드</span><span class="dot">●</span><span>데이터는 이 기기에 저장됨</span><span class="dot">●</span><span>실기체 명령은 비활성</span></div></div></section>`;
}
function topbar(){
  const roleName={admin:'관제 관리자',pilot:'현장 조종자',recipient:'배송 수령인'}[state.role];
  return `<header class="topbar"><div class="brand">${shellIcon()}<div class="brand-copy"><div class="brand-title">D-LOGIS CONTROL</div><div class="brand-sub">DRONE DELIVERY OPS</div></div></div><div class="topbar-main"><div class="topbar-context"><button class="menu-btn" data-menu>${ICONS.menu}</button><div><div class="context-title">${roleName}</div><div class="context-sub">${state.settings.mode==='simulation'?'안전한 시뮬레이션 환경':'외부 게이트웨이 연동 모드'}</div></div></div><div class="top-actions"><div class="live-pill"><i class="live-dot"></i><span>${state.settings.gatewayStatus==='online'?'게이트웨이 연결':'시스템 정상'}</span></div><div class="mode-pill">${state.settings.mode==='simulation'?'SIMULATION':'GATEWAY'}</div><div class="role-switch"><button class="avatar-btn" data-role-menu><span class="avatar">${state.role==='admin'?'관':state.role==='pilot'?'조':'수'}</span><span class="avatar-copy"><strong>${roleName}</strong><small>역할 전환</small></span><span>⌄</span></button><div class="role-menu hidden" id="role-menu"><button data-role="admin">▦ 관제센터</button><button data-role="pilot">✈ 현장 조종자</button><button data-role="recipient">□ 배송 수령인</button><button class="danger" data-exit>↩ 시작 화면</button></div></div></div></div></header>`;
}
const NAV=[['dashboard','dashboard','통합관제'],['missions','missions','배송임무'],['fleet','fleet','드론 관리'],['batteries','battery','스마트배터리'],['safety','safety','안전경보'],['proofs','proof','배송증빙'],['reports','report','운영리포트'],['connection','connect','기체 연결']];
function sidebar(){
  const unack=state.alerts.filter(a=>!a.ack).length;
  return `${state.sidebar?'<div class="sidebar-backdrop" data-menu-close></div>':''}<aside class="sidebar ${state.sidebar?'open':''}"><div class="nav-label">OPERATIONS</div><nav class="nav">${NAV.map(([v,i,l])=>`<button data-view="${v}" class="${state.view===v?'active':''}"><span class="nav-icon">${ICONS[i]}</span><span>${l}</span>${v==='safety'&&unack?`<span class="nav-badge">${unack}</span>`:''}</button>`).join('')}</nav><div class="sidebar-spacer"></div><div class="connection-card"><div class="connection-row"><strong>운항 데이터</strong><span class="status ${state.settings.mode==='simulation'?'amber':'green'}">${state.settings.mode==='simulation'?'가상':'실기체'}</span></div><p>${state.settings.mode==='simulation'?'현재 모든 위치·배터리·명령은 시연용 데이터입니다.':'등록된 HTTPS 게이트웨이와 데이터를 교환합니다.'}</p></div></aside>`;
}
function adminShell(content){ return `<div class="shell">${topbar()}${sidebar()}<main class="main"><div class="page">${content}</div></main></div>`; }
function pageHead(title,sub,actions=''){ return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`; }

function getActiveMissions(){ return state.missions.filter(m=>['IN_FLIGHT','HOLDING','RETURNING'].includes(m.status)); }
function dashboard(){
  const active=getActiveMissions(); const done=state.missions.filter(m=>m.status==='COMPLETED').length; const unack=state.alerts.filter(a=>!a.ack).length;
  return `${pageHead('통합관제 대시보드','실시간 임무, 기체상태, 안전경보를 한 화면에서 확인합니다.',`<button class="btn" data-export-json>${ICONS.download} 데이터 백업</button><button class="btn primary" data-new-mission>${ICONS.plus} 신규 임무</button>`)}
  <section class="grid kpi-grid"><article class="kpi"><div class="kpi-top"><span class="kpi-label">오늘 배송</span><span class="kpi-icon">${ICONS.box}</span></div><div class="kpi-value">${state.stats.today}</div><div class="kpi-foot"><span class="trend">+18%</span><span>전일 대비</span></div></article><article class="kpi"><div class="kpi-top"><span class="kpi-label">현재 운항</span><span class="kpi-icon">${ICONS.drone}</span></div><div class="kpi-value">${active.length}</div><div class="kpi-foot"><span>${state.drones.filter(d=>d.status==='READY').length}대 출동 가능</span></div></article><article class="kpi"><div class="kpi-top"><span class="kpi-label">배송 성공률</span><span class="kpi-icon">${ICONS.check}</span></div><div class="kpi-value">${Math.round((state.stats.success/state.stats.today)*100)}%</div><div class="kpi-foot"><span class="trend">${state.stats.success}건 성공</span><span>· ${done}건 증빙</span></div></article><article class="kpi"><div class="kpi-top"><span class="kpi-label">미확인 경보</span><span class="kpi-icon">${ICONS.safety}</span></div><div class="kpi-value">${unack}</div><div class="kpi-foot"><span>${state.alerts.filter(a=>a.severity==='CRITICAL'&&!a.ack).length}건 긴급</span></div></article></section>
  <section class="grid dashboard-grid"><article class="card"><div class="card-head"><div><h2>실시간 운항지도</h2><p>기체 마커를 선택하면 해당 임무가 열립니다.</p></div><span class="status green">LIVE 1s</span></div>${mapView()}</article><div class="stack"><article class="card"><div class="card-head"><div><h2>진행 중 임무</h2><p>우선순위와 도착예정시간</p></div><button class="btn small" data-view="missions">전체보기</button></div><div class="card-body mission-mini">${active.length?active.map(m=>missionMini(m)).join(''):'<div class="empty">운항 중 임무가 없습니다.</div>'}</div></article><article class="card"><div class="card-head"><div><h2>최근 안전경보</h2><p>미확인 항목 우선 표시</p></div><button class="btn small" data-view="safety">경보센터</button></div><div class="card-body alert-list">${state.alerts.slice().sort((a,b)=>Number(a.ack)-Number(b.ack)).slice(0,3).map(alertRow).join('')}</div></article></div></section>`;
}
function mapView(){
  const markers=state.drones.filter(d=>d.status!=='MAINTENANCE').map(d=>{ const m=state.missions.find(x=>x.droneId===d.id&&['IN_FLIGHT','HOLDING','RETURNING'].includes(x.status)); return `<div class="drone-marker ${m?'active':''} ${d.battery<30?'warning':''}" style="left:${d.x}%;top:${d.y}%"><button data-drone-map="${d.id}" title="${d.name}">${ICONS.drone}</button><span class="marker-label">${d.id} · ${d.battery}%</span></div>`; }).join('');
  return `<div class="map"><div class="map-water"></div><div class="map-road r1"></div><div class="map-road r2"></div><div class="map-road r3"></div><div class="route"></div>${markers}<div class="map-legend"><span class="legend-item"><i class="legend-dot"></i>운항/대기</span><span class="legend-item"><i class="legend-dot amber"></i>주의</span></div></div>`;
}
function missionMini(m){ return `<div class="mini-row" data-select-mission="${m.id}" data-go-missions><div class="mini-number">${m.id.slice(-3)}</div><div><strong>${escapeHtml(m.title)}</strong><small>${m.droneId} · ETA ${m.etaMin}분</small><div class="progress" style="margin-top:7px"><span style="width:${m.progress}%"></span></div></div>${statusBadge(m.status)}</div>`; }
function alertRow(a){ return `<div class="alert-row"><i class="alert-severity ${a.severity}"></i><div><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.message)} · ${fmtTime(a.createdAt)}</p></div>${a.ack?'<span class="status gray">확인</span>':`<button class="btn small" data-ack-alert="${a.id}">확인</button>`}</div>`; }
