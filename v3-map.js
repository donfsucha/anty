"use strict";

window.DLogisMap = (() => {
  let map = null;
  let provider = null;
  let kakaoLoader = null;
  let leafletLoader = null;

  function destroy() {
    try {
      if (provider === "leaflet" && map) map.remove();
    } catch (error) {
      console.warn(error);
    }
    map = null;
    provider = null;
  }

  function addStyle(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletLoader) return leafletLoader;
    addStyle("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "leaflet-v3-css");
    leafletLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error("OpenStreetMap 지도 모듈을 불러오지 못했습니다."));
      document.head.appendChild(script);
    });
    return leafletLoader;
  }

  function loadKakao(key) {
    if (window.kakao?.maps) {
      return new Promise(resolve => window.kakao.maps.load(resolve));
    }
    if (kakaoLoader) return kakaoLoader;
    kakaoLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
        key
      )}&autoload=false`;
      script.onload = () => {
        if (!window.kakao?.maps) {
          reject(new Error("카카오맵 SDK 초기화에 실패했습니다."));
          return;
        }
        window.kakao.maps.load(resolve);
      };
      script.onerror = () => reject(new Error("카카오맵 SDK를 불러오지 못했습니다."));
      document.head.appendChild(script);
    });
    return kakaoLoader;
  }

  function mapContext() {
    const mission =
      missionById(state.ui.selectedMissionId) || activeMissions()[0] || state.missions[0];
    const origin = locationById(mission?.originId);
    const destination = locationById(mission?.destinationId);
    const drones = state.drones.filter(item =>
      ["IN_FLIGHT", "HOLDING", "RETURNING"].includes(item.status)
    );
    return { mission, origin, destination, drones };
  }

  function markerHtml(drone) {
    const className =
      drone.status === "RETURNING"
        ? "returning"
        : drone.linkQualityPct < 70
          ? "warning"
          : "";
    return `<div class="drone-pin ${className}" title="${escapeHtml(
      drone.name
    )}"><span>✥</span><small>${drone.id.replace("DR-", "D")}</small></div>`;
  }

  async function render(containerId = "ops-map") {
    const element = document.getElementById(containerId);
    if (!element) return;
    destroy();
    const context = mapContext();

    if (
      state.settings.mapProvider === "kakao" &&
      state.settings.kakaoJavaScriptKey
    ) {
      try {
        await loadKakao(state.settings.kakaoJavaScriptKey);
        renderKakao(element, context);
        setMapStatus("Kakao Maps", "카카오맵 무료 쿼터 모드");
        return;
      } catch (error) {
        console.warn(error);
        toast(
          "카카오맵 연결 실패",
          "API 키·등록 도메인을 확인해 주세요. 무료 OpenStreetMap으로 전환했습니다.",
          "warning"
        );
      }
    }

    try {
      await loadLeaflet();
      renderLeaflet(element, context);
      setMapStatus("OpenStreetMap", "무료 대체 지도");
    } catch (error) {
      console.warn(error);
      renderFallback(element, context);
      setMapStatus("내장 경로도", "외부 지도 연결 없음");
    }
  }

  function setMapStatus(name, detail) {
    const element = document.getElementById("map-provider-status");
    if (element) element.textContent = `${name} · ${detail}`;
  }

  function renderKakao(element, { origin, destination, drones }) {
    provider = "kakao";
    const center = new kakao.maps.LatLng(
      origin?.lat || 37.50342,
      origin?.lng || 126.76608
    );
    map = new kakao.maps.Map(element, { center, level: 6 });
    const bounds = new kakao.maps.LatLngBounds();

    if (origin && destination) {
      const route = [
        new kakao.maps.LatLng(origin.lat, origin.lng),
        new kakao.maps.LatLng(destination.lat, destination.lng)
      ];
      new kakao.maps.Polyline({
        map,
        path: route,
        strokeWeight: 5,
        strokeColor: "#2874e8",
        strokeOpacity: 0.9,
        strokeStyle: "solid"
      });
      [
        { location: origin, label: "출발", color: "#155bcc" },
        { location: destination, label: "도착", color: "#0d946c" }
      ].forEach(item => {
        const position = new kakao.maps.LatLng(item.location.lat, item.location.lng);
        bounds.extend(position);
        new kakao.maps.CustomOverlay({
          map,
          position,
          yAnchor: 1.55,
          content: `<div class="map-place-label" style="--place-color:${item.color}">${item.label} · ${escapeHtml(
            item.location.name
          )}</div>`
        });
      });
    }

    drones.forEach(drone => {
      const position = new kakao.maps.LatLng(drone.lat, drone.lng);
      bounds.extend(position);
      new kakao.maps.CustomOverlay({
        map,
        position,
        content: markerHtml(drone),
        xAnchor: 0.5,
        yAnchor: 0.5
      });
    });

    if (!bounds.isEmpty()) map.setBounds(bounds, 60, 60, 60, 60);
  }

  function renderLeaflet(element, { origin, destination, drones }) {
    provider = "leaflet";
    map = L.map(element, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    const points = [];
    if (origin && destination) {
      const route = [
        [origin.lat, origin.lng],
        [destination.lat, destination.lng]
      ];
      L.polyline(route, { color: "#2874e8", weight: 5, opacity: 0.9 }).addTo(map);
      L.circleMarker(route[0], {
        radius: 9,
        color: "#155bcc",
        weight: 3,
        fillColor: "#ffffff",
        fillOpacity: 1
      })
        .addTo(map)
        .bindTooltip(`출발 · ${origin.name}`, { permanent: true, direction: "top" });
      L.circleMarker(route[1], {
        radius: 9,
        color: "#0d946c",
        weight: 3,
        fillColor: "#ffffff",
        fillOpacity: 1
      })
        .addTo(map)
        .bindTooltip(`도착 · ${destination.name}`, {
          permanent: true,
          direction: "top"
        });
      points.push(...route);
    }

    drones.forEach(drone => {
      const icon = L.divIcon({
        className: "dlogis-leaflet-icon",
        html: markerHtml(drone),
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });
      L.marker([drone.lat, drone.lng], { icon })
        .addTo(map)
        .bindPopup(
          `<strong>${escapeHtml(drone.name)}</strong><br>` +
            `고도 ${fmt1(drone.altitudeM, " m")}<br>` +
            `배터리 ${fmt1(batteryById(drone.batteryId)?.soc, "%")}<br>` +
            `통신 ${fmt1(drone.linkQualityPct, "%")}`
        );
      points.push([drone.lat, drone.lng]);
    });

    if (points.length) {
      map.fitBounds(points, { padding: [45, 45], maxZoom: 14 });
    } else {
      map.setView([37.50342, 126.76608], 13);
    }
  }

  function renderFallback(element, { origin, destination, drones }) {
    provider = "fallback";
    const all = [origin, destination, ...drones].filter(Boolean);
    const minLat = Math.min(...all.map(item => item.lat)) - 0.004;
    const maxLat = Math.max(...all.map(item => item.lat)) + 0.004;
    const minLng = Math.min(...all.map(item => item.lng)) - 0.004;
    const maxLng = Math.max(...all.map(item => item.lng)) + 0.004;
    const point = item => ({
      x: 70 + ((item.lng - minLng) / (maxLng - minLng)) * 760,
      y: 370 - ((item.lat - minLat) / (maxLat - minLat)) * 300
    });
    const start = origin ? point(origin) : { x: 100, y: 300 };
    const end = destination ? point(destination) : { x: 800, y: 100 };

    element.innerHTML = `<svg class="fallback-map" viewBox="0 0 900 430" role="img" aria-label="운항 경로 대체 지도">
      <defs><pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#cbd9e8" stroke-width="1"/></pattern></defs>
      <rect width="900" height="430" fill="url(#map-grid)"/>
      <path d="M20 350C190 290 240 150 410 160S690 270 880 70" fill="none" stroke="#ffffff" stroke-width="22"/>
      <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#2874e8" stroke-width="6" stroke-linecap="round"/>
      <circle cx="${start.x}" cy="${start.y}" r="12" fill="#fff" stroke="#155bcc" stroke-width="5"/>
      <circle cx="${end.x}" cy="${end.y}" r="12" fill="#fff" stroke="#0d946c" stroke-width="5"/>
      ${drones
        .map(drone => {
          const current = point(drone);
          return `<g transform="translate(${current.x} ${current.y})"><circle r="20" fill="#2874e8" stroke="#fff" stroke-width="4"/><text x="0" y="5" text-anchor="middle" fill="#fff" font-size="16">✥</text><text x="0" y="35" text-anchor="middle" fill="#344054" font-size="12">${drone.id}</text></g>`;
        })
        .join("")}
    </svg>`;
  }

  function openInKakao() {
    const { mission, destination, drones } = mapContext();
    const drone = drones.find(item => item.id === mission?.droneId) || drones[0];
    const target = drone || destination;
    if (!target) return;
    const name = encodeURIComponent(drone?.name || destination?.name || "드론 위치");
    window.open(
      `https://map.kakao.com/link/map/${name},${target.lat},${target.lng}`,
      "_blank",
      "noopener"
    );
  }

  return { render, destroy, openInKakao };
})();
