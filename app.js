(function () {
  "use strict";

  /* ---------- storage ---------- */

  const KEYS = {
    bookmarks: "keizai_bookmarks_v1",
    history: "keizai_history_v1",
    selection: "keizai_selection_v3",
    overrides: "keizai_overrides_v1",
    prefs: "keizai_prefs_v1",
    legacyOrder: "keizai_order_v1"
  };

  const mem = {};
  let storageOk = true;
  try {
    localStorage.setItem("keizai_probe", "1");
    localStorage.removeItem("keizai_probe");
  } catch (e) {
    storageOk = false;
  }

  function loadJSON(key, fallback) {
    try {
      const raw = storageOk ? localStorage.getItem(key) : mem[key];
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, val) {
    const raw = JSON.stringify(val);
    mem[key] = raw;
    if (!storageOk) return;
    try {
      localStorage.setItem(key, raw);
    } catch (e) {
      storageOk = false;
    }
  }

  function legacyRandom() {
    try {
      return localStorage.getItem(KEYS.legacyOrder) === "random";
    } catch (e) {
      return false;
    }
  }

  /* ---------- data ---------- */

  const ALL_QUESTIONS = [];
  const QINDEX = {};
  ALL_YEAR_DATA.forEach((y) => {
    y.questions.forEach((q) => {
      const item = Object.assign({}, q, { year: y.year, yearLabel: y.yearLabel });
      ALL_QUESTIONS.push(item);
      QINDEX[item.id] = item;
    });
  });

  const YEARS = ALL_YEAR_DATA.map((y) => ({ code: y.year, label: y.yearLabel }));
  const CATS = Object.keys(CATEGORY_LABELS).map((code) => ({ code, label: CATEGORY_LABELS[code] }));

  const DEFAULT_PREFS = {
    random: false,
    bookmarkOnly: false,
    unsolvedOnly: false,
    solvedOnly: false,
    count: "",
    autoRead: true,
    sound: true
  };

  const savedSel = loadJSON(KEYS.selection, {});
  const offYears = savedSel.offYears || [];
  const offCats = savedSel.offCats || [];

  const savedPrefs = loadJSON(KEYS.prefs, null);
  const prefs = Object.assign({}, DEFAULT_PREFS, savedPrefs || { random: legacyRandom() });
  if (savedPrefs && savedPrefs.autoread !== undefined && savedPrefs.autoRead === undefined) prefs.autoRead = savedPrefs.autoread;

  const state = {
    screen: "home", // home | quiz | result | bookmarks
    years: new Set(YEARS.map((y) => y.code).filter((c) => !offYears.includes(c))),
    cats: new Set(CATS.map((c) => c.code).filter((c) => !offCats.includes(c))),
    collapsed: new Set(["years", "cats"]),
    bookmarks: new Set(loadJSON(KEYS.bookmarks, [])),
    history: loadJSON(KEYS.history, {}),
    overrides: loadJSON(KEYS.overrides, {}),
    searchText: "",
    searchHits: null,
    list: [],
    idx: 0,
    answers: {},
    selectedKey: null,
    lastSetIds: []
  };

  function saveSelection() {
    saveJSON(KEYS.selection, {
      offYears: YEARS.filter((y) => !state.years.has(y.code)).map((y) => y.code),
      offCats: CATS.filter((c) => !state.cats.has(c.code)).map((c) => c.code)
    });
  }

  const saveBookmarks = () => saveJSON(KEYS.bookmarks, Array.from(state.bookmarks));
  const saveHistory = () => saveJSON(KEYS.history, state.history);
  const saveOverrides = () => saveJSON(KEYS.overrides, state.overrides);
  const savePrefs = () => saveJSON(KEYS.prefs, prefs);

  /* ---------- helpers ---------- */

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
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nl2br(str) {
    return escapeHtml(str).replace(/\n/g, "<br>");
  }

  function effConcept(q) {
    const o = state.overrides[q.id];
    return o && typeof o.concept === "string" ? o.concept : q.concept;
  }

  function effExplain(q, c) {
    const o = state.overrides[q.id];
    return o && o.explains && typeof o.explains[c.key] === "string" ? o.explains[c.key] : c.explain;
  }

  const isSolved = (id) => !!(state.history[id] && state.history[id].last);

  function inScope(q) {
    return state.years.has(q.year) && state.cats.has(q.category);
  }

  function passOptions(q) {
    if (prefs.bookmarkOnly && !state.bookmarks.has(q.id)) return false;
    if (prefs.unsolvedOnly && isSolved(q.id)) return false;
    if (prefs.solvedOnly && !isSolved(q.id)) return false;
    return true;
  }

  const candidates = () => ALL_QUESTIONS.filter((q) => inScope(q) && passOptions(q));

  function countLimit() {
    const n = parseInt(prefs.count, 10);
    return n > 0 ? n : null;
  }

  function makeSet(base) {
    let list = prefs.random ? shuffle(base) : base.slice();
    const n = countLimit();
    if (n) list = list.slice(0, n);
    return list;
  }

  function stats(filterFn) {
    let total = 0;
    let solved = 0;
    ALL_QUESTIONS.forEach((q) => {
      if (filterFn(q)) {
        total++;
        if (isSolved(q.id)) solved++;
      }
    });
    return { total, solved };
  }

  function pbar(s) {
    const pct = s.total ? (s.solved / s.total) * 100 : 0;
    const complete = s.total > 0 && s.solved === s.total;
    return `<div class="pbar${complete ? " complete" : ""}"><div style="width:${pct}%;min-width:${s.solved > 0 ? 4 : 0}px"></div></div>`;
  }

  function categoryBadge(q) {
    return `<span class="cat-badge cat-${q.category}">${escapeHtml(CATEGORY_LABELS[q.category])}</span>`;
  }

  function questionLabel(q) {
    return `${q.yearLabel}　第${q.no}問${q.sub ? "（設問" + q.sub + "）" : ""}`;
  }

  /* ---------- modal / toast ---------- */

  function closeModal() {
    const el = document.querySelector(".modal-overlay");
    if (el) el.remove();
  }

  function showModal(opts) {
    closeModal();
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <h3>${escapeHtml(opts.title)}</h3>
      <div class="modal-body">${opts.body || ""}</div>
      <div class="modal-actions"></div>
    </div>`;
    const actions = ov.querySelector(".modal-actions");
    (opts.buttons || []).forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.cls || "");
      btn.textContent = b.label;
      btn.addEventListener("click", () => {
        const keepOpen = b.onClick ? b.onClick(ov) : undefined;
        if (keepOpen !== false) closeModal();
      });
      actions.appendChild(btn);
    });
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeModal();
    });
    document.body.appendChild(ov);
    return ov;
  }

  function confirmModal(message, okLabel, onOk, danger) {
    showModal({
      title: "確認",
      body: `<p>${nl2br(message)}</p>`,
      buttons: [
        { label: "キャンセル", cls: "secondary" },
        { label: okLabel, cls: danger ? "danger" : "", onClick: onOk }
      ]
    });
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  /* ---------- speech ---------- */

  const speech = { current: null, token: 0 };
  const speechSupported = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  function applySpeakingClass() {
    document.querySelectorAll("[data-speak]").forEach((el) => {
      el.classList.toggle("speaking", el.dataset.speak === speech.current);
    });
  }

  function stopSpeech() {
    speech.token++;
    speech.current = null;
    if (speechSupported()) speechSynthesis.cancel();
    applySpeakingClass();
  }

  function splitChunks(text) {
    const parts = text.match(/[^。！？\n]+[。！？\n]?/g) || [];
    const chunks = [];
    let buf = "";
    parts.forEach((p) => {
      if (buf && buf.length + p.length > 150) {
        chunks.push(buf);
        buf = "";
      }
      buf += p;
    });
    if (buf.trim()) chunks.push(buf);
    return chunks;
  }

  function speakText(target, text) {
    if (!speechSupported()) return;
    speechSynthesis.cancel();
    const token = ++speech.token;
    speech.current = target;
    const chunks = splitChunks(text);
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = "ja-JP";
      if (i === chunks.length - 1) {
        const done = () => {
          if (speech.token === token) {
            speech.current = null;
            applySpeakingClass();
          }
        };
        u.onend = done;
        u.onerror = done;
      }
      speechSynthesis.speak(u);
    });
    applySpeakingClass();
  }

  function questionSpeech(q) {
    return q.question + "\n" + q.choices.map((c) => c.key + "、" + c.text).join("\n");
  }

  function explainSpeech(q) {
    let t = "正解は" + q.answer + "です。\n前提知識。" + effConcept(q) + "\n";
    q.choices.forEach((c) => {
      t += c.key + "、" + effExplain(q, c) + "\n";
    });
    return t;
  }

  function toggleSpeak(which) {
    const q = currentQuestion();
    if (!q) return;
    if (speech.current === which) {
      stopSpeech();
      return;
    }
    speakText(which, which === "q" ? questionSpeech(q) : explainSpeech(q));
  }

  function autoRead() {
    const q = currentQuestion();
    if (prefs.autoRead && q && !state.answers[state.idx]) speakText("q", questionSpeech(q));
  }

  /* ---------- sound ---------- */

  let audioCtx = null;
  function getCtx() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function tone(c, freq, start, dur, type, vol, endFreq) {
    const t0 = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function playResultSound(correct) {
    if (!prefs.sound) return;
    const c = getCtx();
    if (!c) return;
    if (correct) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, i * 0.08, 0.22, "sine", 0.18));
      [523.25, 659.25, 783.99].forEach((f) => tone(c, f, 0.36, 0.5, "triangle", 0.12));
    } else {
      tone(c, 220, 0, 0.16, "sawtooth", 0.14);
      tone(c, 196, 0.22, 0.45, "sawtooth", 0.14, 120);
    }
  }

  /* ---------- quiz flow ---------- */

  function currentQuestion() {
    return state.list[state.idx];
  }

  function setScreen(name) {
    stopSpeech();
    state.screen = name;
    render();
    window.scrollTo(0, 0);
  }

  function beginQuiz(list, idx) {
    if (!list.length) return;
    state.list = list;
    state.idx = idx || 0;
    state.answers = {};
    state.selectedKey = null;
    state.lastSetIds = list.map((q) => q.id);
    setScreen("quiz");
    autoRead();
  }

  function startFromHome() {
    beginQuiz(makeSet(candidates()), 0);
  }

  function restartSame() {
    let list = state.lastSetIds.map((id) => QINDEX[id]).filter(Boolean);
    if (prefs.random) list = shuffle(list);
    beginQuiz(list, 0);
  }

  function selectChoice(key) {
    if (state.answers[state.idx]) return;
    state.selectedKey = key;
    render();
  }

  function submitAnswer() {
    if (!state.selectedKey) return;
    recordAnswer(state.selectedKey);
  }

  function giveUp() {
    recordAnswer(null);
  }

  function recordAnswer(key) {
    const q = currentQuestion();
    if (!q || state.answers[state.idx]) return;
    const correct = key === q.answer;
    state.answers[state.idx] = { key, correct, unknown: key === null };
    state.selectedKey = key;

    const h = state.history[q.id] || { c: 0, w: 0, last: null };
    if (correct) h.c++;
    else h.w++;
    h.last = correct;
    state.history[q.id] = h;
    saveHistory();

    if (!correct && !state.bookmarks.has(q.id)) {
      state.bookmarks.add(q.id);
      saveBookmarks();
    }

    stopSpeech();
    if (key !== null) playResultSound(correct);
    render();
  }

  function goTo(delta) {
    const next = state.idx + delta;
    if (next < 0) return;
    if (next >= state.list.length) {
      setScreen("result");
      return;
    }
    stopSpeech();
    state.idx = next;
    const a = state.answers[next];
    state.selectedKey = a ? a.key : null;
    render();
    window.scrollTo(0, 0);
    if (delta > 0) autoRead();
  }

  function toggleBookmark() {
    const q = currentQuestion();
    if (!q) return;
    if (state.bookmarks.has(q.id)) state.bookmarks.delete(q.id);
    else state.bookmarks.add(q.id);
    saveBookmarks();
    render();
  }

  function removeBookmark(id) {
    state.bookmarks.delete(id);
    saveBookmarks();
    render();
  }

  /* ---------- home actions ---------- */

  function toggleCollapse(gid) {
    if (state.collapsed.has(gid)) state.collapsed.delete(gid);
    else state.collapsed.add(gid);
    render();
  }

  function groupSet(gid) {
    return gid === "years" ? state.years : state.cats;
  }

  function groupItems(gid) {
    return gid === "years" ? YEARS : CATS;
  }

  function toggleItem(gid, code) {
    const set = groupSet(gid);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    saveSelection();
    render();
  }

  function toggleGroup(gid) {
    const set = groupSet(gid);
    const items = groupItems(gid);
    if (items.every((i) => set.has(i.code))) set.clear();
    else items.forEach((i) => set.add(i.code));
    saveSelection();
    render();
  }

  function selectAll(on) {
    [["years", YEARS], ["cats", CATS]].forEach(([gid, items]) => {
      const set = groupSet(gid);
      set.clear();
      if (on) items.forEach((i) => set.add(i.code));
    });
    saveSelection();
    render();
  }

  function setPref(name, value) {
    prefs[name] = value;
    if (name === "unsolvedOnly" && value) prefs.solvedOnly = false;
    if (name === "solvedOnly" && value) prefs.unsolvedOnly = false;
    savePrefs();
    render();
  }

  function setCount(value) {
    prefs.count = value;
    savePrefs();
    refreshSummary();
  }

  function refreshSummary() {
    const total = candidates().length;
    const n = countLimit();
    const el = document.getElementById("match-count");
    if (el) {
      el.textContent = `該当する問題数：${total}問` + (n && n < total ? `（うち ${n}問を出題）` : "");
    }
    const btn = document.getElementById("btn-start");
    if (btn) btn.disabled = total === 0;
  }

  function setSearchText(value) {
    state.searchText = value;
  }

  function haystack(q) {
    const parts = [q.question, q.topic || "", effConcept(q)];
    q.choices.forEach((c) => parts.push(c.text, effExplain(q, c)));
    return parts.join("\n").toLowerCase();
  }

  function runSearch() {
    const words = state.searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      state.searchHits = null;
      render();
      return;
    }
    state.searchHits = ALL_QUESTIONS.filter((q) => {
      const h = haystack(q);
      return words.every((w) => h.includes(w));
    }).map((q) => q.id);
    render();
  }

  function startFromSearch() {
    if (!state.searchHits || !state.searchHits.length) return;
    beginQuiz(makeSet(state.searchHits.map((id) => QINDEX[id])), 0);
  }

  function startFromHit(i) {
    beginQuiz(state.searchHits.map((id) => QINDEX[id]), i);
  }

  function bookmarkedQuestions() {
    return ALL_QUESTIONS.filter((q) => state.bookmarks.has(q.id));
  }

  function startFromBookmarks() {
    beginQuiz(makeSet(bookmarkedQuestions()), 0);
  }

  function startFromBookmarkRow(i) {
    beginQuiz(bookmarkedQuestions(), i);
  }

  function resetHistory() {
    confirmModal("学習履歴をリセットします。ブックマークと解説の修正は消えません。よろしいですか？", "リセットする", () => {
      state.history = {};
      saveHistory();
      toast("学習履歴をリセットしました");
      render();
    }, true);
  }

  /* ---------- explanation editing ---------- */

  function editExplain() {
    const q = currentQuestion();
    if (!q) return;
    stopSpeech();
    let body = `<label for="ov-concept">前提知識</label>
      <textarea id="ov-concept" rows="7">${escapeHtml(effConcept(q))}</textarea>`;
    q.choices.forEach((c, i) => {
      body += `<label for="ov-c-${i}">選択肢 ${escapeHtml(c.key)} の解説</label>
        <textarea id="ov-c-${i}" rows="3">${escapeHtml(effExplain(q, c))}</textarea>`;
    });
    showModal({
      title: "解説を編集",
      body,
      buttons: [
        { label: "キャンセル", cls: "secondary" },
        {
          label: "元の内容に戻す",
          cls: "secondary",
          onClick: () => {
            delete state.overrides[q.id];
            saveOverrides();
            toast("元の内容に戻しました");
            render();
          }
        },
        {
          label: "保存",
          onClick: (ov) => {
            const o = {};
            const concept = ov.querySelector("#ov-concept").value.trim();
            if (concept !== q.concept.trim()) o.concept = concept;
            const ex = {};
            q.choices.forEach((c, i) => {
              const v = ov.querySelector("#ov-c-" + i).value.trim();
              if (v !== c.explain.trim()) ex[c.key] = v;
            });
            if (Object.keys(ex).length) o.explains = ex;
            if (o.concept !== undefined || o.explains) state.overrides[q.id] = o;
            else delete state.overrides[q.id];
            saveOverrides();
            toast("解説を保存しました");
            render();
          }
        }
      ]
    });
  }

  function copyText(textarea) {
    textarea.select();
    const done = () => toast("コピーしました");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textarea.value).then(done, () => {
        document.execCommand("copy");
        done();
      });
    } else {
      document.execCommand("copy");
      done();
    }
  }

  function exportOverrides() {
    const ov = showModal({
      title: "修正内容のエクスポート",
      body: `<p>下の内容をコピーして保存しておくと、別の端末で「インポート」できます。</p>
        <textarea id="exp-text" rows="10" readonly>${escapeHtml(JSON.stringify(state.overrides, null, 1))}</textarea>`,
      buttons: [
        { label: "閉じる", cls: "secondary" },
        { label: "コピー", onClick: () => { copyText(document.getElementById("exp-text")); return false; } }
      ]
    });
    ov.querySelector("#exp-text").addEventListener("focus", (e) => e.target.select());
  }

  function importOverrides() {
    showModal({
      title: "修正内容のインポート",
      body: `<p>エクスポートしたJSONを貼り付けてください。既存の修正にマージされます。</p>
        <textarea id="imp-text" rows="10"></textarea>
        <div class="modal-msg" id="imp-msg"></div>`,
      buttons: [
        { label: "キャンセル", cls: "secondary" },
        {
          label: "取り込む",
          onClick: (ov) => {
            const msg = ov.querySelector("#imp-msg");
            let data;
            try {
              data = JSON.parse(ov.querySelector("#imp-text").value);
            } catch (e) {
              msg.textContent = "JSONとして読み取れませんでした。";
              return false;
            }
            if (!data || typeof data !== "object" || Array.isArray(data)) {
              msg.textContent = "形式が正しくありません（オブジェクトではありません）。";
              return false;
            }
            let ok = 0;
            let skipped = 0;
            Object.keys(data).forEach((qid) => {
              const v = data[qid];
              if (!QINDEX[qid] || !v || typeof v !== "object") {
                skipped++;
                return;
              }
              const cur = state.overrides[qid] || {};
              const next = Object.assign({}, cur);
              if (typeof v.concept === "string") next.concept = v.concept;
              if (v.explains && typeof v.explains === "object") {
                next.explains = Object.assign({}, cur.explains);
                Object.keys(v.explains).forEach((k) => {
                  if (typeof v.explains[k] === "string") next.explains[k] = v.explains[k];
                });
              }
              state.overrides[qid] = next;
              ok++;
            });
            saveOverrides();
            toast(`${ok}件を取り込みました` + (skipped ? `（無効 ${skipped}件）` : ""));
            render();
          }
        }
      ]
    });
  }

  /* ---------- rendering ---------- */

  function renderHeader() {
    let progress = "";
    if (state.screen === "quiz" && state.list.length) {
      const total = state.list.length;
      const pct = Math.round(((state.idx + 1) / total) * 100);
      const answers = Object.values(state.answers);
      const ok = answers.filter((a) => a.correct).length;
      const ng = answers.length - ok;
      progress = `<div class="quiz-progress">
        <div class="progress-row">
          <span>${state.idx + 1} / ${total}</span>
          <span class="score"><span class="ok">正解 ${ok}</span><span class="ng">誤り ${ng}</span></span>
        </div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
      </div>`;
    }
    return `<header class="app-header">
      <div class="app-header-row">
        <button class="hdr-btn" onclick="App.goHome()" aria-label="ホームへ">🏠</button>
        <div class="hdr-title">経済学・経済政策 一問一答</div>
        <button class="hdr-btn" onclick="App.showBookmarks()" aria-label="ブックマーク一覧">🔖</button>
      </div>
      ${progress}
    </header>`;
  }

  function treeBlock(gid, title, items, itemFilter) {
    const set = groupSet(gid);
    const selectedCount = items.filter((i) => set.has(i.code)).length;
    const allSel = selectedCount === items.length;
    const partial = selectedCount > 0 && !allSel;
    const collapsed = state.collapsed.has(gid);
    const gs = stats(() => true);

    const rows = items.map((it) => {
      const s = stats((q) => itemFilter(q, it.code));
      if (!s.total) return "";
      const id = `chk-${gid}-${it.code}`;
      return `<div class="tree-item">
        <input type="checkbox" id="${id}" ${set.has(it.code) ? "checked" : ""} onchange="App.toggleItem('${gid}','${it.code}')">
        <label for="${id}">${escapeHtml(it.label)}</label>
        ${pbar(s)}<span class="tree-count">${s.solved}/${s.total}問</span>
      </div>`;
    }).join("");

    return `<div class="tree-block">
      <div class="tree-head" onclick="App.toggleCollapse('${gid}')">
        <input type="checkbox" aria-label="${escapeHtml(title)}をすべて選択" ${allSel ? "checked" : ""} ${partial ? 'data-indet="1"' : ""}
          onclick="event.stopPropagation()" onchange="App.toggleGroup('${gid}')">
        <span class="chev">${collapsed ? "▸" : "▾"}</span>
        <span class="tree-name">${escapeHtml(title)}</span>
        ${pbar(gs)}<span class="tree-count">${gs.solved}/${gs.total}問</span>
      </div>
      <div class="tree-body" ${collapsed ? "hidden" : ""}>${rows}</div>
    </div>`;
  }

  function renderSearchResults() {
    if (state.searchHits === null) return "";
    const hits = state.searchHits;
    const rows = hits.slice(0, 50).map((id, i) => {
      const q = QINDEX[id];
      const text = q.question.length > 70 ? q.question.slice(0, 70) + "…" : q.question;
      return `<div class="hit-row" onclick="App.startFromHit(${i})">
        <div class="hit-main">
          <div class="hit-path">${escapeHtml(CATEGORY_LABELS[q.category])} ＞ ${escapeHtml(questionLabel(q))}</div>
          <div class="hit-text">${escapeHtml(text)}</div>
        </div>
      </div>`;
    }).join("");
    const more = hits.length > 50 ? `<div class="hit-more">他 ${hits.length - 50}件（先頭50件のみ表示）</div>` : "";
    return `<div class="hit-head">
        <span><b>${hits.length}</b>件ヒット</span>
        <button class="btn btn-sm" ${hits.length ? "" : "disabled"} onclick="App.startFromSearch()">検索結果で学習開始</button>
      </div>
      <div class="hit-list">${rows}${more}</div>`;
  }

  function renderHome() {
    const scopeCount = ALL_QUESTIONS.filter(inScope).length;
    const history = state.history;
    const studied = Object.keys(history).filter((id) => QINDEX[id]).length;
    const editedCount = Object.keys(state.overrides).filter((id) => QINDEX[id]).length;

    const check = (id, label, checked, handler) => `<label class="check-item" for="${id}">
      <input type="checkbox" id="${id}" ${checked ? "checked" : ""} onchange="${handler}"><span>${label}</span></label>`;

    return `
      ${storageOk ? "" : '<div class="banner-warn">この環境ではブラウザの保存機能が使えないため、再読み込みすると学習記録が失われます。</div>'}

      <div class="card">
        <div class="section-row">
          <h2 class="section-title" style="margin:0">出題範囲</h2>
          <span><button class="btn btn-sm secondary" onclick="App.selectAll(true)">すべて選択</button>
          <button class="btn btn-sm secondary" onclick="App.selectAll(false)">すべて解除</button></span>
        </div>
        <div class="sel-summary" style="margin-bottom:10px">選択中: ${scopeCount}問</div>
        ${treeBlock("years", "年度", YEARS, (q, code) => q.year === code)}
        ${treeBlock("cats", "分野", CATS, (q, code) => q.category === code)}
      </div>

      <div class="card">
        <h2 class="section-title">出題オプション</h2>
        <div class="opt-grid">
          ${check("opt-random", "ランダム出題", prefs.random, "App.setPref('random', this.checked)")}
          ${check("opt-bm", "★ 選択範囲内のブックマークのみ", prefs.bookmarkOnly, "App.setPref('bookmarkOnly', this.checked)")}
          ${check("opt-unsolved", "未正解の問題のみ（履歴なし・直近が不正解）", prefs.unsolvedOnly, "App.setPref('unsolvedOnly', this.checked)")}
          ${check("opt-solved", "正解の問題のみ（直近が正解）", prefs.solvedOnly, "App.setPref('solvedOnly', this.checked)")}
          ${check("opt-read", "問題を自動で読み上げる", prefs.autoRead, "App.setPref('autoRead', this.checked)")}
          ${check("opt-sound", "効果音を鳴らす", prefs.sound, "App.setPref('sound', this.checked)")}
        </div>
        <div class="count-row">
          <label for="opt-count">出題数</label>
          <input type="number" id="opt-count" min="1" inputmode="numeric" placeholder="すべて" value="${escapeHtml(prefs.count)}" oninput="App.setCount(this.value)">
          <span class="sel-summary">空欄 = すべて</span>
        </div>
        <div class="match-count" id="match-count"></div>
        <button class="btn btn-large" id="btn-start" onclick="App.startFromHome()">この条件で学習開始</button>
      </div>

      <div class="card">
        <h2 class="section-title">キーワード検索</h2>
        <div class="search-row">
          <input type="search" id="search-input" placeholder="問題文・選択肢・解説（スペースでAND検索）" value="${escapeHtml(state.searchText)}"
            oninput="App.setSearchText(this.value)" onkeydown="if(event.key==='Enter')App.runSearch()">
          <button class="btn btn-sm" onclick="App.runSearch()">検索</button>
        </div>
        ${renderSearchResults()}
      </div>

      <div class="card">
        <h2 class="section-title">学習データ</h2>
        <div class="data-row">
          <span>総問題数 <b>${ALL_QUESTIONS.length}</b>問</span>
          <span>学習済み <b>${studied}</b>問</span>
          <span>ブックマーク <b>${state.bookmarks.size}</b>問</span>
        </div>
        <button class="btn btn-sm secondary" onclick="App.resetHistory()">学習履歴をリセット</button>
      </div>

      <div class="card">
        <h2 class="section-title">解説の修正</h2>
        <div class="data-row"><span>修正済み <b>${editedCount}</b>件</span></div>
        <div class="btn-row">
          <button class="btn btn-sm secondary" onclick="App.exportOverrides()">修正内容をエクスポート</button>
          <button class="btn btn-sm secondary" onclick="App.importOverrides()">インポート</button>
        </div>
      </div>
    `;
  }

  function renderExplainBox(q) {
    const edited = !!state.overrides[q.id];
    let html = `<div class="explain-box" data-speak="e" onclick="App.toggleSpeak('e')">
      <div class="explain-head">
        <div class="explain-title" style="margin:0">解説${edited ? '<span class="edited-tag">修正済み</span>' : ""}</div>
        <button class="btn btn-sm secondary" onclick="event.stopPropagation();App.editExplain()">✏️ 編集</button>
      </div>
      <div class="concept-box">
        <div class="concept-title">📘 前提知識</div>
        <div class="concept-text">${nl2br(effConcept(q))}</div>
      </div>
      <div class="explain-title">選択肢ごとの解説</div>`;
    q.choices.forEach((c) => {
      const ok = c.key === q.answer;
      const text = effExplain(q, c);
      html += `<div class="explain-item">
        <div class="mark ${ok ? "ok" : "ng"}">${ok ? "○" : "✕"}${escapeHtml(c.key)}</div>
        <div class="body">${text ? `<span class="etext">${nl2br(text)}</span>` : '<span class="etext pending">解説は準備中です。</span>'}</div>
      </div>`;
    });
    return html + "</div>";
  }

  function renderQuestionCard(q) {
    const answer = state.answers[state.idx];
    const answered = !!answer;
    let choicesHtml = "";
    q.choices.forEach((c) => {
      const isSelected = state.selectedKey === c.key;
      let cls = "choice";
      let markHtml = "";
      if (isSelected && !answered) cls += " selected";
      if (answered) {
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
        <div class="key">${escapeHtml(c.key)}</div>
        ${markHtml}
        <div class="body">${escapeHtml(c.text)}</div>
      </div>`;
    });

    let resultBanner = "";
    let explainHtml = "";
    if (answered) {
      resultBanner = `<div class="result-banner ${answer.correct ? "ok" : "ng"}">
        ${answer.correct ? "正解 ◎" : (answer.unknown ? "わからない（不正解として記録）" : "不正解 ×") + "（正解は " + escapeHtml(q.answer) + "）"}
        <span class="code">${escapeHtml(q.id)}</span>
      </div>`;
      explainHtml = renderExplainBox(q);
    }

    const starred = state.bookmarks.has(q.id);
    return `
      <div class="card">
        <div class="card-head">
          <div class="q-meta">${categoryBadge(q)} ${escapeHtml(questionLabel(q))}　配点:${q.points}点</div>
          <button class="star-btn ${starred ? "on" : ""}" onclick="App.toggleBookmark()" aria-label="ブックマーク">${starred ? "★" : "☆"}</button>
        </div>
        ${q.topic ? `<div class="topic-badge">${escapeHtml(q.topic)}</div>` : ""}
        <div class="q-text" data-speak="q" onclick="App.toggleSpeak('q')">${nl2br(q.question)}</div>
        ${q.image ? `<img class="q-image" src="${q.image}" alt="第${q.no}問の図表">` : ""}
        <div class="choice-list">${choicesHtml}</div>
        ${resultBanner}
        ${explainHtml}
      </div>
    `;
  }

  function renderQuiz() {
    const q = currentQuestion();
    if (!q) return '<div class="empty-state">該当する問題がありません。<br>ホームで条件を見直してください。</div>';
    const last = state.idx >= state.list.length - 1;
    const answered = !!state.answers[state.idx];
    return `
      ${renderQuestionCard(q)}
      ${answered ? "" : `<div class="answer-actions">
        <button class="btn" ${state.selectedKey ? "" : "disabled"} onclick="App.submitAnswer()">解答する</button>
        <button class="btn secondary" onclick="App.giveUp()">わからない</button>
      </div>`}
      <div class="bottom-nav">
        <button class="btn secondary" ${state.idx <= 0 ? "disabled" : ""} onclick="App.goTo(-1)">← 前の問題</button>
        <button class="btn ${answered ? "" : "secondary"}" onclick="App.goTo(1)">${last ? "結果を見る" : "次の問題 →"}</button>
      </div>`;
  }

  function renderResult() {
    const total = state.list.length;
    const answers = Object.values(state.answers);
    const correct = answers.filter((a) => a.correct).length;
    const wrong = answers.length - correct;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    return `<div class="card result-card">
      <div class="section-title">結果</div>
      <div class="result-score">${correct} / ${total} 問正解 (${pct}%)</div>
      <div class="result-sub">誤り ${wrong}問　未回答 ${total - answers.length}問</div>
      <div class="btn-row">
        <button class="btn" onclick="App.restartSame()">同じ条件でもう一度</button>
        <button class="btn secondary" onclick="App.goHome()">ホームに戻る</button>
      </div>
    </div>`;
  }

  function renderBookmarks() {
    const list = bookmarkedQuestions();
    const rows = list.map((q, i) => {
      const text = q.question.length > 70 ? q.question.slice(0, 70) + "…" : q.question;
      return `<div class="hit-row" onclick="App.startFromBookmarkRow(${i})">
        <div class="hit-main">
          <div class="hit-path">${escapeHtml(CATEGORY_LABELS[q.category])} ＞ ${escapeHtml(questionLabel(q))}</div>
          <div class="hit-text">${escapeHtml(text)}</div>
        </div>
        <button class="star-btn on" onclick="event.stopPropagation();App.removeBookmark('${q.id}')" aria-label="ブックマーク解除">★</button>
      </div>`;
    }).join("");
    return `<div class="card">
      <div class="section-row">
        <h2 class="section-title" style="margin:0">ブックマーク（${list.length}件）</h2>
      </div>
      ${list.length ? "" : '<div class="empty-state" style="padding:24px 0">ブックマークはまだありません。<br>問題の ☆ をタップするか、間違えた問題が自動で追加されます。</div>'}
      <button class="btn btn-large" ${list.length ? "" : "disabled"} onclick="App.startFromBookmarks()">ブックマークで学習開始</button>
      <div class="hit-list" style="margin-top:12px">${rows}</div>
    </div>`;
  }

  function render() {
    const root = document.getElementById("root");
    let body = "";
    if (state.screen === "home") body = renderHome();
    else if (state.screen === "quiz") body = renderQuiz();
    else if (state.screen === "result") body = renderResult();
    else body = renderBookmarks();
    root.innerHTML = renderHeader() + body +
      '<footer class="hint">学習データはこの端末のブラウザ内（localStorage）にのみ保存されます。</footer>';
    root.querySelectorAll('input[data-indet="1"]').forEach((el) => { el.indeterminate = true; });
    if (state.screen === "home") refreshSummary();
    applySpeakingClass();
  }

  window.App = {
    goHome: () => setScreen("home"),
    showBookmarks: () => setScreen("bookmarks"),
    toggleCollapse, toggleItem, toggleGroup, selectAll, setPref, setCount, setSearchText,
    runSearch, startFromHome, startFromSearch, startFromHit, startFromBookmarks, startFromBookmarkRow,
    removeBookmark, resetHistory, restartSame,
    selectChoice, submitAnswer, giveUp, goTo, toggleBookmark, toggleSpeak,
    editExplain, exportOverrides, importOverrides
  };

  document.addEventListener("DOMContentLoaded", () => {
    render();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  });
})();
