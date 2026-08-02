# D-LOGIS 실시간 지도 연결 안내

## 실행 주소

- 실시간 지도 관제 앱: `https://donfsucha.github.io/anty/map.html`

## 기본 동작

처음 접속하면 API 키가 필요 없는 OpenStreetMap이 표시됩니다.

- 드론별 실시간 위치 마커
- 운항 중 임무의 출발지·현재 위치·배송지 항로
- 고도·속도·배터리·통신 상태
- Google 지도에서 열기
- 카카오맵에서 열기

## Kakao Maps 연결

1. 카카오 개발자센터에서 앱을 생성합니다.
2. 플랫폼 설정에서 Web 플랫폼을 추가합니다.
3. 사이트 도메인에 `https://donfsucha.github.io`를 등록합니다.
4. 플랫폼 키의 JavaScript Key를 복사합니다.
5. D-LOGIS 지도 화면에서 `API 설정`을 누릅니다.
6. Kakao JavaScript Key를 입력하고 기본 지도를 Kakao Maps로 선택합니다.

## Google Maps 연결

1. Google Cloud에서 Maps JavaScript API를 활성화합니다.
2. 웹용 API 키를 생성합니다.
3. 애플리케이션 제한을 HTTP 리퍼러로 설정합니다.
4. 허용 주소에 `https://donfsucha.github.io/anty/*`를 등록합니다.
5. D-LOGIS 지도 화면의 `API 설정`에서 키를 입력합니다.
6. 기본 지도를 Google Maps로 선택합니다.

## 보안

API 키는 앱 서버나 GitHub 저장소에 기록하지 않고 사용자의 브라우저 로컬 저장소에만 저장됩니다. 실제 운영용 키에는 반드시 도메인 제한과 API 제한을 적용해야 합니다.
