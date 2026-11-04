/* Review dock: the three review tracks under the stage — planner intent (planner), regression tests (QA) and changes the
   model does not cover (dev). Each tab carries its own status (a dot and the count still to check), so the tab bar is
   the to-do summary of the page. Rows link to steps through the player API and never repeat a step's details.
   Ticks are a per-viewer convenience (browser storage, may be unavailable). Text nodes only. */
(function () {
  "use strict";
  var doc = document, root = doc.getElementById("sv-review");
  if (!root) return;
  var api = window.__nacholens || null;
  function json(id) { var e = doc.getElementById(id); try { return e ? JSON.parse(e.textContent) : null; } catch (x) { return null; } }
  var model = api ? api.model : json("sv-model"), changes = api ? api.changes : json("sv-changes"), data = json("sv-review-data") || {};
  if (!changes && !data.intent && !data.impact) return; // nothing to review: the dock stays hidden

  /* ── helpers ── */
  function h(tag, a) {
    var e = doc.createElement(tag);
    if (a) Object.keys(a).forEach(function (k) {
      var v = a[k]; if (v == null || v === false) return;
      if (k === "on") Object.keys(v).forEach(function (x) { e.addEventListener(x, v[x]); });
      else if (k === "text") e.textContent = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) put(e, arguments[i]);
    return e;
  }
  function put(e, c) { if (c == null || c === false) return; if (Array.isArray(c)) { c.forEach(function (x) { put(e, x); }); return; } e.appendChild(typeof c === "object" ? c : doc.createTextNode(String(c))); }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
  var NS = "http://www.w3.org/2000/svg";
  function icon(d) { var e = doc.createElementNS(NS, "svg"); e.setAttribute("class", "i"); e.setAttribute("viewBox", "0 0 24 24"); e.setAttribute("aria-hidden", "true"); var p = doc.createElementNS(NS, "path"); p.setAttribute("d", d); e.appendChild(p); return e; }
  var CHECK = "M5 12.5l4.5 4.5L19 7.5", CHEV = "m6 9 6 6 6-6";
  /* words: English by default, Korean when the page is built with --lang ko (html lang=ko) */
  var KO = String((doc.documentElement && doc.documentElement.getAttribute && doc.documentElement.getAttribute("lang")) || "en").toLowerCase().indexOf("ko") === 0;
  var L = KO ? {
    tone: { met: "충족", unmet: "미충족", unknown: "확인 불가", direct: "직접 영향", indirect: "간접 영향", "covered-changed": "테스트 있음 · 함께 바뀜", covered: "테스트 있음", "none-found": "테스트 못 찾음", tests: "테스트 미확인", added: "신규", modified: "변경", deleted: "삭제", removed: "삭제" },
    ignore: { test: "테스트", docs: "문서", lockfile: "잠금 파일", asset: "정적 자산" },
    step: function (n) { return n + "단계"; },
    tIntent: "기획 의도", rIntent: "기획", tImpact: "회귀 테스트", rImpact: "QA", tUnmapped: "모델 밖 변경", rUnmapped: "개발",
    noIntent: "intent.json 을 주면 기획 기대사항을 이 모델과 대조합니다 (build --intent).", qIntent: "기획대로 동작하나요?",
    sumIntent: function (m) { return "충족 " + m.met + " · 미충족 " + m.unmet + " · 확인 불가 " + m.unknown; },
    showMet: function (n, open) { return "충족 " + n + "건 " + (open ? "접기" : "보기"); },
    uncovered: function (n) { return "기획에 연결되지 않은 변경 " + n + "건 — 범위 이탈인지 판단"; }, scopeOk: "범위 확인함", checked: "확인함",
    unprovable: "모델로 증명할 수 없음 — 사람이 직접 확인", touched: "이번 변경이 건드림",
    noImpact: "저장소와 기준 커밋을 주면 다시 테스트할 흐름을 계산합니다 (build --repo --base).", qImpact: "무엇을 다시 테스트하나요?", noChangedSteps: "바뀐 단계가 없어 다시 테스트할 흐름이 없습니다",
    sumImpact: function (m) { return "직접 " + m.direct + " · 간접 " + m.indirect + " · 테스트 못 찾음 " + m.withoutTests + (m.testsKnown ? " — 테스트 파일이 경로를 언급하는지로만 찾습니다" : " — 테스트는 저장소를 읽지 않아 확인하지 않았습니다"); },
    tested: "테스트함", why: { table: "테이블 ", endpoint: "외부 호출 ", part: "부품 ", wire: "배선 " },
    changedSteps: function (n) { return "바뀐 단계 " + n; }, testFiles: function (n) { return "테스트 " + n + "개"; }, testFilesLabel: "테스트 파일", kindLabel: "종류",
    cats: function (code, other, ign) { return [["code", "코드 " + code], ["other", "설정·스타일 " + other], ["ignored", "무시 " + ign]]; },
    qUnmapped: "흐름에 안 잡힌 변경이 있나요?", subUnmapped: "어떤 단계의 근거에도 없는 변경 — 단계를 추가하거나 무관한 변경인지 확인",
    noIgnored: "무시한 파일이 없습니다", allMapped: "모든 코드 변경이 흐름의 단계에 잡혔습니다", noOther: "바뀐 설정·스타일 파일이 없습니다",
    nFiles: function (n) { return n + "개"; }, fileList: "파일 목록", grip: "검토 패널 높이", dock: "검토", none: "없음", left: function (n) { return n + "건 남음"; }, allDone: "모두 확인함",
    expand: "검토 패널 펼치기", fold: "검토 패널 접기"
  } : {
    tone: { met: "Met", unmet: "Not met", unknown: "Can't tell", direct: "Direct", indirect: "Indirect", "covered-changed": "Tested · changed too", covered: "Tested", "none-found": "No test found", tests: "Tests not checked", added: "New", modified: "Changed", deleted: "Deleted", removed: "Removed" },
    ignore: { test: "Test", docs: "Docs", lockfile: "Lockfile", asset: "Asset" },
    step: function (n) { return "step " + n; },
    tIntent: "Plan", rIntent: "Planner", tImpact: "Retest", rImpact: "QA", tUnmapped: "Outside the model", rUnmapped: "Dev",
    noIntent: "Pass intent.json to check the planner's expectations against this model (build --intent).", qIntent: "Does it work as planned?",
    sumIntent: function (m) { return "Met " + m.met + " · Not met " + m.unmet + " · Can't tell " + m.unknown; },
    showMet: function (n, open) { return (open ? "Hide " : "Show ") + n + " met"; },
    uncovered: function (n) { return n + (n === 1 ? " change is" : " changes are") + " not linked to the plan: is it out of scope?"; }, scopeOk: "Scope checked", checked: "Checked",
    unprovable: "The model cannot prove this: a person has to check", touched: "Touched by this change",
    noImpact: "Pass the repository and a base commit to find the flows to retest (build --repo --base).", qImpact: "What should be retested?", noChangedSteps: "No changed steps, so nothing needs re-testing",
    sumImpact: function (m) { return "Direct " + m.direct + " · Indirect " + m.indirect + " · No test found " + m.withoutTests + (m.testsKnown ? ": tests are found only by the paths they mention" : ": tests were not checked because the repository was not read"); },
    tested: "Tested", why: { table: "table ", endpoint: "call ", part: "part ", wire: "wire " },
    changedSteps: function (n) { return n + (n === 1 ? " changed step" : " changed steps"); }, testFiles: function (n) { return n + (n === 1 ? " test" : " tests"); }, testFilesLabel: "Test files", kindLabel: "Kind",
    cats: function (code, other, ign) { return [["code", "Code " + code], ["other", "Config & style " + other], ["ignored", "Ignored " + ign]]; },
    qUnmapped: "Did any change miss the flows?", subUnmapped: "Changes that are not in any step's evidence: add a step, or confirm they are unrelated",
    noIgnored: "No ignored files", allMapped: "Every code change is in a step of a flow", noOther: "No config or style files changed",
    nFiles: function (n) { return n + (n === 1 ? " file" : " files"); }, fileList: "File list", grip: "Review panel height", dock: "Review", none: "None", left: function (n) { return n + " to check"; }, allDone: "All checked",
    expand: "Expand the review panel", fold: "Collapse the review panel"
  };
  var TONE = { met: "success", unmet: "danger", unknown: "neutral", direct: "warning", indirect: "info", "covered-changed": "success", covered: "success", "none-found": "danger", tests: "neutral", added: "success", modified: "warning", deleted: "danger", removed: "danger" };
  function badge(k) { return h("span", { "class": "badge", "data-tone": TONE[k] || "neutral" }, L.tone[k] || k); }
  var ucs = {}; model.useCases.forEach(function (u) { ucs[u.id] = u; });
  function ucTitle(id) { return ucs[id] ? ucs[id].title : id; }
  function jump(ucId, stepId) {
    if (!api) return;
    var u = ucs[ucId], i = -1; if (u && stepId) u.steps.forEach(function (st, k) { if (st.id === stepId) i = k; });
    api.selectUseCase(ucId, i >= 0 ? i : null);
  }
  function stepLinks(list) {
    return list.map(function (p) {
      var u = ucs[p.useCase], i = -1; if (u) u.steps.forEach(function (st, k) { if (st.id === p.step) i = k; });
      var t = ucTitle(p.useCase);
      return h("button", { type: "button", "class": "steplink", title: p.label || "", on: { click: function () { jump(p.useCase, p.step); } } }, (t.length > 12 ? t.slice(0, 12) + "…" : t) + " " + L.step(i + 1));
    });
  }

  /* ── ticks (per viewer) ── */
  var KEY = "sv-review:" + ((changes && changes.ref) || model.product.id), done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { done = {}; }
  function tick(id, on) { if (on) done[id] = 1; else delete done[id]; try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) { /* storage blocked: ticks last for this visit */ } paint(); }
  function checkbox(id, label) {
    var on = !!done[id];
    return h("button", { type: "button", "class": "check", role: "checkbox", "aria-checked": on ? "true" : "false", "aria-label": label, on: { click: function (e) { e.stopPropagation(); tick(id, !on); } } }, icon(CHECK));
  }

  /* ── tracks: what each tab still asks a person to check ── */
  var unmapped = (changes && changes.unmapped) || [];
  function folders(code) {
    var m = {}, order = [];
    unmapped.filter(function (f) { return code ? f.category === "code" : f.category !== "code"; }).forEach(function (f) {
      var p = f.file.split("/"), dir = p.slice(0, Math.min(p.length - 1, 3)).join("/") || ".";
      if (!m[dir]) { m[dir] = []; order.push(dir); } m[dir].push(f);
    });
    return order.map(function (d) { return { dir: d, files: m[d] }; }).sort(function (a, b) { return b.files.length - a.files.length || (a.dir < b.dir ? -1 : 1); });
  }
  function uncoveredByUc() { var m = {}, order = []; ((data.intent && data.intent.uncovered) || []).forEach(function (x) { if (!m[x.useCase]) { m[x.useCase] = []; order.push(x.useCase); } m[x.useCase].push(x); }); return order.map(function (id) { return { id: id, items: m[id] }; }); }
  function tracks() {
    return [
      { id: "intent", label: L.tIntent, role: L.rIntent, avail: !!data.intent,
        items: data.intent ? data.intent.results.filter(function (r) { return r.status !== "met"; }).map(function (r) { return "it:" + r.id; }).concat(uncoveredByUc().map(function (g) { return "sc:" + g.id; })) : [],
        danger: !!(data.intent && data.intent.summary.unmet) },
      { id: "impact", label: L.tImpact, role: L.rImpact, avail: !!data.impact,
        items: data.impact ? data.impact.useCases.map(function (u) { return "rt:" + u.id; }) : [],
        danger: !!(data.impact && data.impact.summary.withoutTests) },
      { id: "unmapped", label: L.tUnmapped, role: L.rUnmapped, avail: !!changes,
        items: folders(true).map(function (g) { return "dir:" + g.dir; }), danger: false }
    ];
  }
  function left(t) { return t.items.filter(function (id) { return !done[id]; }).length; }

  /* ── state ── */
  var hashTab = api && api.hash ? api.hash.dock : null, T0 = tracks();
  var avail = T0.filter(function (t) { return t.avail; });
  var nothing = avail.every(function (t) { return t.items.length === 0; }); // nothing to check anywhere: the dock starts folded and gives the room to the stage
  var S = { tab: (T0.filter(function (t) { return t.id === hashTab && t.avail; })[0] || avail.filter(function (t) { return left(t); })[0] || avail[0]).id, collapsed: nothing && !hashTab, showMet: false, open: {}, ucat: "code" };

  /* ── tab bodies ── */
  function head(q, sub, extra) { return h("div", { "class": "dhead" }, h("span", { "class": "q kr", text: q }), sub ? h("span", { "class": "sub kr", text: sub }) : null, h("span", { "class": "grow" }), extra || null); }
  function bodyIntent(b) {
    var I = data.intent;
    if (!I) { put(b, h("div", { "class": "empty kr", text: L.noIntent })); return; }
    var sm = I.summary;
    put(b, head(L.qIntent, L.sumIntent(sm) + (I.title ? " — " + I.title : "")));
    var todo = I.results.filter(function (r) { return r.status !== "met"; }), met = I.results.filter(function (r) { return r.status === "met"; });
    if (todo.length) put(b, h("ul", { "class": "rowlist" }, todo.map(function (r) { return intentRow(r, true); })));
    if (met.length) {
      put(b, h("div", { "class": "subhead" }, h("button", { type: "button", "class": "link", on: { click: function () { S.showMet = !S.showMet; paint(); } } }, L.showMet(met.length, S.showMet))));
      if (S.showMet) put(b, h("ul", { "class": "rowlist" }, met.map(function (r) { return intentRow(r, false); })));
    }
    var groups = uncoveredByUc();
    if (groups.length) {
      put(b, h("div", { "class": "subhead kr", text: L.uncovered(I.uncovered.length) }));
      put(b, h("ul", { "class": "rowlist" }, groups.map(function (g) {
        var key = "sc:" + g.id;
        return h("li", { "class": "ri" + (done[key] ? " done" : "") }, checkbox(key, L.scopeOk), h("div", { "class": "main" }, h("div", { "class": "t kr", text: ucTitle(g.id) }), h("div", { "class": "m" }, stepLinks(g.items))));
      })));
    }
  }
  function intentRow(r, todo) {
    var key = "it:" + r.id;
    return h("li", { "class": "ri" + (todo && done[key] ? " done" : "") },
      todo ? checkbox(key, L.checked) : h("span", { "class": "gap" }),
      h("div", { "class": "main" }, h("div", { "class": "t kr", text: r.text }),
        h("div", { "class": "m" }, r.status === "unknown" ? h("span", { "class": "kr", text: L.unprovable }) : r.status === "unmet" ? h("span", { "class": "kr", text: r.reason }) : null,
          r.useCase && !(r.proof || []).length ? h("span", { "class": "kr", text: ucTitle(r.useCase) }) : null, stepLinks(r.proof || []))),
      h("span", { "class": "end" }, r.touched ? h("span", { "class": "badge", "data-tone": "info" }, L.touched) : null, badge(r.status)));
  }
  function bodyImpact(b) {
    var M = data.impact;
    if (!M) { put(b, h("div", { "class": "empty kr", text: L.noImpact })); return; }
    var sm = M.summary;
    put(b, head(L.qImpact, !M.useCases.length && !sm.direct && !sm.indirect && !sm.withoutTests ? L.noChangedSteps : L.sumImpact(sm))); // nothing changed: say so, not 0 · 0 · 0
    put(b, h("ul", { "class": "rowlist" }, M.useCases.map(function (u) {
      var key = "rt:" + u.id, open = !!S.open[key], files = (u.tests && u.tests.files) || [];
      return h("li", { "class": "ri" + (done[key] ? " done" : "") }, checkbox(key, L.tested),
        h("div", { "class": "main" },
          h("div", { "class": "t kr" }, h("button", { type: "button", "class": "link plain", on: { click: function () { jump(u.id); } } }, u.title)),
          h("div", { "class": "m" }, (u.reasons || []).map(function (r) { return h("span", { "class": "mono", text: (L.why[r.kind] || "") + r.ref }); }),
            (u.direct || []).length ? h("span", { text: L.changedSteps(u.direct.length) }) : null, files.length ? h("span", { text: L.testFiles(files.length) }) : null),
          open ? h("ul", { "class": "files" }, files.map(function (f) { return h("li", null, h("span", { text: f.file })); })) : null),
        h("span", { "class": "end" }, badge(u.relation), badge(u.tests && u.tests.state !== "unknown" ? u.tests.state : "tests"),
          files.length ? h("button", { type: "button", "class": "chev", "aria-expanded": open ? "true" : "false", "aria-label": L.testFilesLabel, on: { click: function () { S.open[key] = !open; paint(); } } }, icon(CHEV)) : null));
    })));
  }
  function bodyUnmapped(b) {
    var code = unmapped.filter(function (f) { return f.category === "code"; }).length, ign = (changes && changes.ignored) || [];
    var seg = h("div", { "class": "seg", role: "group", "aria-label": L.kindLabel });
    L.cats(code, unmapped.length - code, ign.length).forEach(function (x) {
      put(seg, h("button", { type: "button", "aria-pressed": S.ucat === x[0] ? "true" : "false", on: { click: function () { S.ucat = x[0]; paint(); } } }, x[1]));
    });
    put(b, head(L.qUnmapped, L.subUnmapped, seg));
    if (S.ucat === "ignored") {
      put(b, ign.length ? h("ul", { "class": "rowlist" }, ign.map(function (f) { return h("li", { "class": "ri" }, h("span", { "class": "gap" }), h("div", { "class": "main mono small", text: f.file }), h("span", { "class": "end" }, h("span", { "class": "badge", text: L.ignore[f.reason] || f.reason }))); }))
        : h("div", { "class": "empty", text: L.noIgnored }));
      return;
    }
    var gs = folders(S.ucat === "code");
    if (!gs.length) { put(b, h("div", { "class": "empty kr", text: S.ucat === "code" ? L.allMapped : L.noOther })); return; }
    put(b, h("ul", { "class": "rowlist" }, gs.map(function (g) {
      var key = "dir:" + g.dir, open = !!S.open[key];
      return h("li", { "class": "ri" + (done[key] ? " done" : "") }, checkbox(key, L.checked),
        h("div", { "class": "main" }, h("div", { "class": "t mono", text: g.dir + "/" }),
          open ? h("ul", { "class": "files" }, g.files.map(function (f) { return h("li", null, h("span", { text: f.file.slice(g.dir.length + 1) }), h("span", { "class": "ln", text: f.lines }), h("span", { "class": "st", text: (WORD[f.status] || ["", f.status])[1] })); }))
            : h("div", { "class": "m mono ell", text: g.files.map(function (f) { return f.file.slice(g.dir.length + 1); }).join(" · ") })),
        h("span", { "class": "end" }, h("span", { "class": "badge", text: L.nFiles(g.files.length) }), h("button", { type: "button", "class": "chev", "aria-expanded": open ? "true" : "false", "aria-label": L.fileList, on: { click: function () { S.open[key] = !open; paint(); } } }, icon(CHEV))));
    })));
  }

  /* ── frame ── */
  var grip = h("div", { "class": "grip", role: "separator", "aria-orientation": "horizontal", "aria-label": L.grip });
  var bar = h("div", { "class": "dtabs", role: "tablist", "aria-label": L.dock }), body = h("div", { "class": "dbody", role: "tabpanel", id: "sv-review-body" });
  function paint() {
    clear(bar); clear(body);
    tracks().forEach(function (t) {
      var n = left(t), tone = !t.avail ? "neutral" : n === 0 ? "success" : t.danger ? "danger" : "warning";
      put(bar, h("button", { type: "button", "class": "dtab", role: "tab", "data-tab": t.id, "aria-selected": S.tab === t.id && !S.collapsed ? "true" : "false", "aria-controls": "sv-review-body",
        on: { click: function () { if (S.tab === t.id) S.collapsed = !S.collapsed; else { S.tab = t.id; S.collapsed = false; } paint(); } } },
        h("span", { "class": "dot", "data-tone": tone }), t.label, h("span", { "class": "role", text: t.role }),
        !t.avail ? h("span", { "class": "left none", text: L.none }) : n ? h("span", { "class": "left", "data-tone": tone, text: L.left(n) }) : h("span", { "class": "ok", title: L.allDone }, icon(CHECK))));
    });
    put(bar, [h("span", { "class": "grow" }), h("button", { type: "button", "class": "btn icon ghost fold", "aria-label": S.collapsed ? L.expand : L.fold, "aria-expanded": S.collapsed ? "false" : "true", on: { click: function () { S.collapsed = !S.collapsed; paint(); } } }, icon(CHEV))]);
    if (root.classList) root.classList[S.collapsed ? "add" : "remove"]("collapsed");
    if (!S.collapsed) ({ intent: bodyIntent, impact: bodyImpact, unmapped: bodyUnmapped })[S.tab](body);
  }
  (function resizable() {
    var y0 = 0, h0 = 0, dragging = false;
    grip.addEventListener("pointerdown", function (e) { dragging = true; y0 = e.clientY; h0 = root.getBoundingClientRect().height; if (grip.setPointerCapture) grip.setPointerCapture(e.pointerId); });
    grip.addEventListener("pointermove", function (e) { if (!dragging) return; var v = Math.max(120, Math.min(window.innerHeight * 0.6, h0 - (e.clientY - y0))); doc.documentElement.style.setProperty("--dock-h", Math.round(v) + "px"); });
    grip.addEventListener("pointerup", function () { dragging = false; });
  })();
  put(root, [grip, bar, body]);
  root.removeAttribute("hidden");
  paint();
  window.__nacholensReview = {
    get state() { return { tab: S.tab, collapsed: S.collapsed, ucat: S.ucat }; },
    tracks: function () { return tracks().map(function (t) { return { id: t.id, avail: t.avail, left: left(t), total: t.items.length }; }); },
    open: function (tab) { S.tab = tab; S.collapsed = false; paint(); }
  };
})();
