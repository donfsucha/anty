"use strict";

async function ensureXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    script.onload = () =>
      window.XLSX
        ? resolve(window.XLSX)
        : reject(new Error("Excel 모듈 초기화 실패"));
    script.onerror = () => reject(new Error("Excel 모듈 다운로드 실패"));
    document.head.appendChild(script);
  });
}

function excelKstDate(value) {
  if (!value) return null;
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(source)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

function createWorksheet(XLSX, rows, widths = []) {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    skipHeader: false,
    cellDates: true,
    dateNF: "yyyy-mm-dd hh:mm:ss"
  });
  worksheet["!cols"] = widths.map(width => ({ wch: width }));
  if (worksheet["!ref"]) {
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: 0, c: range.e.c }
      })
    };
  }
  return worksheet;
}

function applyColumnFormats(XLSX, worksheet, headers, formatMap) {
  if (!worksheet["!ref"] || !headers.length) return;
  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  headers.forEach((header, columnIndex) => {
    const format = formatMap[header];
    if (!format) return;
    for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (worksheet[address]) worksheet[address].z = format;
    }
  });
}

function mergeLogSets(primary = [], secondary = []) {
  const map = new Map();
  [...primary, ...secondary].forEach(item => item?.id && map.set(item.id, item));
  return [...map.values()];
}

async function collectReportData() {
  let databaseLogs = {};
  try {
    databaseLogs = await window.DLogisDB.getOperationalLogs();
  } catch (error) {
    console.warn("IndexedDB 로그 조회 실패, 현재 화면 데이터로 보고서를 생성합니다.", error);
  }
  return {
    telemetryLogs: mergeLogSets(databaseLogs.telemetryLogs, state.telemetryLogs),
    commandLogs: mergeLogSets(databaseLogs.commandLogs, state.commandLogs),
    checklistLogs: mergeLogSets(databaseLogs.checklistLogs, state.checklistLogs),
    batteryLogs: mergeLogSets(databaseLogs.batteryLogs, state.batteryLogs),
    alerts: mergeLogSets(databaseLogs.alerts, state.alerts),
    proofs: mergeLogSets(databaseLogs.proofs, state.proofs),
    auditLogs: mergeLogSets(databaseLogs.auditLogs, state.auditLogs)
  };
}

function sortByTime(items, fields) {
  return [...items].sort((a, b) => {
    const aValue = fields.map(field => a[field]).find(Boolean) || 0;
    const bValue = fields.map(field => b[field]).find(Boolean) || 0;
    return new Date(aValue) - new Date(bValue);
  });
}

async function exportOperationalWorkbook() {
  try {
    toast("운영보고서 생성 중", "현재 수치와 전체 운영기록을 정리하고 있습니다.");
    const XLSX = await ensureXLSX();
    const logs = await collectReportData();
    const workbook = XLSX.utils.book_new();
    const generatedAt = nowIso();
    const completed = state.missions.filter(item => item.status === "COMPLETED");

    workbook.Props = {
      Title: "D-LOGIS 드론배송 운영보고서",
      Subject: "임무·비행·명령·경보·배터리·증빙 통합기록",
      Author: state.meta.centerName,
      Company: "D-LOGIS",
      CreatedDate: new Date()
    };

    const summaryRows = [
      { 항목: "보고서 생성시각", 값: excelKstDate(generatedAt), 단위: "KST", 설명: "브라우저에서 XLSX를 생성한 시각" },
      { 항목: "운영센터", 값: state.meta.centerName, 단위: "", 설명: "관제 기준 센터" },
      { 항목: "시간대", 값: TIME_ZONE, 단위: "KST", 설명: "화면과 보고서의 표시 시각 기준" },
      { 항목: "좌표계", 값: state.meta.coordinateSystem, 단위: "", 설명: "드론 위치 원본 좌표 기준" },
      { 항목: "전체 임무", 값: round1(state.missions.length), 단위: "건", 설명: "현재 저장된 전체 임무" },
      { 항목: "진행 중 임무", 값: round1(activeMissions().length), 단위: "건", 설명: "비행·대기·배송·복귀 중" },
      { 항목: "완료 임무", 값: round1(completed.length), 단위: "건", 설명: "배송 완료 기록" },
      { 항목: "정시 배송률", 값: onTimeRate(), 단위: "%", 설명: "완료 임무 중 정시 완료 비율" },
      { 항목: "미확인 경보", 값: round1(state.alerts.filter(item => !item.acknowledged).length), 단위: "건", 설명: "운영자가 확인하지 않은 경보" },
      { 항목: "비행로그", 값: round1(logs.telemetryLogs.length), 단위: "건", 설명: "위치·고도·속도·배터리·통신 기록" },
      { 항목: "명령이력", 값: round1(logs.commandLogs.length), 단위: "건", 설명: "승인·이륙·대기·복귀·완료 명령" },
      { 항목: "최종 데이터 수신", 값: excelKstDate(state.meta.lastDataAt), 단위: "KST", 설명: "가장 최근 텔레메트리 수신시각" },
      { 항목: "데이터 신선도", 값: dataFreshnessSeconds(), 단위: "초", 설명: "현재시각과 최종 수신시각의 차이" }
    ];

    const missionRows = state.missions.map(mission => {
      const origin = locationById(mission.originId);
      const destination = locationById(mission.destinationId);
      return {
        "Mission ID": mission.id,
        주문번호: mission.orderNo,
        임무명: mission.title,
        상태: STATUS[mission.status]?.[0] || mission.status,
        우선순위: mission.priority,
        출발지: origin?.name || "",
        도착지: destination?.name || "",
        "거리(km)": round1(mission.distanceKm),
        화물: mission.cargo,
        "중량(kg)": round1(mission.payloadKg),
        기체: mission.droneId || "",
        배터리: mission.batteryId || "",
        조종자: mission.pilot,
        수령인: mission.recipient,
        "진행률(%)": round1(mission.progress),
        생성시각: excelKstDate(mission.createdAt),
        승인시각: excelKstDate(mission.approvedAt),
        출발시각: excelKstDate(mission.departedAt),
        예정도착시각: excelKstDate(mission.etaAt),
        완료시각: excelKstDate(mission.completedAt),
        정시여부:
          mission.onTime === null ? "" : mission.onTime ? "정시" : "지연"
      };
    });

    const telemetryRows = sortByTime(logs.telemetryLogs, ["receivedAt"]).map(item => ({
      기록ID: item.id,
      "Mission ID": item.missionId || "",
      기체ID: item.droneId,
      배터리ID: item.batteryId || "",
      데이터출처: item.source || "UNKNOWN",
      드론전송시각: excelKstDate(item.sentAt),
      서버수신시각: excelKstDate(item.receivedAt),
      "수신지연(ms)": round1(item.dataDelayMs),
      "위도(WGS84)": roundCoordinate(item.lat),
      "경도(WGS84)": roundCoordinate(item.lng),
      위도DMS: coordinateDMS(item.lat, true),
      경도DMS: coordinateDMS(item.lng, false),
      "고도(m)": round1(item.altitudeM),
      "지상속도(km/h)": round1(item.groundSpeedKmh),
      "방위(°)": round1(item.headingDeg),
      "배터리SOC(%)": round1(item.batterySocPct),
      "배터리온도(℃)": round1(item.batteryTempC),
      "통신품질(%)": round1(item.linkQualityPct),
      GNSS위성수: round1(item.satellites),
      비행모드: item.flightMode,
      Armed: item.armed ? "Y" : "N"
    }));

    const commandRows = sortByTime(logs.commandLogs, ["requestedAt"]).map(item => ({
      명령ID: item.id,
      "Mission ID": item.missionId || "",
      기체ID: item.droneId || "",
      명령: item.command,
      상태: item.status,
      결과: item.result || "",
      요청자: item.requestedBy,
      요청시각: excelKstDate(item.requestedAt),
      전송시각: excelKstDate(item.sentAt),
      ACK수신시각: excelKstDate(item.acknowledgedAt),
      적용확인시각: excelKstDate(item.appliedAt),
      "요청→적용(ms)":
        item.appliedAt && item.requestedAt
          ? round1(new Date(item.appliedAt) - new Date(item.requestedAt))
          : ""
    }));

    const alertRows = sortByTime(logs.alerts, ["createdAt"]).map(item => ({
      경보ID: item.id,
      등급: item.severity,
      분류: item.category,
      제목: item.title,
      내용: item.message,
      "Mission ID": item.missionId || "",
      기체ID: item.droneId || "",
      배터리ID: item.batteryId || "",
      현재값: item.currentValue === null ? "" : round1(item.currentValue),
      기준값: item.threshold === null ? "" : round1(item.threshold),
      단위: item.unit || "",
      발생시각: excelKstDate(item.createdAt),
      확인여부: item.acknowledged ? "Y" : "N",
      확인자: item.acknowledgedBy || "",
      확인시각: excelKstDate(item.acknowledgedAt)
    }));

    const batteryRows = sortByTime(logs.batteryLogs, ["recordedAt"]).map(item => ({
      기록ID: item.id,
      기록시각: excelKstDate(item.recordedAt),
      "Mission ID": item.missionId || "",
      기체ID: item.droneId || "",
      배터리ID: item.batteryId,
      데이터출처: item.source || "UNKNOWN",
      "SOC(%)": round1(item.soc),
      "SOH(%)": round1(item.soh),
      "온도(℃)": round1(item.temperatureC),
      "셀편차(mV)": round1(item.cellDeltaMv),
      "사이클(회)": round1(item.cycles),
      상태: item.status
    }));

    const proofRows = sortByTime(logs.proofs, ["deliveredAt"]).map(item => ({
      증빙ID: item.id,
      "Mission ID": item.missionId,
      주문번호: item.orderNo,
      수령인: item.recipient,
      인증방식: item.method,
      OTP일치: item.otpMatched ? "Y" : "N",
      화물함개방시각: excelKstDate(item.lockerOpenedAt),
      전달완료시각: excelKstDate(item.deliveredAt),
      "위도(WGS84)": roundCoordinate(item.lat),
      "경도(WGS84)": roundCoordinate(item.lng),
      위도DMS: coordinateDMS(item.lat, true),
      경도DMS: coordinateDMS(item.lng, false),
      사진파일: item.photoFileName || "",
      전자서명: item.signature || "",
      "최저온도(℃)": round1(item.temperatureMinC),
      "최고온도(℃)": round1(item.temperatureMaxC)
    }));

    const checklistRows = sortByTime(logs.checklistLogs, ["checkedAt"]).map(item => ({
      점검ID: item.id,
      "Mission ID": item.missionId,
      항목코드: item.itemKey,
      점검항목: item.itemName,
      통과여부: item.passed ? "Y" : "N",
      점검자: item.checkedBy,
      점검시각: excelKstDate(item.checkedAt),
      비고: item.note || ""
    }));

    const auditRows = sortByTime(logs.auditLogs, ["occurredAt"]).map(item => ({
      감사ID: item.id,
      발생시각: excelKstDate(item.occurredAt),
      사용자: item.actor,
      행동: item.action,
      대상유형: item.targetType,
      대상ID: item.targetId,
      상세내용: item.detail
    }));

    const sheets = [
      ["01_운영요약", summaryRows, [26, 26, 10, 50]],
      ["02_임무목록", missionRows, [20, 18, 28, 12, 10, 22, 22, 12, 22, 11, 12, 12, 12, 15, 12, 21, 21, 21, 21, 21, 10]],
      ["03_비행로그", telemetryRows, [20, 20, 12, 12, 13, 21, 21, 13, 16, 16, 18, 18, 11, 16, 11, 16, 16, 13, 12, 13, 9]],
      ["04_명령이력", commandRows, [20, 20, 12, 13, 12, 24, 12, 21, 21, 21, 21, 16]],
      ["05_경보이력", alertRows, [20, 11, 13, 28, 48, 20, 12, 12, 11, 11, 9, 21, 10, 12, 21]],
      ["06_배터리기록", batteryRows, [20, 21, 20, 12, 12, 13, 10, 10, 10, 12, 12, 12]],
      ["07_배송증빙", proofRows, [20, 20, 18, 15, 20, 10, 21, 21, 16, 16, 18, 18, 25, 22, 13, 13]],
      ["08_비행전점검", checklistRows, [20, 20, 13, 24, 10, 12, 21, 30]],
      ["09_감사로그", auditRows, [20, 21, 14, 18, 13, 20, 50]]
    ];

    const numberFormats = {
      값: "0.0",
      "거리(km)": "0.0",
      "중량(kg)": "0.0",
      "진행률(%)": "0.0",
      "수신지연(ms)": "0.0",
      "위도(WGS84)": "0.000000",
      "경도(WGS84)": "0.000000",
      "고도(m)": "0.0",
      "지상속도(km/h)": "0.0",
      "방위(°)": "0.0",
      "배터리SOC(%)": "0.0",
      "배터리온도(℃)": "0.0",
      "통신품질(%)": "0.0",
      GNSS위성수: "0.0",
      현재값: "0.0",
      기준값: "0.0",
      "SOC(%)": "0.0",
      "SOH(%)": "0.0",
      "온도(℃)": "0.0",
      "셀편차(mV)": "0.0",
      "사이클(회)": "0.0",
      "최저온도(℃)": "0.0",
      "최고온도(℃)": "0.0",
      "요청→적용(ms)": "0.0"
    };

    const dateHeaders = new Set([
      "보고서 생성시각",
      "최종 데이터 수신",
      "생성시각",
      "승인시각",
      "출발시각",
      "예정도착시각",
      "완료시각",
      "드론전송시각",
      "서버수신시각",
      "요청시각",
      "전송시각",
      "ACK수신시각",
      "적용확인시각",
      "발생시각",
      "확인시각",
      "기록시각",
      "화물함개방시각",
      "전달완료시각",
      "점검시각"
    ]);

    sheets.forEach(([name, rows, widths]) => {
      const worksheet = createWorksheet(XLSX, rows, widths);
      const headers = Object.keys(rows[0] || {});
      applyColumnFormats(XLSX, worksheet, headers, numberFormats);
      headers.forEach((header, columnIndex) => {
        if (!dateHeaders.has(header) || !worksheet["!ref"]) return;
        const range = XLSX.utils.decode_range(worksheet["!ref"]);
        for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
          const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
          if (worksheet[address]) worksheet[address].z = "yyyy-mm-dd hh:mm:ss";
        }
      });
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    });

    const dateToken = new Intl.DateTimeFormat("sv-SE", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .format(new Date())
      .replaceAll("-", "");
    const timeToken = fmtTime(generatedAt, true).replaceAll(":", "");
    const fileName = `DLOGIS_운영보고서_${dateToken}_${timeToken}.xlsx`;
    XLSX.writeFile(workbook, fileName, {
      compression: true,
      cellDates: true,
      bookSST: true
    });
    toast(
      "운영보고서 저장 완료",
      `${sheets.length}개 시트에 현재 수치·시각·사용자·조치 결과를 저장했습니다.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    toast("Excel 생성 실패", error.message, "error");
  }
}

function exportJsonBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `DLOGIS_backup_${Date.now()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
  toast("JSON 백업 완료", "브라우저 운영데이터 전체를 저장했습니다.", "success");
}
