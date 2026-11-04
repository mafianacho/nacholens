/* nacholens player.
   One stage with two scenes (the architecture, or the inside of one component) driven by one motion engine,
   the list of flows with their steps, and the current step. Every piece of information has exactly one home:
   flow/step names + change words + review ticks -> sidebar · what is moving now -> stage caption ·
   narration, change reason, data, evidence -> inspector · planner/test/unmapped review -> review dock (review.js).
   Model text is rendered with textContent only. Public API for review.js and tests: window.__nacholens. */
(function () {
  "use strict";
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  var model = JSON.parse($("sv-model").textContent);
  var changes = JSON.parse($("sv-changes").textContent);
  var review = null;
  try { review = $("sv-review-data") ? JSON.parse($("sv-review-data").textContent) : null; } catch (e) { review = null; }
  var TARGET = (doc.documentElement && doc.documentElement.getAttribute && doc.documentElement.getAttribute("data-target")) || "html";
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function now() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }
  function nextFrame(cb) { return typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(function () { cb(now()); }, 16); }
  function cancelFrame(id) { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id); else clearTimeout(id); }

  /* ═════════════════ DOM helpers (text nodes only) ═════════════════ */
  var NS = "http://www.w3.org/2000/svg";
  function h(tag, a) {
    var e = doc.createElement(tag);
    if (a) Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === "on") Object.keys(v).forEach(function (x) { e.addEventListener(x, v[x]); });
      else if (k === "text") e.textContent = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) put(e, arguments[i]);
    return e;
  }
  function put(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { put(e, x); }); return; }
    e.appendChild(typeof c === "object" ? c : doc.createTextNode(String(c)));
  }
  function s(tag, a, text) { var e = doc.createElementNS(NS, tag); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); if (text != null) e.textContent = text; return e; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
  function cls(e, name, on) { if (e && e.classList) e.classList[on ? "add" : "remove"](name); }
  var P = {
    check: "M5 12.5l4.5 4.5L19 7.5", play: "M7 4.5v15l12-7.5z", pause: "M8 5v14M16 5v14", prev: "M15 6l-6 6 6 6", next: "M9 6l6 6-6 6",
    first: "M6 5v14M17 6l-7 6 7 6", replay: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4", chevron: "m6 9 6 6 6-6", expand: "M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6",
    git: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9",
    client: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2",
    gateway: "M12 3 4 7v5c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V7l-8-4Z",
    service: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
    datastore: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    external: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"
  };
  function icon(n) { var e = s("svg", { "class": "i", viewBox: "0 0 24 24", "aria-hidden": "true" }); e.appendChild(s("path", { d: P[n] })); return e; }

  /* ═════════════════ words (English by default; build --lang ko gives Korean) ═════════════════ */
  var LANG = (function () { var l = doc.documentElement && doc.documentElement.getAttribute ? doc.documentElement.getAttribute("lang") : null; return String(l || "en").toLowerCase().indexOf("ko") === 0 ? "ko" : "en"; })();
  var W = LANG === "ko" ? {
    chg: { added: "신규", modified: "변경", removed: "삭제" },
    kind: { client: "클라이언트", gateway: "게이트웨이", service: "서비스", datastore: "데이터 저장소", external: "외부 서비스" },
    step: { request: "요청", response: "응답", call: "왕복 호출", internal: "내부 처리" },
    role: { route: "라우트", handler: "핸들러", middleware: "미들웨어", service: "서비스", port: "포트", adapter: "어댑터", job: "작업", module: "모듈" },
    op: { read: "읽기", insert: "추가", update: "수정", upsert: "추가·수정", delete: "삭제" },
    leg: { req: "요청", res: "응답", int: "내부 호출" },
    callers: "부르는 쪽", callees: "불리는 쪽", colEntry: "진입", colWork: "처리", colAdapter: "어댑터", tables: "테이블", endpoints: "엔드포인트",
    whole: "전체 구조", inside: "내부",
    hidden: function (n, arch) { return (arch ? "이 흐름과 무관한 컴포넌트 " : "이 흐름이 지나지 않는 항목 ") + n + "개는 숨김"; },
    lookInside: function (x) { return x + " 내부 보기"; }, goInside: function (x) { return x + " 내부로 이동"; },
    moreCols: function (n) { return "+" + n + "개 컬럼"; }, sends: "보냄", gets: "받음", details: function (x) { return x + " 자세히"; }, call: "호출",
    idle: "대기", idleText: function (focus, canOpen) { return focus ? "재생하면 " + focus + " 안에서 데이터가 움직입니다" : "재생하면 요청이 컴포넌트 사이를 움직입니다" + (canOpen ? " · 상자를 누르면 내부로" : ""); },
    out: "밖", outText: function (inPath, focus) { return inPath ? "이 단계의 " + focus + " 내부 경로는 모델에 없습니다" : "이 단계는 " + focus + " 밖에서 일어납니다"; },
    work: "내부 처리", workText: function (x) { return x + " 안에서 처리"; },
    first: "처음으로", prev: "이전 단계", next: "다음 단계", play: "재생", pause: "일시정지", replay: "다시 재생", toStep: function (n) { return n + "단계로"; }, speed: "재생 속도",
    noChanges: "변경 없음", reviewed: "이 단계 리뷰함", gChanged: "이번에 바뀐 흐름", gSame: "바뀌지 않은 흐름", gAll: "흐름", reviewedTitle: "바뀐 단계 중 리뷰한 수", reviewBadge: function (a, b) { return "리뷰 " + a + "/" + b; },
    noMatch: "맞는 흐름이 없습니다", overview: "흐름 개요", gone: "이번에 없어진 단계", howTo: "애니메이션 읽는 법", inStep: function (n) { return n + "단계에서 일어나는 일"; },
    field: { label: "단계 이름", kind: "종류", route: "경로", request: "요청", response: "응답" }, before: "변경 전", moved: "내용은 같고 단계 순서만 바뀌었습니다.",
    transforms: "데이터 모양이 바뀌는 곳", sent: "보내는 데이터", received: "받는 데이터", evidence: "근거 코드", changed: "바뀜", table: "테이블", endpoint: "엔드포인트",
    backStep: function (n) { return "← " + n + "단계 설명으로"; }, backOverview: "← 흐름 개요로", insideOf: function (k, x) { return k + " · " + x + " 내부"; }, noDetail: "설명이 모델에 없습니다.",
    newHere: "이번 작업에서 새로 생겼습니다", changedHere: "이번 작업에서 근거 코드가 바뀌었습니다", calledBy: "이 부품을 부르는 곳", calls: "이 부품이 부르는 곳", auth: "인증",
    stepsHere: "이 흐름에서 지나는 단계", stepN: function (n) { return n + "단계"; },
    depthWord: "깊이", depthName: { diff: "변경만", brief: "한눈에", full: "자세히" }, depthHint: { diff: "변경이 닿는 부분만 모델링", brief: "전체 구성만, 세부 없음", full: "전체 구성과 세부까지" },
    lgReq: "요청이 이동 (주황 점)", lgRes: "응답이 돌아옴 (먹색 점)", lgWork: "컴포넌트 안에서 처리 중", lgPast: "이미 지나간 길", lgChanged: "이번 작업으로 생기거나 바뀐 것",
    lgOpen: "상자를 누르면 내부로 들어가 같은 흐름을 봅니다", lgInt: "내부: 부품 사이 호출 (초록 점)",
    ui: { overlay: "변경 강조", nav: "흐름과 단계", search: "흐름 검색", stage: "데이터 흐름 애니메이션", canvas: "아키텍처와 요청 흐름", transport: "재생 제어", review: "검토", insp: "현재 단계 설명" }
  } : {
    chg: { added: "New", modified: "Changed", removed: "Removed" },
    kind: { client: "Client", gateway: "Gateway", service: "Service", datastore: "Data store", external: "External service" },
    step: { request: "Request", response: "Response", call: "Round trip", internal: "Internal" },
    role: { route: "Route", handler: "Handler", middleware: "Middleware", service: "Service", port: "Port", adapter: "Adapter", job: "Job", module: "Module" },
    op: { read: "Read", insert: "Insert", update: "Update", upsert: "Upsert", delete: "Delete" },
    leg: { req: "Request", res: "Response", int: "Internal call" },
    callers: "Callers", callees: "Called", colEntry: "Entry", colWork: "Logic", colAdapter: "Adapters", tables: "Tables", endpoints: "Endpoints",
    whole: "Architecture", inside: "inside",
    hidden: function (n, arch) { return n + (arch ? (n === 1 ? " component" : " components") + " not on this flow hidden" : (n === 1 ? " item" : " items") + " this flow does not pass hidden"); },
    lookInside: function (x) { return "Look inside " + x; }, goInside: function (x) { return "Go inside " + x; },
    moreCols: function (n) { return "+" + n + (n === 1 ? " column" : " columns"); }, sends: "Req", gets: "Res", details: function (x) { return x + ": details"; }, call: "Call",
    idle: "Idle", idleText: function (focus, canOpen) { return focus ? "Press play to watch the data move inside " + focus : "Press play to watch the request move between components" + (canOpen ? " · click a box to look inside" : ""); },
    out: "Outside", outText: function (inPath, focus) { return inPath ? "The model has no path inside " + focus + " for this step" : "This step happens outside " + focus; },
    work: "Working", workText: function (x) { return "Working inside " + x; },
    first: "Back to the start", prev: "Previous step", next: "Next step", play: "Play", pause: "Pause", replay: "Replay", toStep: function (n) { return "Go to step " + n; }, speed: "Playback speed",
    noChanges: "No changes", reviewed: "I reviewed this step", gChanged: "Changed in this work", gSame: "Not changed", gAll: "Flows", reviewedTitle: "Changed steps reviewed", reviewBadge: function (a, b) { return "Reviewed " + a + "/" + b; },
    noMatch: "No matching flow", overview: "Flow overview", gone: "Steps removed in this work", howTo: "How to read the animation", inStep: function (n) { return "What happens in step " + n; },
    field: { label: "Step name", kind: "Kind", route: "Route", request: "Request", response: "Response" }, before: "Before", moved: "Same content; only the step order changed.",
    transforms: "Where the data changes shape", sent: "Data sent", received: "Data received", evidence: "Evidence", changed: "Changed", table: "Table", endpoint: "Endpoint",
    backStep: function (n) { return "← Back to step " + n; }, backOverview: "← Back to the flow overview", insideOf: function (k, x) { return k + " · inside " + x; }, noDetail: "The model has no description.",
    newHere: "New in this work", changedHere: "Its evidence code changed in this work", calledBy: "Called by", calls: "Calls", auth: "Authentication",
    stepsHere: "Steps of this flow that pass here", stepN: function (n) { return "Step " + n; },
    depthWord: "Depth", depthName: { diff: "Changes only", brief: "Overview", full: "Detailed" }, depthHint: { diff: "Only the parts the change touches", brief: "The whole composition, no detail", full: "The whole composition and its detail" },
    lgReq: "A request moves (orange dot)", lgRes: "The response comes back (ink dot)", lgWork: "Working inside a component", lgPast: "Path already taken", lgChanged: "Added or changed in this work",
    lgOpen: "Click a box to see the same flow inside it", lgInt: "Inside: a call between parts (green dot)",
    ui: null
  };

  /* ═════════════════ vocabulary (one table for every status) ═════════════════ */
  var ST = { added: ["success", W.chg.added], modified: ["warning", W.chg.modified], removed: ["danger", W.chg.removed] };
  var KIND = W.kind, STEP_KO = W.step, ROLE_KO = W.role, OP_KO = W.op, LEG_KO = W.leg;
  var LANE = { client: 0, gateway: 1, service: 2, datastore: 3, external: 3 };

  /* ═════════════════ derived data ═════════════════ */
  var comp = {}; model.components.forEach(function (c) { comp[c.id] = c; });
  var ucById = {}; model.useCases.forEach(function (u) { ucById[u.id] = u; });
  var stepChg = {}, compChg = {}, dchg = {};
  if (changes) {
    (changes.steps || []).forEach(function (c) { stepChg[c.useCase + "/" + c.step] = c; });
    (changes.components || []).forEach(function (c) { compChg[c.id] = c; });
    (changes.details || []).forEach(function (d) { dchg[d.component + "|" + d.kind + "|" + d.id] = d.change; });
  }
  var cmp = {}; if (review && review.compare) review.compare.useCases.forEach(function (u) { cmp[u.id] = u; });
  function uc() { return ucById[S.uc]; }
  function first(l) { return String(l).split("\n")[0]; }
  function pathOf(st) { return [st.from].concat(st.via || [], [st.to]); }
  function chgOf(u, st) { return (S.overlay && stepChg[u.id + "/" + st.id]) || null; }
  function changedSteps(u) { return u.steps.filter(function (st) { return stepChg[u.id + "/" + st.id]; }); }
  function anyChange() { return !!changes && (model.useCases.some(function (u) { return changedSteps(u).length; }) || (changes.components || []).length > 0); }
  function hasDetail(c) { return !!(c && ((c.parts && c.parts.length) || (c.tables && c.tables.length) || (c.endpoints && c.endpoints.length))); }
  function compTag(id) { // marked only when changed AND on a changed step of the selected flow
    var c = compChg[id]; if (!c || !S.overlay) return null;
    return changedSteps(uc()).some(function (st) { return pathOf(st).indexOf(id) >= 0; }) ? c.change : null;
  }
  function evRef(e) { return e.file + ":" + e.lines[0] + (e.lines[1] !== e.lines[0] ? "-" + e.lines[1] : ""); }

  /* ═════════════════ state ═════════════════ */
  function parseHash(raw) { var o = {}; String(raw || "").replace(/^#/, "").split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
  var H0 = parseHash(typeof location !== "undefined" ? location.hash : "");
  var start = model.useCases.filter(function (u) { return changedSteps(u).length; })[0] || model.useCases[0];
  var S = { uc: H0.uc && ucById[H0.uc] ? H0.uc : start.id, overlay: !!changes, filter: "", collapsed: { same: true }, item: null, zooming: false };
  var KEY = "sv-player:" + ((changes && changes.ref) || model.product.id), ticks = {};
  try { ticks = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { ticks = {}; }
  function setTick(id, on) { if (on) ticks[id] = 1; else delete ticks[id]; try { localStorage.setItem(KEY, JSON.stringify(ticks)); } catch (e) { /* storage blocked: ticks last for this visit */ } }

  /* ═════════════════ Stage: scenes ═════════════════
     A scene is a table of boxes { id: {x, y, w, h, kind, ref} }: the architecture, or the inside of one component
     (parts + wires / tables / endpoints) with its neighbours as dashed stubs. Paths inside come only from the model
     (step.trace, step.data, step.endpoints); nothing is inferred. */
  var G = { W: 800, H: 400, NW: 168, NH: 56 };
  var SC = { mode: "arch", focus: null, pos: {}, hidden: 0, heads: [] };
  function measure() { var st = $("sv-stage"); G.W = Math.max(480, st.clientWidth || 0); G.H = Math.max(260, st.clientHeight || 0); }
  function ucComps(u) { var out = []; u.steps.forEach(function (st) { pathOf(st).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); }); return out; }
  function archLayout() {
    var used = ucComps(uc()); SC.pos = {}; SC.heads = [];
    // scale rule: with many components only the ones this flow touches are drawn
    var shown = model.components.length > 8 ? model.components.filter(function (c) { return used.indexOf(c.id) >= 0; }) : model.components.slice();
    SC.hidden = model.components.length - shown.length;
    var lanes = {}; shown.forEach(function (c) { var l = c.lane != null ? c.lane : LANE[c.kind]; (lanes[l] = lanes[l] || []).push(c); });
    var keys = Object.keys(lanes).map(Number).sort(function (a, b) { return a - b; });
    G.NW = Math.round(Math.max(140, Math.min(200, (G.W - 60) / keys.length - 44)));
    var mx = G.NW / 2 + 32, span = keys.length > 1 ? (G.W - 2 * mx) / (keys.length - 1) : 0, top = 76, bottom = 28;
    keys.forEach(function (k, li) {
      var list = lanes[k], rows = {}, used2 = {}, next = 0;
      list.forEach(function (c) { if (c.row != null) { rows[c.id] = c.row; used2[c.row] = 1; } });
      list.forEach(function (c) { if (rows[c.id] == null) { while (used2[next]) next++; rows[c.id] = next; used2[next] = 1; } });
      var order = Object.keys(used2).map(Number).sort(function (a, b) { return a - b; }), n = order.length;
      var gap = n > 1 ? Math.min(108, Math.max(G.NH + 18, (G.H - top - bottom - G.NH) / (n - 1))) : 0;
      list.forEach(function (c) {
        var i = order.indexOf(rows[c.id]);
        SC.pos[c.id] = { x: keys.length > 1 ? mx + li * span : G.W / 2, y: top + (G.H - top - bottom) / 2 + (i - (n - 1) / 2) * gap, w: G.NW, h: G.NH, lane: li, kind: "node", ref: c };
      });
    });
  }
  function traceIn(st, cid) { return (st.trace || []).filter(function (r) { return r.split("/")[0] === cid; }).map(function (r) { return "p:" + r.split("/")[1]; }); }
  function targetsIn(st, c) { // the cards a step reaches inside a datastore / third party
    if (c.tables) return (st.data || []).filter(function (d) { return d.store === c.id; }).map(function (d) { return "t:" + d.table; });
    if (c.endpoints) return (st.endpoints || []).filter(function (e) { return e.split("/")[0] === c.id; }).map(function (e) { return "e:" + e.split("/")[1]; });
    return [];
  }
  function detailLayout() {
    var c = comp[SC.focus], u = uc(), top = 98, bottom = 26, pad = 18, stubW = 104, stubH = 44;
    SC.pos = {}; SC.heads = []; SC.hidden = 0;
    // neighbours this flow connects to the focus: earlier lanes on the left (callers), later lanes on the right (callees)
    var nb = [];
    u.steps.forEach(function (st) { var p = pathOf(st); p.forEach(function (id, i) { if (id !== c.id) return; [p[i - 1], p[i + 1]].forEach(function (n) { if (n && n !== c.id && nb.indexOf(n) < 0) nb.push(n); }); }); });
    var me = LANE[c.kind], left = nb.filter(function (id) { return LANE[comp[id].kind] < me; }), right = nb.filter(function (id) { return LANE[comp[id].kind] >= me; });
    function stubs(list, x, head) {
      if (!list.length) return;
      SC.heads.push({ x: x, text: head });
      var gap = Math.min(92, (G.H - top - bottom) / list.length);
      list.forEach(function (id, i) { SC.pos["stub:" + id] = { x: x, y: top + (G.H - top - bottom) / 2 + (i - (list.length - 1) / 2) * gap, w: stubW, h: stubH, kind: "stub", ref: comp[id] }; });
    }
    stubs(left, pad + stubW / 2, W.callers);
    stubs(right, G.W - pad - stubW / 2, W.callees);
    var inL = left.length ? pad + stubW + 44 : pad, inR = right.length ? G.W - pad - stubW - 44 : G.W - pad;
    if (c.parts && c.parts.length) {
      var byId = {}; c.parts.forEach(function (p) { byId[p.id] = p; });
      var order = []; u.steps.forEach(function (st) { traceIn(st, c.id).forEach(function (id) { if (order.indexOf(id) < 0 && byId[id.slice(2)]) order.push(id); }); });
      var list = (order.length ? order.map(function (id) { return byId[id.slice(2)]; }) : c.parts.slice()).slice(0, 14);
      SC.hidden = c.parts.length - list.length; // scale rule: only the parts this flow passes
      var cols = [[W.colEntry, ["route", "handler", "middleware"]], [W.colWork, ["service", "module", "job", "port"]], [W.colAdapter, ["adapter"]]]
        .map(function (g) { return { name: g[0], items: list.filter(function (p) { return g[1].indexOf(p.role) >= 0; }) }; })
        .filter(function (g) { return g.items.length; });
      var colW = (inR - inL) / cols.length, cw = Math.max(124, Math.min(190, colW - 64)), ch = 58;
      cols.forEach(function (col, ci) {
        var x = inL + colW * (ci + 0.5), n = col.items.length, gap = n > 1 ? Math.min(86, Math.max(ch + 12, (G.H - top - bottom - ch) / (n - 1))) : 0; // room for a transform chip when there is space
        SC.heads.push({ x: x, text: col.name });
        col.items.forEach(function (p, i) { SC.pos["p:" + p.id] = { x: x, y: top + (G.H - top - bottom) / 2 + (i - (n - 1) / 2) * gap, w: cw, h: ch, kind: "part", ref: p, col: ci }; });
      });
      return;
    }
    var used = {}; u.steps.forEach(function (st) { targetsIn(st, c).forEach(function (id) { used[id] = 1; }); });
    var cards = c.tables ? c.tables.map(function (t) { return { id: "t:" + t.name, kind: "table", ref: t, lines: t.columns.length }; })
      : c.endpoints.map(function (e) { return { id: "e:" + e.id, kind: "endpoint", ref: e, lines: 2 }; });
    cards.sort(function (a, b) { return (used[b.id] ? 1 : 0) - (used[a.id] ? 1 : 0); }); // the ones this flow reaches first
    var avail = inR - inL, ncol = Math.max(1, Math.min(3, Math.floor(avail / 240))), cw2 = avail / ncol - 18, all = (c.tables || c.endpoints).length;
    cards = cards.slice(0, ncol * 3); SC.hidden = all - cards.length;
    var maxLines = 6, rowsH = [], total = 0;
    for (var pass = 0; pass < 3; pass++) {
      cards.forEach(function (cd) { cd.show = Math.min(cd.lines, maxLines); cd.h = 46 + cd.show * 17 + (cd.lines > cd.show ? 18 : 0); });
      rowsH = []; cards.forEach(function (cd, i) { var r = Math.floor(i / ncol); rowsH[r] = Math.max(rowsH[r] || 0, cd.h); });
      total = rowsH.reduce(function (a, b) { return a + b; }, 0) + 14 * Math.max(0, rowsH.length - 1);
      if (total <= G.H - top - bottom) break;
      maxLines = maxLines > 3 ? 3 : 1;
    }
    var y = top + Math.max(0, (G.H - top - bottom - total) / 2);
    rowsH.forEach(function (rh, r) {
      cards.slice(r * ncol, r * ncol + ncol).forEach(function (cd, k) { SC.pos[cd.id] = { x: inL + (k + 0.5) * (avail / ncol), y: y + cd.h / 2, w: cw2, h: cd.h, kind: cd.kind, ref: cd.ref, show: cd.show }; });
      y += rh + 14;
    });
    SC.heads.push({ x: (inL + inR) / 2, text: c.tables ? W.tables : W.endpoints });
  }

  /* ═════════════════ Stage: geometry (computed here, so the engine needs no SVG measuring) ═════════════════ */
  function edge(id, tx, ty) {
    var p = SC.pos[id], dx = tx - p.x, dy = ty - p.y, hw = p.w / 2 + 3, hh = p.h / 2 + 3;
    if (!dx && !dy) return { x: p.x, y: p.y };
    var t = Math.min(dx ? hw / Math.abs(dx) : 1e9, dy ? hh / Math.abs(dy) : 1e9);
    return { x: p.x + dx * t, y: p.y + dy * t };
  }
  function bend(a, b) {
    var A0 = SC.pos[a], B0 = SC.pos[b];
    if (SC.mode === "arch" && Math.abs(A0.lane - B0.lane) > 1) return { x: (A0.x + B0.x) / 2, y: (A0.y + B0.y) / 2 > G.H / 2 ? Math.max(A0.y, B0.y) + 110 : Math.min(A0.y, B0.y) - 110 };
    if (SC.mode === "detail" && Math.abs(A0.x - B0.x) < 1 && Math.abs(A0.y - B0.y) > 1.7 * A0.h) return { x: A0.x + A0.w / 2 + 48, y: (A0.y + B0.y) / 2 }; // same column, not adjacent: go around
    return null;
  }
  function hopStraight(a, b) {
    var A0 = SC.pos[a], B0 = SC.pos[b], c = bend(a, b);
    if (!c) return [edge(a, B0.x, B0.y), edge(b, A0.x, A0.y)];
    var q0 = edge(a, c.x, c.y), q1 = edge(b, c.x, c.y), out = [];
    for (var i = 0; i <= 20; i++) { var t = i / 20, v = 1 - t; out.push({ x: v * v * q0.x + 2 * v * t * c.x + t * t * q1.x, y: v * v * q0.y + 2 * v * t * c.y + t * t * q1.y }); }
    return out;
  }

  /* Edge routing. Every wire is an orthogonal path from the side of one box to the side of another that runs only through
     the free channels between boxes (never under a box), keeps clear of every other box by `m` px, and is spread over its own
     line where several wires share a channel or a side. It is the same polyline for the drawn wire and for the travelling
     packet. Found on the lines through the box edges (Dijkstra, a penalty per bend and per stretch shared with a wire placed
     before); if no free path exists at any clearance the old straight/curved hop is used. */
  var ROUTE = {};
  var CLEAR = [10, 6, 3], BEND = 24, CROSS = 20, ROUND = 9;
  function keyPair(a, b) { return a + "\u0001" + b; }
  function rectOf(id) { var p = SC.pos[id]; return { x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - p.h / 2, y1: p.y + p.h / 2 }; }
  function sideFor(a, b, ids) { // [side of a, side of b]: R, L, T, B
    var A0 = rectOf(a), B0 = rectOf(b);
    if (B0.x0 >= A0.x1 + 6) return ["R", "L"];
    if (A0.x0 >= B0.x1 + 6) return ["L", "R"];
    var top = A0.y1 <= B0.y0, lo = top ? A0.y1 : B0.y1, hi = top ? B0.y0 : A0.y0, x0 = Math.max(A0.x0, B0.x0), x1 = Math.min(A0.x1, B0.x1), clear = x1 - x0 > 8;
    ids.forEach(function (o) { if (o === a || o === b) return; var Q = rectOf(o); if (Q.y1 > lo && Q.y0 < hi && Q.x1 > x0 && Q.x0 < x1) clear = false; });
    if (clear && (A0.y1 <= B0.y0 || B0.y1 <= A0.y0)) return top ? ["B", "T"] : ["T", "B"];
    return ["R", "R"]; // same column with a box in between: around the right side
  }
  function outDir(side) { return side === "R" ? [1, 0] : side === "L" ? [-1, 0] : side === "T" ? [0, -1] : [0, 1]; }
  function portAt(id, side, k, n) { // the k-th of n ports on a side, spread over the middle of it
    var B0 = rectOf(id), horiz = side === "L" || side === "R", len = horiz ? B0.y1 - B0.y0 : B0.x1 - B0.x0, gap = n > 1 ? Math.min(13, (len - 18) / (n - 1)) : 0, off = (k - (n - 1) / 2) * gap;
    if (side === "R") return { x: B0.x1, y: (B0.y0 + B0.y1) / 2 + off };
    if (side === "L") return { x: B0.x0, y: (B0.y0 + B0.y1) / 2 + off };
    if (side === "T") return { x: (B0.x0 + B0.x1) / 2 + off, y: B0.y0 };
    return { x: (B0.x0 + B0.x1) / 2 + off, y: B0.y1 };
  }
  function uniq(list) { var o = list.slice().sort(function (a, b) { return a - b; }), r = []; o.forEach(function (v) { v = Math.round(v * 100) / 100; if (!r.length || v - r[r.length - 1] > 0.5) r.push(v); }); return r; }
  function fillChannels(base, lo, hi) { // lines through every free gap, 8 px apart, so wires sharing a channel do not overlap (none closer than 4 px to another line)
    var s0 = uniq(base), out = s0.slice();
    function free(v) { for (var j = 0; j < out.length; j++) if (Math.abs(out[j] - v) < 4) return false; return true; }
    for (var i = 1; i < s0.length; i++) {
      var a = s0[i - 1], b = s0[i], w = b - a; if (w < 11) continue;
      var mid = (a + b) / 2; if (free(mid)) out.push(mid);
      for (var k = 1; k <= 3; k++) { if (mid - 8 * k > a + 3 && free(mid - 8 * k)) out.push(mid - 8 * k); if (mid + 8 * k < b - 3 && free(mid + 8 * k)) out.push(mid + 8 * k); }
    }
    return uniq(out.filter(function (v) { return v >= lo && v <= hi; }));
  }
  function overlapLen(map, key, a0, a1) { var l = map[key], t = 0; if (!l) return 0; for (var i = 0; i < l.length; i++) t += Math.max(0, Math.min(a1, l[i][1]) - Math.max(a0, l[i][0])); return t; }
  function crossings(map, a0, a1, c) { // placed wires running the other way that this stretch (from a0 to a1 at line c) cuts across
    var n = 0; Object.keys(map).forEach(function (k) { var v = +k; if (v <= a0 + 0.5 || v >= a1 - 0.5) return; map[k].forEach(function (r) { if (c > r[0] + 0.5 && c < r[1] - 0.5) n++; }); }); return n;
  }
  function sharedCost(U, horiz, c, a0, a1) { // cost of running along line c from a0 to a1: on top of a placed wire is worst, within 7 px of one is bad
    var map = horiz ? U.h : U.v, other = horiz ? U.v : U.h, cost = 0, k = Math.round(c), ov = overlapLen(map, k, a0, a1);
    if (ov > 0) cost += ov * 4 + 40;
    for (var d = 1; d <= 6; d++) { var near = overlapLen(map, k - d, a0, a1) + overlapLen(map, k + d, a0, a1); if (near > 0) cost += d <= 3 ? near * 2.5 + 20 : near * 0.3 + 3; }
    return cost + crossings(other, a0, a1, c) * CROSS;
  }
  function addUsed(U, pts) {
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i];
      if (Math.abs(p.y - q.y) < 0.01) (U.h[Math.round(p.y)] = U.h[Math.round(p.y)] || []).push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
      else if (Math.abs(p.x - q.x) < 0.01) (U.v[Math.round(p.x)] = U.v[Math.round(p.x)] || []).push([Math.min(p.y, q.y), Math.max(p.y, q.y)]);
    }
  }
  function makeGrid(boxes, ports, m, bounds) { // the lines through the box edges (kept m px clear of every box), the lane lines of each free gap and the port stubs
    var infl = boxes.map(function (b) { return { x0: b.x0 - m, x1: b.x1 + m, y0: b.y0 - m, y1: b.y1 + m }; }), EPS = 0.01;
    function inside(x, y) { for (var i = 0; i < infl.length; i++) { var q = infl[i]; if (x > q.x0 + EPS && x < q.x1 - EPS && y > q.y0 + EPS && y < q.y1 - EPS) return true; } return false; }
    var bx = [bounds.x0, bounds.x1], by = [bounds.y0, bounds.y1];
    infl.forEach(function (q) { bx.push(q.x0, q.x1); by.push(q.y0, q.y1); });
    var sx = [], sy = []; ports.forEach(function (p) { sx.push(p.x + p.dx * m); sy.push(p.y + p.dy * m); });
    var xs = uniq(fillChannels(bx, bounds.x0, bounds.x1).concat(sx)), ys = uniq(fillChannels(by, bounds.y0, bounds.y1).concat(sy)), NX = xs.length, NY = ys.length, N = NX * NY;
    var blocked = new Uint8Array(N), hBlock = new Uint8Array(N), vBlock = new Uint8Array(N);
    for (var iy = 0; iy < NY; iy++) for (var ix = 0; ix < NX; ix++) {
      var n = iy * NX + ix; blocked[n] = inside(xs[ix], ys[iy]) ? 1 : 0;
      if (ix + 1 < NX && inside((xs[ix] + xs[ix + 1]) / 2, ys[iy])) hBlock[n] = 1;
      if (iy + 1 < NY && inside(xs[ix], (ys[iy] + ys[iy + 1]) / 2)) vBlock[n] = 1;
    }
    return { m: m, xs: xs, ys: ys, NX: NX, NY: NY, blocked: blocked, hBlock: hBlock, vBlock: vBlock, inside: inside };
  }
  function nearestIdx(list, v) { var best = 0, bd = 1e9; for (var i = 0; i < list.length; i++) { var d = Math.abs(list[i] - v); if (d < bd) { bd = d; best = i; } } return best; }
  function findPath(G2, S0, S1, d0, d1, U) { // A* over the grid, a penalty per bend, per stretch on or beside a placed wire and per crossing of one
    var xs = G2.xs, ys = G2.ys, NX = G2.NX, NY = G2.NY, N = NX * NY;
    if (G2.inside(S0.x, S0.y) || G2.inside(S1.x, S1.y)) return null;
    var s = nearestIdx(ys, S0.y) * NX + nearestIdx(xs, S0.x), g = nearestIdx(ys, S1.y) * NX + nearestIdx(xs, S1.x);
    var gx = xs[g % NX], gy = ys[(g - g % NX) / NX];
    var dist = new Float64Array(N * 4).fill(1e12), prev = new Int32Array(N * 4).fill(-1), costH = new Float64Array(N).fill(-1), costV = new Float64Array(N).fill(-1);
    var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], heap = [];
    function push(c, st) { heap.push([c, st]); var i = heap.length - 1; while (i > 0) { var pa = (i - 1) >> 1; if (heap[pa][0] <= heap[i][0]) break; var t = heap[pa]; heap[pa] = heap[i]; heap[i] = t; i = pa; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m2 = i; if (l < heap.length && heap[l][0] < heap[m2][0]) m2 = l; if (r < heap.length && heap[r][0] < heap[m2][0]) m2 = r; if (m2 === i) break; var t = heap[m2]; heap[m2] = heap[i]; heap[i] = t; i = m2; } } return top; }
    var startDir = d0[0] === 1 ? 0 : d0[1] === 1 ? 1 : d0[0] === -1 ? 2 : 3, inDir = [-d1[0], -d1[1]], want = inDir[0] === 1 ? 0 : inDir[1] === 1 ? 1 : inDir[0] === -1 ? 2 : 3;
    dist[s * 4 + startDir] = 0; push(Math.abs(gx - xs[s % NX]) + Math.abs(gy - ys[(s - s % NX) / NX]), s * 4 + startDir);
    var done = -1, bestTotal = 1e12;
    while (heap.length) {
      var cur = pop(), st = cur[1], n = st >> 2, d = st & 3, gc = dist[st];
      if (cur[0] - 1e-9 > bestTotal) break; // nothing left that can beat the best way in
      var nx = n % NX, ny = (n - nx) / NX;
      if (n === g) { var tot = gc + (d !== want ? BEND : 0); if (tot < bestTotal) { bestTotal = tot; done = st; } continue; }
      for (var e = 0; e < 4; e++) {
        if (e === ((d + 2) & 3)) continue;
        var mx = nx + DX[e], my = ny + DY[e]; if (mx < 0 || my < 0 || mx >= NX || my >= NY) continue;
        var m1 = my * NX + mx; if (G2.blocked[m1]) continue;
        var horiz = e % 2 === 0, eid = e === 0 ? n : e === 2 ? m1 : e === 1 ? n : m1;
        if (horiz ? G2.hBlock[eid] : G2.vBlock[eid]) continue;
        var ax = xs[nx], ay = ys[ny], bx2 = xs[mx], by2 = ys[my], cache = horiz ? costH : costV, extra = cache[eid];
        if (extra < 0) { extra = horiz ? sharedCost(U, true, ay, Math.min(ax, bx2), Math.max(ax, bx2)) : sharedCost(U, false, ax, Math.min(ay, by2), Math.max(ay, by2)); cache[eid] = extra; }
        var len = Math.abs(bx2 - ax) + Math.abs(by2 - ay), c = gc + len + (e !== d ? BEND : 0) + extra, st2 = m1 * 4 + e;
        if (c < dist[st2] - 1e-9) { dist[st2] = c; prev[st2] = st; push(c + Math.abs(gx - bx2) + Math.abs(gy - by2), st2); }
      }
    }
    if (done < 0) return null;
    var out = []; for (var cs = done; cs >= 0; cs = prev[cs]) { var nn = cs >> 2; out.push({ x: xs[nn % NX], y: ys[(nn - nn % NX) / NX] }); }
    return out.reverse();
  }
  function tidy(pts) { // drop repeated and collinear points
    var o = [];
    pts.forEach(function (p) {
      if (o.length && Math.abs(o[o.length - 1].x - p.x) < 0.01 && Math.abs(o[o.length - 1].y - p.y) < 0.01) return;
      if (o.length > 1) { var a = o[o.length - 2], b = o[o.length - 1]; if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01)) o.pop(); }
      o.push(p);
    });
    return o;
  }
  function rounded(pts) { // soften the right-angle corners
    if (pts.length < 3) return pts;
    var o = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1], l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y), r = Math.min(ROUND, l1 / 2, l2 / 2);
      if (r < 5) { o.push(b); continue; } // a jog too short for a round corner stays square
      var p0 = { x: b.x + (a.x - b.x) / l1 * r, y: b.y + (a.y - b.y) / l1 * r }, p1 = { x: b.x + (c.x - b.x) / l2 * r, y: b.y + (c.y - b.y) / l2 * r };
      for (var k = 0; k <= 4; k++) { var t = k / 4, v = 1 - t; o.push({ x: v * v * p0.x + 2 * v * t * b.x + t * t * p1.x, y: v * v * p0.y + 2 * v * t * b.y + t * t * p1.y }); }
    }
    o.push(pts[pts.length - 1]); return o;
  }
  function wiresOf() { // every pair of boxes a wire or a step crosses in the current scene
    var pairs = [], seen = {};
    function add(a, b) { if (!a || !b || a === b || !SC.pos[a] || !SC.pos[b]) return; var k = keyOf(a, b); if (seen[k]) return; seen[k] = 1; pairs.push([a, b]); }
    if (SC.mode === "arch") model.links.forEach(function (l) { add(l.a, l.b); });
    else (comp[SC.focus].wires || []).forEach(function (w) { add("p:" + w.from, "p:" + w.to); });
    uc().steps.forEach(function (st) { legsOf(st).forEach(function (lg) { if (lg.type === "move") lg.ids.slice(1).forEach(function (b, i) { add(lg.ids[i], b); }); }); });
    return pairs;
  }
  function planRoutes() {
    ROUTE = {};
    var ids = Object.keys(SC.pos), pairs = wiresOf(), boxes = ids.map(rectOf), sides = {}, ends = {};
    pairs.forEach(function (pr, i) {
      var sd = sideFor(pr[0], pr[1], ids); sides[i] = sd;
      [[0, pr[0], pr[1]], [1, pr[1], pr[0]]].forEach(function (e) { var k = e[1] + "|" + sd[e[0]]; (ends[k] = ends[k] || []).push({ i: i, end: e[0], other: SC.pos[e[2]] }); });
    });
    var port = {}; // "pair index/end" -> point, wires on one side ordered by where they lead so they do not cross at the box
    Object.keys(ends).forEach(function (k) {
      var side = k.split("|")[1], horiz = side === "L" || side === "R", list = ends[k];
      list.sort(function (a, b) { return (horiz ? a.other.y - b.other.y : a.other.x - b.other.x) || a.i - b.i; });
      list.forEach(function (e, n) { port[e.i + "/" + e.end] = portAt(k.split("|")[0], side, n, list.length); });
    });
    var minY = 1e9, maxY = 0, minX = 1e9, maxX = 0; boxes.forEach(function (b) { minY = Math.min(minY, b.y0); maxY = Math.max(maxY, b.y1); minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1); });
    var bounds = { x0: Math.min(4, minX - 12), x1: Math.max(G.W - 4, maxX + 12), y0: Math.min(minY - 14, SC.mode === "detail" ? 92 : 50), y1: Math.max(G.H - 8, maxY + 14) };
    var U = { h: {}, v: {} }, order = pairs.map(function (pr, i) { return i; });
    order.sort(function (a, b) { var A0 = SC.pos[pairs[a][0]], A1 = SC.pos[pairs[a][1]], B0 = SC.pos[pairs[b][0]], B1 = SC.pos[pairs[b][1]]; return (Math.abs(A0.x - A1.x) + Math.abs(A0.y - A1.y)) - (Math.abs(B0.x - B1.x) + Math.abs(B0.y - B1.y)) || a - b; });
    var grids = {}, stubs = []; // every wire end, so each clearance level has one grid for the whole scene
    pairs.forEach(function (pr, i) { [0, 1].forEach(function (end) { var P = port[i + "/" + end], d = outDir(sides[i][end]); stubs.push({ x: P.x, y: P.y, dx: d[0], dy: d[1] }); }); });
    function gridFor(t) { return grids[t] || (grids[t] = makeGrid(boxes, stubs, CLEAR[t], bounds)); }
    function routeOne(i, used) {
      var P0 = port[i + "/0"], P1 = port[i + "/1"], d0 = outDir(sides[i][0]), d1 = outDir(sides[i][1]);
      for (var t = 0; t < CLEAR.length; t++) {
        var m = CLEAR[t], S0 = { x: P0.x + d0[0] * m, y: P0.y + d0[1] * m }, S1 = { x: P1.x + d1[0] * m, y: P1.y + d1[1] * m }, mid = findPath(gridFor(t), S0, S1, d0, d1, used);
        if (mid) return tidy([P0].concat(mid, [P1]));
      }
      return null;
    }
    order.forEach(function (i) {
      var r = routeOne(i, U);
      if (r) { addUsed(U, r); ROUTE[keyPair(pairs[i][0], pairs[i][1])] = { from: pairs[i][0], pts: rounded(r) }; }
    });
  }
  function hopPts(a, b) {
    var r = ROUTE[keyPair(a, b)] || ROUTE[keyPair(b, a)];
    if (!r) return hopStraight(a, b);
    return r.from === a ? r.pts : r.pts.slice().reverse();
  }
  function routePts(ids) { var pts = []; ids.slice(1).forEach(function (b, i) { pts = pts.concat(hopPts(ids[i], b)); }); return pts; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function dOf(pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + r1(p.x) + " " + r1(p.y); }).join(" "); }
  function lengths(pts) { var acc = [0]; for (var i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)); return acc; }
  function pointAt(pts, acc, d) {
    if (d <= 0) return pts[0];
    for (var i = 1; i < pts.length; i++) if (acc[i] >= d) { var k = acc[i] === acc[i - 1] ? 0 : (d - acc[i - 1]) / (acc[i] - acc[i - 1]); return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k }; }
    return pts[pts.length - 1];
  }
  // a tag box around centred text: the rendered width when the browser can measure it (the embedded fonts are wider
  // or narrower than the estimate), the estimate otherwise; `pad` on each side so the text never touches the edge
  // (and, given `max`, shortened with … until the measured text fits)
  function measure(text) { try { return text.getComputedTextLength ? text.getComputedTextLength() || 0 : 0; } catch (e) { return 0; } }
  function fitPad(rect, text, cx, est, pad, max) {
    var tw = measure(text);
    if (max && tw && tw + 2 * pad > max) {
      var str = String(text.textContent).replace(/…$/, "");
      while (str.length > 1 && tw + 2 * pad > max) { str = str.slice(0, -1); text.textContent = str.replace(/\s+$/, "") + "…"; tw = measure(text); }
      est = Math.min(est, tw);
    }
    var w = Math.max(est, tw) + 2 * pad;
    rect.setAttribute("x", cx - w / 2); rect.setAttribute("width", w);
  }
  function textW(str, px) { var w = 0; for (var i = 0; i < str.length; i++) w += str.charCodeAt(i) > 0x2e80 ? px : px * 0.6; return w; }
  function clip(str, maxW, px) { str = String(str); if (textW(str, px) <= maxW) return str; var o = ""; for (var i = 0; i < str.length && textW(o + str[i] + "…", px) <= maxW; i++) o += str[i]; return o + "…"; }
  function wrap2(str, maxW, px) { // one line if it fits, else break at a space, a slash or a camelCase hump, then clip
    str = String(str); if (textW(str, px) <= maxW) return [str];
    var cut = 0;
    for (var i = 1; i < str.length; i++) {
      var brk = str[i] === " " || str[i] === "(" || str[i - 1] === "/" || (/[a-z]/.test(str[i - 1]) && /[A-Z]/.test(str[i]));
      if (brk && textW(str.slice(0, i), px) <= maxW) cut = i;
    }
    if (!cut) while (cut < str.length && textW(str.slice(0, cut + 1), px) <= maxW) cut++;
    return [str.slice(0, cut).trim(), clip(str.slice(cut).trim(), maxW, px)];
  }
  function itemName(id) {
    var p = SC.pos[id]; if (!p) return "";
    if (p.kind === "node" || p.kind === "stub") return first(p.ref.label);
    if (p.kind === "part") return p.ref.label;
    if (p.kind === "table") return p.ref.name;
    return p.ref.method + " " + p.ref.path;
  }

  /* ═════════════════ Stage: legs (what moves, per scene) ═════════════════ */
  function mv(ids, tone, text) { return { type: "move", ids: ids, tone: tone, text: text || "" }; }
  function legsOf(st) { return SC.mode === "arch" ? archLegs(st) : detailLegs(st); }
  function archLegs(st) {
    var p = pathOf(st).filter(function (id) { return SC.pos[id]; });
    if (st.kind === "internal") return SC.pos[st.from] ? [{ type: "work", at: st.from }] : [];
    if (p.length < 2) return [];
    if (st.kind === "call") return [mv(p, "req", st.request), mv(p.slice().reverse(), "res", st.response)];
    return [mv(p, st.kind === "response" ? "res" : "req", st.kind === "response" ? st.response : st.request)];
  }
  function wireBetween(a, b) { return (comp[SC.focus].wires || []).filter(function (w) { var f = "p:" + w.from, t = "p:" + w.to; return (f === a && t === b) || (f === b && t === a); })[0]; }
  function detailLegs(st) {
    var c = comp[SC.focus]; if (pathOf(st).indexOf(c.id) < 0) return [];
    var stub = function (id) { return SC.pos["stub:" + id] ? "stub:" + id : null; };
    if (c.parts && c.parts.length) {
      var T = traceIn(st, c.id).filter(function (id) { return SC.pos[id]; });
      if (st.kind === "internal") {
        if (T.length > 1) return [mv(T, "int", T.slice(1).map(function (b, i) { var w = wireBetween(T[i], b); return w ? w.label : itemName(b); }).join(" → "))];
        return T.length ? [{ type: "work", at: T[0] }] : [];
      }
      if (!T.length) return [];
      // the neighbour on each side of the focus in this step's path (a gateway in `via` counts)
      var p = pathOf(st), i = p.indexOf(c.id), inS = i > 0 ? stub(p[i - 1]) : null, outS = i < p.length - 1 ? stub(p[i + 1]) : null;
      var ids = (inS ? [inS] : []).concat(T, outS ? [outS] : []);
      if (ids.length < 2) return [];
      if (st.kind === "call") return [mv(ids, "req", st.request), mv(ids.slice().reverse(), "res", st.response)];
      return [mv(ids, st.kind === "response" ? "res" : "req", st.kind === "response" ? st.response : st.request)];
    }
    var p2 = pathOf(st), j = p2.indexOf(c.id), other = j > 0 ? p2[j - 1] : p2[j + 1];
    var tg = targetsIn(st, c).filter(function (id) { return SC.pos[id]; })[0], s0 = other ? stub(other) : null;
    if (!tg || !s0) return [];
    if (st.kind === "call") return [mv([s0, tg], "req", st.request), mv([tg, s0], "res", st.response)];
    return [mv(st.to === c.id ? [s0, tg] : [tg, s0], st.kind === "response" ? "res" : "req", st.kind === "response" ? st.response : st.request)];
  }

  /* ═════════════════ Stage: drawing ═════════════════ */
  var L = {}, NODE = {}, LINK = {};
  function drawStage() {
    measure();
    var svg = $("sv-canvas"); clear(svg);
    svg.setAttribute("viewBox", "0 0 " + G.W + " " + G.H);
    ["links", "trail", "flow", "packet", "nodes", "notes", "fx", "rings"].forEach(function (k) { L[k] = s("g", { "class": "layer-" + k }); svg.appendChild(L[k]); });
    NODE = {}; LINK = {};
    if (SC.mode === "arch") { archLayout(); planRoutes(); drawArch(); } else { detailLayout(); planRoutes(); drawDetail(); }
    cls($("sv-stage"), "in-detail", SC.mode === "detail");
    var cr = $("sv-crumbs"); clear(cr); cr.hidden = SC.mode !== "detail";
    if (SC.mode === "detail") put(cr, [h("button", { type: "button", "class": "back", on: { click: closeDetail } }, icon("prev"), W.whole), h("span", { "class": "here", text: first(comp[SC.focus].label) }), h("span", { "class": "sub", text: W.inside })]);
    var stage = $("sv-stage"), old = stage.lastHiddenNote; if (old && old.parentNode) old.parentNode.removeChild(old);
    stage.lastHiddenNote = null;
    if (SC.hidden > 0) stage.lastHiddenNote = stage.appendChild(h("div", { "class": "hidden-note", text: W.hidden(SC.hidden, SC.mode === "arch") }));
  }
  function addLink(key, el) { (LINK[key] = LINK[key] || []).push(el); L.links.appendChild(el); }
  function keyOf(a, b) { return [a, b].sort().join("|"); }
  function changeTag(g, x, y, w, change) {
    if (!change) return;
    cls(g, "chg-" + change, true);
    var tw = Math.max(32, textW(ST[change][1], 11) + 12), rc = g.appendChild(s("rect", { "class": "tagbg", y: y - 9, height: 18, rx: 4 }));
    var tx = g.appendChild(s("text", { "class": "tagtx", x: x + w - 8 - tw / 2, y: y + 4 }, ST[change][1]));
    fitPad(rc, tx, x + w - 8 - tw / 2, tw - 12, 6);
  }
  function clickable(g, label, fn) {
    g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); g.setAttribute("aria-label", label);
    g.addEventListener("click", fn);
    g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); fn(); } });
  }
  function drawArch() {
    model.links.forEach(function (l) { if (SC.pos[l.a] && SC.pos[l.b]) addLink(keyOf(l.a, l.b), s("path", { "class": "lk", d: dOf(hopPts(l.a, l.b)) })); });
    Object.keys(SC.pos).forEach(function (id) {
      var p = SC.pos[id], c = p.ref, x = p.x - p.w / 2, y = p.y - p.h / 2, g = s("g", { "class": "nd", "data-id": id, "data-kind": c.kind }), open = hasDetail(c);
      g.appendChild(s("rect", { "class": "box", x: x, y: y, width: p.w, height: p.h, rx: 10 }));
      g.appendChild(s("rect", { "class": "ibox", x: x + 10, y: p.y - 15, width: 30, height: 30, rx: 8 }));
      g.appendChild(s("path", { "class": "ico", d: P[c.kind], transform: "translate(" + (x + 16) + "," + (p.y - 9) + ") scale(.75)" }));
      var ln = wrap2(first(c.label), p.w - (open ? 72 : 56), 14), y1 = ln.length > 1 ? p.y - 11 : p.y - 2;
      ln.forEach(function (t, i) { g.appendChild(s("text", { "class": "nm", x: x + 48, y: y1 + i * 16 }, t)); });
      g.appendChild(s("text", { "class": "kd", x: x + 48, y: ln.length > 1 ? p.y + 20 : p.y + 14 }, KIND[c.kind]));
      if (open) {
        cls(g, "has-detail", true);
        g.appendChild(s("path", { "class": "open", d: P.expand, transform: "translate(" + (x + p.w - 24) + "," + (p.y - 7) + ") scale(.58)" }));
        g.appendChild(s("title", {}, W.lookInside(first(c.label))));
        clickable(g, W.lookInside(first(c.label)), function () { openDetail(id); });
      }
      changeTag(g, x, y, p.w, compTag(id));
      NODE[id] = g; L.nodes.appendChild(g);
    });
  }
  function drawDetail() {
    var c = comp[SC.focus];
    SC.heads.forEach(function (hd) { L.links.appendChild(s("text", { "class": "colh", x: hd.x, y: 82 }, hd.text)); });
    (c.wires || []).forEach(function (w) {
      var a = "p:" + w.from, b = "p:" + w.to; if (!SC.pos[a] || !SC.pos[b]) return;
      var ch = S.overlay ? dchg[c.id + "|wire|" + w.from + ">" + w.to] : null;
      addLink(keyOf(a, b), s("path", { "class": "wr" + (ch ? " chg-" + ch : ""), d: dOf(hopPts(a, b)) }));
    });
    var seen = {}; // the edges to the neighbours: only those a step of this flow actually crosses
    uc().steps.forEach(function (st) {
      detailLegs(st).forEach(function (lg) {
        if (lg.type !== "move") return;
        lg.ids.slice(1).forEach(function (b, i) {
          var a = lg.ids[i], k = keyOf(a, b);
          if (seen[k] || LINK[k]) return;
          seen[k] = 1; addLink(k, s("path", { "class": "wr stubwire", d: dOf(hopPts(a, b)) }));
        });
      });
    });
    Object.keys(SC.pos).forEach(function (id) { drawItem(id, SC.pos[id], c); });
  }
  function drawItem(id, p, c) {
    var g = s("g", { "class": "it " + p.kind, "data-id": id }), x = p.x - p.w / 2, y = p.y - p.h / 2, r = p.ref;
    g.appendChild(s("rect", { "class": "box", x: x, y: y, width: p.w, height: p.h, rx: 8 }));
    if (p.kind === "stub") {
      g.appendChild(s("text", { "class": "t1", x: p.x, y: p.y - 2 }, clip(first(r.label), p.w - 16, 14)));
      g.appendChild(s("text", { "class": "t2", x: p.x, y: p.y + 14 }, KIND[r.kind]));
      if (hasDetail(r)) { cls(g, "nav", true); g.appendChild(s("title", {}, W.goInside(first(r.label)))); clickable(g, W.goInside(first(r.label)), function () { switchFocus(r.id); }); }
    } else if (p.kind === "part") {
      var ln = wrap2(r.label, p.w - 22, 14), y1 = ln.length > 1 ? p.y - 11 : p.y - 3;
      ln.forEach(function (t, i) { g.appendChild(s("text", { "class": "t1", x: x + 11, y: y1 + i * 16 }, t)); });
      g.appendChild(s("text", { "class": "t2", x: x + 11, y: ln.length > 1 ? p.y + 20 : p.y + 14 }, clip((ROLE_KO[r.role] || r.role) + (r.connects && comp[r.connects] ? " → " + first(comp[r.connects].label) : ""), p.w - 22, 11)));
      changeTag(g, x, y, p.w, S.overlay ? dchg[c.id + "|part|" + r.id] : null);
    } else if (p.kind === "table") {
      g.appendChild(s("text", { "class": "t1 mono", x: x + 12, y: y + 21 }, clip(r.name, p.w - 70, 14)));
      g.appendChild(s("line", { "class": "hr", x1: x + 1, x2: x + p.w - 1, y1: y + 31, y2: y + 31 }));
      g.colEls = {};
      r.columns.slice(0, p.show).forEach(function (col, i) {
        var cy = y + 31 + 17 * (i + 1);
        g.colEls[col.name] = g.appendChild(s("text", { "class": "colname", "data-col": col.name, x: x + 12, y: cy }, clip(col.name, p.w * 0.6, 11.5)));
        if (col.type) g.appendChild(s("text", { "class": "coltype", x: x + p.w - 12, y: cy }, col.type));
      });
      if (r.columns.length > p.show) g.appendChild(s("text", { "class": "collab", x: x + 12, y: y + 33 + 17 * (p.show + 1) }, W.moreCols(r.columns.length - p.show)));
      changeTag(g, x, y, p.w, S.overlay ? dchg[c.id + "|table|" + r.name] : null);
    } else {
      var mth = s("g", { "class": "mth" });
      mth.appendChild(s("rect", { x: x + 10, y: y + 10, width: 46, height: 18, rx: 4 }));
      mth.appendChild(s("text", { x: x + 33, y: y + 23 }, r.method));
      g.appendChild(mth);
      g.appendChild(s("text", { "class": "t1 mono", x: x + 64, y: y + 23 }, clip(r.path, p.w - 122, 14)));
      g.appendChild(s("line", { "class": "hr", x1: x + 1, x2: x + p.w - 1, y1: y + 36, y2: y + 36 }));
      [[W.sends, r.request], [W.gets, r.response]].forEach(function (row, i) {
        var cy = y + 36 + 17 * (i + 1);
        g.appendChild(s("text", { "class": "collab", x: x + 12, y: cy }, row[0]));
        g.appendChild(s("text", { "class": "colname", x: x + 44, y: cy }, clip(row[1] && row[1].length ? row[1].map(function (f) { return f.name; }).join(", ") : "—", p.w - 56, 11.5)));
      });
      changeTag(g, x, y, p.w, S.overlay ? dchg[c.id + "|endpoint|" + r.id] : null);
    }
    if (p.kind !== "stub") clickable(g, W.details(itemName(id)), function () { selectItem(id); });
    g.opb = g.appendChild(s("g", { "class": "opb" }));
    NODE[id] = g; L.nodes.appendChild(g);
  }

  /* ═════════════════ Stage: state of the current step (classes only; no re-draw) ═════════════════ */
  function idsOf(lg) { return lg.type === "move" ? lg.ids : [lg.at]; }
  function paintStepState() {
    var u = uc(), cur = A.step >= 0 ? u.steps[A.step] : null, used = {}, usedK = {}, vis = {}, visK = {}, act = {}, work = {};
    u.steps.forEach(function (st, i) {
      var past = i < A.step || (i === A.step && A.finished);
      legsOf(st).forEach(function (lg) {
        var ids = idsOf(lg);
        ids.forEach(function (id) { used[id] = 1; if (past) vis[id] = 1; });
        ids.slice(1).forEach(function (b, j) { var k = keyOf(ids[j], b); usedK[k] = 1; if (past) visK[k] = 1; });
        if (i !== A.step) return;
        if (lg.type === "work") work[lg.at] = 1;
        else ids.forEach(function (id, j) { if (SC.mode === "detail" || j === 0 || j === ids.length - 1) act[id] = 1; });
      });
    });
    Object.keys(NODE).forEach(function (id) {
      var g = NODE[id];
      cls(g, "off", !used[id] && id.indexOf("stub:") !== 0);
      cls(g, "visited", !!vis[id]); cls(g, "active", !!act[id]); cls(g, "working", !!work[id]); cls(g, "sel", S.item === id); cls(g, "hitcard", false);
      if (g.colEls) Object.keys(g.colEls).forEach(function (k) { cls(g.colEls[k], "col-hit", false); });
      if (g.opb) clear(g.opb);
    });
    Object.keys(LINK).forEach(function (k) { LINK[k].forEach(function (el) { cls(el, "off", !usedK[k]); cls(el, "visited", !!visK[k]); }); });
    clear(L.notes);
    if (SC.mode !== "detail" || !cur) return;
    var c = comp[SC.focus];
    (cur.data || []).filter(function (d) { return d.store === c.id; }).forEach(function (d) { markCard("t:" + d.table, OP_KO[d.op] || d.op, d.columns); });
    (cur.endpoints || []).filter(function (e) { return e.split("/")[0] === c.id; }).forEach(function (e) { markCard("e:" + e.split("/")[1], W.call); });
    // where the data changes shape on this step (step.transforms), under the part that converts it
    (cur.transforms || []).forEach(function (tf) {
      var at = tf.at.split("/"), p = at[0] === c.id ? SC.pos["p:" + at[1]] : null; if (!p) return;
      // "in → out" when it fits beside the neighbours, else "→ out" (the full pair is in the panel), clipped only as a last resort
      var room = chipRoom(p, p.y + p.h / 2 + 6, 20), full = tf["in"].type + " → " + tf.out.type;
      var text = clip(textW(full, 11) <= room - 18 ? full : "→ " + tf.out.type, room - 18, 11), g = s("g", { "class": "xchip" });
      var rc = g.appendChild(s("rect", { y: p.y + p.h / 2 + 6, height: 20, rx: 4 }));
      var tx = g.appendChild(s("text", { x: p.x, y: p.y + p.h / 2 + 20 }, text));
      L.notes.appendChild(g);
      if (text === full && measure(tx) + 18 > room) { tx.textContent = text = clip("→ " + tf.out.type, room - 18, 11); }
      fitPad(rc, tx, p.x, textW(text, 11), 9, room);
    });
  }
  // widest centred tag under box p that stays clear of every other box beside it and of the stage edge
  function chipRoom(p, top, hgt) {
    var half = Math.min(p.x, G.W - p.x) - 4;
    Object.keys(SC.pos).forEach(function (id) {
      var q = SC.pos[id]; if (q === p || q.y + q.h / 2 < top - 4 || q.y - q.h / 2 > top + hgt + 4) return;
      var gap = q.x > p.x ? q.x - q.w / 2 - p.x : p.x - (q.x + q.w / 2);
      if (gap > 0) half = Math.min(half, gap - 6);
    });
    return Math.max(p.w, 2 * half);
  }
  function markCard(id, label, cols) {
    var g = NODE[id], p = SC.pos[id]; if (!g || !p) return;
    cls(g, "hitcard", true);
    var w = textW(label, 11) + 16;
    var rc = g.opb.appendChild(s("rect", { y: p.y - p.h / 2 + 9, height: 18, rx: 4 }));
    var tx = g.opb.appendChild(s("text", { x: p.x + p.w / 2 - w / 2 - 10, y: p.y - p.h / 2 + 22 }, label));
    fitPad(rc, tx, p.x + p.w / 2 - w / 2 - 10, textW(label, 11), 8);
    (cols || []).forEach(function (n) { if (g.colEls && g.colEls[n]) cls(g.colEls[n], "col-hit", true); });
  }

  /* ═════════════════ Stage: motion engine ═════════════════
     A step is a list of legs. move = the packet travels a route; work = one box processes (progress bar).
     Duration follows route length and speed; each leg eases in and out; a continuous run keeps a faint trail. */
  var SPEED = 300, DWELL = 240, GAP = 260, WORK = 950, EMPTY = 700, HOLD = 900;
  var A = { step: -1, legs: [], leg: 0, t: 0, dur: 1, playing: false, running: false, raf: 0, timer: 0, last: 0, rate: 1, finished: true };
  var MOVE = null; // current move leg geometry: { pts, acc, len, trail, packet }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function stopClock() { cancelFrame(A.raf); clearTimeout(A.timer); A.running = false; }
  function clearMotion() { [L.flow, L.packet, L.fx].forEach(function (g) { if (g) clear(g); }); MOVE = null; }
  function startLeg(i, t0) {
    var lg = A.legs[i]; A.leg = i; A.t = t0 || 0; clearMotion();
    if (lg.type === "move") {
      var pts = routePts(lg.ids), acc = lengths(pts), d = dOf(pts);
      L.flow.appendChild(s("path", { "class": "flowline " + lg.tone, d: d }));
      var trail = L.trail.appendChild(s("path", { "class": "trail " + lg.tone, d: d, "stroke-dasharray": "0 99999" }));
      var pk = s("g", { "class": "pk " + lg.tone }); pk.appendChild(s("circle", { "class": "halo", r: 7 })); pk.appendChild(s("circle", { "class": "core", r: 6 }));
      L.packet.appendChild(pk);
      MOVE = { pts: pts, acc: acc, len: acc[acc.length - 1], trail: trail, packet: pk, tone: lg.tone, x: pts[0].x, y: pts[0].y };
      A.dur = Math.max(520, Math.min(1700, MOVE.len / SPEED * 1000)) / A.rate;
    } else {
      var p = SC.pos[lg.at], w = p.w - 24;
      L.fx.appendChild(s("rect", { "class": "wbar-bg", x: p.x - w / 2, y: p.y + p.h / 2 + 8, width: w, height: 4, rx: 2 }));
      MOVE = { bar: L.fx.appendChild(s("rect", { "class": "wbar", x: p.x - w / 2, y: p.y + p.h / 2 + 8, width: 0, height: 4, rx: 2 })), w: w };
      A.dur = WORK / A.rate;
    }
    frameDraw(); // place the packet before the first frame
    caption();
    if (reduce) { A.t = 1; frameDraw(); legEnd(); return; }
    A.running = true; A.last = now(); A.raf = nextFrame(frame);
  }
  function frame(ts) {
    if (!A.running) return;
    A.t = Math.min(1, A.t + Math.max(0, ts - A.last) / A.dur); A.last = ts;
    frameDraw();
    if (A.t >= 1) { A.running = false; legEnd(); } else A.raf = nextFrame(frame);
  }
  function frameDraw() {
    if (!MOVE) return;
    var e = ease(A.t);
    if (MOVE.pts) {
      var pt = pointAt(MOVE.pts, MOVE.acc, e * MOVE.len); MOVE.x = pt.x; MOVE.y = pt.y;
      MOVE.packet.setAttribute("transform", "translate(" + r1(pt.x) + "," + r1(pt.y) + ")");
      MOVE.trail.setAttribute("stroke-dasharray", r1(e * MOVE.len) + " 99999");
    } else MOVE.bar.setAttribute("width", r1(MOVE.w * e));
    progress();
  }
  function legEnd() {
    var lg = A.legs[A.leg];
    if (lg.type === "move") {
      var p = SC.pos[lg.ids[lg.ids.length - 1]];
      if (!reduce) {
        var rg = L.rings.appendChild(s("rect", { "class": "ring " + lg.tone, x: p.x - p.w / 2 - 3, y: p.y - p.h / 2 - 3, width: p.w + 6, height: p.h + 6, rx: 11 }));
        rg.addEventListener("animationend", function () { if (rg.parentNode) rg.parentNode.removeChild(rg); });
      }
      if (MOVE && MOVE.trail) cls(MOVE.trail, "past", true);
    }
    if (A.leg < A.legs.length - 1) {
      if (reduce) { startLeg(A.leg + 1); return; }
      A.timer = setTimeout(function () { startLeg(A.leg + 1); }, DWELL / A.rate);
      return;
    }
    stepFinished();
  }
  function stepFinished() {
    A.finished = true; paintStepState(); progress(); transport(); renderSide();
    if (A.playing && A.step < uc().steps.length - 1) A.timer = setTimeout(function () { go(A.step + 1, true); }, (reduce ? HOLD : GAP) / A.rate);
    else if (A.playing) { A.playing = false; transport(); }
  }
  function go(i, animate) { // the only way the current step changes
    stopClock(); clearMotion();
    var u = uc(), target = Math.max(-1, Math.min(i, u.steps.length - 1)), cont = target === A.step + 1 && A.finished && animate;
    A.step = target; A.finished = !animate || target < 0; A.legs = A.step >= 0 ? legsOf(u.steps[A.step]) : []; A.leg = 0; A.t = 0; S.item = null;
    if (!cont) { clear(L.trail); clear(L.rings); } // a continuous run keeps the faint trail of earlier legs; any jump starts clean
    paintStepState(); caption(); renderSide(); renderInsp(); transport(); syncHash();
    if (A.step >= 0 && animate) {
      if (A.legs.length) startLeg(0);
      else if (reduce) stepFinished();
      else A.timer = setTimeout(stepFinished, EMPTY / A.rate); // nothing moves in this scene: hold briefly, then go on
    } else progress();
  }
  function play() {
    var n = uc().steps.length;
    if (A.playing) { pause(); return; }
    A.playing = true;
    if ((A.step >= n - 1 && A.finished) || A.step < 0) { go(0, true); return; }
    if (!A.finished && A.legs.length) { transport(); if (MOVE && A.t < 1) { A.running = true; A.last = now(); A.raf = nextFrame(frame); } else legEnd(); return; } // resume mid-leg
    go(A.step + 1, true);
  }
  function pause() { A.playing = false; stopClock(); transport(); }
  function next() { A.playing = false; go(A.step + 1, true); }
  function prev() { A.playing = false; go(A.step - 1, false); }
  function caption() {
    var c = $("sv-caption"), u = uc(), lg = A.legs[A.leg], focus = SC.mode === "detail" ? first(comp[SC.focus].label) : null, kids;
    if (A.step < 0) kids = [h("span", { "class": "leg idle" }, W.idle), h("span", { "class": "txt kr", text: W.idleText(focus, model.components.some(hasDetail)) })];
    else if (!lg) kids = [h("span", { "class": "leg idle" }, W.out), h("span", { "class": "txt kr", text: W.outText(pathOf(u.steps[A.step]).indexOf(SC.focus) >= 0, focus) })];
    else if (lg.type === "work") kids = [h("span", { "class": "leg int" }, W.work), h("span", { "class": "txt kr", text: W.workText(itemName(lg.at)) })];
    else kids = [h("span", { "class": "leg " + lg.tone }, LEG_KO[lg.tone] + " → " + itemName(lg.ids[lg.ids.length - 1])), h("span", { "class": "txt mono ell2", text: lg.text, title: lg.text })];
    if (reduce) { clear(c); put(c, kids); return; }
    cls(c, "swap", true);
    clearTimeout(c.swapTimer);
    c.swapTimer = setTimeout(function () { clear(c); put(c, kids); cls(c, "swap", false); }, 110);
  }

  /* ═════════════════ Stage: entering and leaving a component ═════════════════ */
  function tween(ms, fn, done) {
    if (reduce) { fn(1); if (done) done(); return; }
    var t0 = now();
    (function f(ts) { var k = Math.min(1, Math.max(0, (ts - t0) / ms)); fn(ease(k)); if (k < 1) nextFrame(f); else if (done) done(); })(t0);
  }
  function lerpRect(a, b, k) { return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k }; }
  function setRect(el, r) { el.setAttribute("x", r1(r.x)); el.setAttribute("y", r1(r.y)); el.setAttribute("width", r1(r.w)); el.setAttribute("height", r1(r.h)); }
  function fadeLayers(v) { [L.links, L.trail, L.nodes, L.notes, L.rings].forEach(function (g) { g.style.opacity = String(v); }); }
  function fadeIn() { var cv = $("sv-canvas"); cls(cv, "fade-in", false); if (cv.getBoundingClientRect) cv.getBoundingClientRect(); cls(cv, "fade-in", true); }
  function boxOf(p) { return { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }; }
  function openDetail(id) {
    if (SC.mode !== "arch" || S.zooming || !hasDetail(comp[id]) || !SC.pos[id]) return;
    var resume = A.playing, from = boxOf(SC.pos[id]), to = { x: 8, y: 8, w: G.W - 16, h: G.H - 16 };
    A.playing = false; stopClock(); clearMotion(); S.zooming = true;
    var z = $("sv-canvas").appendChild(s("rect", { "class": "zoom", rx: 10 }));
    tween(360, function (k) { setRect(z, lerpRect(from, to, k)); fadeLayers(1 - k); }, function () {
      SC.mode = "detail"; SC.focus = id; S.zooming = false; drawStage(); fadeIn();
      A.playing = resume; go(A.step, A.step >= 0); // replay the current step inside
    });
  }
  function closeDetail() {
    if (SC.mode !== "detail" || S.zooming) return;
    var resume = A.playing, id = SC.focus; A.playing = false; stopClock(); clearMotion(); S.zooming = true;
    tween(160, function (k) { fadeLayers(1 - k); }, function () {
      SC.mode = "arch"; SC.focus = null; drawStage(); fadeLayers(0);
      var full = { x: 8, y: 8, w: G.W - 16, h: G.H - 16 }, to = SC.pos[id] ? boxOf(SC.pos[id]) : full;
      var z = $("sv-canvas").appendChild(s("rect", { "class": "zoom", rx: 10 }));
      tween(340, function (k) { setRect(z, lerpRect(full, to, k)); z.style.opacity = String(1 - k * 0.9); fadeLayers(k); }, function () {
        if (z.parentNode) z.parentNode.removeChild(z);
        S.zooming = false; A.playing = resume; go(A.step, resume && A.step >= 0);
      });
    });
  }
  function switchFocus(id) { // from a stub straight into the neighbour's inside
    if (!hasDetail(comp[id])) return;
    var resume = A.playing; A.playing = false; stopClock(); clearMotion();
    SC.mode = "detail"; SC.focus = id; drawStage(); fadeIn(); A.playing = resume; go(A.step, A.step >= 0);
  }
  function selectItem(id) { S.item = S.item === id ? null : id; paintStepState(); renderInsp(); }
  function setOverlay(on) { S.overlay = !!on && !!changes; renderTop(); drawStage(); paintStepState(); renderSide(); renderInsp(); }

  /* ═════════════════ Transport ═════════════════ */
  function transport() {
    var t = $("sv-transport"), u = uc(), n = u.steps.length, atEnd = A.step >= n - 1 && A.finished; clear(t);
    put(t, [
      h("button", { type: "button", "class": "btn icon ghost", title: W.first, "aria-label": W.first, disabled: A.step < 0 ? true : null, on: { click: function () { A.playing = false; go(-1, false); } } }, icon("first")),
      h("button", { type: "button", "class": "btn icon", title: W.prev, "aria-label": W.prev, disabled: A.step < 0 ? true : null, on: { click: prev } }, icon("prev")),
      h("button", { type: "button", "class": "btn primary", id: "sv-play", on: { click: play } }, icon(A.playing ? "pause" : atEnd ? "replay" : "play"), A.playing ? W.pause : atEnd ? W.replay : W.play),
      h("button", { type: "button", "class": "btn icon", title: W.next, "aria-label": W.next, disabled: atEnd ? true : null, on: { click: next } }, icon("next"))
    ]);
    var sc = h("div", { "class": "scrub", id: "sv-scrub" });
    u.steps.forEach(function (st, i) {
      var sg = stepChg[u.id + "/" + st.id];
      put(sc, h("button", { type: "button", "class": "seg-step" + (i < A.step || (i === A.step && A.finished) ? " done" : "") + (sg ? " chg" : "") + (i === A.step ? " cur" : ""), title: (i + 1) + ". " + st.label + (sg ? " · " + ST[sg.change][1] : ""), "aria-label": W.toStep(i + 1), "aria-current": i === A.step ? "step" : null, on: { click: function () { A.playing = false; go(i, true); } } }, h("i")));
    });
    put(t, [sc, h("span", { "class": "counter", id: "sv-counter" }, (A.step + 1) + " / " + n)]);
    var sp = h("div", { "class": "seg", role: "group", "aria-label": W.speed });
    [[0.5, "0.5×"], [1, "1×"], [2, "2×"]].forEach(function (x) { put(sp, h("button", { type: "button", "aria-pressed": A.rate === x[0] ? "true" : "false", on: { click: function () { A.rate = x[0]; transport(); } } }, x[1])); });
    put(t, sp);
  }
  function progress() {
    var sc = $("sv-scrub"); if (!sc) return;
    var seg = sc.children[A.step]; if (!seg || !seg.firstChild) return;
    var frac = A.finished ? 1 : (A.leg + A.t) / Math.max(1, A.legs.length);
    seg.firstChild.style.width = Math.round(frac * 1000) / 10 + "%";
  }

  /* ═════════════════ Sidebar: flows, their steps, the change word and the review tick ═════════════════ */
  function tickBox(id) {
    var on = !!ticks[id];
    return h("button", { type: "button", "class": "check", role: "checkbox", "aria-checked": on ? "true" : "false", "aria-label": W.reviewed, title: W.reviewed,
      on: { click: function (e) { e.stopPropagation(); setTick(id, !on); renderSide(); } } }, icon("check"));
  }
  function renderSide() {
    var side = $("sv-list"); clear(side);
    var f = S.filter.trim().toLowerCase();
    var split = anyChange(), groups = split ? [["changed", W.gChanged], ["same", W.gSame]] : [["all", W.gAll]], curLi = null;
    groups.forEach(function (g) {
      var list = model.useCases.filter(function (u) {
        var grp = !split ? "all" : changedSteps(u).length ? "changed" : "same";
        return grp === g[0] && (!f || (u.title + " " + u.trigger + " " + u.steps.map(function (st) { return st.label; }).join(" ")).toLowerCase().indexOf(f) >= 0);
      });
      if (!list.length) return;
      var open = f || g[0] === "all" || list.some(function (u) { return u.id === S.uc; }) ? true : !S.collapsed[g[0]]; // the flow on screen is never folded away
      put(side, h("button", { type: "button", "class": "gh", "aria-expanded": open ? "true" : "false", on: { click: function () { S.collapsed[g[0]] = open; renderSide(); } } }, icon("chevron"), g[1], h("span", { "class": "n", text: String(list.length) })));
      if (!open) return;
      list.forEach(function (u) {
        var cur = u.id === S.uc, ch = S.overlay ? changedSteps(u) : [], rv = ch.filter(function (st) { return ticks["rv:" + u.id + "/" + st.id]; }).length;
        put(side, h("button", { type: "button", "class": "uc", "data-uc": u.id, "aria-current": cur ? "true" : null, on: { click: function () { if (!cur) selectUc(u.id); } } },
          h("span", { "class": "main" }, h("span", { "class": "t kr", text: u.title }), h("span", { "class": "m ell2", text: u.trigger, title: u.trigger })),
          ch.length ? h("span", { "class": "badge", "data-tone": rv === ch.length ? "success" : "warning", title: W.reviewedTitle }, W.reviewBadge(rv, ch.length)) : null));
        if (!cur) return;
        var ol = h("ol", { "class": "steps", id: "sv-steps" });
        u.steps.forEach(function (st, i) {
          var c = chgOf(u, st), pick = function () { A.playing = false; go(i, true); };
          var li = h("li", { "class": "st" + (i < A.step ? " done" : ""), "data-step": st.id, "aria-current": i === A.step ? "step" : null, tabindex: 0,
            on: { click: pick, keydown: function (e) { if (e.key === "Enter") pick(); } } },
            h("span", { "class": "n" }, String(i + 1)), h("span", { "class": "lbl ell2 kr", text: st.label, title: st.label }),
            c ? h("span", { "class": "chg", "data-tone": ST[c.change][0] }, ST[c.change][1]) : null,
            c ? tickBox("rv:" + u.id + "/" + st.id) : null);
          if (i === A.step) curLi = li;
          put(ol, li);
        });
        put(side, ol);
      });
    });
    if (!side.firstChild) put(side, h("div", { "class": "empty", text: W.noMatch }));
    if (curLi && curLi.scrollIntoView) curLi.scrollIntoView({ block: "nearest" }); // the step being played stays in view in a long list
  }
  function selectUc(id, step) {
    if (!ucById[id]) return;
    S.uc = id; A.playing = false; stopClock(); A.step = -1; A.finished = true; S.item = null;
    drawStage(); fadeIn();
    go(step != null && step >= 0 ? step : -1, step != null && step >= 0);
  }

  /* ═════════════════ Inspector: the current step, or the item picked inside a component ═════════════════ */
  function sec(title) { var e = h("div", { "class": "isec" }, title ? h("h2", { text: title }) : null); for (var i = 1; i < arguments.length; i++) put(e, arguments[i]); return e; }
  function noteRefs(note) { // "Evidence code changed: a.js:1-3, b.js:9" -> {lead, refs}
    var cut = note.indexOf(": "), lead = (cut > 0 ? note.slice(0, cut) : note).replace(/\s*\(.*\)\s*$/, "");
    var refs = cut > 0 ? note.slice(cut + 2).replace(/\s*\(.*\)\s*$/, "").split(/,\s*(?=[^\s,]+:\d)/) : [];
    return { lead: lead, refs: refs };
  }
  function renderInsp() {
    var el = $("sv-insp"); clear(el);
    if (S.item && SC.mode === "detail" && SC.pos[S.item]) { itemInsp(el); return; }
    var u = uc();
    if (A.step < 0) {
      put(el, h("div", { "class": "ih" }, h("p", { "class": "eyebrow", text: W.overview }), h("p", { "class": "lead kr", text: u.summary })));
      var row = cmp[u.id], gone = row && review.compare.mode === "two-models" && S.overlay ? row.rows.filter(function (r) { return r.status === "removed" && r.before; }) : [];
      if (gone.length) put(el, sec(W.gone, h("ul", { "class": "gone" }, gone.map(function (r) { return h("li", { "class": "kr", text: r.before.label }); }))));
      put(el, sec(W.howTo, legend()));
      return;
    }
    var st = u.steps[A.step], c = chgOf(u, st), hit = {};
    put(el, h("div", { "class": "ih" }, h("p", { "class": "eyebrow", text: W.inStep(A.step + 1) }), h("p", { "class": "lead kr", text: st.narration })));
    if (c) {
      var nr = noteRefs(c.note || ""); nr.refs.forEach(function (r) { hit[r.trim()] = 1; });
      put(el, sec(null, h("div", { "class": "note", "data-tone": ST[c.change][0] }, icon("git"), h("span", { "class": "kr", text: nr.lead }))));
    }
    var row2 = cmp[u.id] && review.compare.mode === "two-models" && S.overlay ? cmp[u.id].rows.filter(function (r) { return r.id === st.id; })[0] : null;
    if (row2 && row2.before && row2.after) {
      var diff = ["label", "kind", "route", "request", "response"].filter(function (k) { return (row2.before[k] || "") !== (row2.after[k] || ""); });
      var NAME = W.field;
      if (diff.length) put(el, sec(W.before, h("dl", { "class": "kv before" }, diff.map(function (k) { return [h("dt", { text: NAME[k] }), h("dd", { "class": "kr", text: k === "kind" ? STEP_KO[row2.before[k]] || row2.before[k] : row2.before[k] || "—" })]; }))));
      else if (row2.status === "moved") put(el, sec(W.before, h("p", { "class": "kr", text: W.moved })));
    }
    if (SC.mode === "arch" && st.transforms && st.transforms.length) { // inside a component the stage shows these as chips
      put(el, sec(W.transforms, st.transforms.map(function (tf) {
        var at = tf.at.split("/"), part = (comp[at[0]] && comp[at[0]].parts || []).filter(function (p) { return p.id === at[1]; })[0];
        return h("div", { "class": "xf" }, h("div", { "class": "at kr", text: (part ? part.label : at[1]) + " · " + first(comp[at[0]].label) }), h("div", { "class": "io", text: tf["in"].type + " → " + tf.out.type }),
          tf.map && tf.map.length ? h("ul", { "class": "map" }, tf.map.map(function (m) { return h("li", { text: m.from + " → " + m.to + (m.how ? "  (" + m.how + ")" : "") }); })) : null);
      })));
    }
    (st.payload || []).forEach(function (p) {
      put(el, sec((p.leg === "request" ? W.sent : W.received) + (p.title ? " · " + p.title : ""),
        p.body ? h("pre", { "class": "code", text: p.body }) : null,
        p.bind ? h("dl", { "class": "kv" }, p.bind.map(function (b) { return [h("dt", { text: b.name }), h("dd", { text: b.value })]; })) : null,
        p.columns ? h("dl", { "class": "kv" }, p.columns.map(function (b) { return [h("dt", { text: b.name }), h("dd", { text: b.value })]; })) : null));
    });
    put(el, sec(W.evidence, h("ul", { "class": "ev" }, st.evidence.map(function (e) {
      var ref = evRef(e), on = !!(c && hit[ref]);
      return h("li", { "class": on ? "hit" : null }, h("span", { text: ref }), on ? h("span", { "class": "badge", "data-tone": ST[c.change][0] }, W.changed) : null);
    }))));
  }
  function itemInsp(el) { // a part / table / endpoint picked inside a component: only what its card does not show
    var p = SC.pos[S.item], r = p.ref, c = comp[SC.focus], u = uc(), id = S.item;
    var kindKo = p.kind === "part" ? ROLE_KO[r.role] || r.role : p.kind === "table" ? W.table : W.endpoint;
    put(el, h("div", { "class": "ih" },
      h("button", { type: "button", "class": "link", style: "font-size:12px;margin-bottom:12px", on: { click: function () { S.item = null; paintStepState(); renderInsp(); } } }, A.step >= 0 ? W.backStep(A.step + 1) : W.backOverview),
      h("p", { "class": "eyebrow", text: W.insideOf(kindKo, first(c.label)) }),
      h("p", { "class": "lead kr", text: r.detail || W.noDetail })));
    var ch = S.overlay ? dchg[c.id + "|" + p.kind + "|" + (p.kind === "table" ? r.name : r.id)] : null;
    if (ch) put(el, sec(null, h("div", { "class": "note", "data-tone": ST[ch][0] }, icon("git"), h("span", { "class": "kr", text: ch === "added" ? W.newHere : W.changedHere }))));
    if (p.kind === "part") {
      var byId = {}; c.parts.forEach(function (x) { byId[x.id] = x; });
      var rel = function (w, dir) { var o = dir === "in" ? byId[w.from] : byId[w.to]; return h("li", null, h("span", { "class": "who kr", text: (dir === "in" ? "← " : "→ ") + (o ? o.label : dir === "in" ? w.from : w.to) }), h("span", { "class": "how mono", text: w.label })); };
      var ins = (c.wires || []).filter(function (w) { return w.to === r.id; }), outs = (c.wires || []).filter(function (w) { return w.from === r.id; });
      if (ins.length) put(el, sec(W.calledBy, h("ul", { "class": "rel" }, ins.map(function (w) { return rel(w, "in"); }))));
      if (outs.length) put(el, sec(W.calls, h("ul", { "class": "rel" }, outs.map(function (w) { return rel(w, "out"); }))));
    }
    if (p.kind === "endpoint" && r.auth) put(el, sec(W.auth, h("p", { "class": "kr", text: r.auth })));
    var hits = u.steps.map(function (st, i) { return { st: st, i: i }; }).filter(function (x) { return p.kind === "part" ? traceIn(x.st, c.id).indexOf(id) >= 0 : targetsIn(x.st, c).indexOf(id) >= 0; });
    if (hits.length) put(el, sec(W.stepsHere, h("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, hits.map(function (x) {
      return h("button", { type: "button", "class": "steplink", title: x.st.label, on: { click: function () { A.playing = false; go(x.i, true); } } }, W.stepN(x.i + 1));
    }))));
    put(el, sec(W.evidence, h("ul", { "class": "ev" }, (r.evidence || []).map(function (e) { return h("li", null, h("span", { text: evRef(e) })); }))));
  }
  function legend() {
    function sw(draw) { var g = s("svg", { width: 28, height: 16, viewBox: "0 0 28 16", "aria-hidden": "true" }); draw(g); return g; }
    function dotLine(color, cx) { return function (g) { g.appendChild(s("line", { x1: 2, y1: 8, x2: 26, y2: 8, style: "stroke:" + color, "stroke-width": 2.5, "stroke-dasharray": "1 5", "stroke-linecap": "round" })); g.appendChild(s("circle", { cx: cx, cy: 8, r: 5, style: "fill:" + color + ";stroke:var(--surface)", "stroke-width": 2 })); }; }
    var rows = [
      [dotLine("var(--req)", 18), W.lgReq],
      [dotLine("var(--res)", 10), W.lgRes],
      [function (g) { g.appendChild(s("rect", { x: 3, y: 6, width: 22, height: 4, rx: 2, style: "fill:var(--int-soft)" })); g.appendChild(s("rect", { x: 3, y: 6, width: 13, height: 4, rx: 2, style: "fill:var(--int)" })); }, W.lgWork],
      [function (g) { g.appendChild(s("line", { x1: 2, y1: 8, x2: 26, y2: 8, style: "stroke:var(--trail-grey)", "stroke-width": 2 })); }, W.lgPast]
    ];
    if (changes) rows.push([function (g) { g.appendChild(s("rect", { x: 4, y: 3, width: 20, height: 10, rx: 3, style: "fill:var(--success-bg);stroke:var(--success-border)" })); }, W.lgChanged]);
    if (model.components.some(hasDetail)) {
      rows.push([function (g) { g.appendChild(s("path", { d: P.expand, transform: "translate(6,0) scale(.66)", style: "fill:none;stroke:var(--text-3)", "stroke-width": 2.2, "stroke-linecap": "round" })); }, W.lgOpen]);
      rows.push([dotLine("var(--int)", 14), W.lgInt]);
    }
    return h("div", { "class": "legend" }, rows.map(function (r) { return [sw(r[0]), h("span", { text: r[1] })]; }));
  }

  /* ═════════════════ Top bar, URL, wiring ═════════════════ */
  function renderTop() {
    $("sv-product").textContent = model.product.name;
    var g = changes && changes.generated, ref = $("sv-ref");
    ref.hidden = !g; ref.textContent = g && g.base && g.head ? (g.base === g.head ? g.head.slice(0, 7) + " · " + W.noChanges : g.base.slice(0, 7) + " → " + g.head.slice(0, 7)) : "";
    $("sv-commit").textContent = changes ? changes.title : model.product.description;
    var dp = $("sv-depth");
    if (dp) { dp.hidden = !model.depth; dp.textContent = model.depth ? W.depthWord + " " + ({ diff: 1, brief: 2, full: 3 }[model.depth]) + " · " + W.depthName[model.depth] : ""; dp.title = model.depth ? W.depthHint[model.depth] || "" : ""; }
    var t = $("sv-overlay"); t.hidden = !changes; t.setAttribute("aria-checked", S.overlay ? "true" : "false");
    if (anyChange()) t.removeAttribute("disabled"); else t.setAttribute("disabled", ""); // nothing to highlight: the switch rests
    if (doc.title !== undefined) doc.title = model.product.name + " · Nacholens";
  }
  function syncHash() {
    if (TARGET !== "html" || typeof history === "undefined" || !history.replaceState) return;
    var extra = H0.dock ? "&dock=" + encodeURIComponent(H0.dock) : "";
    try { history.replaceState(null, "", "#uc=" + S.uc + "&step=" + (A.step + 1) + (SC.mode === "detail" ? "&focus=" + SC.focus : "") + extra); } catch (e) { /* sandboxed */ }
  }
  function relayout() {
    var keep = { leg: A.leg, t: A.t, running: A.running };
    stopClock(); clearMotion(); drawStage(); paintStepState();
    if (A.step >= 0 && !A.finished) {
      A.legs = legsOf(uc().steps[A.step]);
      if (A.legs.length) { startLeg(Math.min(keep.leg, A.legs.length - 1), keep.t); if (!keep.running) stopClock(); }
    } else progress();
  }
  $("sv-q").addEventListener("input", function (e) { S.filter = e.target.value || ""; renderSide(); });
  $("sv-overlay").addEventListener("click", function () { setOverlay(!S.overlay); });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeDetail(); return; }
    var a = doc.activeElement; if (a && a !== doc.body && a.tagName !== "svg") return; // keys belong to the focused control
    if (e.key === " ") { e.preventDefault(); play(); } else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev();
  });
  // tag boxes are sized from the rendered text: draw again once the embedded fonts are ready
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready && document.fonts.status !== "loaded") document.fonts.ready.then(function () { relayout(); });
  if (typeof ResizeObserver === "function") {
    var rz = 0, lastW = 0, lastH = 0;
    new ResizeObserver(function () {
      var st = $("sv-stage"); if (st.clientWidth === lastW && st.clientHeight === lastH) return;
      lastW = st.clientWidth; lastH = st.clientHeight; clearTimeout(rz); rz = setTimeout(relayout, 60);
    }).observe($("sv-stage"));
  }

  /* ═════════════════ start ═════════════════ */
  if (H0.focus && hasDetail(comp[H0.focus])) { SC.mode = "detail"; SC.focus = H0.focus; }
  renderTop(); drawStage();
  go(H0.step ? Number(H0.step) - 1 : -1, false);
  if (H0.at != null && A.step >= 0) { // capture aid: #…&at=0.4 freezes the step at that point of its motion
    A.finished = false; A.legs = legsOf(uc().steps[A.step]);
    if (A.legs.length) { var f = Math.max(0, Math.min(0.999, Number(H0.at))) * A.legs.length, li = Math.floor(f); startLeg(li, f - li); stopClock(); A.t = f - li; frameDraw(); paintStepState(); caption(); transport(); progress(); }
  }

  window.__nacholens = {
    model: model, changes: changes, target: TARGET, hash: H0,
    get state() { return { uc: S.uc, step: A.step, finished: A.finished, playing: A.playing, running: A.running, leg: A.leg, t: A.t, mode: SC.mode, focus: SC.focus, item: S.item, overlay: S.overlay, rate: A.rate }; },
    scene: function () { var b = {}; Object.keys(SC.pos).forEach(function (id) { var p = SC.pos[id]; b[id] = { x: p.x, y: p.y, w: p.w, h: p.h, kind: p.kind }; }); return { mode: SC.mode, focus: SC.focus, w: G.W, h: G.H, boxes: b, hidden: SC.hidden }; },
    legs: function (i) { return legsOf(uc().steps[i]).map(function (l) { return l.type === "move" ? { type: l.type, ids: l.ids.slice(), tone: l.tone, text: l.text } : { type: l.type, at: l.at }; }); },
    packet: function () { return MOVE && MOVE.pts ? { x: MOVE.x, y: MOVE.y, tone: MOVE.tone } : null; },
    tagged: function () { return Object.keys(NODE).filter(function (id) { return NODE[id].getAttribute("class").indexOf("chg-") >= 0; }).sort(); },
    selectUseCase: selectUc, go: go, play: play, pause: pause, next: next, prev: prev,
    openDetail: openDetail, closeDetail: closeDetail, switchFocus: switchFocus, selectItem: selectItem,
    setOverlay: setOverlay, relayout: relayout
  };
})();
