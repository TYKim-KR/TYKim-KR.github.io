// 세트 넣기 체험판(10-15 사용자 "실사용을 음주와 같이 test로") — 종목 탭 → 무게·횟수 ± → [세트 추가](폰 안에 쌓임 + 쉬는 시간 타이머) → 텔레그램 [저장] 한 번(sendData).
// 받는 값: 주소 # 뒤 e=가짜 예시 종목(이름~종류~단위~무게~횟수~무게 칸) — 개인 기록 없음. 보내는 값: 종목 번호·무게·횟수와 체험 계측 숫자뿐. 봇은 답장만 하고 저장하지 않는다.
// initData(텔레그램 사용자 정보)는 읽지 않는다. 이 페이지는 통신 금지 규칙(CSP) 아래라 텔레그램 밖으로는 아무것도 못 보낸다.
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var openedAt = Date.now();
  var MAX_SETS = 30;
  var $ = function (id) { return document.getElementById(id); };
  var info = function (s) { $("info").textContent = s; };

  // 통신 차단 확인 — 같은 사이트로도 못 나가면(규칙 위반 이벤트) 확인됨으로 보고한다.
  var csp = false;
  document.addEventListener("securitypolicyviolation", function () { csp = true; });
  try { fetch(location.origin + "/").catch(function () {}); } catch (e) {}

  // e = 이름~종류(w 무게×횟수 · r 횟수 · t 초)~단위(kg·slot)~무게(kg×10 또는 칸)~횟수(초)~무게 한 칸~쉬는 시간(초, 10-16 종목마다)
  var hash = new URLSearchParams(location.hash.slice(1));
  var exercises = [];
  var REST_MIN = 15, REST_MAX = 600;
  (hash.get("e") || "").split("|").forEach(function (s) {
    var p = s.split("~");
    var m = p[1], w = Number(p[3]), r = Number(p[4]), step = Number(p[5]), rs = Number(p[6]);
    if (!Number.isInteger(rs) || rs < REST_MIN || rs > REST_MAX) rs = 90;
    var okUnit = m !== "w" || p[2] === "kg" || p[2] === "slot";
    if (p[0] && p[0].length <= 20 && (m === "w" || m === "r" || m === "t") && okUnit && Number.isInteger(w) && w >= 0 && w <= 5000 &&
        Number.isInteger(r) && r >= 0 && r <= 3600 && Number.isInteger(step) && step >= 0 && step <= 500 && exercises.length < 12) {
      exercises.push({ name: p[0], m: m, unit: p[2], w: w, r: r, step: step || 1, rest: rs });
    }
  });

  var cur = 0;
  var sets = []; // {e, w, r}
  var taps = 0, maxTapMs = 0, timersStarted = 0, timersDone = 0, restEdits = 0, beeps = 0, restored = false;
  var sending = false;
  var ready = false; // 이어 쓰기(기기 저장소 읽기)가 끝나기 전엔 누름을 받지 않는다 — 먼저 넣은 세트가 저장된 값을 덮거나 뒤섞인다(Codex 10-15 medium)

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "select") tg.HapticFeedback.selectionChanged();
      else if (kind === "done") tg.HapticFeedback.notificationOccurred("success");
      else if (kind === "heavy") tg.HapticFeedback.impactOccurred("heavy");
      else tg.HapticFeedback.impactOccurred("light");
    } catch (e) {}
  }

  // 쉬기 끝 소리 — 아이폰은 사용자가 누른 순간에만 소리 장치를 켤 수 있어서 누를 때마다 켜 둔다(파일을 받지 않고 그 자리에서 만든 "삐" — 통신 아님).
  // 무음 스위치가 켜져 있으면 안 들릴 수 있다(체험으로 확인할 것). 음악을 끊지 않게 기본 방식 그대로 둔다.
  var audio = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state !== "running") audio.resume();
    } catch (e) {}
  }
  document.addEventListener("touchend", unlockAudio, { passive: true });
  document.addEventListener("click", unlockAudio);
  function beep() {
    try {
      if (!audio || audio.state !== "running") return;
      var t = audio.currentTime;
      for (var i = 0; i < 3; i++) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.5, t + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.35 + 0.2);
        o.connect(g); g.connect(audio.destination);
        o.start(t + i * 0.35); o.stop(t + i * 0.35 + 0.22);
      }
      beeps += 1;
    } catch (e) {}
  }
  // 쉬기 끝 — 진동 3번(0·0.4·0.8초) + 삐 3번. 진동은 아이폰 [시스템 햅틱]이 꺼져 있으면 안 올 수 있다.
  function restDoneAlert() {
    haptic("done");
    setTimeout(function () { haptic("heavy"); }, 400);
    setTimeout(function () { haptic("heavy"); }, 800);
    beep();
  }
  function weightText(ex, w) { return ex.unit === "slot" ? w + "칸" : (w / 10) + "kg"; }
  function repsText(ex, r) { return ex.m === "t" ? r + "초" : r + "회"; }
  function setText(ex, s) { return ex.m === "w" ? weightText(ex, s.w) + " × " + s.r : repsText(ex, s.r); }

  // 누른 뒤 화면이 바뀔 때까지(다음 그림 그리기) — 체험 계측
  function measured(fn) {
    return function (e) {
      if (e) e.preventDefault();
      if (sending || !ready) return;
      var t0 = performance.now();
      taps += 1;
      fn();
      requestAnimationFrame(function () { maxTapMs = Math.max(maxTapMs, Math.round(performance.now() - t0)); });
    };
  }
  function on(id, fn) { $(id).addEventListener("pointerdown", measured(fn)); }

  function render() {
    var tabs = $("tabs");
    tabs.textContent = "";
    exercises.forEach(function (ex, i) {
      var b = document.createElement("button");
      var n = sets.filter(function (s) { return s.e === i; }).length;
      b.textContent = ex.name;
      if (n) { var c = document.createElement("span"); c.className = "n"; c.textContent = " " + n; b.appendChild(c); }
      b.className = i === cur ? "on" : "";
      b.addEventListener("pointerdown", measured(function () { cur = i; haptic("select"); render(); }));
      tabs.appendChild(b);
    });
    var ex = exercises[cur];
    $("wBox").hidden = ex.m !== "w";
    $("wVal").textContent = weightText(ex, ex.w);
    $("rVal").textContent = repsText(ex, ex.r);
    var list = $("sets");
    list.textContent = "";
    var no = {};
    sets.forEach(function (s, i) {
      var e = exercises[s.e];
      no[s.e] = (no[s.e] || 0) + 1;
      var row = document.createElement("div"); row.className = "row";
      var name = document.createElement("span"); name.className = "name"; name.textContent = e.name + " " + no[s.e] + "세트 · " + setText(e, s);
      var del = document.createElement("button"); del.textContent = "✕";
      del.addEventListener("pointerdown", measured(function () { sets.splice(i, 1); haptic(); changed(); }));
      row.append(name, del);
      list.appendChild(row);
    });
  }

  var saveTimer = null;
  function changed() {
    render();
    if (tg) {
      try { sets.length ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch (e) {}
      if (tg.MainButton) { if (sets.length) { tg.MainButton.setText("저장 (" + sets.length + "세트)"); tg.MainButton.show(); } else tg.MainButton.hide(); }
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }

  function bump(field, dir) {
    var ex = exercises[cur];
    var step = field === "w" ? ex.step : (ex.m === "t" ? 10 : 1);
    var max = field === "w" ? 5000 : 3600;
    ex[field] = Math.max(0, Math.min(max, ex[field] + dir * step));
    haptic();
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }
  on("wMinus", function () { bump("w", -1); });
  on("wPlus", function () { bump("w", 1); });
  on("rMinus", function () { bump("r", -1); });
  on("rPlus", function () { bump("r", 1); });
  on("addSet", function () {
    if (sets.length >= MAX_SETS) { info("한 번에 " + MAX_SETS + "세트까지야 — 저장하고 다시 열어줘."); return; }
    var ex = exercises[cur];
    if (ex.r <= 0) { info("횟수(초)를 먼저 올려줘."); return; }
    sets.push({ e: cur, w: ex.m === "w" ? ex.w : 0, r: ex.r });
    unlockAudio();
    haptic();
    changed();
    startTimer(cur);
  });

  // 쉬는 시간 — 종목마다 따로(10-16). 끝나는 시각을 적어 두고 그때와의 차이로 센다(화면이 잠깐 꺼졌다 와도 맞다). 앱이 닫히면 멈춘다.
  // ±는 지금 도는 타이머의 종목 시간을 바꾸고, 그 종목 다음 세트도 바뀐 시간으로 시작한다.
  var timerEx = 0, lastRest = null, endAt = 0, ticking = null, rang = false;
  function startTimer(i) {
    timerEx = i;
    lastRest = exercises[i].rest;
    endAt = Date.now() + lastRest * 1000;
    rang = false;
    timersStarted += 1;
    $("timerName").textContent = exercises[i].name + " 쉬는 시간";
    $("timer").hidden = false;
    $("timer").className = "";
    clearInterval(ticking);
    ticking = setInterval(tick, 250);
    tick();
  }
  function tick() {
    if (!endAt) return; // [끝]으로 멈춘 타이머는 다시 세지 않는다(Codex 10-15 low)
    var left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    $("timerVal").textContent = left > 0 ? Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2) : "쉬기 끝 — 다음 세트";
    if (left === 0 && !rang) { rang = true; timersDone += 1; $("timer").className = "done"; restDoneAlert(); clearInterval(ticking); }
  }
  function adjust(sec) {
    var ex = exercises[timerEx];
    var before = ex.rest;
    ex.rest = Math.max(REST_MIN, Math.min(REST_MAX, ex.rest + sec));
    if (ex.rest !== before) restEdits += 1;
    lastRest = ex.rest;
    // 남은 시간도 실제로 바뀐 만큼만(15초 바닥에서 −15를 또 누르면 그대로, Codex 10-15 low)
    if (!rang && endAt) { endAt += (ex.rest - before) * 1000; tick(); }
    haptic("select");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }
  on("tMinus", function () { adjust(-15); });
  on("tPlus", function () { adjust(15); });
  on("tStop", function () { clearInterval(ticking); endAt = 0; $("timer").hidden = true; });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || rang || !endAt) return;
    // 화면이 꺼졌다 오면 소리 장치가 멈춰 있을 수 있다 — 다시 켜진 뒤(늦어도 0.5초) 세야 끝난 타이머의 삐가 빠지지 않는다(Codex 10-16 medium)
    var once = false;
    var go = function () { if (!once) { once = true; tick(); } };
    try {
      if (audio && audio.state !== "running") { audio.resume().then(go, go); setTimeout(go, 500); return; }
    } catch (e) {}
    go();
  });

  // 작성 중 값 — 이 기기에만(텔레그램 기기 저장소). 다시 열면 이어 쓴다(음주 앱과 같은 아이폰 대책).
  var storage = tg && tg.isVersionAtLeast && tg.isVersionAtLeast("9.0") ? tg.DeviceStorage : null;
  var draftKey = "sets_trial";
  function saveDraft() {
    if (!storage || sending || !ready) return;
    var vals = exercises.map(function (ex) { return [ex.w, ex.r, ex.rest]; });
    try { storage.setItem(draftKey, JSON.stringify({ sets: sets, vals: vals, cur: cur })); } catch (e) {}
  }
  function loadDraft(done) {
    if (!storage) return done();
    try {
      storage.getItem(draftKey, function (err, value) {
        if (!err && value) {
          try {
            var d = JSON.parse(value);
            (Array.isArray(d && d.sets) ? d.sets : []).forEach(function (s) {
              if (s && Number.isInteger(s.e) && s.e >= 0 && s.e < exercises.length && Number.isInteger(s.w) && s.w >= 0 && s.w <= 5000 &&
                  Number.isInteger(s.r) && s.r > 0 && s.r <= 3600 && sets.length < MAX_SETS) sets.push({ e: s.e, w: s.w, r: s.r });
            });
            (Array.isArray(d && d.vals) ? d.vals : []).forEach(function (v, i) {
              if (exercises[i] && Array.isArray(v) && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[0] <= 5000 && v[1] >= 0 && v[1] <= 3600) {
                exercises[i].w = v[0]; exercises[i].r = v[1];
                if (Number.isInteger(v[2]) && v[2] >= REST_MIN && v[2] <= REST_MAX) exercises[i].rest = v[2];
              }
            });
            if (Number.isInteger(d && d.cur) && d.cur >= 0 && d.cur < exercises.length) cur = d.cur;
            restored = sets.length > 0;
          } catch (e) {}
        }
        done();
      });
    } catch (e) { done(); }
  }

  var readyMs = null;
  function send() {
    if (sending || !sets.length || !tg || !tg.sendData) return;
    sending = true;
    clearTimeout(saveTimer);
    var payload = JSON.stringify({
      v: "st1",
      sets: sets.map(function (s) { return [s.e, s.w, s.r]; }),
      taps: taps, maxTapMs: maxTapMs, timers: timersStarted, timersDone: timersDone, rest: lastRest, restEdits: restEdits, beeps: beeps,
      restored: restored, csp: csp, readyMs: readyMs, openS: Math.round((Date.now() - openedAt) / 1000),
    });
    try { tg.disableClosingConfirmation(); } catch (e) {}
    info("보내는 중…");
    var sent = false;
    var go = function () {
      if (sent) return;
      sent = true;
      try { tg.sendData(payload); } catch (e) { info("보내기 실패 — 다시 열어줘."); }
    };
    if (storage) {
      setTimeout(go, 400);
      try { storage.setItem(draftKey, "", go); } catch (e) { go(); }
    } else go();
  }

  if (!exercises.length) {
    info("봇 채팅에서 /settrial 로 연 아래 키보드 버튼으로 열어줘.");
    $("editor").hidden = true;
    return;
  }
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes(); } catch (e) {}
    if (tg.MainButton) tg.MainButton.onClick(send);
  }
  loadDraft(function () {
    readyMs = Date.now() - openedAt;
    ready = true;
    changed();
    if (restored) info("아까 넣던 세트를 이어서 보여 줘.");
    else if (!tg || !tg.sendData) info("텔레그램 밖이라 저장은 안 돼.");
  });
})();
