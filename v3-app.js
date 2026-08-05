"use strict";

let lastSimulationAt = 0;

function setRole(role) {
  state.session.role = role;
  if (role === "admin") {
    state.session.operatorName = "한지수";
    state.session.operatorRole = "관제운영 책임자";
    state.ui.view = "dashboard";
  } else if (role === "pilot") {
    state.session.operatorName = "김도윤";
    state.session.operatorRole = "현장 조종자";
  } else if (role === "recipient") {
    state.session.operatorName = "박서연";
    state.session.operatorRole = "배송 수령인";
  }
  persist();
  renderApp();
}

function setView(view) {
  state.session.role = "admin";
  state.ui.view = view;
  state.ui.sidebarOpen = false;
  persist();
  renderApp();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function openMissionWizard() {
  UIState.wizardStep = 1;
  const readyDrones = state.drones.filter(
    drone => drone.airworthy && drone.status === "READY"
  );
  const readyBatteries = state.batteries.filter(
    battery =>
      battery.status === "READY" &&
      battery.soc >= 60 &&
      battery.soh >= 85 &&
      battery.cellDeltaMv <= 50
  );
  const localTime = new Date(
    Date.now() + 30 * 60000 - new Date().getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);

  document.getElementById("modal-root").innerHTML = `<div class="modal-backdrop" data-modal-close>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="mission-modal-title" onclick="event.stopPropagation()">
      <div class="modal-head"><div><h2 id="mission-modal-title">신규 배송임무</h2><p>4단계로 입력하고 자동 안전검토 후 Mission ID를 생성합니다.</p></div><button class="btn icon" type="button" data-modal-close>${icon("close")}</button></div>
      <form id="mission-form">
        <div class="modal-body">
          <div class="wizard-steps">${["배송정보", "경로·일정", "자원배정", "최종검토"].map((label, index) => `<div class="wizard-step ${index === 0 ? "active" : ""}" data-wizard-indicator="${index + 1}">${index + 1}. ${label}</div>`).join("")}</div>
          <section class="wizard-page active" data-wizard-page="1"><div class="form-grid">
            <div class="field full"><label>임무명 <em>*</em></label><input class="input" name="title" required maxlength="80" placeholder="예: 산업단지 긴급부품 배송"></div>
            <div class="field"><label>배송 유형</label><select class="select" name="type"><option value="GENERAL">일반배송</option><option value="INDUSTRIAL">산업물류</option><option value="MEDICAL">의료연계</option><option value="EMERGENCY">재난긴급</option></select></div>
            <div class="field"><label>우선순위</label><select class="select" name="priority"><option value="NORMAL">일반</option><option value="HIGH">우선</option><option value="URGENT">긴급</option></select></div>
            <div class="field"><label>화물명 <em>*</em></label><input class="input" name="cargo" required maxlength="120"></div>
            <div class="field"><label>중량(kg) <em>*</em></label><input class="input" name="payloadKg" type="number" min="0.1" max="10" step="0.1" value="1.0" required></div>
            <div class="field"><label>수령인·부서 <em>*</em></label><input class="input" name="recipient" required maxlength="50"></div>
            <div class="field"><label>연락처</label><input class="input" name="recipientPhone" value="010-0000-0000"></div>
          </div></section>
          <section class="wizard-page" data-wizard-page="2"><div class="form-grid">
            <div class="field"><label>출발지 <em>*</em></label><select class="select" name="originId">${state.locations.filter(location => location.type === "HUB").map(location => `<option value="${location.id}">${escapeHtml(location.name)}</option>`).join("")}</select></div>
            <div class="field"><label>배송지 <em>*</em></label><select class="select" name="destinationId">${state.locations.filter(location => location.type !== "HUB").map(location => `<option value="${location.id}">${escapeHtml(location.name)}</option>`).join("")}</select></div>
            <div class="field"><label>출발 예정시각 <em>*</em></label><input class="input" name="scheduledAt" type="datetime-local" value="${localTime}" required></div>
            <div class="field"><label>수령 OTP</label><input class="input mono" name="otp" value="${Math.floor(100000 + Math.random() * 900000)}" readonly></div>
            <div class="field full"><div class="notice">거리와 예상 비행시간은 출발지·도착지의 WGS84 좌표를 기준으로 자동 계산됩니다.</div></div>
          </div></section>
          <section class="wizard-page" data-wizard-page="3"><div class="form-grid">
            <div class="field"><label>조종자</label><select class="select" name="pilot"><option>김도윤</option><option>이현우</option><option>최민재</option></select></div>
            <div class="field"><label>드론</label><select class="select" name="droneId"><option value="">자동배정 대기</option>${readyDrones.map(drone => `<option value="${drone.id}">${escapeHtml(drone.name)} · 최대 ${fmt1(drone.payloadMaxKg, "kg")}</option>`).join("")}</select><div class="help">화물중량을 초과하는 기체는 생성 시 차단됩니다.</div></div>
            <div class="field"><label>배터리</label><select class="select" name="batteryId"><option value="">자동배정 대기</option>${readyBatteries.map(battery => `<option value="${battery.id}">${battery.id} · SOC ${fmt1(battery.soc, "%")} · SOH ${fmt1(battery.soh, "%")}</option>`).join("")}</select></div>
            <div class="field"><label>기록주기</label><input class="input" value="${state.settings.telemetryIntervalSec}초" disabled></div>
          </div></section>
          <section class="wizard-page" data-wizard-page="4"><div id="mission-review" class="review-grid"></div><div class="notice warning mission-review-notice">생성 직후 상태는 ‘승인대기’입니다. 관제 운영자가 승인하고 7개 안전점검을 완료해야 이륙할 수 있습니다.</div></section>
        </div>
        <div class="modal-foot"><button type="button" class="btn" data-modal-close>취소</button><button type="button" class="btn" data-wizard-prev disabled>이전</button><button type="button" class="btn primary" data-wizard-next>다음</button><button type="submit" class="btn primary hidden" data-wizard-submit>임무 생성</button></div>
      </form>
    </section>
  </div>`;
}

function updateWizard(step) {
  UIState.wizardStep = step;
  $$('[data-wizard-page]').forEach(element =>
    element.classList.toggle("active", Number(element.dataset.wizardPage) === step)
  );
  $$('[data-wizard-indicator]').forEach(element =>
    element.classList.toggle("active", Number(element.dataset.wizardIndicator) === step)
  );
  $('[data-wizard-prev]').disabled = step === 1;
  $('[data-wizard-next]').classList.toggle("hidden", step === 4);
  $('[data-wizard-submit]').classList.toggle("hidden", step !== 4);

  if (step === 4) {
    const form = document.getElementById("mission-form");
    const data = new FormData(form);
    const origin = locationById(data.get("originId"));
    const destination = locationById(data.get("destinationId"));
    const review = [
      ["임무명", data.get("title")],
      ["화물", `${data.get("cargo")} · ${fmt1(data.get("payloadKg"), "kg")}`],
      ["경로", `${origin?.name || "-"} → ${destination?.name || "-"}`],
      ["거리", fmt1(haversineKm(origin, destination), "km")],
      ["출발예정", fmtKST(new Date(data.get("scheduledAt")).toISOString(), false)],
      ["조종자", data.get("pilot")],
      ["드론", data.get("droneId") || "생성 후 자동배정"],
      ["배터리", data.get("batteryId") || "생성 후 자동배정"]
    ];
    document.getElementById("mission-review").innerHTML = review
      .map(([label, value]) => `<div class="review-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join("");
  }
}

function validateWizardStep(step) {
  const page = document.querySelector(`[data-wizard-page="${step}"]`);
  for (const input of $$('input,select', page)) {
    if (!input.reportValidity()) return false;
  }
  return true;
}

function createMission(form) {
  const data = new FormData(form);
  const origin = locationById(data.get("originId"));
  const destination = locationById(data.get("destinationId"));
  const distance = haversineKm(origin, destination);
  const scheduledAt = new Date(data.get("scheduledAt")).toISOString();
  const payloadKg = round1(data.get("payloadKg"));
  const selectedDrone = droneById(data.get("droneId"));

  if (selectedDrone && payloadKg > selectedDrone.payloadMaxKg) {
    toast(
      "기체 배정 실패",
      `화물 ${fmt1(payloadKg, "kg")}이 ${selectedDrone.name} 최대 탑재량을 초과합니다.`,
      "error"
    );
    return;
  }

  const dateToken = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(new Date())
    .replaceAll("-", "");
  const estimatedMinutes = Math.max(8, Math.ceil((distance / 34) * 60 + 6));
  const mission = {
    id: `MSN-${dateToken}-${String(state.missions.length + 1).padStart(3, "0")}`,
    orderNo: `ORD-${Date.now().toString().slice(-10)}`,
    title: data.get("title"),
    type: data.get("type"),
    priority: data.get("priority"),
    status: "PENDING_APPROVAL",
    progress: 0,
    originId: origin.id,
    destinationId: destination.id,
    droneId: data.get("droneId") || null,
    batteryId: data.get("batteryId") || null,
    pilot: data.get("pilot"),
    cargo: data.get("cargo"),
    payloadKg,
    recipient: data.get("recipient"),
    recipientPhone: data.get("recipientPhone"),
    otp: data.get("otp"),
    distanceKm: distance,
    scheduledAt,
    createdAt: nowIso(),
    approvedAt: null,
    departedAt: null,
    etaAt: new Date(new Date(scheduledAt).getTime() + estimatedMinutes * 60000).toISOString(),
    completedAt: null,
    onTime: null,
    checks: {
      weather: false,
      airspace: false,
      airframe: false,
      battery: false,
      cargo: false,
      link: false,
      route: false
    },
    history: [{ event: "임무 생성", at: nowIso(), actor: state.session.operatorName }]
  };

  state.missions.unshift(mission);
  state.ui.selectedMissionId = mission.id;
  state.ui.view = "missions";
  audit(
    "MISSION_CREATE",
    "MISSION",
    mission.id,
    `${mission.title} · ${mission.cargo} · ${fmt1(mission.payloadKg, "kg")}`
  );
  addAlert({
    severity: mission.priority === "URGENT" ? "CRITICAL" : "WARNING",
    category: "MISSION",
    title: "신규 임무 승인 필요",
    message: `${mission.id} · ${mission.title}`,
    missionId: mission.id
  });
  persist();
  closeModal();
  renderApp();
  toast(
    "배송임무 생성 완료",
    `${mission.id}가 승인대기로 등록되었습니다.`,
    "success"
  );
}

function toggleCheck(missionId, key) {
  const mission = missionById(missionId);
  if (!mission || !(key in mission.checks)) return;
  mission.checks[key] = !mission.checks[key];
  const actor = state.session.role === "pilot" ? "김도윤" : state.session.operatorName;
  const log = {
    id: uid("CHK"),
    missionId,
    itemKey: key,
    itemName: CHECK_LABELS[key],
    passed: mission.checks[key],
    checkedAt: nowIso(),
    checkedBy: actor,
    note: mission.checks[key] ? "점검 완료" : "점검 해제"
  };
  recordLog("checklistLogs", log);
  mission.history.push({
    event: `${CHECK_LABELS[key]} ${mission.checks[key] ? "완료" : "해제"}`,
    at: log.checkedAt,
    actor
  });
  audit(
    "PREFLIGHT_CHECK",
    "MISSION",
    missionId,
    `${CHECK_LABELS[key]}: ${mission.checks[key] ? "완료" : "해제"}`,
    actor
  );
  persist();
  renderApp();
}

function completeAllChecks(missionId) {
  const mission = missionById(missionId);
  if (!mission) return;
  const checkedAt = nowIso();
  const actor = state.session.role === "pilot" ? "김도윤" : state.session.operatorName;
  Object.keys(mission.checks).forEach(key => {
    if (!mission.checks[key]) {
      recordLog("checklistLogs", {
        id: uid("CHK"),
        missionId,
        itemKey: key,
        itemName: CHECK_LABELS[key],
        passed: true,
        checkedAt,
        checkedBy: actor,
        note: "전체 점검 실행"
      });
    }
    mission.checks[key] = true;
  });
  mission.history.push({ event: "비행 전 전체 점검 완료", at: checkedAt, actor });
  audit("PREFLIGHT_ALL", "MISSION", missionId, "7개 안전점검 전체 완료", actor);
  persist();
  renderApp();
  toast("비행 전 점검 완료", "점검자와 완료시각이 기록되었습니다.", "success");
}

function autoAssign(missionId) {
  const mission = missionById(missionId);
  if (!mission) return;
  const drone = state.drones.find(
    item =>
      item.airworthy &&
      item.status === "READY" &&
      item.payloadMaxKg >= mission.payloadKg
  );
  const battery = state.batteries.find(
    item =>
      item.status === "READY" &&
      item.soc >= 60 &&
      item.soh >= 85 &&
      item.cellDeltaMv <= 50
  );
  if (!drone || !battery) {
    toast(
      "자동배정 불가",
      "화물중량과 안전기준을 만족하는 기체 또는 배터리가 없습니다.",
      "error"
    );
    return;
  }
  mission.droneId = drone.id;
  mission.batteryId = battery.id;
  mission.pilot = mission.pilot === "미배정" ? "김도윤" : mission.pilot;
  drone.batteryId = battery.id;
  battery.droneId = drone.id;
  mission.history.push({
    event: `자원 자동배정 · ${drone.id} / ${battery.id}`,
    at: nowIso(),
    actor: state.session.operatorName
  });
  audit("AUTO_ASSIGN", "MISSION", missionId, `${drone.id} · ${battery.id}`);
  persist();
  renderApp();
  toast("자원 자동배정 완료", `${drone.name}과 ${battery.id}를 배정했습니다.`, "success");
}

function createCommandLog(mission, command, status = "APPLIED") {
  const requestedAt = nowIso();
  const actor = state.session.role === "pilot" ? "김도윤" : state.session.operatorName;
  const log = {
    id: uid("CMD"),
    missionId: mission.id,
    droneId: mission.droneId,
    command,
    requestedBy: actor,
    requestedAt,
    sentAt: requestedAt,
    acknowledgedAt: new Date(Date.now() + 180).toISOString(),
    appliedAt: new Date(Date.now() + 420).toISOString(),
    status,
    result:
      state.settings.mode === "simulation"
        ? "SIMULATION_ACCEPTED"
        : "MAV_RESULT_ACCEPTED"
  };
  recordLog("commandLogs", log);
  audit("COMMAND", "MISSION", mission.id, `${command} · ${log.result}`, actor);
  return log;
}

function missionAction(missionId, action) {
  const mission = missionById(missionId);
  if (!mission) return;
  const actor = state.session.role === "pilot" ? "김도윤" : state.session.operatorName;
  if (
    ["RTH", "CANCEL"].includes(action) &&
    !confirm(
      `${action === "RTH" ? "긴급 복귀" : "임무 취소"}를 실행하시겠습니까?\n사용자와 실행시각이 기록됩니다.`
    )
  )
    return;

  if (action === "APPROVE") {
    mission.status = "READY";
    mission.approvedAt = nowIso();
    mission.history.push({ event: "운항 승인", at: mission.approvedAt, actor });
    createCommandLog(mission, "APPROVE");
  }

  if (action === "CANCEL") {
    mission.status = "CANCELLED";
    mission.history.push({ event: "임무 취소", at: nowIso(), actor });
    createCommandLog(mission, "CANCEL");
  }

  if (action === "START") {
    if (!mission.droneId || !mission.batteryId) {
      toast("이륙 차단", "기체와 배터리를 먼저 배정하세요.", "error");
      return;
    }
    if (!Object.values(mission.checks).every(Boolean)) {
      toast("이륙 차단", "7개 비행 전 점검을 모두 완료하세요.", "error");
      return;
    }
    const drone = droneById(mission.droneId);
    const battery = batteryById(mission.batteryId);
    if (
      !drone?.airworthy ||
      !battery ||
      battery.status === "QUARANTINE" ||
      battery.soc < 40
    ) {
      toast(
        "이륙 차단",
        "기체 또는 배터리가 임무 투입 기준을 충족하지 않습니다.",
        "error"
      );
      return;
    }
    mission.status = "IN_FLIGHT";
    mission.departedAt = nowIso();
    mission.history.push({ event: "이륙·임무 시작", at: mission.departedAt, actor });
    drone.status = "IN_FLIGHT";
    drone.missionId = mission.id;
    drone.armed = true;
    drone.flightMode = "MISSION";
    drone.payloadKg = mission.payloadKg;
    battery.status = "IN_USE";
    createCommandLog(mission, "START");
  }

  if (action === "HOLD") {
    mission.status = "HOLDING";
    mission.history.push({ event: "일시대기", at: nowIso(), actor });
    const drone = droneById(mission.droneId);
    if (drone) {
      drone.status = "HOLDING";
      drone.flightMode = "HOLD";
      drone.groundSpeedKmh = 0;
    }
    createCommandLog(mission, "HOLD");
  }

  if (action === "RESUME") {
    mission.status = "IN_FLIGHT";
    mission.history.push({ event: "운항 재개", at: nowIso(), actor });
    const drone = droneById(mission.droneId);
    if (drone) {
      drone.status = "IN_FLIGHT";
      drone.flightMode = "MISSION";
    }
    createCommandLog(mission, "RESUME");
  }

  if (action === "RTH") {
    mission.status = "RETURNING";
    mission.returnProgress = 0;
    mission.history.push({ event: "긴급 복귀 명령", at: nowIso(), actor });
    const drone = droneById(mission.droneId);
    if (drone) {
      drone.status = "RETURNING";
      drone.flightMode = "RTL";
      drone.payloadKg = 0;
    }
    createCommandLog(mission, "RTH");
  }

  if (action === "COMPLETE") {
    mission.status = "COMPLETED";
    mission.progress = 100;
    mission.completedAt = nowIso();
    mission.onTime = new Date(mission.completedAt) <= new Date(mission.etaAt);
    mission.history.push({ event: "착륙·임무 종료", at: mission.completedAt, actor });
    const drone = droneById(mission.droneId);
    const battery = batteryById(mission.batteryId);
    const origin = locationById(mission.originId);
    const destination = locationById(mission.destinationId);
    if (drone) {
      drone.status = "READY";
      drone.missionId = null;
      drone.armed = false;
      drone.flightMode = "STANDBY";
      drone.altitudeM = 0;
      drone.groundSpeedKmh = 0;
      drone.payloadKg = 0;
      drone.lat = origin.lat;
      drone.lng = origin.lng;
    }
    if (battery) {
      battery.status = battery.soc >= 40 ? "READY" : "CHARGING";
      battery.droneId = drone?.id || null;
    }
    if (!state.proofs.some(item => item.missionId === mission.id)) {
      const proof = {
        id: uid("PRF"),
        missionId: mission.id,
        orderNo: mission.orderNo,
        recipient: mission.recipient,
        method: "OTP+화물함 개폐",
        otpMatched: true,
        lockerOpenedAt: mission.completedAt,
        deliveredAt: mission.completedAt,
        lat: destination.lat,
        lng: destination.lng,
        photoFileName: `POD_${mission.id}.jpg`,
        signature: "전자 인수확인 완료",
        temperatureMinC: round1(22 + Math.random()),
        temperatureMaxC: round1(24 + Math.random())
      };
      state.proofs.unshift(proof);
      window.DLogisDB?.put("proofs", proof).catch(() => {});
    }
    createCommandLog(mission, "COMPLETE");
  }

  persist();
  renderApp();
  toast(
    "임무 상태 변경",
    `${mission.id} · ${STATUS[mission.status]?.[0] || mission.status}`,
    "success"
  );
}

function acknowledgeAlert(alertId) {
  const alert = state.alerts.find(item => item.id === alertId);
  if (!alert) return;
  alert.acknowledged = true;
  alert.acknowledgedAt = nowIso();
  alert.acknowledgedBy = state.session.operatorName;
  window.DLogisDB?.put("alerts", alert).catch(() => {});
  audit("ALERT_ACK", "ALERT", alertId, alert.title);
  persist();
  renderApp();
  toast(
    "경보 확인 기록 완료",
    `${alert.acknowledgedBy} · ${fmtKST(alert.acknowledgedAt, true)}`,
    "success"
  );
}

function saveSettings() {
  state.settings.mapProvider =
    document.getElementById("setting-map-provider")?.value || state.settings.mapProvider;
  state.settings.kakaoJavaScriptKey =
    document.getElementById("setting-kakao-key")?.value.trim() || "";
  state.settings.telemetryIntervalSec = Number(
    document.getElementById("setting-log-interval")?.value || 5
  );
  audit(
    "SETTINGS_UPDATE",
    "SYSTEM",
    "MAP_AND_LOG",
    `지도 ${state.settings.mapProvider} · 기록주기 ${state.settings.telemetryIntervalSec}초`
  );
  persist();
  renderApp();
  toast(
    "설정 저장 완료",
    state.settings.mapProvider === "kakao"
      ? "카카오맵 무료모드로 다시 연결합니다."
      : "OpenStreetMap을 사용합니다.",
    "success"
  );
}

function simulationLoop() {
  if (state.settings.mode !== "simulation") return;
  const current = Date.now();
  const interval = state.settings.telemetryIntervalSec * 1000;
  if (current - lastSimulationAt < interval) return;
  lastSimulationAt = current;
  let changed = false;

  activeMissions().forEach(mission => {
    const drone = droneById(mission.droneId);
    const battery = batteryById(mission.batteryId);
    const origin = locationById(mission.originId);
    const destination = locationById(mission.destinationId);
    if (!drone || !origin || !destination) return;

    if (["IN_FLIGHT", "DELIVERING"].includes(mission.status)) {
      mission.progress = round1(clamp(mission.progress + 1.2, 0, 97));
      if (mission.progress >= 78) mission.status = "DELIVERING";
      const progress = mission.progress / 100;
      drone.lat = roundCoordinate(origin.lat + (destination.lat - origin.lat) * progress);
      drone.lng = roundCoordinate(origin.lng + (destination.lng - origin.lng) * progress);
      drone.altitudeM = round1(78 + Math.sin(current / 5000) * 7);
      drone.groundSpeedKmh = round1(34 + Math.sin(current / 3000) * 4);
      drone.headingDeg = round1(105 + Math.sin(current / 7000) * 12);
    } else if (mission.status === "RETURNING") {
      mission.returnProgress = round1(clamp((mission.returnProgress || 0) + 1.3, 0, 98));
      const progress = 1 - mission.returnProgress / 100;
      drone.lat = roundCoordinate(origin.lat + (destination.lat - origin.lat) * progress);
      drone.lng = roundCoordinate(origin.lng + (destination.lng - origin.lng) * progress);
      drone.altitudeM = round1(Math.max(18, 74 - mission.returnProgress * 0.45));
      drone.groundSpeedKmh = round1(39 + Math.sin(current / 3500) * 3);
    } else if (mission.status === "HOLDING") {
      drone.groundSpeedKmh = 0;
      drone.altitudeM = round1(drone.altitudeM);
    }

    drone.linkQualityPct = round1(
      clamp(drone.linkQualityPct + (Math.random() - 0.5) * 2, 55, 100)
    );
    drone.satellites = round1(
      clamp(
        drone.satellites +
          (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0),
        12,
        26
      )
    );

    if (battery) {
      battery.soc = round1(clamp(battery.soc - 0.2, 5, 100));
      battery.temperatureC = round1(
        clamp(battery.temperatureC + (Math.random() - 0.35) * 0.15, 25, 49)
      );
      drone.batterySocPct = battery.soc;
      if (battery.soc < 24) {
        addAlert({
          severity: "WARNING",
          category: "BATTERY",
          title: `${drone.name} 배터리 안전여유 감소`,
          message: `현재 SOC ${fmt1(battery.soc, "%")}입니다. 복귀 가능시간을 확인하세요.`,
          missionId: mission.id,
          droneId: drone.id,
          batteryId: battery.id,
          currentValue: battery.soc,
          threshold: 24,
          unit: "%"
        });
      }
    }

    if (drone.linkQualityPct < 65) {
      addAlert({
        severity: "CRITICAL",
        category: "LINK",
        title: `${drone.name} 통신품질 저하`,
        message: `현재 통신품질 ${fmt1(drone.linkQualityPct, "%")}입니다.`,
        missionId: mission.id,
        droneId: drone.id,
        currentValue: drone.linkQualityPct,
        threshold: 65,
        unit: "%"
      });
    }

    createTelemetry(drone, mission);
    changed = true;
  });

  if (changed) {
    persist();
    if (state.session.role) renderApp();
  }
}

async function resetDemoData() {
  if (
    !confirm(
      "현재 브라우저의 모든 임무·로그·설정을 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다."
    )
  )
    return;
  localStorage.removeItem(STORAGE_KEY);
  try {
    await window.DLogisDB?.clearAll();
  } catch (error) {
    console.warn(error);
  }
  state = seedState();
  await window.DLogisDB?.initialize(state);
  persist();
  renderApp();
  toast("초기화 완료", "최초 시연 데이터로 복원했습니다.", "success");
}

function handleClick(event) {
  const target = event.target.closest(
    "button,[data-select-mission],[data-go-missions]"
  );
  if (!target) return;

  if (target.dataset.enterRole) return setRole(target.dataset.enterRole);
  if (target.dataset.exit !== undefined) {
    state.session.role = null;
    persist();
    return renderApp();
  }
  if (target.dataset.roleMenu !== undefined) {
    state.session.role = null;
    persist();
    return renderApp();
  }
  if (target.dataset.sidebarToggle !== undefined) {
    state.ui.sidebarOpen = !state.ui.sidebarOpen;
    persist();
    return renderApp();
  }
  if (target.dataset.view) return setView(target.dataset.view);
  if (target.dataset.newMission !== undefined) return openMissionWizard();
  if (target.dataset.modalClose !== undefined) return closeModal();
  if (target.dataset.wizardNext !== undefined) {
    if (!validateWizardStep(UIState.wizardStep)) return;
    return updateWizard(Math.min(4, UIState.wizardStep + 1));
  }
  if (target.dataset.wizardPrev !== undefined)
    return updateWizard(Math.max(1, UIState.wizardStep - 1));
  if (target.dataset.selectMission) {
    state.ui.selectedMissionId = target.dataset.selectMission;
    if (target.dataset.goMissions !== undefined) {
      state.session.role = "admin";
      state.ui.view = "missions";
    }
    persist();
    return renderApp();
  }
  if (target.dataset.toggleCheck)
    return toggleCheck(target.dataset.toggleCheck, target.dataset.checkKey);
  if (target.dataset.checkAll) return completeAllChecks(target.dataset.checkAll);
  if (target.dataset.autoAssign) return autoAssign(target.dataset.autoAssign);
  if (target.dataset.missionAction)
    return missionAction(target.dataset.missionId, target.dataset.missionAction);
  if (target.dataset.ackAlert) return acknowledgeAlert(target.dataset.ackAlert);
  if (target.dataset.ackAll !== undefined) {
    const at = nowIso();
    state.alerts
      .filter(alert => !alert.acknowledged)
      .forEach(alert => {
        alert.acknowledged = true;
        alert.acknowledgedAt = at;
        alert.acknowledgedBy = state.session.operatorName;
        window.DLogisDB?.put("alerts", alert).catch(() => {});
      });
    audit("ALERT_ACK_ALL", "ALERT", "ALL", "전체 경보 확인");
    persist();
    renderApp();
    return toast(
      "전체 경보 확인 완료",
      "확인자와 시각이 기록되었습니다.",
      "success"
    );
  }
  if (target.dataset.testAlert !== undefined) {
    addAlert({
      severity: "WARNING",
      category: "LINK",
      title: "통신품질 시험경보",
      message: "화면·기록 검증을 위한 시험 경보입니다.",
      droneId: "DR-003",
      currentValue: 62.4,
      threshold: 65,
      unit: "%"
    });
    persist();
    renderApp();
    return toast("시험경보 생성", "안전·경보 센터에 기록했습니다.", "warning");
  }
  if (target.dataset.recordType) {
    state.ui.recordType = target.dataset.recordType;
    persist();
    return renderApp();
  }
  if (target.dataset.exportXlsx !== undefined) return exportOperationalWorkbook();
  if (target.dataset.exportJson !== undefined) return exportJsonBackup();
  if (target.dataset.openKakao !== undefined) return window.DLogisMap?.openInKakao();
  if (target.dataset.saveSettings !== undefined) return saveSettings();
  if (target.dataset.reset !== undefined) return resetDemoData();
  if (target.dataset.copyOtp) {
    navigator.clipboard?.writeText(target.dataset.copyOtp);
    return toast("수령코드 복사 완료", target.dataset.copyOtp, "success");
  }
}

function handleInput(event) {
  if (event.target.id !== "mission-search") return;
  UIState.missionQuery = event.target.value;
  renderApp();
  const input = document.getElementById("mission-search");
  input?.focus();
  input?.setSelectionRange(UIState.missionQuery.length, UIState.missionQuery.length);
}

function handleChange(event) {
  if (event.target.id === "mission-filter") {
    UIState.missionFilter = event.target.value;
    renderApp();
  }
  if (event.target.id === "quick-map-provider") {
    state.settings.mapProvider = event.target.value;
    persist();
    renderApp();
  }
}

function handleSubmit(event) {
  if (event.target.id !== "mission-form") return;
  event.preventDefault();
  createMission(event.target);
}

async function bootstrap() {
  try {
    await window.DLogisDB?.initialize(state);
  } catch (error) {
    console.warn(error);
  }
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
  });
  setInterval(updateLiveClock, 1000);
  setInterval(simulationLoop, 1000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker-v3.js").catch(error =>
      console.warn("서비스워커 등록 실패", error)
    );
  }
  renderApp();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
