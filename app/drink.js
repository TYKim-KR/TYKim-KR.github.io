// 술 넣기 미니 앱 — 즐겨찾기 격자·±·다른 술 → 텔레그램 [저장] 한 번으로 봇에 보낸다(sendData). 봇이 열린 자리에 더한다.
// 받는 값: 주소 # 뒤 s=자리 번호, c=즐겨찾기, o=다른 술(종류~단위~양|…) — 사람 이름 없음. 보내는 값: 자리 번호·일회용 번호·술 목록뿐.
// initData(텔레그램 사용자 정보)는 읽지 않는다. 이 페이지는 통신 금지 규칙(CSP) 아래라 텔레그램 밖으로는 아무것도 못 보낸다.
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var UNITS = ["잔", "병", "캔", "500cc"];
  var MAX_ITEMS = 12;
  var $ = function (id) { return document.getElementById(id); };
  var info = function (s) { $("info").textContent = s; };

  var hash = new URLSearchParams(location.hash.slice(1));
  var seat = hash.get("s") || "";
  function parseList(raw, limit) {
    var out = [];
    (raw || "").split("|").forEach(function (s) {
      var p = s.split("~");
      var n = Number(p[2]);
      if (p[0] && p[0].length <= 20 && UNITS.indexOf(p[1]) >= 0 && (n === 0.5 || n === 1) && out.length < limit) out.push({ t: p[0], u: p[1], n: n });
    });
    return out;
  }
  var choices = parseList(hash.get("c"), 9);
  var others = parseList(hash.get("o"), 40);

  var items = []; // 이번에 넣을 술 {t, u, n}
  var nonce = null;
  var restored = false;
  var key = function (t, u) { return t + "~" + u; };
  // ± 한 칸 — 그 술에 반 단위 버튼이 있으면 0.5(소주 반병), 아니면 1
  function stepOf(t, u) {
    return choices.concat(others).some(function (c) { return c.t === t && c.u === u && c.n === 0.5; }) ? 0.5 : 1;
  }
  function amountText(it) {
    if (it.u === "500cc") return "500cc " + it.n + "잔";
    if (it.n === 0.5) return "반" + it.u;
    return Math.floor(it.n) + it.u + (it.n % 1 ? " 반" : "");
  }
  function choiceText(c) { return c.t + "\n+" + (c.u === "500cc" ? "500cc" : (c.n === 0.5 ? "반" : "1") + c.u); }
  function haptic(kind) {
    try { if (tg && tg.HapticFeedback) kind === "select" ? tg.HapticFeedback.selectionChanged() : tg.HapticFeedback.impactOccurred("light"); } catch (e) {}
  }
  function newNonce() {
    var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return abc[b % abc.length]; }).join("");
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
  function picked() { return items.filter(function (x) { return x.n > 0; }); }
  function changed() {
    render();
    var total = picked().length;
    if (tg) {
      try { total ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch (e) {}
      if (tg.MainButton) { if (total) { tg.MainButton.setText("저장 (" + total + "종)"); tg.MainButton.show(); } else tg.MainButton.hide(); }
    }
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
      minus.addEventListener("pointerdown", function (e) { e.preventDefault(); add(it.t, it.u, -stepOf(it.t, it.u)); });
      plus.addEventListener("pointerdown", function (e) { e.preventDefault(); add(it.t, it.u, stepOf(it.t, it.u)); });
      row.append(name, count, minus, plus);
      rows.appendChild(row);
    });
  }

  // [다른 술] — 종류 → 양(주소의 o 목록 그대로)
  function openPicker(open) {
    $("picker").hidden = !open;
    $("other").hidden = open || !others.length;
    $("unitBox").hidden = true;
    if (!open) return;
    var types = $("types");
    types.textContent = "";
    var seen = [];
    others.forEach(function (o) { if (seen.indexOf(o.t) < 0) seen.push(o.t); });
    seen.forEach(function (t) {
      var b = document.createElement("button");
      b.textContent = t;
      b.addEventListener("click", function () {
        haptic("select");
        Array.prototype.forEach.call(types.children, function (x) { x.className = x === b ? "on" : ""; });
        $("unitLabel").textContent = t + " 얼마나?";
        var units = $("units");
        units.textContent = "";
        others.filter(function (o) { return o.t === t; }).forEach(function (o) {
          var u = document.createElement("button");
          u.textContent = o.u === "500cc" ? "500cc" : (o.n === 0.5 ? "반" : "1") + o.u;
          u.addEventListener("click", function () { add(o.t, o.u, o.n); openPicker(false); });
          units.appendChild(u);
        });
        $("unitBox").hidden = false;
      });
      types.appendChild(b);
    });
  }
  $("other").addEventListener("click", function () { openPicker(true); });
  $("pickCancel").addEventListener("click", function () { openPicker(false); });

  // 작성 중 값 — 이 기기에만(텔레그램 기기 저장소), 자리마다. 다시 열면 이어 쓴다.
  var storage = tg && tg.isVersionAtLeast && tg.isVersionAtLeast("9.0") ? tg.DeviceStorage : null;
  var draftKey = "drink_" + seat.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  function saveDraft() {
    if (!storage) return;
    try { storage.setItem(draftKey, JSON.stringify({ k: nonce, items: picked() })); } catch (e) {}
  }
  function loadDraft(done) {
    if (!storage) return done();
    try {
      storage.getItem(draftKey, function (err, value) {
        if (!err && value) {
          try {
            var d = JSON.parse(value);
            if (d && typeof d.k === "string" && /^[A-Za-z0-9]{16}$/.test(d.k)) nonce = d.k;
            (Array.isArray(d && d.items) ? d.items : []).forEach(function (x) {
              if (x && typeof x.t === "string" && x.t.length <= 20 && UNITS.indexOf(x.u) >= 0 && typeof x.n === "number" && x.n > 0 && x.n <= 30 && items.length < MAX_ITEMS) items.push({ t: x.t, u: x.u, n: x.n });
            });
            restored = items.length > 0;
          } catch (e) {}
        }
        done();
      });
    } catch (e) { done(); }
  }

  function send() {
    var list = picked().map(function (x) { return { t: x.t, u: x.u, n: x.n }; });
    if (!list.length || !tg || !tg.sendData) return;
    var payload = JSON.stringify({ v: 3, s: seat, k: nonce, items: list });
    try { tg.disableClosingConfirmation(); } catch (e) {}
    info("보내는 중…");
    clearTimeout(saveTimer);
    // 작성 중 값을 비우고 보낸다 — 아이폰은 저장소 답 이벤트가 안 올 수 있어(10-15 체험판) 0.4초 뒤엔 그냥 보낸다(한 번만).
    var sent = false;
    var go = function () {
      if (sent) return;
      sent = true;
      try { tg.sendData(payload); } catch (e) { info("보내기 실패 — 카드 버튼으로 넣어줘."); }
    };
    if (storage) {
      setTimeout(go, 400);
      try { storage.setItem(draftKey, "", go); } catch (e) { go(); }
    } else go();
  }

  if (!seat || !/^[0-9a-f-]{8,40}$/i.test(seat)) {
    info("술자리 카드를 연 뒤 아래 [🍺 술 넣기]로 열어줘.");
    $("other").hidden = true;
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
    $("other").hidden = !others.length;
    changed();
    if (restored) info("아까 넣던 술을 이어서 보여 줘.");
    else if (!tg || !tg.sendData) info("텔레그램 밖이라 저장은 안 돼.");
  });
})();
