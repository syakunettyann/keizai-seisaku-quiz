(function () {
  "use strict";

  const LS = {
    bookmarks: "keizai_bookmarks_v1",
    order: "keizai_order_v1",
    history: "keizai_history_v1",
    selection: "keizai_selection_v2",
    overrides: "keizai_overrides_v1",
    prefs: "keizai_prefs_v1"
  };

  /* ---------- localStorage（使えない環境でも落とさない） ---------- */
  let lsOk = true;
  try {
    localStorage.setItem("keizai_probe", "1");
    localStorage.removeItem("keizai_probe");
  } catch (e) {
    lsOk = false;
  }
  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { lsOk = false; return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { lsOk = false; }
  }
  function loadJSON(k, def) {
    const raw = lsGet(k);
    if (!raw) return def;
    try {
      const v = JSON.parse(raw);
      return v == null ? def : v;
    } catch (e) {
      return def;
    }
  }
  function saveJSON(k, v) { lsSet(k, JSON.stringify(v)); }

  /* ---------- データ ---------- */
  const ALL_QUESTIONS = [];
  const QBYID = {};
  ALL_YEAR_DATA.forEach((yearData) => {
    yearData.questions.forEach((q) => {
      const item = Object.assign({}, q, {
        year: yearData.year,
        yearLabel: yearData.yearLabel,
        key: q.category + ":" + yearData.year
      });
      ALL_QUESTIONS.push(item);
      QBYID[item.id] = item;
    });
  });

  const CATS = Object.keys(CATEGORY_LABELS);
  const TREE = CATS.map((code) => {
    const mids = [];
    ALL_YEAR_DATA.forEach((y) => {
      const qs = ALL_QUESTIONS.filter((q) => q.category === code && q.year === y.year);
      if (qs.length) mids.push({ key: code + ":" + y.year, label: y.yearLabel, qs });
    });
    return { code, label: CATEGORY_LABELS[code], mids };
  }).filter((c) => c.mids.length);
  const ALL_KEYS = new Set();
  TREE.forEach((c) => c.mids.forEach((m) => ALL_KEYS.add(m.key)));

  /* ---------- 状態 ---------- */
  const savedSel = loadJSON(LS.selection, null);
  const state = {
    screen: "home", // home | quiz | result | bookmarks
    selection: new Set(Array.isArray(savedSel) ? savedSel.filter((k) => ALL_KEYS.has(k)) : Array.from(ALL_KEYS)),
    expanded: new Set(),
    opts: {
      random: lsGet(LS.order) === "random",
      bookmarkOnly: false,
      unsolved: false,
      solved: false,
      count: ""
    },
    prefs: Object.assign({ autoread: true, sound: true }, loadJSON(LS.prefs, {})),
    searchQuery: "",
    searchHits: null,
    bookmarks: new Set(loadJSON(LS.bookmarks, [])),
    history: loadJSON(LS.history, {}),
    overrides: loadJSON(LS.overrides, {}),
    list: [],
    idx: 0,
    selectedKey: null,
    answered: false,
    session: {},
    lastIds: [],
    modal: null,
    rendered: null
  };

  /* ---------- ユーティリティ ---------- */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }
  function nl2br(str) {
    return escapeHtml(str).replace(/\n/g, "<br>");
  }
  function snippet(str, n) {
    const s = String(str).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  function saveBookmarks() { saveJSON(LS.bookmarks, Array.from(state.bookmarks)); }
  function saveSelection() { saveJSON(LS.selection, Array.from(state.selection)); }
  function savePrefs() { saveJSON(LS.prefs, state.prefs); }
  function crumb(q) { return CATEGORY_LABELS[q.category] + " ＞ " + q.yearLabel; }

  function conceptOf(q) {
    const o = state.overrides[q.id];
    return o && typeof o.concept === "string" ? o.concept : q.concept;
  }
  function explainOf(q, c) {
    const o = state.overrides[q.id];
    return o && o.explains && typeof o.explains[c.key] === "string" ? o.explains[c.key] : c.explain;
  }

  function isSolved(q) {
    const h = state.history[q.id];
    return !!(h && h.last === true);
  }
  function inScope(q) { return state.selection.has(q.key); }
  function passesOpts(q) {
    const o = state.opts;
    if (o.bookmarkOnly && !state.bookmarks.has(q.id)) return false;
    if (o.unsolved && isSolved(q)) return false;
    if (o.solved && !isSolved(q)) return false;
    return true;
  }
  function pool() { return ALL_QUESTIONS.filter((q) => inScope(q) && passesOpts(q)); }
  function prepareList(list) {
    let out = state.opts.random ? shuffle(list) : list.slice();
    const n = parseInt(state.opts.count, 10);
    if (n > 0) out = out.slice(0, n);
    return out;
  }
  function currentQuestion() { return state.list[state.idx]; }

  /* ---------- 読み上げ ---------- */
  const ttsOk = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  let speakEl = null;
  function stopSpeech() {
    try { if (ttsOk) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (speakEl) { speakEl.classList.remove("speaking"); speakEl = null; }
  }
  function speakText(text, el) {
    if (!ttsOk) return;
    stopSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (el) { speakEl = el; el.classList.add("speaking"); }
    const done = () => {
      if (el && speakEl === el) { el.classList.remove("speaking"); speakEl = null; }
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }
  function speakTap(el) {
    if (!ttsOk) return;
    if (speakEl === el) { stopSpeech(); return; }
    speakText(el.innerText || el.textContent, el);
  }
  function autoSpeak() {
    if (!ttsOk || !state.prefs.autoread || state.screen !== "quiz") return;
    const el = document.getElementById("q-text");
    const q = currentQuestion();
    if (el && q) speakText(q.question, el);
  }
  const speakAttr = ttsOk ? 'onclick="App.speakTap(this)"' : "";

  /* ---------- 効果音（Web Audio で合成） ---------- */
  let actx = null;
  function audioCtx() {
    if (!state.prefs.sound) return null;
    try {
      if (!actx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        actx = new C();
      }
      if (actx.state === "suspended") actx.resume();
      return actx;
    } catch (e) {
      return null;
    }
  }
  function tone(ctx, freq, start, dur, type, gain, endFreq) {
    const t0 = ctx.currentTime + start;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.linearRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  function playSound(ok) {
    const ctx = audioCtx();
    if (!ctx) return;
    if (ok) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ctx, f, i * 0.09, 0.25, "sine", 0.18));
      [523.25, 659.25, 783.99].forEach((f) => tone(ctx, f, 0.42, 0.6, "triangle", 0.1));
    } else {
      tone(ctx, 196, 0, 0.22, "sawtooth", 0.13, 170);
      tone(ctx, 147, 0.28, 0.45, "sawtooth", 0.13, 110);
    }
  }
  document.addEventListener("pointerdown", () => { audioCtx(); }, { once: true });

  /* ---------- 画面遷移・出題 ---------- */
  function resetQuestionState() {
    state.selectedKey = null;
    state.answered = false;
  }
  function startFrom(list, idx) {
    if (!list.length) return;
    state.list = list;
    state.idx = idx || 0;
    state.session = {};
    state.lastIds = list.map((q) => q.id);
    state.screen = "quiz";
    resetQuestionState();
    render();
    autoSpeak();
  }
  function startQuiz() {
    const list = pool();
    if (!list.length) return;
    startFrom(prepareList(list), 0);
  }
  function retry() {
    let list = state.lastIds.map((id) => QBYID[id]).filter(Boolean);
    if (state.opts.random) list = shuffle(list);
    startFrom(list, 0);
  }
  function goHome() { state.screen = "home"; render(); }
  function backToSetup() { goHome(); }
  function showBookmarks() { state.screen = "bookmarks"; render(); }
  function showResult() { state.screen = "result"; render(); }

  function goTo(delta) {
    const next = state.idx + delta;
    if (next < 0) return;
    if (next >= state.list.length) {
      if (delta > 0 && state.list.length) showResult();
      return;
    }
    state.idx = next;
    resetQuestionState();
    render();
    autoSpeak();
  }

  function selectChoice(key) {
    if (state.answered) return;
    state.selectedKey = key;
    render(true);
  }

  function submitAnswer() {
    if (!state.selectedKey || state.answered) return;
    const q = currentQuestion();
    if (!q) return;
    const ok = state.selectedKey === q.answer;
    state.answered = true;
    const h = state.history[q.id] || { c: 0, w: 0, last: null };
    if (ok) h.c++; else h.w++;
    h.last = ok;
    state.history[q.id] = h;
    saveJSON(LS.history, state.history);
    state.session[q.id] = ok;
    if (!ok && !state.bookmarks.has(q.id)) {
      state.bookmarks.add(q.id);
      saveBookmarks();
    }
    playSound(ok);
    render(true);
  }

  function toggleBookmark() {
    const q = currentQuestion();
    if (!q) return;
    if (state.bookmarks.has(q.id)) state.bookmarks.delete(q.id);
    else state.bookmarks.add(q.id);
    saveBookmarks();
    render(true);
  }
  function removeBookmark(id) {
    state.bookmarks.delete(id);
    saveBookmarks();
    render(true);
  }

  /* ---------- ホーム：選択・オプション ---------- */
  function toggleExpand(code) {
    if (state.expanded.has(code)) state.expanded.delete(code);
    else state.expanded.add(code);
    render(true);
  }
  function toggleCat(code) {
    const cat = TREE.find((c) => c.code === code);
    if (!cat) return;
    const allOn = cat.mids.every((m) => state.selection.has(m.key));
    cat.mids.forEach((m) => { if (allOn) state.selection.delete(m.key); else state.selection.add(m.key); });
    saveSelection();
    render(true);
  }
  function toggleMid(key) {
    if (state.selection.has(key)) state.selection.delete(key);
    else state.selection.add(key);
    saveSelection();
    render(true);
  }
  function selectAll() { ALL_KEYS.forEach((k) => state.selection.add(k)); saveSelection(); render(true); }
  function clearAll() { state.selection.clear(); saveSelection(); render(true); }

  function setOpt(name, value) {
    state.opts[name] = value;
    if (name === "unsolved" && value) state.opts.solved = false;
    if (name === "solved" && value) state.opts.unsolved = false;
    if (name === "random") lsSet(LS.order, value ? "random" : "seq");
    render(true);
  }
  function setPref(name, value) {
    state.prefs[name] = value;
    savePrefs();
    if (name === "autoread" && !value) stopSpeech();
  }
  function updatePoolInfo() {
    const el = document.getElementById("pool-info");
    if (el) el.textContent = poolInfoText();
  }
  function setCount(v) {
    state.opts.count = v;
    updatePoolInfo();
  }
  function poolInfoText() {
    const n = pool().length;
    const c = parseInt(state.opts.count, 10);
    return c > 0 && c < n ? "条件に該当: " + n + "問 → 出題 " + c + "問" : "条件に該当: " + n + "問";
  }

  /* ---------- 検索 ---------- */
  function setSearchQuery(v) { state.searchQuery = v; }
  function runSearch() {
    const kw = state.searchQuery.trim().toLowerCase();
    if (!kw) { state.searchHits = null; render(true); return; }
    state.searchHits = ALL_QUESTIONS.filter((q) => {
      let text = q.question + "\n" + conceptOf(q);
      q.choices.forEach((c) => { text += "\n" + c.text + "\n" + explainOf(q, c); });
      return text.toLowerCase().indexOf(kw) !== -1;
    });
    render(true);
  }
  function searchKeydown(ev) {
    if (ev.key === "Enter") { ev.preventDefault(); runSearch(); }
  }
  function startSearch() {
    if (!state.searchHits || !state.searchHits.length) return;
    startFrom(prepareList(state.searchHits), 0);
  }
  function startFromSearch(i) {
    if (!state.searchHits) return;
    startFrom(state.searchHits.slice(), i);
  }

  /* ---------- ブックマーク一覧 ---------- */
  function bookmarkedQuestions() { return ALL_QUESTIONS.filter((q) => state.bookmarks.has(q.id)); }
  function startBookmarks() {
    const list = bookmarkedQuestions();
    if (!list.length) return;
    startFrom(prepareList(list), 0);
  }
  function startFromBookmark(i) {
    startFrom(bookmarkedQuestions(), i);
  }

  /* ---------- モーダル ---------- */
  function openConfirm(message, onOk) { state.modal = { type: "confirm", message, onOk }; render(true); }
  function openInfo(message) { state.modal = { type: "info", message }; render(true); }
  function closeModal() { state.modal = null; render(true); }
  function modalOk() {
    const m = state.modal;
    state.modal = null;
    if (m && m.onOk) m.onOk();
    render(true);
  }

  function resetHistory() {
    openConfirm("学習履歴をリセットします。ブックマークは消えません。よろしいですか？", () => {
      state.history = {};
      saveJSON(LS.history, state.history);
    });
  }

  /* ---------- 解説の編集・エクスポート・インポート ---------- */
  function editExplain() {
    const q = currentQuestion();
    if (!q) return;
    state.modal = { type: "edit", qid: q.id };
    render(true);
  }
  function saveEdit() {
    const q = QBYID[state.modal.qid];
    const o = {};
    const concept = document.getElementById("ed-concept").value;
    if (concept !== q.concept) o.concept = concept;
    const ex = {};
    q.choices.forEach((c, i) => {
      const v = document.getElementById("ed-" + i).value;
      if (v !== c.explain) ex[c.key] = v;
    });
    if (Object.keys(ex).length) o.explains = ex;
    if (Object.keys(o).length) state.overrides[q.id] = o;
    else delete state.overrides[q.id];
    saveJSON(LS.overrides, state.overrides);
    state.modal = null;
    render(true);
  }
  function revertEdit() {
    const qid = state.modal.qid;
    delete state.overrides[qid];
    saveJSON(LS.overrides, state.overrides);
    state.modal = null;
    render(true);
  }
  function openExport() { state.modal = { type: "export" }; render(true); }
  function openImport() { state.modal = { type: "import" }; render(true); }
  function copyExport(btn) {
    const ta = document.getElementById("export-text");
    const done = () => { btn.textContent = "コピーしました"; };
    const fallback = () => {
      try {
        ta.focus();
        ta.select();
        if (document.execCommand("copy")) done();
      } catch (e) { /* ignore */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, fallback);
    } else {
      fallback();
    }
  }
  function doImport() {
    const text = document.getElementById("import-text").value.trim();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      state.modal = { type: "info", message: "JSONとして読み込めませんでした。エクスポートした内容をそのまま貼り付けてください。" };
      render(true);
      return;
    }
    let ok = 0;
    let bad = 0;
    Object.keys(data).forEach((qid) => {
      const v = data[qid];
      const q = QBYID[qid];
      if (!q || !v || typeof v !== "object") { bad++; return; }
      const o = {};
      if (typeof v.concept === "string") o.concept = v.concept;
      if (v.explains && typeof v.explains === "object") {
        const ex = {};
        q.choices.forEach((c) => { if (typeof v.explains[c.key] === "string") ex[c.key] = v.explains[c.key]; });
        if (Object.keys(ex).length) o.explains = ex;
      }
      if (!Object.keys(o).length) { bad++; return; }
      state.overrides[qid] = o;
      ok++;
    });
    saveJSON(LS.overrides, state.overrides);
    state.modal = { type: "info", message: ok + "件の修正を取り込みました" + (bad ? "（無効 " + bad + "件はスキップ）" : "") + "。" };
    render(true);
  }

  /* ---------- 描画 ---------- */
  function renderHeader() {
    return `<header class="topbar">
      <button class="hbtn" onclick="App.goHome()" aria-label="ホーム">🏠</button>
      <h1>経済学・経済政策 一問一答</h1>
      <button class="hbtn" onclick="App.showBookmarks()" aria-label="ブックマーク一覧">🔖</button>
    </header>`;
  }

  function progressBar(solved, total) {
    const pct = total ? (solved / total) * 100 : 0;
    const complete = total > 0 && solved === total;
    return `<div class="pbar ${complete ? "complete" : ""}"><div style="width:${pct}%;min-width:${solved > 0 ? 4 : 0}px"></div></div>`;
  }

  function renderTree() {
    return TREE.map((cat) => {
      const all = [];
      cat.mids.forEach((m) => m.qs.forEach((q) => all.push(q)));
      const solved = all.filter(isSolved).length;
      const selN = cat.mids.filter((m) => state.selection.has(m.key)).length;
      const checked = selN === cat.mids.length;
      const indet = selN > 0 && selN < cat.mids.length;
      const open = state.expanded.has(cat.code);
      const mids = open ? cat.mids.map((m) => {
        const s = m.qs.filter(isSolved).length;
        const id = "mid-" + m.key.replace(":", "-");
        return `<label class="tree-mid" for="${id}">
          <input type="checkbox" id="${id}" ${state.selection.has(m.key) ? "checked" : ""} onchange="App.toggleMid('${m.key}')">
          <span class="tname">${m.label}</span>
          ${progressBar(s, m.qs.length)}
          <span class="tcount">${s}/${m.qs.length}問</span>
        </label>`;
      }).join("") : "";
      return `<div class="tree-block">
        <div class="tree-head" onclick="App.toggleExpand('${cat.code}')">
          <label class="tree-major" for="cat-${cat.code}" onclick="event.stopPropagation()">
            <input type="checkbox" id="cat-${cat.code}" ${checked ? "checked" : ""} ${indet ? "data-indet=\"1\"" : ""} onchange="App.toggleCat('${cat.code}')">
            <span class="tname">${cat.label}</span>
          </label>
          ${progressBar(solved, all.length)}
          <span class="tcount">${solved}/${all.length}問</span>
          <span class="caret">${open ? "▾" : "▸"}</span>
        </div>
        ${open ? `<div class="tree-mids">${mids}</div>` : ""}
      </div>`;
    }).join("");
  }

  function renderSearchResults() {
    const hits = state.searchHits;
    if (hits === null) return "";
    if (!hits.length) return '<div class="muted-note">ヒットする問題はありません。</div>';
    const rows = hits.slice(0, 50).map((q, i) => `<div class="list-row" onclick="App.startFromSearch(${i})">
      <div class="crumb">${escapeHtml(crumb(q))}　第${q.no}問${q.sub ? "（設問" + q.sub + "）" : ""}</div>
      <div class="ltext">${escapeHtml(snippet(q.question, 80))}</div>
    </div>`).join("");
    return `<div class="search-result">
      <div class="search-bar">
        <button class="btn btn-sm" onclick="App.startSearch()">検索結果で学習開始</button>
        <span class="muted-note">${hits.length}件ヒット</span>
      </div>
      ${rows}
      ${hits.length > 50 ? `<div class="muted-note">他${hits.length - 50}件</div>` : ""}
    </div>`;
  }

  function renderHome() {
    const total = ALL_QUESTIONS.length;
    const learned = ALL_QUESTIONS.filter((q) => state.history[q.id]).length;
    const scopeN = ALL_QUESTIONS.filter(inScope).length;
    const poolN = pool().length;
    const o = state.opts;
    const editedN = Object.keys(state.overrides).length;

    return `
      ${lsOk ? "" : '<div class="warn-banner">この環境では学習記録を保存できません。再読み込みで記録が失われます。</div>'}

      <div class="card">
        <h2 class="setup-h2">出題範囲</h2>
        <div class="range-bar">
          <button class="btn btn-sm secondary" onclick="App.selectAll()">すべて選択</button>
          <button class="btn btn-sm secondary" onclick="App.clearAll()">すべて解除</button>
          <span class="muted-note">選択中: ${scopeN}問</span>
        </div>
        ${renderTree()}
      </div>

      <div class="card">
        <h2 class="setup-h2">出題オプション</h2>
        <label class="check-item" for="opt-random"><input type="checkbox" id="opt-random" ${o.random ? "checked" : ""} onchange="App.setOpt('random', this.checked)"><span>ランダム出題</span></label>
        <label class="check-item" for="opt-bm"><input type="checkbox" id="opt-bm" ${o.bookmarkOnly ? "checked" : ""} onchange="App.setOpt('bookmarkOnly', this.checked)"><span>★ ブックマークのみ</span></label>
        <label class="check-item" for="opt-unsolved"><input type="checkbox" id="opt-unsolved" ${o.unsolved ? "checked" : ""} onchange="App.setOpt('unsolved', this.checked)"><span>未正解の問題のみ（未回答・直近が不正解）</span></label>
        <label class="check-item" for="opt-solved"><input type="checkbox" id="opt-solved" ${o.solved ? "checked" : ""} onchange="App.setOpt('solved', this.checked)"><span>正解の問題のみ（直近が正解）</span></label>
        <div class="count-row">
          <label for="opt-count">出題数</label>
          <input type="number" id="opt-count" min="1" inputmode="numeric" placeholder="すべて" value="${escapeAttr(o.count)}" oninput="App.setCount(this.value)">
          <span class="muted-note">空欄＝すべて</span>
        </div>
        <label class="check-item" for="pref-auto"><input type="checkbox" id="pref-auto" ${state.prefs.autoread ? "checked" : ""} onchange="App.setPref('autoread', this.checked)" ${ttsOk ? "" : "disabled"}><span>問題文を自動で読み上げる${ttsOk ? "" : "（非対応）"}</span></label>
        <label class="check-item" for="pref-sound"><input type="checkbox" id="pref-sound" ${state.prefs.sound ? "checked" : ""} onchange="App.setPref('sound', this.checked)"><span>効果音</span></label>
        <div class="match-count" id="pool-info">${poolInfoText()}</div>
        <div class="actions center">
          <button class="btn btn-large" ${poolN === 0 ? "disabled" : ""} onclick="App.startQuiz()">この条件で学習開始</button>
        </div>
      </div>

      <div class="card">
        <h2 class="setup-h2">キーワード検索</h2>
        <div class="search-input-row">
          <input type="search" id="search-q" placeholder="問題文・解説から検索" value="${escapeAttr(state.searchQuery)}" oninput="App.setSearchQuery(this.value)" onkeydown="App.searchKeydown(event)">
          <button class="btn btn-sm" onclick="App.runSearch()">検索</button>
        </div>
        ${renderSearchResults()}
      </div>

      <div class="card">
        <h2 class="setup-h2">データ</h2>
        <div class="stats">総問題数 ${total}問 / 学習済み ${learned}問 / ブックマーク ${state.bookmarks.size}問</div>
        <div class="actions"><button class="btn btn-sm secondary" onclick="App.resetHistory()">学習履歴をリセット</button></div>
        <h2 class="setup-h2">解説の修正</h2>
        <div class="stats">修正済み ${editedN}件</div>
        <div class="actions">
          <button class="btn btn-sm secondary" onclick="App.openExport()">修正内容をエクスポート</button>
          <button class="btn btn-sm secondary" onclick="App.openImport()">インポート</button>
        </div>
      </div>
    `;
  }

  function renderExplainBox(q) {
    const edited = !!state.overrides[q.id];
    let html = '<div class="explain-box">';
    html += `<div class="explain-head"><span class="explain-title">解説${edited ? ' <span class="edited-tag">修正済み</span>' : ""}</span>
      <button class="btn btn-sm secondary" onclick="App.editExplain()">✏️編集</button></div>`;
    html += `<div class="concept-box" ${speakAttr}>
      <div class="concept-title">📘 前提知識</div>
      <div class="concept-text">${nl2br(conceptOf(q))}</div>
    </div>`;
    html += '<div class="explain-title">選択肢ごとの解説</div>';
    q.choices.forEach((c) => {
      const ok = c.key === q.answer;
      html += `<div class="explain-item">
        <div class="mark ${ok ? "ok" : "ng"}">${ok ? "○" : "✕"}${c.key}</div>
        <div class="body" ${speakAttr}><span class="etext">${nl2br(explainOf(q, c))}</span></div>
      </div>`;
    });
    html += "</div>";
    return html;
  }

  function renderQuestionCard(q) {
    let choicesHtml = "";
    q.choices.forEach((c) => {
      const isSelected = state.selectedKey === c.key;
      let cls = "choice";
      let markHtml = "";
      if (isSelected && !state.answered) cls += " selected";
      if (state.answered) {
        if (c.key === q.answer) {
          cls += " reveal-correct";
          markHtml = '<span class="mark ok">○</span>';
        } else if (isSelected) {
          cls += " reveal-incorrect";
          markHtml = '<span class="mark ng">✕</span>';
        } else {
          markHtml = '<span class="mark"></span>';
        }
      }
      choicesHtml += `<div class="${cls}" onclick="App.selectChoice('${c.key}')">
          <div class="key">${c.key}</div>
          ${state.answered ? markHtml : ""}
          <div class="body">${escapeHtml(c.text)}</div>
        </div>`;
    });

    let resultBanner = "";
    let explainHtml = "";
    if (state.answered) {
      const correct = state.selectedKey === q.answer;
      resultBanner = `<div class="result-banner ${correct ? "ok" : "ng"}">
        ${correct ? "正解です！" : "不正解です。正解は" + q.answer + "です。"}
      </div>
      <div class="src-code">出典: ${escapeHtml(q.yearLabel)}　第${q.no}問${q.sub ? "（設問" + q.sub + "）" : ""}（${escapeHtml(q.id)}）</div>`;
      explainHtml = renderExplainBox(q);
    }

    return `
      <div class="card">
        <div class="card-head">
          <div class="q-meta"><span class="cat-badge cat-${q.category}">${CATEGORY_LABELS[q.category]}</span> ＞ ${q.yearLabel}　第${q.no}問${q.sub ? "（設問" + q.sub + "）" : ""}${q.points ? "　配点:" + q.points + "点" : ""}</div>
          <button class="star-btn ${state.bookmarks.has(q.id) ? "on" : ""}" onclick="App.toggleBookmark()" aria-label="ブックマーク">${state.bookmarks.has(q.id) ? "★" : "☆"}</button>
        </div>
        <div class="q-text" id="q-text" ${speakAttr}>${nl2br(q.question)}</div>
        ${q.image ? `<img class="q-image" src="${q.image}" alt="第${q.no}問の図表">` : ""}
        <div class="choice-list">${choicesHtml}</div>
        <div class="actions">
          <button class="btn" ${!state.selectedKey || state.answered ? "disabled" : ""} onclick="App.submitAnswer()">解答する</button>
        </div>
        ${resultBanner}
        ${explainHtml}
      </div>
    `;
  }

  function renderQuiz() {
    const q = currentQuestion();
    const total = state.list.length;
    const pct = total ? Math.round(((state.idx + 1) / total) * 100) : 0;
    const vals = Object.keys(state.session).map((k) => state.session[k]);
    const okN = vals.filter(Boolean).length;
    const ngN = vals.length - okN;
    const isLast = state.idx >= total - 1;
    const body = q ? renderQuestionCard(q) : '<div class="empty-state">該当する問題がありません。</div>';
    const nav = q ? `
      <div class="bottom-nav">
        <button class="btn secondary" ${state.idx <= 0 ? "disabled" : ""} onclick="App.goTo(-1)">← 前の問題</button>
        <button class="btn ${state.answered ? "" : "secondary"}" onclick="App.goTo(1)">${isLast ? "結果を見る" : "次の問題 →"}</button>
      </div>` : "";
    return `
      <div class="quiz-progress">
        <div class="progress-row">
          <span>${total ? state.idx + 1 : 0} / ${total}</span>
          <span>正解 ${okN} / 誤り ${ngN}</span>
        </div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
      </div>
      ${body}
      ${nav}
    `;
  }

  function renderResult() {
    const total = state.list.length;
    const okN = Object.keys(state.session).filter((k) => state.session[k]).length;
    const pct = total ? Math.round((okN / total) * 100) : 0;
    return `
      <div class="card result-card">
        <div class="result-score">${okN} / ${total} 問正解 (${pct}%)</div>
        <div class="actions center">
          <button class="btn" onclick="App.retry()">同じ条件でもう一度</button>
          <button class="btn secondary" onclick="App.goHome()">ホームに戻る</button>
        </div>
      </div>
    `;
  }

  function renderBookmarks() {
    const list = bookmarkedQuestions();
    const rows = list.map((q, i) => `<div class="list-row bm-row">
      <div class="bm-main" onclick="App.startFromBookmark(${i})">
        <div class="crumb">${escapeHtml(crumb(q))}　第${q.no}問${q.sub ? "（設問" + q.sub + "）" : ""}</div>
        <div class="ltext">${escapeHtml(snippet(q.question, 80))}</div>
      </div>
      <button class="star-btn on" onclick="App.removeBookmark('${q.id}')" aria-label="ブックマーク解除">★</button>
    </div>`).join("");
    return `
      <div class="card">
        <h2 class="setup-h2">ブックマーク</h2>
        <div class="range-bar">
          <span class="muted-note">${list.length}件</span>
          <button class="btn btn-sm" ${list.length ? "" : "disabled"} onclick="App.startBookmarks()">ブックマークで学習開始</button>
        </div>
        ${list.length ? rows : '<div class="muted-note">ブックマークはまだありません。問題画面の☆で追加できます（不正解の問題は自動で追加されます）。</div>'}
      </div>
    `;
  }

  function renderModal() {
    const m = state.modal;
    if (!m) return "";
    let inner = "";
    if (m.type === "confirm") {
      inner = `<p class="modal-msg">${nl2br(m.message)}</p>
        <div class="modal-actions">
          <button class="btn secondary" onclick="App.closeModal()">キャンセル</button>
          <button class="btn" onclick="App.modalOk()">OK</button>
        </div>`;
    } else if (m.type === "info") {
      inner = `<p class="modal-msg">${nl2br(m.message)}</p>
        <div class="modal-actions"><button class="btn" onclick="App.closeModal()">OK</button></div>`;
    } else if (m.type === "edit") {
      const q = QBYID[m.qid];
      let fields = `<label class="ed-label" for="ed-concept">前提知識</label>
        <textarea id="ed-concept" rows="5">${escapeHtml(conceptOf(q))}</textarea>`;
      q.choices.forEach((c, i) => {
        fields += `<label class="ed-label" for="ed-${i}">${c.key} の解説</label>
          <textarea id="ed-${i}" rows="4">${escapeHtml(explainOf(q, c))}</textarea>`;
      });
      inner = `<h3 class="modal-title">解説を編集</h3>
        ${fields}
        <div class="modal-actions">
          <button class="btn secondary btn-sm" onclick="App.revertEdit()">元の内容に戻す</button>
          <button class="btn secondary" onclick="App.closeModal()">キャンセル</button>
          <button class="btn" onclick="App.saveEdit()">保存</button>
        </div>`;
    } else if (m.type === "export") {
      inner = `<h3 class="modal-title">修正内容のエクスポート</h3>
        <textarea id="export-text" rows="10" readonly>${escapeHtml(JSON.stringify(state.overrides, null, 2))}</textarea>
        <div class="modal-actions">
          <button class="btn secondary" onclick="App.copyExport(this)">コピー</button>
          <button class="btn" onclick="App.closeModal()">閉じる</button>
        </div>`;
    } else if (m.type === "import") {
      inner = `<h3 class="modal-title">修正内容のインポート</h3>
        <textarea id="import-text" rows="10" placeholder="エクスポートしたJSONを貼り付け"></textarea>
        <div class="modal-actions">
          <button class="btn secondary" onclick="App.closeModal()">キャンセル</button>
          <button class="btn" onclick="App.doImport()">取り込む</button>
        </div>`;
    }
    return `<div class="modal-overlay" onclick="App.closeModal()"><div class="modal-card" onclick="event.stopPropagation()">${inner}</div></div>`;
  }

  function render(keepScroll) {
    stopSpeech();
    const root = document.getElementById("root");
    const y = window.scrollY;
    let body;
    if (state.screen === "home") body = renderHome();
    else if (state.screen === "quiz") body = renderQuiz();
    else if (state.screen === "result") body = renderResult();
    else body = renderBookmarks();
    root.innerHTML = renderHeader() + body +
      '<footer class="hint">データはブラウザ内（localStorage）にのみ保存されます。</footer>' + renderModal();
    root.querySelectorAll("input[data-indet]").forEach((el) => { el.indeterminate = true; });
    if (keepScroll && state.rendered === state.screen) window.scrollTo(0, y);
    else window.scrollTo(0, 0);
    state.rendered = state.screen;
  }

  window.App = {
    selectChoice, submitAnswer, goTo, toggleBookmark, startQuiz, backToSetup,
    goHome, showBookmarks, removeBookmark, startBookmarks, startFromBookmark, retry,
    toggleExpand, toggleCat, toggleMid, selectAll, clearAll, setOpt, setPref, setCount,
    setSearchQuery, runSearch, searchKeydown, startSearch, startFromSearch,
    closeModal, modalOk, resetHistory, editExplain, saveEdit, revertEdit,
    openExport, openImport, copyExport, doImport, speakTap
  };

  document.addEventListener("DOMContentLoaded", () => {
    render();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  });
})();
