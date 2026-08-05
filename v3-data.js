"use strict";

const APP_VERSION = "3.0.0";
const STORAGE_KEY = "dlogis-control-v3-state";
const TIME_ZONE = "Asia/Seoul";
const RECENT_LOG_LIMIT = 800;

const STATUS = {
  PENDING_APPROVAL: ["승인대기", "violet"],
  READY: ["출동대기", "green"],
  IN_FLIGHT: ["비행중", "blue"],
  HOLDING: ["일시대기", "amber"],
  DELIVERING: ["배송처리", "blue"],
  RETURNING: ["복귀중", "amber"],
  COMPLETED: ["완료", "green"],
  CANCELLED: ["취소", "red"]
};

const CHECK_LABELS = {
  weather: "기상 적합성",
  airspace: "공역·비행 승인",
  airframe: "기체 외관·프로펠러",
  battery: "배터리 임무준비도",
  cargo: "화물 중량·잠금",
  link: "통신·GNSS 상태",
  route: "항로·비상착륙점"
};

function round1(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round((number + Number.EPSILON) * 10) / 10
    : 0;
}

function roundCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number * 1000000) / 1000000
    : 0;
}

function fmt1(value, unit = "") {
  return `${round1(value).toFixed(1)}${unit}`;
}

function nowIso() {
  return new Date().toISOString();
}

function offsetIso(minutes = 0) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function uid(prefix = "ID") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function fmtKST(value, withSeconds = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false
  }).format(date);
}

function fmtTime(value, withSeconds = false) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false
  }).format(new Date(value));
}

function fmtDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date(value));
}

function elapsedSeconds(value) {
  if (!value) return 9999;
  return round1(Math.max(0, (Date.now() - new Date(value).getTime()) / 1000));
}

function coordinateDMS(value, isLatitude) {
  const number = Number(value) || 0;
  const absolute = Math.abs(number);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = round1((minutesFloat - minutes) * 60);
  const direction = isLatitude
    ? number >= 0
      ? "N"
      : "S"
    : number >= 0
      ? "E"
      : "W";
  return `${degrees}°${String(minutes).padStart(2, "0")}′${seconds.toFixed(
    1
  )}″${direction}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function haversineKm(a, b) {
  if (!a || !b) return 0;
  const radius = 6371;
  const radians = value => (value * Math.PI) / 180;
  const latitude = radians(b.lat - a.lat);
  const longitude = radians(b.lng - a.lng);
  const part =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(longitude / 2) ** 2;
  return round1(radius * 2 * Math.atan2(Math.sqrt(part), Math.sqrt(1 - part)));
}

function statusBadge(status) {
  const [label, tone] = STATUS[status] || [status || "-", ""];
  return `<span class="status ${tone}">${escapeHtml(label)}</span>`;
}

function priorityBadge(priority) {
  const label = priority === "URGENT" ? "긴급" : priority === "HIGH" ? "우선" : "일반";
  return `<span class="priority ${priority || "NORMAL"}">${label}</span>`;
}

function capArray(array, maximum = RECENT_LOG_LIMIT) {
  if (array.length > maximum) array.splice(0, array.length - maximum);
}

function recordLog(storeName, item, maximum = RECENT_LOG_LIMIT) {
  if (!state[storeName]) state[storeName] = [];
  state[storeName].push(item);
  capArray(state[storeName], maximum);
  if (window.DLogisDB) window.DLogisDB.put(storeName, item).catch(() => {});
  return item;
}

function locationById(id) {
  return state.locations.find(item => item.id === id);
}

function missionById(id) {
  return state.missions.find(item => item.id === id);
}

function droneById(id) {
  return state.drones.find(item => item.id === id);
}

function batteryById(id) {
  return state.batteries.find(item => item.id === id);
}

function activeMissions() {
  return state.missions.filter(item =>
    ["IN_FLIGHT", "HOLDING", "DELIVERING", "RETURNING"].includes(item.status)
  );
}

function latestTelemetry(droneId) {
  for (let index = state.telemetryLogs.length - 1; index >= 0; index -= 1) {
    if (state.telemetryLogs[index].droneId === droneId) return state.telemetryLogs[index];
  }
  return null;
}

function dataFreshnessSeconds() {
  const latest = state.telemetryLogs.at(-1)?.receivedAt || state.meta.lastDataAt;
  return elapsedSeconds(latest);
}

function onTimeRate() {
  const completed = state.missions.filter(item => item.status === "COMPLETED");
  if (!completed.length) return 100;
  return round1(
    (completed.filter(item => item.onTime !== false).length / completed.length) * 100
  );
}

function actionableCount() {
  const alerts = state.alerts.filter(
    item => !item.acknowledged && ["WARNING", "CRITICAL"].includes(item.severity)
  ).length;
  const approvals = state.missions.filter(item => item.status === "PENDING_APPROVAL").length;
  const batteries = state.batteries.filter(
    item => item.status !== "QUARANTINE" && (item.soh < 85 || item.cellDeltaMv > 50)
  ).length;
  return alerts + approvals + batteries;
}

function audit(action, targetType, targetId, detail, actor = state.session.operatorName || "시스템") {
  return recordLog("auditLogs", {
    id: uid("AUD"),
    actor,
    action,
    targetType,
    targetId,
    detail,
    occurredAt: nowIso()
  });
}

function addAlert({
  severity = "INFO",
  category = "SYSTEM",
  title,
  message,
  missionId = null,
  droneId = null,
  batteryId = null,
  currentValue = null,
  threshold = null,
  unit = ""
}) {
  const duplicate = state.alerts.find(
    item =>
      !item.acknowledged &&
      item.title === title &&
      item.droneId === droneId &&
      item.batteryId === batteryId
  );
  if (duplicate) return duplicate;
  const alert = {
    id: uid("ALT"),
    severity,
    category,
    title,
    message,
    missionId,
    droneId,
    batteryId,
    currentValue: currentValue === null ? null : round1(currentValue),
    threshold: threshold === null ? null : round1(threshold),
    unit,
    createdAt: nowIso(),
    acknowledged: false,
    acknowledgedAt: null,
    acknowledgedBy: null
  };
  state.alerts.unshift(alert);
  capArray(state.alerts, 1200);
  if (window.DLogisDB) window.DLogisDB.put("alerts", alert).catch(() => {});
  return alert;
}

function createTelemetry(drone, mission) {
  const battery = batteryById(drone.batteryId);
  const sentAt = nowIso();
  const latency = round1(40 + Math.random() * 110);
  const record = {
    id: uid("TEL"),
    missionId: mission?.id || null,
    droneId: drone.id,
    batteryId: drone.batteryId || null,
    source: state.settings.mode === "simulation" ? "SIMULATION" : "GATEWAY",
    sentAt,
    receivedAt: new Date(Date.now() + latency).toISOString(),
    dataDelayMs: latency,
    lat: roundCoordinate(drone.lat),
    lng: roundCoordinate(drone.lng),
    altitudeM: round1(drone.altitudeM),
    groundSpeedKmh: round1(drone.groundSpeedKmh),
    headingDeg: round1(drone.headingDeg),
    batterySocPct: round1(battery?.soc ?? drone.batterySocPct),
    batteryTempC: round1(battery?.temperatureC ?? 0),
    linkQualityPct: round1(drone.linkQualityPct),
    satellites: round1(drone.satellites),
    flightMode: drone.flightMode,
    armed: Boolean(drone.armed)
  };
  recordLog("telemetryLogs", record, 1500);
  state.meta.lastDataAt = record.receivedAt;
  if (battery) {
    recordLog("batteryLogs", {
      id: uid("BATLOG"),
      missionId: mission?.id || null,
      droneId: drone.id,
      batteryId: battery.id,
      source: record.source,
      recordedAt: record.receivedAt,
      soc: round1(battery.soc),
      soh: round1(battery.soh),
      temperatureC: round1(battery.temperatureC),
      cellDeltaMv: round1(battery.cellDeltaMv),
      cycles: round1(battery.cycles),
      status: battery.status
    });
  }
  return record;
}

function seedState() {
  const locations = [
    { id: "LOC-HUB-A", name: "부천 물류거점 A", type: "HUB", address: "경기도 부천시 시범 물류거점", lat: 37.50342, lng: 126.76608 },
    { id: "LOC-IND-B", name: "산업단지 B동", type: "DESTINATION", address: "경기도 부천시 산업단지 B동", lat: 37.49296, lng: 126.74281 },
    { id: "LOC-MED-A", name: "지역의료원", type: "DESTINATION", address: "경기도 부천시 지역의료원", lat: 37.48873, lng: 126.77724 },
    { id: "LOC-LAB-C", name: "바이오검사센터", type: "DESTINATION", address: "경기도 부천시 바이오검사센터", lat: 37.51531, lng: 126.74862 },
    { id: "LOC-PARK-D", name: "스마트공원 배달점", type: "DESTINATION", address: "경기도 부천시 스마트공원", lat: 37.51018, lng: 126.78631 }
  ];

  const drones = [
    { id: "DR-001", name: "아르고 01", model: "DLV-X8", status: "IN_FLIGHT", airworthy: true, batteryId: "BAT-001", missionId: "MSN-DEMO-001", lat: 37.49976, lng: 126.75797, altitudeM: 81.2, groundSpeedKmh: 34.1, headingDeg: 112.4, linkQualityPct: 95, satellites: 21, armed: true, flightMode: "MISSION", payloadMaxKg: 5, payloadKg: 2.4, flightHours: 43.6, maintenanceDueHours: 21.4 },
    { id: "DR-002", name: "아르고 02", model: "DLV-X8", status: "RETURNING", airworthy: true, batteryId: "BAT-002", missionId: "MSN-DEMO-002", lat: 37.50762, lng: 126.75328, altitudeM: 74.8, groundSpeedKmh: 40.7, headingDeg: 238.6, linkQualityPct: 86.4, satellites: 18, armed: true, flightMode: "RTL", payloadMaxKg: 5, payloadKg: 0, flightHours: 61.1, maintenanceDueHours: 12.8 },
    { id: "DR-003", name: "아르고 03", model: "DLV-X8", status: "READY", airworthy: true, batteryId: "BAT-003", missionId: null, lat: 37.50342, lng: 126.76608, altitudeM: 0, groundSpeedKmh: 0, headingDeg: 0, linkQualityPct: 100, satellites: 0, armed: false, flightMode: "STANDBY", payloadMaxKg: 5, payloadKg: 0, flightHours: 28.7, maintenanceDueHours: 36.2 },
    { id: "DR-004", name: "아르고 04", model: "DLV-X4", status: "CHARGING", airworthy: true, batteryId: "BAT-004", missionId: null, lat: 37.50342, lng: 126.76608, altitudeM: 0, groundSpeedKmh: 0, headingDeg: 0, linkQualityPct: 100, satellites: 0, armed: false, flightMode: "STANDBY", payloadMaxKg: 3, payloadKg: 0, flightHours: 52.5, maintenanceDueHours: 9.6 },
    { id: "DR-005", name: "아르고 05", model: "DLV-X4", status: "MAINTENANCE", airworthy: false, batteryId: null, missionId: null, lat: 37.50342, lng: 126.76608, altitudeM: 0, groundSpeedKmh: 0, headingDeg: 0, linkQualityPct: 0, satellites: 0, armed: false, flightMode: "MAINTENANCE", payloadMaxKg: 3, payloadKg: 0, flightHours: 74.9, maintenanceDueHours: 0 }
  ];

  const batteries = [
    { id: "BAT-001", status: "IN_USE", droneId: "DR-001", soc: 68, soh: 94, temperatureC: 37.2, cellDeltaMv: 18, cycles: 84, lastInspectionAt: offsetIso(-5760) },
    { id: "BAT-002", status: "IN_USE", droneId: "DR-002", soc: 31, soh: 88, temperatureC: 41.5, cellDeltaMv: 34, cycles: 132, lastInspectionAt: offsetIso(-10080) },
    { id: "BAT-003", status: "READY", droneId: "DR-003", soc: 96, soh: 97, temperatureC: 29.4, cellDeltaMv: 11, cycles: 45, lastInspectionAt: offsetIso(-2880) },
    { id: "BAT-004", status: "CHARGING", droneId: "DR-004", soc: 76, soh: 91, temperatureC: 33.8, cellDeltaMv: 22, cycles: 106, lastInspectionAt: offsetIso(-7200) },
    { id: "BAT-005", status: "READY", droneId: null, soc: 89, soh: 95, temperatureC: 28.6, cellDeltaMv: 14, cycles: 63, lastInspectionAt: offsetIso(-1440) },
    { id: "BAT-006", status: "QUARANTINE", droneId: null, soc: 54, soh: 74, temperatureC: 31.2, cellDeltaMv: 79, cycles: 221, lastInspectionAt: offsetIso(-17280) }
  ];

  const completeChecks = {
    weather: true,
    airspace: true,
    airframe: true,
    battery: true,
    cargo: true,
    link: true,
    route: true
  };

  const missions = [
    { id: "MSN-DEMO-001", orderNo: "ORD-260805-014", title: "생활필수품 정기배송", type: "GENERAL", priority: "NORMAL", status: "IN_FLIGHT", progress: 43, originId: "LOC-HUB-A", destinationId: "LOC-PARK-D", droneId: "DR-001", batteryId: "BAT-001", pilot: "김도윤", cargo: "생활필수품 박스", payloadKg: 2.4, recipient: "박서연", recipientPhone: "010-****-1128", otp: "482917", distanceKm: haversineKm(locations[0], locations[4]), scheduledAt: offsetIso(-20), createdAt: offsetIso(-35), approvedAt: offsetIso(-27), departedAt: offsetIso(-16), etaAt: offsetIso(11), completedAt: null, onTime: null, checks: { ...completeChecks }, history: [{ event: "임무 생성", at: offsetIso(-35), actor: "한지수" }, { event: "운항 승인", at: offsetIso(-27), actor: "한지수" }, { event: "비행 전 점검 완료", at: offsetIso(-18), actor: "김도윤" }, { event: "이륙·임무 시작", at: offsetIso(-16), actor: "김도윤" }] },
    { id: "MSN-DEMO-002", orderNo: "ORD-260805-012", title: "검사 샘플 회송", type: "MEDICAL", priority: "HIGH", status: "RETURNING", progress: 84, returnProgress: 36, originId: "LOC-HUB-A", destinationId: "LOC-LAB-C", droneId: "DR-002", batteryId: "BAT-002", pilot: "이현우", cargo: "비위험 연구 샘플", payloadKg: 1.1, recipient: "검사분석팀", recipientPhone: "032-***-3950", otp: "731204", distanceKm: haversineKm(locations[0], locations[3]), scheduledAt: offsetIso(-45), createdAt: offsetIso(-70), approvedAt: offsetIso(-60), departedAt: offsetIso(-41), etaAt: offsetIso(6), completedAt: null, onTime: null, checks: { ...completeChecks }, history: [{ event: "임무 생성", at: offsetIso(-70), actor: "한지수" }, { event: "운항 승인", at: offsetIso(-60), actor: "한지수" }, { event: "이륙·임무 시작", at: offsetIso(-41), actor: "이현우" }, { event: "배송 완료·복귀 시작", at: offsetIso(-12), actor: "이현우" }] },
    { id: "MSN-DEMO-003", orderNo: "ORD-260805-016", title: "산업단지 긴급부품 배송", type: "INDUSTRIAL", priority: "URGENT", status: "PENDING_APPROVAL", progress: 0, originId: "LOC-HUB-A", destinationId: "LOC-IND-B", droneId: "DR-003", batteryId: "BAT-003", pilot: "최민재", cargo: "정밀 스핀들 부품", payloadKg: 3.2, recipient: "생산관리팀", recipientPhone: "031-***-2204", otp: "119603", distanceKm: haversineKm(locations[0], locations[1]), scheduledAt: offsetIso(20), createdAt: offsetIso(-4), approvedAt: null, departedAt: null, etaAt: offsetIso(35), completedAt: null, onTime: null, checks: { weather: false, airspace: true, airframe: false, battery: false, cargo: true, link: false, route: true }, history: [{ event: "임무 생성", at: offsetIso(-4), actor: "한지수" }] },
    { id: "MSN-DEMO-004", orderNo: "ORD-260805-018", title: "의료원 소모품 오후배송", type: "MEDICAL", priority: "NORMAL", status: "READY", progress: 0, originId: "LOC-HUB-A", destinationId: "LOC-MED-A", droneId: null, batteryId: null, pilot: "미배정", cargo: "의료 소모품", payloadKg: 1.8, recipient: "의료지원팀", recipientPhone: "032-***-8814", otp: "902418", distanceKm: haversineKm(locations[0], locations[2]), scheduledAt: offsetIso(90), createdAt: offsetIso(-25), approvedAt: offsetIso(-15), departedAt: null, etaAt: offsetIso(108), completedAt: null, onTime: null, checks: { weather: false, airspace: true, airframe: false, battery: false, cargo: true, link: false, route: true }, history: [{ event: "임무 생성", at: offsetIso(-25), actor: "한지수" }, { event: "운항 승인", at: offsetIso(-15), actor: "한지수" }] },
    { id: "MSN-DEMO-005", orderNo: "ORD-260804-038", title: "품질승인 문서 배송", type: "INDUSTRIAL", priority: "NORMAL", status: "COMPLETED", progress: 100, originId: "LOC-HUB-A", destinationId: "LOC-IND-B", droneId: "DR-004", batteryId: "BAT-005", pilot: "김도윤", cargo: "품질승인 문서", payloadKg: 0.5, recipient: "품질보증팀", recipientPhone: "031-***-2211", otp: "665208", distanceKm: haversineKm(locations[0], locations[1]), scheduledAt: offsetIso(-1560), createdAt: offsetIso(-1620), approvedAt: offsetIso(-1600), departedAt: offsetIso(-1557), etaAt: offsetIso(-1541), completedAt: offsetIso(-1542), onTime: true, checks: { ...completeChecks }, history: [{ event: "임무 생성", at: offsetIso(-1620), actor: "한지수" }, { event: "운항 승인", at: offsetIso(-1600), actor: "한지수" }, { event: "배송 완료", at: offsetIso(-1542), actor: "김도윤" }] }
  ];

  const seeded = {
    meta: { version: APP_VERSION, centerName: "부천 스마트 드론배송 실증센터", timezone: TIME_ZONE, coordinateSystem: "WGS84", createdAt: nowIso(), lastDataAt: nowIso() },
    session: { role: null, operatorId: "OP-004", operatorName: "한지수", operatorRole: "관제운영 책임자" },
    settings: { mode: "simulation", mapProvider: "kakao", kakaoJavaScriptKey: "", fallbackMap: "osm", telemetryIntervalSec: 5, decimalPlaces: 1, dataRetentionDays: 30, noPaidMap: true },
    ui: { view: "dashboard", selectedMissionId: "MSN-DEMO-001", recordType: "telemetry", sidebarOpen: false },
    locations,
    drones,
    batteries,
    missions,
    alerts: [
      { id: "ALT-DEMO-001", severity: "WARNING", category: "BATTERY", title: "복귀 안전여유 확인 필요", message: "DR-002의 예상 착륙 SOC가 19.0%로 계산되었습니다.", missionId: "MSN-DEMO-002", droneId: "DR-002", batteryId: "BAT-002", currentValue: 19, threshold: 20, unit: "%", createdAt: offsetIso(-8), acknowledged: false, acknowledgedAt: null, acknowledgedBy: null },
      { id: "ALT-DEMO-002", severity: "INFO", category: "WEATHER", title: "서남서풍 증가 추세", message: "30분 후 평균 풍속이 4.8m/s까지 증가할 가능성이 있습니다.", missionId: null, droneId: null, batteryId: null, currentValue: 4.8, threshold: 7, unit: "m/s", createdAt: offsetIso(-17), acknowledged: false, acknowledgedAt: null, acknowledgedBy: null },
      { id: "ALT-DEMO-003", severity: "CRITICAL", category: "BATTERY", title: "배터리 격리 유지", message: "BAT-006의 셀 편차가 안전 기준을 초과하여 임무 배정이 차단되었습니다.", missionId: null, droneId: null, batteryId: "BAT-006", currentValue: 79, threshold: 50, unit: "mV", createdAt: offsetIso(-52), acknowledged: true, acknowledgedAt: offsetIso(-48), acknowledgedBy: "한지수" }
    ],
    telemetryLogs: [],
    commandLogs: [],
    checklistLogs: [],
    batteryLogs: [],
    proofs: [
      { id: "PRF-DEMO-001", missionId: "MSN-DEMO-005", orderNo: "ORD-260804-038", recipient: "품질보증팀", method: "OTP+화물함 개폐", otpMatched: true, lockerOpenedAt: offsetIso(-1543), deliveredAt: offsetIso(-1542), lat: locations[1].lat, lng: locations[1].lng, photoFileName: "POD_MSN-DEMO-005.jpg", signature: "전자 인수확인 완료", temperatureMinC: 22, temperatureMaxC: 24.1 }
    ],
    auditLogs: [
      { id: "AUD-DEMO-001", actor: "한지수", action: "ALERT_ACK", targetType: "ALERT", targetId: "ALT-DEMO-003", detail: "고위험 배터리 격리 상태 확인", occurredAt: offsetIso(-48) }
    ]
  };

  missions.forEach(mission => {
    Object.entries(mission.checks).forEach(([key, passed]) => {
      if (!passed) return;
      seeded.checklistLogs.push({
        id: uid("CHK"),
        missionId: mission.id,
        itemKey: key,
        itemName: CHECK_LABELS[key],
        passed: true,
        checkedAt: mission.departedAt || mission.approvedAt || mission.createdAt,
        checkedBy: mission.pilot === "미배정" ? "한지수" : mission.pilot,
        note: "초기 시연 데이터"
      });
    });
  });

  for (let index = 12; index >= 1; index -= 1) {
    drones
      .filter(drone => ["IN_FLIGHT", "RETURNING"].includes(drone.status))
      .forEach(drone => {
        const mission = missions.find(item => item.id === drone.missionId);
        const battery = batteries.find(item => item.id === drone.batteryId);
        const time = offsetIso(-index);
        seeded.telemetryLogs.push({
          id: uid("TEL"),
          missionId: mission.id,
          droneId: drone.id,
          batteryId: drone.batteryId,
          source: "SIMULATION",
          sentAt: time,
          receivedAt: new Date(new Date(time).getTime() + 80).toISOString(),
          dataDelayMs: 80,
          lat: roundCoordinate(drone.lat - index * 0.00002),
          lng: roundCoordinate(drone.lng - index * 0.00003),
          altitudeM: round1(drone.altitudeM + Math.sin(index) * 2),
          groundSpeedKmh: round1(drone.groundSpeedKmh + Math.cos(index) * 1.3),
          headingDeg: round1(drone.headingDeg),
          batterySocPct: round1(battery.soc + index * 0.15),
          batteryTempC: round1(battery.temperatureC - index * 0.04),
          linkQualityPct: round1(drone.linkQualityPct),
          satellites: round1(drone.satellites),
          flightMode: drone.flightMode,
          armed: drone.armed
        });
      });
  }

  seeded.commandLogs.push({
    id: "CMD-DEMO-001",
    missionId: "MSN-DEMO-002",
    droneId: "DR-002",
    command: "RTH",
    requestedBy: "이현우",
    requestedAt: offsetIso(-12),
    sentAt: offsetIso(-12),
    acknowledgedAt: new Date(Date.now() - 12 * 60000 + 350).toISOString(),
    appliedAt: new Date(Date.now() - 12 * 60000 + 620).toISOString(),
    status: "APPLIED",
    result: "SIMULATION_ACCEPTED"
  });

  return seeded;
}

function migrateState(raw) {
  if (!raw || raw.meta?.version !== APP_VERSION) return seedState();
  raw.settings = {
    mode: "simulation",
    mapProvider: "kakao",
    kakaoJavaScriptKey: "",
    fallbackMap: "osm",
    telemetryIntervalSec: 5,
    decimalPlaces: 1,
    dataRetentionDays: 30,
    noPaidMap: true,
    ...raw.settings
  };
  raw.ui = {
    view: "dashboard",
    selectedMissionId: null,
    recordType: "telemetry",
    sidebarOpen: false,
    ...raw.ui
  };
  [
    "telemetryLogs",
    "commandLogs",
    "checklistLogs",
    "batteryLogs",
    "proofs",
    "auditLogs",
    "alerts"
  ].forEach(key => {
    raw[key] ||= [];
  });
  return raw;
}

function loadState() {
  try {
    return migrateState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return seedState();
  }
}

function persist() {
  try {
    capArray(state.telemetryLogs, 1500);
    ["commandLogs", "checklistLogs", "batteryLogs", "auditLogs"].forEach(key =>
      capArray(state[key], RECENT_LOG_LIMIT)
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("브라우저 상태 저장 실패", error);
  }
}

let state = loadState();
