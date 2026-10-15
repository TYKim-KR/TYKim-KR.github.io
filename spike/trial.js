// 술 넣기 체험판 — 가짜 예시 데이터. 즐겨찾기 격자·±·다른 술 → 텔레그램 [저장] 한 번으로 봇에 보낸다(sendData, 봇은 저장하지 않고 답만).
// 받는 값: 주소 # 뒤 c=종류~단위~양|… (사람 이름 없음). 보내는 값: 술 목록과 숫자뿐. initData는 읽지 않는다.
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var readyMs = Math.round(performance.now());
  var TYPES = ["소주", "맥주", "막걸리", "와인", "위스키", "하이볼", "고량주", "사케"];
  var UNITS = ["잔", "병", "캔", "500cc"];
  var DRAFT_KEY = "trial_draft";
  var MAX_ITEMS = 12;

  var $ = function (id) { return document.getElementById(id); };
  var cspBlocked = false;
  document.addEventListener("securitypolicyviolation", function (e) { if (e.effectiveDirective === "connect-src") cspBlocked = true; });

  // 주소 # 뒤 즐겨찾기 — 없으면 체험용 기본값
  function parseChoices() {
    var raw = new URLSearchParams(location.hash.slice(1)).get("c");
    var out = [];
    (raw || "소주~병~1|소주~병~0.5|맥주~500cc~1|하이볼~잔~1|와인~잔~1|막걸리~병~1").split("|").forEach(function (s) {
      var p = s.split("~");
      var n = Number(p[2]);
      if (TYPES.indexOf(p[0]) >= 0 && UNITS.indexOf(p[1]) >= 0 && (n === 0.5 || n === 1) && out.length < 9) out.push({ t: p[0], u: p[1], n: n });
    });
    return out;
  }
  var choices = parseChoices();
  var items = []; // {t, u, n}
  var restored = false;

  var key = function (t, u) { return t + "~" + u; };
  var stepOf = function (u) { return u === "병" ? 0.5 : 1; };
  function amountText(it) {
    if (it.u === "500cc") return it.n + "잔";
    if (it.n === 0.5) return "반" + it.u;
    return (it.n % 1 ? it.n.toFixed(1) : String(it.n)) + it.u;
  }
  function choiceText(c) { return c.t + "\n+" + (c.u === "500cc" ? "500cc" : (c.n === 0.5 ? "반" : "1") + c.u); }
  function haptic(kind) {
    try { if (tg && tg.HapticFeedback) kind === "select" ? tg.HapticFeedback.selectionChanged() : tg.HapticFeedback.impactOccurred("light"); } catch (e) {}
  }

  function add(t, u, n) {
    var k = key(t, u);
    var it = items.find(function (x) { return key(x.t, x.u) === k; });
    if (!it) {
      if (items.length >= MAX_ITEMS) return;
      it = { t: t, u: u, n: 0 };
      items.push(it);
    }
    it.n = Math.max(0, Math.min(30, Math.round((it.n + n) * 2) / 2));
    haptic("tap");
    changed();
  }

  var saveTimer = null;
  function changed() {
    render();
    var total = items.filter(function (x) { return x.n > 0; }).length;
    if (tg) {
      try { total ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch (e) {}
      if (tg.MainButton) {
        if (total) { tg.MainButton.setText("저장 (" + total + "종)"); tg.MainButton.show(); } else tg.MainButton.hide();
      }
    }
    $("fallbackSend").hidden = !!(tg && tg.MainButton && tg.platform !== "unknown") || !total;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }

  function render() {
    var grid = $("grid");
    grid.textContent = "";
    choices.forEach(function (c) {
      var b = document.createElement("button");
      b.textContent = choiceText(c);
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); add(c.t, c.u, c.n); });
      grid.appendChild(b);
    });
    var rows = $("rows");
    rows.textContent = "";
    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "row";
      var name = document.createElement("span"); name.className = "name"; name.textContent = it.t;
      var count = document.createElement("span"); count.className = "count"; count.textContent = amountText(it);
      var minus = document.createElement("button"); minus.textContent = "−"; minus.disabled = it.n <= 0;
      var plus = document.createElement("button"); plus.textContent = "+";
      minus.addEventListener("pointerdown", function (e) { e.preventDefault(); add(it.t, it.u, -stepOf(it.u)); });
      plus.addEventListener("pointerdown", function (e) { e.preventDefault(); add(it.t, it.u, stepOf(it.u)); });
      row.append(name, count, minus, plus);
      rows.appendChild(row);
    });
  }

  // [다른 술] — 종류 → 단위 → 1단위 추가
  var pickedType = null;
  function openPicker(open) {
    $("picker").hidden = !open;
    $("other").hidden = open;
    $("unitBox").hidden = true;
    pickedType = null;
    if (!open) return;
    var types = $("types");
    types.textContent = "";
    TYPES.forEach(function (t) {
      var b = document.createElement("button");
      b.textContent = t;
      b.addEventListener("click", function () {
        pickedType = t;
        haptic("select");
        Array.prototype.forEach.call(types.children, function (x) { x.className = x === b ? "on" : ""; });
        $("unitLabel").textContent = t + " — 단위?";
        $("unitBox").hidden = false;
      });
      types.appendChild(b);
    });
    var units = $("units");
    units.textContent = "";
    UNITS.forEach(function (u) {
      var b = document.createElement("button");
      b.textContent = u;
      b.addEventListener("click", function () { if (pickedType) { add(pickedType, u, 1); openPicker(false); } });
      units.appendChild(b);
    });
  }
  $("other").addEventListener("click", function () { openPicker(true); });
  $("pickCancel").addEventListener("click", function () { openPicker(false); });

  // 작성 중 값 — 이 기기에만(텔레그램 기기 저장소). 다시 열면 이어 쓴다.
  var storage = tg && tg.isVersionAtLeast && tg.isVersionAtLeast("9.0") ? tg.DeviceStorage : null;
  function saveDraft() {
    if (!storage) return;
    try { storage.setItem(DRAFT_KEY, JSON.stringify(items.filter(function (x) { return x.n > 0; }))); } catch (e) {}
  }
  function loadDraft(done) {
    if (!storage) return done();
    try {
      storage.getItem(DRAFT_KEY, function (err, value) {
        if (!err && value) {
          try {
            JSON.parse(value).forEach(function (x) {
              if (TYPES.indexOf(x.t) >= 0 && UNITS.indexOf(x.u) >= 0 && typeof x.n === "number" && x.n > 0 && x.n <= 30 && items.length < MAX_ITEMS) items.push({ t: x.t, u: x.u, n: x.n });
            });
            restored = items.length > 0;
          } catch (e) {}
        }
        done();
      });
    } catch (e) { done(); }
  }

  function send() {
    var list = items.filter(function (x) { return x.n > 0; }).map(function (x) { return { t: x.t, u: x.u, n: x.n }; });
    if (!list.length) return;
    var payload = JSON.stringify({ v: 2, items: list, restored: restored, csp: cspBlocked, readyMs: readyMs, sentAt: Date.now() });
    if (!tg || !tg.sendData) { info("텔레그램 밖이라 보낼 수 없어."); return; }
    try { tg.disableClosingConfirmation(); } catch (e) {}
    info("보내는 중…");
    clearTimeout(saveTimer); // 남은 작성 중 저장이 비운 값을 덮지 않게
    // 작성 중 값을 비우고 보낸다. 아이폰은 removeItem(값 null)에 답 이벤트가 안 와 콜백을 기다리면 영영 안 보냈다(10-15 체험) —
    // 저장이 되는 setItem("[]")으로 비우고, 답이 늦어도 0.4초 뒤엔 보낸다(한 번만).
    var sent = false;
    var go = function () {
      if (sent) return;
      sent = true;
      try { tg.sendData(payload); } catch (e) { info("보내기 실패: " + (e && e.message)); }
    };
    if (storage) {
      setTimeout(go, 400);
      try { storage.setItem(DRAFT_KEY, "[]", go); } catch (e) { go(); }
    } else go();
  }
  $("fallbackSend").addEventListener("click", send);

  function info(s) { $("info").textContent = s; }

  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes(); } catch (e) {}
    if (tg.MainButton) tg.MainButton.onClick(send);
  }
  // 통신 금지 규칙 확인 — 같은 사이트로도 요청을 못 보내야 정상(막히면 csp=true)
  try { fetch("csp-probe").catch(function () {}); } catch (e) { cspBlocked = true; }

  loadDraft(function () {
    changed();
    setTimeout(function () {
      info((tg ? tg.platform + " · v" + tg.version : "텔레그램 밖") + " · 준비 " + readyMs + "ms · 통신 차단 " + (cspBlocked ? "확인" : "?") + (restored ? " · 이어서 쓰는 중" : ""));
    }, 300);
  });
})();
