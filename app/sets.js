// 세트 넣기 미니 앱(10-20 본 개발 — 체험판 spike/sets를 대신한다) — 종목 탭 → 무게·횟수 ± → [세트 추가](폰 안에 쌓임 + 종목별 쉬는 시간 타이머)
// → 텔레그램 [저장] 한 번(sendData). 봇이 오늘 열린 운동 세션에 이어 붙인다.
// 받는 값: 주소 # 뒤 s=세션 번호, e=종목(코드~이름~방식~단위~무게~횟수~무게 칸~쉬는 시간~오늘 세트~처방 세트~여유 물음|…) — 사람 이름·신체 수치 없음.
// 보내는 값: 세션 번호·일회용 번호·세트(코드·무게·횟수·누름 수·순번)·첫 세트 여유뿐. initData(텔레그램 사용자 정보)는 읽지 않는다.
// 이 페이지는 통신 금지 규칙(CSP) 아래라 텔레그램 밖으로는 아무것도 못 보낸다.
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var M = window.SetsMath;
  var MAX_ITEMS = 12, MAX_SETS = 40, REST_MIN = 15, REST_MAX = 600;
  var $ = function (id) { return document.getElementById(id); };
  var info = function (s) { $("info").textContent = s; };

  var hash = new URLSearchParams(location.hash.slice(1));
  var sid = /^[0-9]{1,12}$/.test(hash.get("s") || "") ? hash.get("s") : "";
  // ok = 봇이 저장(또는 이미 저장됨)을 확인한 일회용 번호 — 그 번호의 작성 중 값은 이미 들어갔으니 버린다.
  var savedOk = /^[A-Za-z0-9]{8,32}$/.test(hash.get("ok") || "") ? hash.get("ok") : "";
  var exercises = [];
  var isInt = function (v, min, max) { return Number.isInteger(v) && v >= min && v <= max; };
  (hash.get("v") === "1" ? hash.get("e") || "" : "").split("|").forEach(function (s) {
    var p = s.split("~");
    if (p.length !== 11 || exercises.length >= MAX_ITEMS) return;
    var m = p[2], unit = p[3], gear = p[6];
    var w = Number(p[4]), r = Number(p[5]), rest = Number(p[7]), done = Number(p[8]), target = Number(p[9]);
    var okKind = m === "w" ? (unit === "kg" && (gear === "b" || gear === "d")) || (unit === "slot" && gear === "s") : (m === "r" || m === "t") && unit === "" && gear === "";
    if (!/^[a-z0-9-]{1,64}$/.test(p[0]) || !p[1] || p[1].length > 30 || !okKind || !isInt(w, 0, 9999) || !isInt(r, 1, 999) || !isInt(done, 0, 99) || !isInt(target, 0, 20)) return;
    if (unit === "slot") w = Math.min(Math.max(w, 1), 99);
    exercises.push({ code: p[0], name: p[1], m: m, unit: unit, gear: gear, w: m === "w" ? w : 0, r: r, rest: isInt(rest, REST_MIN, REST_MAX) ? rest : 90, done: done, target: target, ask: p[10] === "1" });
  });

  var cur = 0;
  var sets = []; // {e, w, r, taps, seq}
  var nextSeq = 0; // 세트 순번 — 지운 세트의 번호도 다시 쓰지 않는다(봇이 (일회용 번호, 순번)으로 같은 세트를 한 번만 넣는다)
  var rirAns = {}; // 종목 번호 → 여유(0·1·3) — 오늘 첫 세트에만
  var tapsSince = 0; // 앞 세트 뒤부터 누른 수(세트마다 봇에 남긴다 — 운동통계 누름 수)
  var nonce = null, restored = false;
  var sending = false; // [저장]을 누른 뒤엔 더 고치지 않는다 — 보낸 번호로 바뀐 값이 남으면 다음 저장이 중복으로 버려진다(음주 앱과 같은 이유)
  var ready = false; // 이어 쓰기(기기 저장소 읽기)가 끝나기 전엔 누름을 받지 않는다

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "select") tg.HapticFeedback.selectionChanged();
      else if (kind === "done") tg.HapticFeedback.notificationOccurred("success");
      else if (kind === "heavy") tg.HapticFeedback.impactOccurred("heavy");
      else tg.HapticFeedback.impactOccurred("light");
    } catch (e) {}
  }
  function newNonce() {
    var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return abc[b % abc.length]; }).join("");
  }

  // 쉬기 끝 소리 — 아이폰은 사용자가 누른 순간에만 소리 장치를 켤 수 있어서 누를 때마다 켜 둔다(파일을 받지 않고 그 자리에서 만든 "삐" — 통신 아님).
  // 무음 스위치가 켜져 있으면 안 들릴 수 있다. 음악을 끊지 않게 기본 방식 그대로 둔다.
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
    } catch (e) {}
  }
  // 쉬기 끝 — 진동 3번(0·0.4·0.8초) + 삐 3번. 진동은 아이폰 [시스템 햅틱]이 꺼져 있으면 안 올 수 있다.
  function restDoneAlert() {
    haptic("done");
    setTimeout(function () { haptic("heavy"); }, 400);
    setTimeout(function () { haptic("heavy"); }, 800);
    beep();
  }

  var RIR_TEXT = { 0: "0", 1: "1~2", 3: "3+" };
  function weightText(ex, w) { return ex.unit === "slot" ? w + "칸" : (w / 10) + "kg"; }
  function repsText(ex, r) { return ex.m === "t" ? r + "초" : r + "회"; }
  function setText(ex, s) { return ex.m === "w" ? weightText(ex, s.w) + " × " + s.r : repsText(ex, s.r); }
  function localCount(i) { return sets.filter(function (s) { return s.e === i; }).length; }

  function tapped(fn) {
    return function (e) {
      if (e) e.preventDefault();
      if (sending || !ready) return;
      tapsSince += 1;
      fn();
    };
  }
  function on(id, fn) { $(id).addEventListener("pointerdown", tapped(fn)); }

  function render() {
    var tabs = $("tabs");
    tabs.textContent = "";
    exercises.forEach(function (ex, i) {
      var b = document.createElement("button");
      var n = ex.done + localCount(i);
      b.textContent = ex.name;
      if (n || ex.target) {
        var c = document.createElement("span");
        c.className = "n";
        c.textContent = " " + n + (ex.target ? "/" + ex.target : "");
        b.appendChild(c);
      }
      b.className = i === cur ? "on" : "";
      b.addEventListener("pointerdown", tapped(function () { cur = i; haptic("select"); render(); }));
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
      var first = e.done === 0 && no[s.e] === 1;
      var row = document.createElement("div"); row.className = "row";
      var name = document.createElement("span"); name.className = "name";
      name.textContent = e.name + " " + (e.done + no[s.e]) + "세트 · " + setText(e, s) + (first && rirAns[s.e] != null ? " · 여유 " + RIR_TEXT[rirAns[s.e]] : "");
      var del = document.createElement("button"); del.textContent = "✕";
      del.addEventListener("pointerdown", tapped(function () {
        sets.splice(i, 1);
        // 첫 세트를 지우면 그 여유도 지운다 — 남은 세트가 새 첫 세트가 되면 그 세트로 다시 묻는다
        if (first) { delete rirAns[s.e]; hideRir(); if (e.ask && localCount(s.e) > 0) showRir(s.e); }
        haptic();
        changed();
      }));
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
    if (field === "w") ex.w = M.stepWeight(ex.gear, ex.w, dir);
    else ex.r = M.stepReps(ex.m, ex.r, dir);
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
    sets.push({ e: cur, w: ex.m === "w" ? ex.w : 0, r: ex.r, taps: tapsSince, seq: nextSeq++ });
    tapsSince = 0;
    unlockAudio();
    haptic();
    changed();
    startTimer(cur);
    if (ex.ask && ex.done === 0 && localCount(cur) === 1 && rirAns[cur] == null) showRir(cur);
  });

  // (2차) 오늘 첫 세트 뒤 여유 1탭 — 남긴 반복 0 / 1~2 / 3+. 답은 첫 세트에만 붙고, 건너뛰면 이번엔 증량 판정 없이 간다(카드와 같다).
  var rirFor = -1;
  function showRir(i) {
    rirFor = i;
    $("rirName").textContent = exercises[i].name + " 첫 세트 — 몇 회 더 할 수 있었어?";
    $("rirBox").hidden = false;
  }
  function hideRir() { rirFor = -1; $("rirBox").hidden = true; }
  function answer(bucket) {
    if (rirFor >= 0 && bucket != null) rirAns[rirFor] = bucket;
    hideRir();
    haptic("select");
    changed();
  }
  on("rir0", function () { answer(0); });
  on("rir1", function () { answer(1); });
  on("rir3", function () { answer(3); });
  on("rirSkip", function () { answer(null); });

  // 쉬는 시간 — 종목마다 따로. 끝나는 시각을 적어 두고 그때와의 차이로 센다(화면이 잠깐 꺼졌다 와도 맞다). 앱이 닫히면 멈춘다.
  // ±는 지금 도는 타이머의 종목 시간을 바꾸고, 그 종목 다음 세트도 바뀐 시간으로 시작한다(이 기기에서만 — 봇에는 안 보낸다).
  var timerEx = 0, endAt = 0, ticking = null, rang = false;
  function startTimer(i) {
    timerEx = i;
    endAt = Date.now() + exercises[i].rest * 1000;
    rang = false;
    $("timerName").textContent = exercises[i].name + " 쉬는 시간";
    $("timer").hidden = false;
    $("timer").className = "";
    clearInterval(ticking);
    ticking = setInterval(tick, 250);
    tick();
  }
  function tick() {
    if (!endAt) return; // [끝]으로 멈춘 타이머는 다시 세지 않는다
    var left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    $("timerVal").textContent = left > 0 ? Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2) : "쉬기 끝 — 다음 세트";
    if (left === 0 && !rang) { rang = true; $("timer").className = "done"; restDoneAlert(); clearInterval(ticking); }
  }
  function adjust(sec) {
    var ex = exercises[timerEx];
    var before = ex.rest;
    ex.rest = Math.max(REST_MIN, Math.min(REST_MAX, ex.rest + sec));
    // 남은 시간도 실제로 바뀐 만큼만(15초 바닥에서 −15를 또 누르면 그대로)
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
    // 화면이 꺼졌다 오면 소리 장치가 멈춰 있을 수 있다 — 다시 켜진 뒤(늦어도 0.5초) 세야 끝난 타이머의 삐가 빠지지 않는다
    var once = false;
    var go = function () { if (!once) { once = true; tick(); } };
    try {
      if (audio && audio.state !== "running") { audio.resume().then(go, go); setTimeout(go, 500); return; }
    } catch (e) {}
    go();
  });

  // 작성 중 값 — 이 기기에만(텔레그램 기기 저장소), 세션마다. 다시 열면 이어 쓴다. 종목은 번호가 아니라 코드로 적는다(다시 열 때 목록 순서가 바뀔 수 있다).
  var storage = tg && tg.isVersionAtLeast && tg.isVersionAtLeast("9.0") ? tg.DeviceStorage : null;
  var draftKey = "sets_" + sid;
  var indexOf = function (code) { for (var i = 0; i < exercises.length; i++) if (exercises[i].code === code) return i; return -1; };
  function saveDraft() {
    if (!storage || sending || !ready) return;
    writeDraft();
  }
  function writeDraft(done) {
    var d = {
      k: nonce,
      sets: sets.map(function (s) { return [exercises[s.e].code, s.w, s.r, s.taps, s.seq]; }),
      n: nextSeq,
      vals: exercises.map(function (ex) { return [ex.code, ex.w, ex.r, ex.rest]; }),
      rir: Object.keys(rirAns).map(function (i) { return [exercises[i].code, rirAns[i]]; }),
      cur: exercises[cur].code,
    };
    try { storage.setItem(draftKey, JSON.stringify(d), done); } catch (e) { if (done) done(); }
  }
  function loadDraft(done) {
    if (!storage) return done();
    try {
      storage.getItem(draftKey, function (err, value) {
        if (!err && value) {
          try {
            var d = JSON.parse(value);
            // 봇이 저장을 확인한 번호면 이미 들어간 값이다 — 이어 쓰지 않고 지운다
            if (d && savedOk && d.k === savedOk) { try { storage.setItem(draftKey, ""); } catch (e) {} return done(); }
            if (d && typeof d.k === "string" && /^[A-Za-z0-9]{16}$/.test(d.k)) nonce = d.k;
            (Array.isArray(d && d.sets) ? d.sets : []).forEach(function (s) {
              var i = Array.isArray(s) ? indexOf(s[0]) : -1;
              if (i >= 0 && isInt(s[1], 0, 9999) && isInt(s[2], 1, 999) && isInt(s[3], 0, 999) && isInt(s[4], 0, 9999) && sets.length < MAX_SETS) {
                sets.push({ e: i, w: s[1], r: s[2], taps: s[3], seq: s[4] });
                nextSeq = Math.max(nextSeq, s[4] + 1);
              }
            });
            (Array.isArray(d && d.vals) ? d.vals : []).forEach(function (v) {
              var i = Array.isArray(v) ? indexOf(v[0]) : -1;
              if (i < 0) return;
              if (exercises[i].m === "w" && isInt(v[1], 0, 9999)) exercises[i].w = exercises[i].unit === "slot" ? Math.min(Math.max(v[1], 1), 99) : v[1];
              if (isInt(v[2], 1, 999)) exercises[i].r = v[2];
              if (isInt(v[3], REST_MIN, REST_MAX)) exercises[i].rest = v[3];
            });
            (Array.isArray(d && d.rir) ? d.rir : []).forEach(function (x) {
              var i = Array.isArray(x) ? indexOf(x[0]) : -1;
              if (i >= 0 && (x[1] === 0 || x[1] === 1 || x[1] === 3) && exercises[i].done === 0 && localCount(i) > 0) rirAns[i] = x[1];
            });
            if (d && isInt(d.n, 0, 9999)) nextSeq = Math.max(nextSeq, d.n);
            if (d && indexOf(d.cur) >= 0) cur = indexOf(d.cur);
            restored = sets.length > 0;
          } catch (e) {}
        }
        done();
      });
    } catch (e) { done(); }
  }

  function send() {
    if (sending || !sets.length || !tg || !tg.sendData) return;
    sending = true;
    clearTimeout(saveTimer);
    var payload = JSON.stringify({
      v: "ts1",
      s: Number(sid),
      k: nonce,
      sets: sets.map(function (s) { return [exercises[s.e].code, s.w, s.r, s.taps, s.seq]; }),
      rir: Object.keys(rirAns).map(function (i) { return [exercises[i].code, rirAns[i]]; }),
    });
    try { tg.disableClosingConfirmation(); } catch (e) {}
    info("보내는 중…");
    // 작성 중 값은 지우지 않고 마지막 값으로 적어 둔 뒤 보낸다 — 저장이 실패하면 다시 열어 같은 번호로 다시 보낼 수 있다. 봇이 저장을 확인하면
    // 다음 키보드 주소의 ok로 알려 주고 그때 지운다(Codex 10-20 high). 아이폰은 저장소 답 이벤트가 안 올 수 있어 0.4초 뒤엔 그냥 보낸다(한 번만).
    var sent = false;
    var go = function () {
      if (sent) return;
      sent = true;
      try { tg.sendData(payload); } catch (e) { sending = false; info("보내기 실패 — 다시 [저장]을 눌러줘."); }
    };
    if (storage) {
      setTimeout(go, 400);
      writeDraft(go);
    } else go();
  }

  if (!sid || !exercises.length || !M) {
    info("봇 채팅에서 /운동을 보낸 뒤 아래 [🏋 세트 넣기]로 열어줘.");
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
    if (!nonce) nonce = newNonce();
    ready = true;
    changed();
    if (restored) info("아까 넣던 세트를 이어서 보여 줘.");
    else if (!tg || !tg.sendData) info("텔레그램 밖이라 저장은 안 돼.");
  });
})();
