# 멈춤지기 — 고속도로 멈춤 대피 안내

고속도로에서 고장이나 사고로 차가 멈춘 순간, 차가 먼저 "모두 가드레일 밖으로 나가세요"라고 말하고
좌석과 문을 읽어 **탑승자 전원이 내렸는지** 확인한 뒤, 위치가 들어간 **신고 문장**을 만들어 견인 요청까지 이어 주는
Pleos Connect 차량용 앱입니다.

현대자동차그룹 Pleos 차량용 앱 개발 공모전 제출물입니다.

- APK: [`apk/거북이정신_멈춤지기_release.apk`](apk/거북이정신_멈춤지기_release.apk)
- 패키지: `io.github.stoporder.meomchumjigi` · minSdk 28 · targetSdk 34 · 가로 화면

## 지금 되는 것과 아직 안 된 것

숨기지 않고 적습니다.

| 항목 | 상태 |
|---|---|
| 멈춤 알아채기 · 남은 좌석 짚기 · 전원 하차 판정 · 신고 문장 · 기록 | 동작. 신호 값에서 실제로 계산합니다 (`app/src/main/assets/web/app.js`) |
| 음성 안내 | 동작. 안드로이드 기본 TextToSpeech 로 읽습니다. Pleos TextToSpeech SDK 로 바꿀 예정 |
| 시연 신호 (`DemoSignalSource`) | 동작. Pleos 차량 서비스가 없는 기기에서는 정해진 각본으로 신호를 흘립니다. 일반 안드로이드 에뮬레이터(API 34)에서 각본이 전원 하차 판정까지 진행되는 것을 동작 기록(logcat)으로 확인했습니다. 화면 모양은 같은 페이지를 브라우저에서 확인했습니다 |
| 실차 신호 (`PleosSignalSource`) | Pleos Vehicle SDK 2.3.2 에 맞춰 **컴파일까지만** 확인. Pleos Connect 에뮬레이터·실차에서의 동작은 아직 확인하지 못했습니다 |
| 고속도로 위인지 판단 (NaviHelper SDK) | 아직 없음. 실차 신호 모드에서는 항상 고속도로 위라고 가정합니다 |
| 위치 → 도로명·방향·지점 | 아직 없음. 화면의 위치는 예시 문구입니다 |
| 휴대폰으로 신고 문장 전송, 긴급견인 바로 걸기 | 아직 없음. 화면 표시만 있습니다 |
| 견인 자동 접수 | 아직 없음. 접수 창구를 여는 제휴가 전제이고, 그 전에는 모의 접수 서버로 구현할 계획입니다 |

## 구조

```
app/src/main/java/io/github/stoporder/meomchumjigi/
  VehicleSignals.kt      차량 신호 인터페이스 (SignalSink, VehicleSignalSource)
  PleosSignalSource.kt   실차 신호 — Pleos Vehicle SDK + 표준 AAOS Car API(속도)
  DemoSignalSource.kt    시연 신호 — 정해진 각본
  MainActivity.kt        WebView 화면 + 신호 다리 + 음성 안내
app/src/main/assets/web/
  index.html styles.css  화면 (좌석 배치도 · 음성 안내 · 앱이 켠 등 · 신고 문장 · 기록)
  app.js                 판정 로직과 window.VehicleBridge (신호를 받는 입구)
  data.js                예시 문구 (도로·지점·시각)
```

앱을 켜면 `ai.pleos.playground.vehicle.VEHICLE_START` 서비스가 기기에 있는지 보고,
있으면 `PleosSignalSource`, 없으면 `DemoSignalSource` 를 씁니다. 화면과 판정 로직은 두 경우에 같습니다.

## 쓰는 SDK

| 기능 | SDK / API |
|---|---|
| 좌석 점유 | Vehicle SDK `Seat.getCurrentSeatOccupancy`, `registerSeatOccupancy` |
| 도어 | Vehicle SDK `Door.getCurrentDoorPosition`, `registerDoorPosition` |
| 경고등 · 출력 제한 경고 | Vehicle SDK `Safety.getTelltalesInfo`, `registerTelltales`, `registerPowerDownWarningIndicator` |
| 에어백 전개 | Vehicle SDK `Safety.registerSeatAirbagDeployed` |
| 미등 · 후방 안개등 · 실내등 | Vehicle SDK `Light.setTailLampLightSwitch`, `setRearFogLightSwitch`, `setCabinLightSwitch` |
| 속도 (정차 판단) | 표준 AAOS Car API `PERF_VEHICLE_SPEED` — Pleos Vehicle SDK 에 없는 항목 |

비상등은 SDK 에 켜는 기능이 없어 앱이 켜지 않습니다. 음성으로 켜라고 안내합니다.
119 에는 어느 단계에서도 자동으로 신고하지 않습니다.

## 실행

Pleos 차량 서비스가 없는 기기에서는 첫 화면에서 **시연 보기** → 아래 띠의 **▶ 시연 재생**을 누르면
주행 → 경고등 → 갓길 정차 → 대피 안내 → 한 명씩 하차 → 전원 하차 판정 → 신고 문장 순서로 약 1분간 진행됩니다.
끝나면 **안내 종료**를 눌러 기록 화면을 볼 수 있습니다.

`app/src/main/assets/web/index.html` 을 브라우저로 열면 화면만 따로 볼 수 있습니다.

## 빌드

JDK 17 과 안드로이드 SDK(플랫폼 34, 빌드 도구 34)가 필요합니다.

```
./gradlew assembleRelease
```

release 서명 키는 저장소에 없습니다. 루트에 `keystore.properties`(storeFile · storePassword · keyAlias · keyPassword)를 두면
그 키로 서명하고, 없으면 서명되지 않은 APK 가 나옵니다. 서명 없이 돌려 보려면 `./gradlew assembleDebug` 를 씁니다.
