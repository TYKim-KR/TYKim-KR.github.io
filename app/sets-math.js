// 세트 넣기 앱의 ± 한 칸 — 봇 카드와 같은 규칙(ty-assistant src/trainer/weights.ts stepUp·stepDown, card-state.ts adjustReps).
// 무게 w = kg×10 또는 칸. gear: s 칸 ±1(1~99) · d 덤벨·케틀벨(올릴 때 10kg 미만 1kg·이상 2kg, 내릴 때 10kg 이하 1kg·초과 2kg) · b ±2.5kg(0~999.9kg).
// 끝에 닿으면 누르기 전 값을 그대로 둔다.
(function (root) {
  "use strict";
  function stepWeight(gear, w, dir) {
    if (gear === "s") {
      var n = w + dir;
      return n < 1 || n > 99 ? w : n;
    }
    var step = gear === "d" ? (dir > 0 ? (w < 100 ? 10 : 20) : (w <= 100 ? 10 : 20)) : 25;
    var next = w + dir * step;
    return next < 0 || next > 9999 ? w : next;
  }
  // 횟수 ±1(1~999) · 초 ±10(10~999)
  function stepReps(m, r, dir) {
    var step = m === "t" ? 10 : 1;
    var next = r + dir * step;
    return next < step || next > 999 ? r : next;
  }
  var api = { stepWeight: stepWeight, stepReps: stepReps };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SetsMath = api;
})(this);
