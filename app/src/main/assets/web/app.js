// 멈춤지기 시연 목업 — 화면 배선과 판정 로직.
// 클래식 script. Math.random / new Date / 네트워크 호출 없음.
// 판정(멈춤 알아채기 · 남은 좌석 짚기 · 전원 하차 판정 · 신고 문장 · 기록)은 신호 값에서 실제로 계산한다.
// 신호 자체는 아래 띠의 보이지 않는 입력으로 넣는 값이다(실제 SDK 호출 없음).

(function () {
  'use strict';

  var D = window.MVP_DATA;
  if (!D) {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:24px;color:#ffb074">data.js 가 로드되지 않았습니다.</p>');
    return;
  }
  function $(id) { return document.getElementById(id); }

  // ---------- 상태 ----------
  var S = {
    mode: 'standby',       // standby | evac | clear | ended
    speed: 0,
    onHighway: false,
    tell: [],              // 켜진 경고등
    doors: { fl: false, fr: false, rl: false, rr: false },
    seats: D.SEATS.map(function (_, i) { return D.START_OCC.indexOf(i) !== -1; }),
    riders: D.START_OCC.length,   // 멈춘 순간의 탑승 인원
    out: [],               // 내린 좌석 번호
    lamps: false,          // 앱이 켠 미등·후방 안개등·실내등
    voice: { text: '', level: 'idle' },
    t: D.T_DRIVE,
    stopAt: null, clearAt: null,
    trigger: '',
    events: [],            // 기록용 시간순
    log: [],
    guideTimer: null,
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(t) { return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t % 3600 / 60)); }
  function hms(t) { return hm(t) + ':' + pad(t % 60); }
  function dur(s) { var m = Math.floor(s / 60); return (m ? m + '분 ' : '') + (s % 60) + '초'; }

  function inCar() {
    var a = [];
    S.seats.forEach(function (o, i) { if (o) a.push(i); });
    return a;
  }
  function openDoors() {
    return Object.keys(S.doors).filter(function (k) { return S.doors[k]; });
  }
  // APK 안에서는 window.Android(코틀린 쪽 다리)가 있다. 웹 목업으로 열면 없다.
  var LIVE = !!window.Android;
  function nowSec() { var d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); }
  function setT(v) { S.t = LIVE ? nowSec() : v; }
  function tick(step) { if (LIVE) S.t = nowSec(); else S.t += step; }
  function lampsOut() { if (LIVE) { try { window.Android.setLamps(S.lamps); } catch (e) {} } }
  function say(text, level) {
    var same = S.voice.text === text;      // 같은 말을 연달아 읽지 않는다
    S.voice = { text: text, level: level || 'info' };
    if (LIVE && text && !same) { try { window.Android.speak(text); } catch (e) {} }
  }
  function log(sig, react) {
    S.log.unshift({ sig: sig, react: react });
    if (S.log.length > 4) S.log.length = 4;
    if (LIVE) console.log('[' + S.mode + '] ' + sig + ' → ' + react);
    if (S.mode !== 'standby' || S.stopAt !== null || S.tell.length) {
      S.events.push({ t: S.t, sig: sig, react: react });
    }
  }

  // ---------- 판정 ----------
  function drive() {
    if (S.mode !== 'standby') return;
    S.speed = 100; S.onHighway = true; setT(D.T_DRIVE);
    log('속도 100 km/h · 고속도로 본선', '대기 — 화면에 띄울 것 없음');
  }

  function fault() {
    if (S.mode !== 'standby' || !S.onHighway) return;
    S.tell = D.TELLTALES.slice();
    S.speed = 40; setT(D.T_FAULT);
    log('경고등: ' + S.tell.join(' · '), '고장 의심 — 멈추는지 지켜봄');
  }

  // 멈춤 알아채기: 고속도로 위 + 정차 + (빨간 경고등·출력 제한 경고) → 바로 시작
  function stop() {
    if (S.mode !== 'standby') return;
    S.speed = 0; setT(D.T_STOP);
    if (S.onHighway && S.tell.length) {
      startEvac('경고등이 켜진 채 고속도로 위 정차');
    } else {
      log('속도 0 km/h', '경고등 없음 — 버튼·음성으로 시작할 수 있음');
    }
  }

  function startEvac(why) {
    S.mode = 'evac';
    S.stopAt = S.t;
    S.trigger = why;
    S.riders = inCar().length;
    S.lamps = true; lampsOut();
    say('고속도로 위에 멈췄습니다. 대피 안내를 시작합니다.', 'alarm');
    log('속도 0 km/h · ' + why, '대피 안내 시작 · 미등·후방 안개등·실내등 켜기 · 신고 문장 전송');
    S.guideTimer = setTimeout(function () {
      S.guideTimer = null;
      if (S.mode === 'evac' && S.out.length === 0) {
        say('비상등을 켜세요. 모두 조수석 쪽 문으로 내려 가드레일 밖으로 나가세요.', 'alarm');
        render();
      }
    }, 3000);
  }

  function toggleDoor(k) {
    S.doors[k] = !S.doors[k];
    if (S.mode === 'evac') tick(D.STEP_DOOR);
    log('도어: ' + D.DOORS[k] + (S.doors[k] ? ' 열림' : ' 닫힘'),
      S.mode === 'evac' ? (S.doors[k] ? '하차 시작으로 봄' : '문 닫힘 확인') : '반응 없음');
    if (S.mode === 'evac') recheck();
  }

  function toggleOcc(i) {
    S.seats[i] = !S.seats[i];
    if (S.mode === 'evac') {
      tick(D.STEP_SEAT[i] || 14);
      if (!S.seats[i] && S.out.indexOf(i) === -1) S.out.push(i);
      if (S.seats[i]) S.out = S.out.filter(function (x) { return x !== i; });
      log('좌석 점유: ' + D.SEATS[i] + (S.seats[i] ? ' 앉음' : ' 비움'),
        S.seats[i] ? '다시 탑승 — 남은 자리에 추가' : '차 안 ' + inCar().length + '명 남음');
      recheck();
    } else {
      log('좌석 점유: ' + D.SEATS[i] + (S.seats[i] ? ' 앉음' : ' 비움'), '대기 중 — 탑승 인원만 기억');
    }
  }

  // 전원 하차 판정 — 전 좌석이 비고 문이 모두 닫힐 때까지 반복
  function recheck() {
    if (S.guideTimer) { clearTimeout(S.guideTimer); S.guideTimer = null; }
    var left = inCar();
    var others = left.filter(function (i) { return i !== 0; });
    if (others.length) {
      var names = others.map(function (i) { return D.SEATS[i]; }).join(', ');
      say(names + '에 아직 사람이 있습니다.', 'alarm');
      return;
    }
    if (left.length) {            // 운전자만 남음
      say('동승자가 모두 내렸습니다. 운전자도 조수석 쪽 문으로 내리세요.', 'warn');
      return;
    }
    if (openDoors().length) {
      say('전 좌석 비었습니다. 문을 닫고 가드레일 밖으로 나가세요.', 'warn');
      return;
    }
    S.mode = 'clear';
    S.clearAt = S.t;
    say('전 좌석 비었습니다. 차 안을 한 번 더 눈으로 확인하고 가드레일 밖에서 기다리세요.', 'ok');
    S.log[0].react = '전원 하차 판정 · 신고 문장 「전원 대피 완료」로 갱신';
    S.events[S.events.length - 1].react = S.log[0].react;
  }

  function end() {
    if (S.mode !== 'clear') return;
    S.mode = 'ended';
    setT(D.T_END);
    S.lamps = false; lampsOut();
    log('“안내 종료”', '등화 원래대로 · 기록 저장');
  }

  // 신고 문장 — 위치·방향·인원·멈춘 이유
  function reportText() {
    var left = inCar().length;
    var tail = S.mode === 'evac'
      ? '탑승자 ' + S.riders + '명 가운데 ' + left + '명이 아직 차 안에 있습니다.'
      : '탑승자 ' + S.riders + '명 전원 대피 완료.';
    return D.ROAD + ', ' + D.SPOT + ', ' + D.CAR + (S.airbag ? ' 사고 정차(에어백 전개). ' : ' 고장 정차(' + S.tell[0] + '). ') + tail;
  }

  // ---------- 그리기 ----------
  function phase() {
    if (S.mode === 'ended') return ['안내 종료 · 기록 저장됨', 'ok'];
    if (S.mode === 'clear') return ['전원 하차 확인', 'ok'];
    if (S.mode === 'evac') return ['대피 안내 중 · 차 안 ' + inCar().length + '명', 'alarm'];
    if (S.tell.length) return ['경고등 감지 · 대기', 'warn'];
    if (S.onHighway) return ['고속도로 주행 중 · 대기', 'drive'];
    return ['대기', 'idle'];
  }

  function seatHtml(i) {
    var st = S.seats[i] ? 'left' : (S.out.indexOf(i) !== -1 ? 'out' : 'empty');
    var txt = st === 'left' ? '아직 차 안' : st === 'out' ? '내림' : '';
    return '<div class="seat seat-p" data-state="' + st + '">' +
      '<span class="seat-name">' + D.SEATS[i] + '</span>' +
      '<span class="seat-st">' + txt + '</span></div>';
  }

  function render() {
    $('clock').textContent = hm(S.t);
    var ph = phase();
    $('phase').textContent = ph[0];
    $('phase').setAttribute('data-level', ph[1]);
    $('roadChip').textContent = S.onHighway ? D.ROAD + ' (예시)' : '';
    $('barSpeed').textContent = S.speed + ' km/h';
    $('lightBadge').hidden = !S.lamps;
    $('main').setAttribute('data-alarm', S.mode === 'evac' ? 'on' : 'off');

    $('viewStandby').hidden = S.mode !== 'standby';
    $('viewEvac').hidden = !(S.mode === 'evac' || S.mode === 'clear');
    $('viewRecord').hidden = S.mode !== 'ended';

    // 대기 화면
    $('sbState').textContent = S.onHighway ? '대피 안내 대기 중' : '멈춤지기';
    $('sbSub').textContent = S.onHighway
      ? '주행 중에는 아무것도 띄우지 않아요. 고속도로 위에서 멈추면 차가 먼저 말해요.'
      : '고속도로에 올라서면 대기를 시작해요.';
    $('sbTell').hidden = !S.tell.length;
    $('sbTell').textContent = S.tell.length ? S.tell.join(' · ') + ' 감지 — 멈추면 대피 안내를 시작해요' : '';

    // 좌석
    var n = inCar().length;
    $('seatHead').textContent = S.mode === 'clear' ? '모두 내렸어요'
      : n === S.riders ? S.riders + '명이 타고 있어요' : '아직 ' + n + '명이 차 안에 있어요';
    $('rowFront').innerHTML = seatHtml(0) + seatHtml(1);
    $('rowRear').innerHTML = seatHtml(2) + seatHtml(3) + seatHtml(4);
    Object.keys(S.doors).forEach(function (k) {
      $('door-' + k).setAttribute('data-open', String(S.doors[k]));
    });

    // 음성
    $('voice').setAttribute('data-level', S.voice.level);
    $('voiceText').textContent = S.voice.text;

    // 등화
    ['lampTail', 'lampFog', 'lampCabin'].forEach(function (id) {
      $(id).setAttribute('data-on', String(S.lamps));
    });

    // 신고 문장
    if (S.mode === 'evac' || S.mode === 'clear') {
      $('reportText').textContent = '“' + reportText() + '”';
      $('report').setAttribute('data-done', String(S.mode === 'clear'));
    }
    $('telTow').textContent = D.TOW;
    $('endBtn').hidden = S.mode !== 'clear';

    if (S.mode === 'ended') renderRecord();

    // 신호 띠
    hud('chSpeed', 'hudSpeed', S.speed + ' km/h');
    hud('chTell', 'hudTell', S.tell.length ? S.tell[0] + ' 외 ' + (S.tell.length - 1) : '없음');
    var od = openDoors();
    hud('chDoor', 'hudDoor', od.length ? od.map(function (k) { return D.DOORS[k].replace(' 문', ''); }).join('·') + ' 열림' : '모두 닫힘');
    hud('chOcc', 'hudOcc', n + ' / 5');
    hud('chLight', 'outLight', S.lamps ? '미등·안개등·실내등 켜짐' : '꺼짐');
    $('outLight').setAttribute('data-on', String(S.lamps));
    $('log').innerHTML = S.log.map(function (l, k) {
      return '<li' + (k === 0 ? ' class="new"' : '') + '><span>' + l.sig + '</span><b>' + l.react + '</b></li>';
    }).join('');
  }

  function renderRecord() {
    var took = S.clearAt - S.stopAt;
    $('recHead').textContent = '전원 하차까지 ' + dur(took) + ' 걸렸어요';
    var facts = [
      ['멈춘 시각', D.TODAY + ' ' + hms(S.stopAt)],
      ['위치 (예시)', D.ROAD + ' · ' + D.SPOT],
      ['멈춘 이유', S.tell.join(' · ')],
      ['시작 계기', S.trigger],
      ['탑승 인원', S.riders + '명 · 전원 하차 ' + hms(S.clearAt)],
      ['앱이 켠 등', '미등 · 후방 안개등 · 실내등'],
    ];
    $('recFacts').innerHTML = facts.map(function (f) {
      return '<div class="fact"><em>' + f[0] + '</em><b>' + f[1] + '</b></div>';
    }).join('');
    $('tl').innerHTML = S.events.map(function (e) {
      return '<li><time>' + hms(e.t) + '</time><span>' + e.sig + '</span><b>' + e.react + '</b></li>';
    }).join('');
  }

  // 값이 바뀐 신호 칩을 번쩍인다 (보이지 않는 입력 버튼 대신 눈에 보이는 표시)
  var hudPrev = {};
  function hud(chipId, valId, val) {
    $(valId).textContent = val;
    if (hudPrev[chipId] !== undefined && hudPrev[chipId] !== val) {
      var c = $(chipId);
      c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
    }
    hudPrev[chipId] = val;
  }

  // ---------- 배선 ----------
  $('fixtureBadge').textContent = D.LABEL;
  $('fixtureBadge').hidden = false;
  $('footNote').textContent = D.NOTE;

  function on(id, fn) { $(id).addEventListener('click', function () { fn(); render(); }); }
  on('driveBtn', drive);
  on('faultBtn', fault);
  on('stopBtn', stop);
  on('endBtn', end);
  on('manualBtn', function () {
    if (S.mode !== 'standby') return;
    S.speed = 0;
    if (!S.tell.length) S.tell = ['운전자 직접 시작'];
    startEvac('운전자가 버튼으로 시작');
  });
  $('ctl').addEventListener('click', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-door')) toggleDoor(t.getAttribute('data-door'));
    else if (t.hasAttribute('data-occ')) toggleOcc(+t.getAttribute('data-occ'));
    else return;
    render();
  });
  $('introGo').addEventListener('click', function () { $('intro').hidden = true; });
  $('outroBtn').addEventListener('click', function () { $('outro').hidden = false; });
  $('outro').addEventListener('click', function () { $('outro').hidden = true; });

  // 녹화에는 마우스 커서가 안 찍힌다 — 누른 자리를 고리로 표시한다
  var tap = $('tap');
  document.addEventListener('mousedown', function (e) {
    if ($('ctl').contains(e.target)) return;   // 가상 신호 입력은 칩이 번쩍이는 것으로 보인다
    tap.style.left = e.clientX + 'px';
    tap.style.top = e.clientY + 'px';
    tap.classList.remove('go');
    void tap.offsetWidth;
    tap.classList.add('go');
  }, true);

  // ---------- 차량 신호 다리 (APK: 코틀린 VehicleSignalSource → 여기) ----------
  // 신호 값만 받는다. 무엇을 할지는 위 판정 로직이 정한다.
  window.VehicleBridge = {
    source: function (name) { D.LABEL = name; $('fixtureBadge').textContent = name; },
    speed: function (kmh, onHighway) {
      S.onHighway = !!onHighway;
      if (kmh === S.speed) { render(); return; }
      if (S.mode !== 'standby') { S.speed = kmh; render(); return; }
      if (kmh > 0) {
        S.speed = kmh; tick(0);
        log('속도 ' + kmh + ' km/h' + (S.onHighway ? ' · 고속도로 본선' : ''), '대기 — 화면에 띄울 것 없음');
      } else {
        stop();
      }
      render();
    },
    telltales: function (names) {
      if (S.mode !== 'standby') return;
      S.tell = names || []; tick(0);
      if (S.tell.length) {
        log('경고등: ' + S.tell.join(' · '), '고장 의심 — 멈추는지 지켜봄');
        if (S.speed === 0 && S.onHighway) startEvac('경고등이 켜진 채 고속도로 위 정차');
      }
      render();
    },
    airbag: function () {
      if (S.mode !== 'standby') return;
      S.airbag = true; S.speed = 0; tick(0);
      if (S.tell.indexOf('에어백 전개') === -1) S.tell.unshift('에어백 전개');
      startEvac('에어백 전개');
      render();
    },
    door: function (k, open) { if (S.doors[k] !== !!open) { toggleDoor(k); render(); } },
    seat: function (i, occ) { if (S.seats[i] !== !!occ) { toggleOcc(i); render(); } },
  };

  if (LIVE) {
    // 실제 신호로 채운다 — 예시 탑승자를 비우고 시작
    S.seats = D.SEATS.map(function () { return false; });
    S.t = nowSec();
    document.body.classList.add('live');
    var demo = false;
    try { demo = window.Android.isDemo(); } catch (e) {}
    $('introNote').innerHTML = demo
      ? '이 기기에는 Pleos 차량 서비스가 없어 <b>시연 신호</b>(정해진 각본)로 움직여요. 판정은 신호 값에서 실제로 계산해요.'
      : 'Pleos Vehicle SDK 의 좌석·도어·경고등 신호를 읽어요. 위치는 예시예요.';
    var db = $('demoBtn');
    db.hidden = !demo;
    db.addEventListener('click', function () { window.Android.startDemo(); });
    // 화면 크기에 맞춰 1920×1002 설계 화면을 통째로 줄이거나 늘린다
    var fit = function () {
      var k = Math.min(window.innerWidth / 1920, window.innerHeight / 1002);
      var b = document.body.style;
      b.width = '1920px'; b.height = '1002px'; b.minHeight = '0'; b.transformOrigin = '0 0';
      b.transform = 'translate(' + ((window.innerWidth - 1920 * k) / 2) + 'px,' + ((window.innerHeight - 1002 * k) / 2) + 'px) scale(' + k + ')';
    };
    window.addEventListener('resize', fit);
    fit();
  }

  render();
})();
