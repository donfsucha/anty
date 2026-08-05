"use strict";

const UIState = {
  missionQuery: "",
  missionFilter: "ALL",
  wizardStep: 1,
  lastRenderAt: 0
};

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  mission: '<path d="M9 4h6l1 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3z"/><path d="m9 13 2 2 4-4"/>',
  drone: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 7.5 10 10M17 7.5 14 10M7 16.5 10 14M17 16.5 14 14"/><rect x="9" y="9" width="6" height="6" rx="2"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3 7.8 7.5 9.5 4.5-1.7 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  record: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1-2-4-2 1a8 8 0 0 0-2-1l-.3-2h-5l-.3 2a8 8 0 0 0-2 1l-2-1-2 4 2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a8 8 0 0 0 2 1l.3 2h5l.3-2a8 8 0 0 0 2-1l2 1 2-4-2-1c.1-.3.1-.7.1-1z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v4M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  battery: '<rect x="3" y="7" width="17" height="10" rx="2"/><path d="M21 10v4M7 10v4M11 10v4M15 10v4"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  rth: '<path d="M3 7v6h6M4.5 16a8 8 0 1 0 .5-9L3 9"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4a4 4 0 0 0 4-4V8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
  package: '<path d="m3 7 9-4 9 4-9 4z"/><path d="m3 7 9 4 9-4v10l-9 4-9-4zM12 11v10"/>'
};

const NAV = [
  ["dashboard", "관제현황", "grid"],
  ["missions", "임무관리", "mission"],
  ["assets", "기체·배터리", "drone"],
  ["safety", "안전·경보", "shield"],
  ["records", "운영기록", "record"],
  ["settings", "시스템설정", "settings"]
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}

function toast(title, message = "", type = "info", duration = 3800) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<p>${escapeHtml(message)}</p>` : ""}`;
  root.appendChild(element);
  setTimeout(() => element.remove(), duration);
}

function pageHead(eyebrow, title, description, actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">${icon("grid")} ${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="actions">${actions}</div></div>`;
}

function kpi(label, value, unit, foot, tone = "") {
  return `<article class="kpi ${tone}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value mono">${escapeHtml(value)}<small>${escapeHtml(unit)}</small></div><div class="kpi-foot">${foot}</div></article>`;
}

function renderApp() {
  window.DLogisMap?.destroy();
  let html;
  if (!state.session.role) html = welcomeView();
  else if (state.session.role === "pilot") html = pilotView();
  else if (state.session.role === "recipient") html = recipientView();
  else html = adminShell();
  document.getElementById("app").innerHTML = html;
  UIState.lastRenderAt = Date.now();
  updateLiveClock();
  if (state.session.role === "admin" && state.ui.view === "dashboard") {
    requestAnimationFrame(() => window.DLogisMap?.render());
  }
}

function welcomeView() {
  const roles = [
    ["admin", "관제센터", "주문·임무·지도·기체·배터리·경보·운영기록을 통합 관리합니다.", "grid", "관제센터 시작"],
    ["pilot", "현장 조종자", "오늘의 임무와 안전점검을 순서대로 수행하고 관제 명령을 확인합니다.", "drone", "조종자 화면"],
    ["recipient", "배송 수령인", "예상 도착시간, 배송 진행상태와 수령코드를 한 화면에서 확인합니다.", "mission", "배송조회 화면"]
  ];
  return `<main class="welcome"><div class="welcome-panel"><div class="welcome-brand"><div class="brand-mark">${icon("drone")}</div><div><h1>D-LOGIS CONTROL V3</h1><p>정밀 데이터 기록 기반 드론 배송 통합관제시스템</p></div></div><section class="role-grid">${roles.map(([role, title, description, glyph, button]) => `<button class="role-card" data-enter-role="${role}"><span class="role-icon">${icon(glyph)}</span><h2>${title}</h2><p>${description}</p><span class="btn primary">${button}</span></button>`).join("")}</section></div></main>`;
}

function adminShell() {
  const view = ({
    dashboard: dashboardView,
    missions: missionsView,
    assets: assetsView,
    safety: safetyView,
    records: recordsView,
    settings: settingsView
  })[state.ui.view] || dashboardView;
  const unacknowledged = state.alerts.filter(item => !item.acknowledged).length;
  const warning = actionableCount() > 0;
  return `<div class="app-shell">
    <aside class="sidebar ${state.ui.sidebarOpen ? "open" : ""}">
      <div class="brand"><div class="brand-mark">${icon("drone")}</div><div class="brand-copy"><strong>D-LOGIS</strong><small>CONTROL V3</small></div></div>
      <div class="nav-label">OPERATIONS</div>
      <nav class="nav">${NAV.map(([id, label, glyph]) => `<button class="nav-btn ${state.ui.view === id ? "active" : ""}" data-view="${id}">${icon(glyph)}<span>${label}</span>${id === "safety" && unacknowledged ? `<span class="count">${unacknowledged}</span>` : ""}</button>`).join("")}</nav>
      <div class="sidebar-status"><div class="nav-label">SYSTEM STATUS</div>
        <div class="system-line"><i></i><span>관제 UI</span><span>정상</span></div>
        <div class="system-line"><i></i><span>텔레메트리</span><span>${fmt1(dataFreshnessSeconds(), "초")}</span></div>
        <div class="system-line"><i></i><span>보고서 모듈</span><span>XLSX</span></div>
        <div class="system-line"><i></i><span>지도</span><span>${state.settings.mapProvider === "kakao" ? "Kakao" : "OSM"}</span></div>
        <div class="side-weather"><span>${icon("alert")}</span><div><strong>비행 적합</strong><small>풍속 3.2 m/s</small></div><b>27.4°</b></div>
      </div>
    </aside>
    <header class="topbar">
      <button class="btn icon mobile-menu" data-sidebar-toggle>${icon("menu")}</button>
      <span class="site-pill">${icon("map")} ${escapeHtml(state.meta.centerName)}</span>
      <span class="network-pill ${warning ? "warning" : ""}"><i class="live-dot"></i>${warning ? "조치 확인 필요" : "관제망 정상"} · ${fmt1(dataFreshnessSeconds(), "초")}</span>
      <div class="clock-box"><strong id="live-clock">--:--:--</strong><small id="live-date">----</small></div>
      <button class="profile-btn" data-role-menu><span class="avatar">관</span><span class="profile-copy"><strong>${escapeHtml(state.session.operatorName)}</strong><small>${escapeHtml(state.session.operatorRole)}</small></span></button>
    </header>
    <main class="main">${view()}</main>
  </div>`;
}

function dashboardView() {
  const active = activeMissions();
  const availableDrones = state.drones.filter(item => item.airworthy && ["READY", "IN_FLIGHT", "RETURNING", "HOLDING"].includes(item.status)).length;
  const suitableBatteries = state.batteries.filter(item => item.status !== "QUARANTINE" && item.soh >= 85 && item.cellDeltaMv <= 50).length;
  const stale = dataFreshnessSeconds() > state.settings.telemetryIntervalSec * 3;
  const selected = missionById(state.ui.selectedMissionId) || active[0] || state.missions[0];
  const actions = `<button class="btn" data-export-xlsx>${icon("download")} 운영보고서 XLSX</button><button class="btn primary" data-new-mission>${icon("plus")} 신규 배송임무</button>`;
  return `${pageHead("LIVE OPERATIONS", "드론 배송 통합관제", "조치가 필요한 항목을 먼저 보여주고, 모든 수치·시각·명령·점검 이력을 Mission ID로 기록합니다.", actions)}
  <section class="grid kpi-grid">
    ${kpi("즉시 확인 항목", actionableCount().toFixed(1), "건", '<span class="critical-copy">우선순위 기반</span>', "tone-red")}
    ${kpi("진행 중 임무", active.length.toFixed(1), "건", `예약 포함 ${state.missions.filter(item => !["COMPLETED", "CANCELLED"].includes(item.status)).length.toFixed(1)}건`)}
    ${kpi("정시 배송률", onTimeRate().toFixed(1), "%", `완료 ${state.missions.filter(item => item.status === "COMPLETED").length.toFixed(1)}건`, "tone-green")}
    ${kpi("운항 가능 기체", availableDrones.toFixed(1), "대", `전체 ${state.drones.length.toFixed(1)}대`, "tone-green")}
    ${kpi("임무 적합 배터리", suitableBatteries.toFixed(1), "개", `격리 ${state.batteries.filter(item => item.status === "QUARANTINE").length.toFixed(1)}개`, "tone-amber")}
    ${kpi("데이터 신선도", dataFreshnessSeconds().toFixed(1), "초", stale ? '<span class="warning-copy">수신 지연 확인</span>' : '<span class="trend">정상 수신</span>', stale ? "tone-amber" : "tone-green")}
  </section>
  <section class="grid dashboard-grid">${mapCard(selected)}${actionQueueCard()}</section>
  <section class="section-gap">${activeMissionStrip(active)}</section>
  <section class="card section-gap">${telemetryTable()}</section>`;
}

function mapCard(mission) {
  const drone = droneById(mission?.droneId);
  const battery = batteryById(mission?.batteryId);
  return `<article class="card map-card">
    <div class="card-head"><div class="card-title"><span class="card-icon">${icon("map")}</span><div><h2>실시간 운항 지도</h2><p>WGS84 위치 · 승인항로 · 기체 상태</p></div></div><div class="map-toolbar"><select class="select" id="quick-map-provider"><option value="kakao" ${state.settings.mapProvider === "kakao" ? "selected" : ""}>카카오맵 무료모드</option><option value="osm" ${state.settings.mapProvider === "osm" ? "selected" : ""}>OpenStreetMap</option></select><button class="btn small" data-open-kakao>카카오맵 열기</button></div></div>
    <div class="map-wrap"><div id="ops-map"></div><div class="map-status"><span class="map-chip">풍속 ${fmt1(3.2, " m/s")}</span><span class="map-chip">가시거리 ${fmt1(12.4, " km")}</span><span class="map-chip">수신 ${fmt1(dataFreshnessSeconds(), "초 전")}</span></div>${mission ? `<div class="map-info"><div class="map-info-head"><h3>${escapeHtml(drone?.name || "미배정")} · ${escapeHtml(mission.title)}</h3>${statusBadge(mission.status)}</div><div class="map-info-grid"><div><span>고도</span><strong>${fmt1(drone?.altitudeM, " m")}</strong></div><div><span>속도</span><strong>${fmt1(drone?.groundSpeedKmh, " km/h")}</strong></div><div><span>배터리</span><strong>${fmt1(battery?.soc, "%")}</strong></div><div><span>통신</span><strong>${fmt1(drone?.linkQualityPct, "%")}</strong></div></div><div class="map-provider-note"><span id="map-provider-status">지도 연결 중</span><br>좌표 ${coordinateDMS(drone?.lat || 0, true)} · ${coordinateDMS(drone?.lng || 0, false)}</div></div>` : ""}</div>
  </article>`;
}

function buildActionQueue() {
  const rows = [];
  state.alerts.filter(item => !item.acknowledged).forEach(item => rows.push({ type: "alert", severity: item.severity, title: item.title, message: item.message, time: item.createdAt, id: item.id }));
  state.missions.filter(item => item.status === "PENDING_APPROVAL").forEach(item => rows.push({ type: "mission", severity: item.priority === "URGENT" ? "CRITICAL" : "WARNING", title: "운항 승인 대기", message: `${item.id} · ${item.title}`, time: item.createdAt, id: item.id }));
  state.batteries.filter(item => item.status !== "QUARANTINE" && (item.soh < 85 || item.cellDeltaMv > 50)).forEach(item => rows.push({ type: "battery", severity: "CRITICAL", title: "배터리 임무투입 차단 권고", message: `${item.id} · SOH ${fmt1(item.soh, "%")} · 셀편차 ${fmt1(item.cellDeltaMv, " mV")}`, time: item.lastInspectionAt, id: item.id }));
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return rows.sort((a, b) => rank[a.severity] - rank[b.severity] || new Date(b.time) - new Date(a.time));
}

function actionQueueCard() {
  const rows = buildActionQueue().slice(0, 6);
  return `<article class="card"><div class="card-head"><div class="card-title"><span class="card-icon">${icon("alert")}</span><div><h2>조치 우선순위</h2><p>경보·승인·자산 상태를 중요도순으로 정렬</p></div></div><span class="status ${rows.some(item => item.severity === "CRITICAL") ? "red" : "amber"}">${rows.length}건</span></div><div class="card-body"><div class="queue">${rows.length ? rows.map(item => `<div class="queue-row"><i class="severity ${item.severity}"></i><div class="queue-copy"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${fmtKST(item.time, true)}</small></div>${item.type === "alert" ? `<button class="btn small" data-ack-alert="${item.id}">확인</button>` : item.type === "mission" ? `<button class="btn small" data-select-mission="${item.id}" data-go-missions>검토</button>` : '<button class="btn small" data-view="assets">보기</button>'}</div>`).join("") : '<div class="notice">현재 즉시 조치가 필요한 항목이 없습니다.</div>'}</div></div></article>`;
}

function activeMissionStrip(active) {
  const list = active.slice(0, 3);
  return `<div class="section-title"><div class="card-title"><span class="card-icon">${icon("route")}</span><div><h2>진행 중 임무</h2><p>클릭하면 임무 상세로 이동합니다.</p></div></div><button class="btn small" data-view="missions">전체 임무</button></div><div class="mission-strip">${list.length ? list.map(mission => { const origin = locationById(mission.originId); const destination = locationById(mission.destinationId); return `<article class="mission-card" data-select-mission="${mission.id}" data-go-missions><div class="mission-card-head"><div><span class="mono small">${mission.id}</span> ${priorityBadge(mission.priority)}</div>${statusBadge(mission.status)}</div><h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(mission.cargo)} · ${fmt1(mission.payloadKg, " kg")}</p><div class="route-mini"><span>${escapeHtml(origin?.name || "-")}</span><i></i><span>${escapeHtml(destination?.name || "-")}</span></div><div class="mission-progress"><div class="progress"><span style="width:${clamp(mission.progress, 0, 100)}%"></span></div><b>${fmt1(mission.progress, "%")}</b></div></article>`; }).join("") : '<div class="notice">현재 진행 중 임무가 없습니다.</div>'}</div>`;
}

function telemetryTable() {
  const rows = state.drones.map(drone => ({ drone, telemetry: latestTelemetry(drone.id), battery: batteryById(drone.batteryId) }));
  return `<div class="card-head"><div class="card-title"><span class="card-icon">${icon("drone")}</span><div><h2>기체 실시간 데이터</h2><p>운영 수치는 소수점 한 자리, 위치는 DMS 정밀 좌표로 표시</p></div></div><button class="btn small" data-view="records">전체 기록</button></div><div class="table-wrap"><table class="table"><thead><tr><th>기체</th><th>상태</th><th>최종 수신</th><th>고도</th><th>속도</th><th>배터리</th><th>온도</th><th>통신</th><th>GNSS</th><th>위치</th></tr></thead><tbody>${rows.map(({ drone, telemetry, battery }) => `<tr><td><strong>${escapeHtml(drone.name)}</strong><small>${drone.id} · ${escapeHtml(drone.model)}</small></td><td>${statusBadge(["IN_FLIGHT", "RETURNING", "HOLDING"].includes(drone.status) ? drone.status : drone.status === "READY" ? "READY" : drone.status === "MAINTENANCE" ? "CANCELLED" : "READY")}</td><td><span class="data-fresh ${telemetry && elapsedSeconds(telemetry.receivedAt) <= 15 ? "" : "stale"}"><i></i>${telemetry ? fmtTime(telemetry.receivedAt, true) : "-"}</span></td><td class="mono">${fmt1(drone.altitudeM, " m")}</td><td class="mono">${fmt1(drone.groundSpeedKmh, " km/h")}</td><td class="mono">${fmt1(battery?.soc, "%")}</td><td class="mono">${fmt1(battery?.temperatureC, " ℃")}</td><td class="mono">${fmt1(drone.linkQualityPct, "%")}</td><td class="mono">${fmt1(drone.satellites, "개")}</td><td><strong>${coordinateDMS(drone.lat, true)}</strong><small>${coordinateDMS(drone.lng, false)}</small></td></tr>`).join("")}</tbody></table></div>`;
}

function missionsView() {
  const query = UIState.missionQuery.trim().toLowerCase();
  const rows = state.missions.filter(mission => (UIState.missionFilter === "ALL" || mission.status === UIState.missionFilter) && (!query || `${mission.id} ${mission.orderNo} ${mission.title} ${mission.cargo} ${mission.recipient}`.toLowerCase().includes(query)));
  const selected = missionById(state.ui.selectedMissionId) || rows[0];
  const actions = `<button class="btn" data-export-xlsx>${icon("download")} 운영보고서 XLSX</button><button class="btn primary" data-new-mission>${icon("plus")} 신규 임무</button>`;
  return `${pageHead("MISSION MANAGEMENT", "배송임무 관리", "등록부터 승인·점검·비행·복귀·증빙까지 모든 단계의 사용자와 시각을 기록합니다.", actions)}<section class="split"><article class="card"><div class="toolbar"><div class="filters"><div class="search-control">${icon("search")}<input class="input" id="mission-search" value="${escapeHtml(UIState.missionQuery)}" placeholder="임무·주문·화물·수령인 검색"></div><select class="select" id="mission-filter"><option value="ALL">전체 상태</option>${Object.entries(STATUS).map(([key, value]) => `<option value="${key}" ${UIState.missionFilter === key ? "selected" : ""}>${value[0]}</option>`).join("")}</select></div><span class="muted small">검색 ${rows.length}건</span></div><div class="table-wrap"><table class="table"><thead><tr><th>임무</th><th>경로</th><th>화물</th><th>자원</th><th>상태</th><th>진행률</th><th>예정</th></tr></thead><tbody>${rows.map(mission => `<tr class="clickable ${selected?.id === mission.id ? "selected" : ""}" data-select-mission="${mission.id}"><td><strong>${escapeHtml(mission.title)}</strong><small>${mission.id} · ${mission.orderNo}</small></td><td><strong>${escapeHtml(locationById(mission.originId)?.name || "-")}</strong><small>→ ${escapeHtml(locationById(mission.destinationId)?.name || "-")} · ${fmt1(mission.distanceKm, " km")}</small></td><td><strong>${escapeHtml(mission.cargo)}</strong><small>${fmt1(mission.payloadKg, " kg")} · ${escapeHtml(mission.recipient)}</small></td><td><strong>${mission.droneId || "미배정"}</strong><small>${mission.batteryId || "배터리 미배정"} · ${escapeHtml(mission.pilot)}</small></td><td>${statusBadge(mission.status)}</td><td><strong>${fmt1(mission.progress, "%")}</strong><div class="progress table-progress"><span style="width:${mission.progress}%"></span></div></td><td><strong>${fmtTime(mission.scheduledAt)}</strong><small>ETA ${fmtTime(mission.etaAt)}</small></td></tr>`).join("")}</tbody></table></div></article>${missionDetail(selected)}</section>`;
}

function missionDetail(mission) {
  if (!mission) return '<article class="card detail-panel"><div class="card-body">임무를 선택해 주세요.</div></article>';
  const drone = droneById(mission.droneId);
  const battery = batteryById(mission.batteryId);
  const allDone = Object.values(mission.checks).every(Boolean);
  return `<article class="card detail-panel"><div class="detail-hero"><div class="detail-hero-top"><span class="mono small">${mission.id}</span>${statusBadge(mission.status)}</div><h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(locationById(mission.originId)?.name || "-")} → ${escapeHtml(locationById(mission.destinationId)?.name || "-")}</p></div><div class="detail-grid"><div class="detail-item"><span>기체 / 조종자</span><strong>${mission.droneId || "미배정"} · ${escapeHtml(mission.pilot)}</strong></div><div class="detail-item"><span>배터리</span><strong>${mission.batteryId || "미배정"} · ${fmt1(battery?.soc, "%")}</strong></div><div class="detail-item"><span>화물</span><strong>${escapeHtml(mission.cargo)} · ${fmt1(mission.payloadKg, " kg")}</strong></div><div class="detail-item"><span>수령인</span><strong>${escapeHtml(mission.recipient)}</strong></div><div class="detail-item"><span>진행률 / ETA</span><strong>${fmt1(mission.progress, "%")} · ${fmtTime(mission.etaAt)}</strong></div><div class="detail-item"><span>통신 / GNSS</span><strong>${fmt1(drone?.linkQualityPct, "%")} · ${fmt1(drone?.satellites, "개")}</strong></div></div><div class="card-head"><div><h2>비행 전 안전점검</h2><p>${allDone ? "전체 항목 완료" : "모든 항목 완료 후 이륙 가능"}</p></div><button class="btn small" data-check-all="${mission.id}">전체 점검</button></div><div class="checklist">${Object.entries(CHECK_LABELS).map(([key, label]) => `<button class="check-row ${mission.checks[key] ? "done" : ""}" data-toggle-check="${mission.id}" data-check-key="${key}"><span class="check-box">${mission.checks[key] ? "✓" : ""}</span><span>${label}</span><small>${mission.checks[key] ? "완료" : "확인 필요"}</small></button>`).join("")}</div><div class="detail-actions">${missionButtons(mission, allDone)}</div><div class="card-head"><div><h2>임무 이력</h2><p>행동 사용자와 발생시각 기록</p></div></div><div class="timeline">${[...mission.history].reverse().slice(0, 8).map(item => `<div class="timeline-row"><i class="timeline-dot"></i><div><strong>${escapeHtml(item.event)}</strong><small>${escapeHtml(item.actor)} · ${fmtKST(item.at, true)}</small></div></div>`).join("")}</div></article>`;
}

function missionButtons(mission, allDone) {
  if (mission.status === "PENDING_APPROVAL") return `<button class="btn primary" data-mission-action="APPROVE" data-mission-id="${mission.id}">${icon("check")} 운항 승인</button><button class="btn danger" data-mission-action="CANCEL" data-mission-id="${mission.id}">취소</button>`;
  if (mission.status === "READY") return `<button class="btn" data-auto-assign="${mission.id}">자원 자동배정</button><button class="btn primary" data-mission-action="START" data-mission-id="${mission.id}" ${!allDone || !mission.droneId || !mission.batteryId ? "disabled" : ""}>${icon("play")} 이륙·임무 시작</button>`;
  if (["IN_FLIGHT", "DELIVERING"].includes(mission.status)) return `<button class="btn warning" data-mission-action="HOLD" data-mission-id="${mission.id}">${icon("pause")} 일시대기</button><button class="btn danger" data-mission-action="RTH" data-mission-id="${mission.id}">${icon("rth")} 긴급 복귀</button><button class="btn green" data-mission-action="COMPLETE" data-mission-id="${mission.id}">배송 완료</button>`;
  if (mission.status === "HOLDING") return `<button class="btn primary" data-mission-action="RESUME" data-mission-id="${mission.id}">${icon("play")} 운항 재개</button><button class="btn danger" data-mission-action="RTH" data-mission-id="${mission.id}">${icon("rth")} 긴급 복귀</button>`;
  if (mission.status === "RETURNING") return `<button class="btn green" data-mission-action="COMPLETE" data-mission-id="${mission.id}">착륙·임무 종료</button>`;
  if (mission.status === "COMPLETED") return `<button class="btn" data-view="records">${icon("record")} 배송증빙·기록 보기</button>`;
  return "";
}

function assetsView() {
  const actions = `<button class="btn" data-export-xlsx>${icon("download")} 자산 포함 보고서</button>`;
  return `${pageHead("FLEET & ENERGY", "기체·스마트배터리", "기체 운항가능성, 정비잔여시간과 배터리 SOC·SOH·온도·셀 편차를 한 자리 소수점으로 관리합니다.", actions)}<div class="section-title"><div class="card-title"><span class="card-icon">${icon("drone")}</span><div><h2>드론 기체</h2><p>운항·통신·정비 상태</p></div></div></div><section class="grid entity-grid">${state.drones.map(drone => { const battery = batteryById(drone.batteryId); const displayStatus = ["IN_FLIGHT", "RETURNING", "HOLDING"].includes(drone.status) ? drone.status : drone.status === "READY" ? "READY" : drone.status === "MAINTENANCE" ? "CANCELLED" : "READY"; const maintenancePercent = clamp((drone.maintenanceDueHours / 40) * 100, 0, 100); return `<article class="entity"><div class="entity-top"><div><h3>${escapeHtml(drone.name)}</h3><p>${drone.id} · ${escapeHtml(drone.model)}</p></div>${statusBadge(displayStatus)}</div><div class="metrics"><div class="metric"><span>배터리</span><strong>${fmt1(battery?.soc, "%")}</strong></div><div class="metric"><span>통신</span><strong>${fmt1(drone.linkQualityPct, "%")}</strong></div><div class="metric"><span>GNSS</span><strong>${fmt1(drone.satellites, "개")}</strong></div><div class="metric"><span>고도</span><strong>${fmt1(drone.altitudeM, " m")}</strong></div><div class="metric"><span>속도</span><strong>${fmt1(drone.groundSpeedKmh, " km/h")}</strong></div><div class="metric"><span>정비잔여</span><strong>${fmt1(drone.maintenanceDueHours, " h")}</strong></div></div><div class="health-bar ${drone.maintenanceDueHours < 10 ? "danger" : drone.maintenanceDueHours < 20 ? "warning" : ""}"><div class="health-bar-head"><span>정비 여유</span><b>${fmt1(maintenancePercent, "%")}</b></div><div class="progress"><span style="width:${maintenancePercent}%"></span></div></div></article>`; }).join("")}</section><div class="section-title section-gap"><div class="card-title"><span class="card-icon">${icon("battery")}</span><div><h2>스마트배터리</h2><p>임무 투입 가능성 자동 판정</p></div></div></div><section class="grid entity-grid">${state.batteries.map(battery => { const risk = battery.status === "QUARANTINE" || battery.soh < 85 || battery.cellDeltaMv > 50; return `<article class="entity"><div class="entity-top"><div><h3>${battery.id}</h3><p>${battery.droneId ? `${battery.droneId} 장착` : "보관 랙"} · ${fmtKST(battery.lastInspectionAt, false)}</p></div><span class="status ${risk ? "red" : battery.status === "READY" ? "green" : "amber"}">${risk ? "투입 차단" : battery.status === "READY" ? "임무 적합" : battery.status}</span></div><div class="metrics"><div class="metric"><span>SOC</span><strong>${fmt1(battery.soc, "%")}</strong></div><div class="metric"><span>SOH</span><strong>${fmt1(battery.soh, "%")}</strong></div><div class="metric"><span>온도</span><strong>${fmt1(battery.temperatureC, " ℃")}</strong></div><div class="metric"><span>셀 편차</span><strong>${fmt1(battery.cellDeltaMv, " mV")}</strong></div><div class="metric"><span>사이클</span><strong>${fmt1(battery.cycles, "회")}</strong></div><div class="metric"><span>예상비행</span><strong>${fmt1(battery.soc * 0.42, "분")}</strong></div></div><div class="health-bar ${risk ? "danger" : battery.soc < 55 ? "warning" : ""}"><div class="health-bar-head"><span>충전 상태</span><b>${fmt1(battery.soc, "%")}</b></div><div class="progress"><span style="width:${battery.soc}%"></span></div></div></article>`; }).join("")}</section>`;
}

function safetyView() {
  const rows = [...state.alerts].sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || new Date(b.createdAt) - new Date(a.createdAt));
  const actions = '<button class="btn" data-ack-all>전체 확인</button><button class="btn warning" data-test-alert>시험경보 생성</button>';
  return `${pageHead("SAFETY OPERATIONS", "안전·경보 센터", "발생시각, 현재값, 기준값, 확인자와 확인시각을 함께 기록합니다.", actions)}<article class="card"><div class="table-wrap"><table class="table"><thead><tr><th>등급</th><th>발생시각</th><th>경보</th><th>대상</th><th>현재값</th><th>기준값</th><th>상태</th><th>조치</th></tr></thead><tbody>${rows.map(alert => `<tr><td><span class="status ${alert.severity === "CRITICAL" ? "red" : alert.severity === "WARNING" ? "amber" : "blue"}">${alert.severity}</span></td><td><strong>${fmtKST(alert.createdAt, true)}</strong><small>${fmt1(elapsedSeconds(alert.createdAt), "초 전")}</small></td><td><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.message)}</small></td><td><strong>${alert.droneId || alert.batteryId || alert.missionId || "운영센터"}</strong></td><td class="mono">${alert.currentValue === null ? "-" : fmt1(alert.currentValue, ` ${alert.unit}`)}</td><td class="mono">${alert.threshold === null ? "-" : fmt1(alert.threshold, ` ${alert.unit}`)}</td><td>${alert.acknowledged ? `<span class="status green">확인완료</span><small>${escapeHtml(alert.acknowledgedBy || "")} · ${fmtKST(alert.acknowledgedAt, true)}</small>` : '<span class="status red">미확인</span>'}</td><td>${alert.acknowledged ? "-" : `<button class="btn small" data-ack-alert="${alert.id}">확인 기록</button>`}</td></tr>`).join("")}</tbody></table></div></article>`;
}

function recordRows() {
  const type = state.ui.recordType;
  if (type === "commands") return state.commandLogs.slice().reverse().map(item => [fmtKST(item.requestedAt, true), item.id, item.missionId || "-", item.droneId || "-", item.command, item.status, item.result || "-", item.requestedBy]);
  if (type === "alerts") return state.alerts.map(item => [fmtKST(item.createdAt, true), item.id, item.missionId || "-", item.droneId || item.batteryId || "-", item.title, item.severity, item.acknowledged ? "확인" : "미확인", item.acknowledgedBy || "-"]);
  if (type === "checks") return state.checklistLogs.slice().reverse().map(item => [fmtKST(item.checkedAt, true), item.id, item.missionId, "-", item.itemName, item.passed ? "통과" : "미통과", item.note || "-", item.checkedBy]);
  if (type === "battery") return state.batteryLogs.slice().reverse().map(item => [fmtKST(item.recordedAt, true), item.id, item.missionId || "-", item.droneId || "-", `${item.batteryId} · SOC ${fmt1(item.soc, "%")}`, item.status, `SOH ${fmt1(item.soh, "%")} · ${fmt1(item.temperatureC, "℃")}`, fmt1(item.cellDeltaMv, "mV")]);
  if (type === "audit") return state.auditLogs.slice().reverse().map(item => [fmtKST(item.occurredAt, true), item.id, item.targetId || "-", item.targetType, item.action, "기록", item.detail, item.actor]);
  return state.telemetryLogs.slice().reverse().slice(0, 500).map(item => [fmtKST(item.receivedAt, true), item.id, item.missionId || "-", item.droneId, `${fmt1(item.altitudeM, "m")} · ${fmt1(item.groundSpeedKmh, "km/h")}`, `${item.flightMode} · ${item.source || "UNKNOWN"}`, `${fmt1(item.batterySocPct, "%")} · ${fmt1(item.linkQualityPct, "%")}`, `${coordinateDMS(item.lat, true)} / ${coordinateDMS(item.lng, false)}`]);
}

function recordsView() {
  const tabs = [["telemetry", "비행로그"], ["commands", "명령이력"], ["alerts", "경보이력"], ["checks", "점검표"], ["battery", "배터리기록"], ["audit", "감사로그"]];
  const rows = recordRows();
  const actions = `<button class="btn" data-export-json>${icon("download")} JSON 백업</button><button class="btn primary" data-export-xlsx>${icon("download")} 9시트 XLSX</button>`;
  return `${pageHead("OPERATION RECORDS", "운영기록·보고서", "날짜·시간·Mission ID·기체·수치·사용자·조치 결과를 자동 축적하고 다중시트 Excel로 내보냅니다.", actions)}<article class="card"><div class="record-tabs">${tabs.map(([id, label]) => `<button class="tab ${state.ui.recordType === id ? "active" : ""}" data-record-type="${id}">${label}</button>`).join("")}</div><div class="table-wrap"><table class="table"><thead><tr><th>기준시각(KST)</th><th>기록ID</th><th>Mission ID</th><th>기체/대상</th><th>수치·내용</th><th>상태·출처</th><th>결과·세부</th><th>사용자/위치</th></tr></thead><tbody>${rows.map(row => `<tr>${row.map((value, index) => `<td class="${index < 4 ? "mono" : ""}">${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></article>`;
}

function settingsView() {
  const actions = `<button class="btn" data-export-json>${icon("download")} 전체 백업</button>`;
  return `${pageHead("SYSTEM CONFIGURATION", "시스템 설정", "무료 지도, 기록 주기, 데이터 보관과 표시 기준을 관리합니다.", actions)}<section class="settings-stack">
    <article class="card"><div class="card-head"><div class="card-title"><span class="card-icon">${icon("map")}</span><div><h2>지도 설정</h2><p>카카오맵 무료 쿼터 우선 · 실패 시 OSM 자동전환</p></div></div></div><div class="setting-row"><div class="setting-copy"><strong>기본 지도</strong><small>Google Maps는 결제계정과 과금 관리가 필요하므로 무과금 우선 버전에서는 제외했습니다.</small></div><div class="setting-control"><select id="setting-map-provider" class="select"><option value="kakao" ${state.settings.mapProvider === "kakao" ? "selected" : ""}>카카오맵 무료 쿼터 모드</option><option value="osm" ${state.settings.mapProvider === "osm" ? "selected" : ""}>OpenStreetMap 무료 대체지도</option></select></div></div><div class="setting-row"><div class="setting-copy"><strong>카카오 JavaScript Key</strong><small>키는 이 브라우저에만 저장됩니다. 카카오 개발자센터에서 localhost:5500과 실제 배포 도메인을 등록해야 합니다.</small></div><div class="setting-control"><input id="setting-kakao-key" class="input mono" type="password" value="${escapeHtml(state.settings.kakaoJavaScriptKey)}" placeholder="JavaScript Key 입력"></div></div><div class="card-body"><div class="notice warning">비용 방지 원칙: 카카오맵 무료 쿼터 적용 앱만 사용하고 Biz Wallet·유료 API 사용을 연결하지 않습니다. 키가 없거나 로딩에 실패하면 OpenStreetMap으로 자동 전환합니다.</div></div></article>
    <article class="card"><div class="card-head"><div class="card-title"><span class="card-icon">${icon("record")}</span><div><h2>정밀 기록 기준</h2><p>실시간 데이터와 보고서의 공통 규칙</p></div></div></div><div class="setting-row"><div class="setting-copy"><strong>운영 수치 소수점</strong><small>고도·속도·거리·배터리·온도·통신·풍속·셀 편차는 소수점 한 자리로 저장·표시합니다.</small></div><div class="setting-control"><input class="input" value="1자리 고정" disabled></div></div><div class="setting-row"><div class="setting-copy"><strong>좌표 표시</strong><small>화면은 DMS의 초 단위만 소수점 한 자리로 표시합니다. Excel 원본 좌표는 사고분석 정확도를 위해 WGS84 6자리로 저장합니다.</small></div><div class="setting-control"><input class="input" value="DMS 0.1초 / 원본 6자리" disabled></div></div><div class="setting-row"><div class="setting-copy"><strong>텔레메트리 기록주기</strong><small>시뮬레이션에서 위치·고도·속도·배터리·통신 수치를 기록하는 간격입니다.</small></div><div class="setting-control"><select id="setting-log-interval" class="select"><option value="5" ${state.settings.telemetryIntervalSec === 5 ? "selected" : ""}>5초</option><option value="10" ${state.settings.telemetryIntervalSec === 10 ? "selected" : ""}>10초</option><option value="30" ${state.settings.telemetryIntervalSec === 30 ? "selected" : ""}>30초</option></select></div></div><div class="setting-row"><div class="setting-copy"><strong>시간 기준</strong><small>화면과 Excel은 Asia/Seoul(KST), 내부 원본은 ISO 8601 UTC를 유지합니다.</small></div><div class="setting-control"><input class="input" value="Asia/Seoul (KST)" disabled></div></div></article>
    <article class="card"><div class="card-head"><div class="card-title"><span class="card-icon">${icon("settings")}</span><div><h2>저장·초기화</h2><p>브라우저 상태와 IndexedDB 운영로그</p></div></div></div><div class="setting-row"><div class="setting-copy"><strong>설정 저장</strong><small>지도 키, 지도 종류와 기록주기를 저장하고 화면을 다시 구성합니다.</small></div><div class="setting-control"><button class="btn primary wide" data-save-settings>설정 저장·지도 다시 연결</button></div></div><div class="setting-row"><div class="setting-copy"><strong>데모 데이터 초기화</strong><small>생성한 임무와 기록을 삭제하고 최초 시연 데이터로 복원합니다.</small></div><div class="setting-control"><button class="btn danger wide" data-reset>데모 데이터 초기화</button></div></div><div class="card-body"><div class="notice">실제 다중 사용자 운영, 법적 보존, 서버 수신시각 보장은 다음 단계에서 PostgreSQL 등 서버 데이터베이스와 계정·권한·감사로그 서버를 연결해야 합니다.</div></div></article>
  </section>`;
}

function pilotView() {
  const mission = state.missions.find(item => item.pilot === "김도윤" && ["READY", "IN_FLIGHT", "HOLDING", "DELIVERING", "RETURNING"].includes(item.status)) || activeMissions()[0] || state.missions.find(item => item.status === "READY");
  if (!mission) return '<main class="mobile-shell"><div class="mobile-hero"><div class="mobile-title"><h1>배정된 임무가 없습니다.</h1></div></div></main>';
  const drone = droneById(mission.droneId);
  const battery = batteryById(mission.batteryId);
  const done = Object.values(mission.checks).filter(Boolean).length;
  const total = Object.keys(CHECK_LABELS).length;
  const nextAction = mission.status === "READY" ? (done === total ? "이륙·임무 시작" : "비행 전 점검 완료") : mission.status === "HOLDING" ? "운항 재개" : mission.status === "RETURNING" ? "복귀 상태 확인" : "운항 상세 확인";
  return `<main class="mobile-shell"><section class="mobile-hero"><div class="mobile-top"><div class="brand mobile-brand"><div class="brand-mark">${icon("drone")}</div><div class="brand-copy"><strong>D-LOGIS PILOT</strong><small>현장 운항 앱</small></div></div><button class="btn icon glass" data-role-menu>${icon("user")}</button></div><div class="mobile-title"><small>안녕하세요, 김도윤 조종자님</small><h1>다음 작업을 확인해 주세요.</h1></div></section><div class="mobile-content"><article class="mobile-card"><div class="mobile-card-body"><div class="mission-card-head"><div><span class="mono small">${mission.id}</span> ${priorityBadge(mission.priority)}</div>${statusBadge(mission.status)}</div><h2 class="mobile-mission-title">${escapeHtml(mission.title)}</h2><div class="mobile-route"><div class="stop"><span>출발지</span><strong>${escapeHtml(locationById(mission.originId)?.name || "-")}</strong></div><div class="route-drone">${icon("drone")}</div><div class="stop"><span>도착지</span><strong>${escapeHtml(locationById(mission.destinationId)?.name || "-")}</strong></div></div><div class="mobile-metrics"><div class="mobile-metric"><span>고도</span><strong>${fmt1(drone?.altitudeM, "m")}</strong></div><div class="mobile-metric"><span>속도</span><strong>${fmt1(drone?.groundSpeedKmh, "km/h")}</strong></div><div class="mobile-metric"><span>배터리</span><strong>${fmt1(battery?.soc, "%")}</strong></div><div class="mobile-metric"><span>통신</span><strong>${fmt1(drone?.linkQualityPct, "%")}</strong></div></div></div></article><article class="mobile-card next-action"><small>현재 수행할 작업</small><h3>${nextAction}</h3>${pilotPrimaryAction(mission, done === total)}</article><article class="mobile-card"><div class="card-head"><div><h2>비행 전 점검</h2><p>${done}/${total} 완료 · 점검시각 자동 기록</p></div></div><div class="checklist">${Object.entries(CHECK_LABELS).map(([key, label]) => `<button class="check-row ${mission.checks[key] ? "done" : ""}" data-toggle-check="${mission.id}" data-check-key="${key}"><span class="check-box">${mission.checks[key] ? "✓" : ""}</span><span>${label}</span><small>${mission.checks[key] ? "완료" : "점검"}</small></button>`).join("")}</div></article><article class="mobile-card"><div class="card-head"><div><h2>임무 정보</h2><p>${fmtTime(mission.scheduledAt)} 출발 예정</p></div></div><div class="detail-grid"><div class="detail-item"><span>화물</span><strong>${escapeHtml(mission.cargo)} · ${fmt1(mission.payloadKg, "kg")}</strong></div><div class="detail-item"><span>수령인</span><strong>${escapeHtml(mission.recipient)}</strong></div><div class="detail-item"><span>기체</span><strong>${drone?.name || "미배정"}</strong></div><div class="detail-item"><span>배터리</span><strong>${mission.batteryId || "미배정"}</strong></div></div></article></div><nav class="bottom-nav"><div class="bottom-nav-inner"><button class="active">${icon("mission")}임무</button><button>${icon("check")}점검</button><button>${icon("drone")}관제</button><button>${icon("record")}메시지</button><button data-exit>${icon("user")}나가기</button></div></nav></main>`;
}

function pilotPrimaryAction(mission, allDone) {
  if (mission.status === "READY") return `<button class="btn wide" data-mission-action="START" data-mission-id="${mission.id}" ${!allDone || !mission.droneId || !mission.batteryId ? "disabled" : ""}>${icon("play")} 이륙·임무 시작</button>`;
  if (mission.status === "HOLDING") return `<button class="btn wide" data-mission-action="RESUME" data-mission-id="${mission.id}">${icon("play")} 운항 재개</button>`;
  if (["IN_FLIGHT", "DELIVERING"].includes(mission.status)) return `<div class="mobile-action-grid"><button class="btn wide" data-mission-action="HOLD" data-mission-id="${mission.id}">${icon("pause")} 일시대기</button><button class="btn danger wide" data-mission-action="RTH" data-mission-id="${mission.id}">${icon("rth")} 긴급 복귀</button></div>`;
  return '<button class="btn wide" data-enter-role="admin">관제센터 상세보기</button>';
}

function recipientView() {
  const mission = state.missions.find(item => ["IN_FLIGHT", "HOLDING", "DELIVERING"].includes(item.status)) || state.missions[0];
  const drone = droneById(mission.droneId);
  const etaMinutes = Math.max(0, round1((new Date(mission.etaAt) - Date.now()) / 60000));
  return `<main class="mobile-shell"><section class="mobile-hero recipient-hero"><div class="mobile-top"><div class="brand mobile-brand"><div class="brand-mark">${icon("drone")}</div><div class="brand-copy"><strong>D-LOGIS DELIVERY</strong><small>안전한 드론 배송</small></div></div><button class="btn icon glass" data-role-menu>${icon("user")}</button></div><div class="mobile-title"><small>${mission.orderNo}</small><h1>드론이 배송 중입니다.</h1></div></section><div class="mobile-content"><article class="mobile-card"><div class="mobile-card-body"><div class="mission-card-head"><div><span class="muted small">예상 도착시간</span><div class="eta-value">${fmt1(etaMinutes, "분")}</div><span class="small muted">${fmtTime(mission.etaAt)} 도착 예정</span></div>${statusBadge(mission.status)}</div><div class="mission-progress"><div class="progress"><span style="width:${mission.progress}%"></span></div><b>${fmt1(mission.progress, "%")}</b></div></div></article><article class="mobile-card"><div class="mobile-card-body"><div class="mission-card-head"><h2>배송 수령코드</h2><span class="status blue">도착 시 사용</span></div><div class="otp">${String(mission.otp).split("").map(number => `<i>${number}</i>`).join("")}</div><button class="btn wide" data-copy-otp="${mission.otp}">${icon("copy")} 코드 복사</button></div></article><article class="mobile-card"><div class="card-head"><div><h2>배송 상세정보</h2><p>실시간 관제센터 연결</p></div><span class="status green">정상</span></div><div class="detail-grid"><div class="detail-item"><span>배송 품목</span><strong>${escapeHtml(mission.cargo)}</strong></div><div class="detail-item"><span>배송 중량</span><strong>${fmt1(mission.payloadKg, "kg")}</strong></div><div class="detail-item"><span>비행 기체</span><strong>${escapeHtml(drone?.name || "배정 중")}</strong></div><div class="detail-item"><span>예상 도착</span><strong>${fmtTime(mission.etaAt)}</strong></div></div></article><article class="mobile-card"><div class="card-head"><div><h2>안전 수령 안내</h2><p>${escapeHtml(locationById(mission.destinationId)?.name || "지정 배달점")}</p></div></div><div class="card-body"><div class="notice">드론이 착륙하거나 화물함 개방 안내가 나오기 전에는 지정 안전선 밖에서 대기해 주세요.</div></div></article></div><nav class="bottom-nav"><div class="bottom-nav-inner"><button class="active">${icon("mission")}배송</button><button>${icon("map")}경로</button><button>${icon("copy")}수령코드</button><button>${icon("record")}문의</button><button data-exit>${icon("user")}나가기</button></div></nav></main>`;
}

function updateLiveClock() {
  const clock = document.getElementById("live-clock");
  const date = document.getElementById("live-date");
  if (clock) clock.textContent = fmtTime(nowIso(), true);
  if (date) date.textContent = fmtDate(nowIso());
}
