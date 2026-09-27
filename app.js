(function () {
  "use strict";

  const LS_BOOKMARKS = "keizai_bookmarks_v1";
  const LS_ORDER = "keizai_order_v1";

  function buildAllQuestions() {
    const out = [];
    ALL_YEAR_DATA.forEach((yearData) => {
      yearData.questions.forEach((q) => {
        out.push(Object.assign({}, q, {
          year: yearData.year,
          yearLabel: yearData.yearLabel
        }));
      });
    });
    return out;
  }

  const ALL_QUESTIONS = buildAllQuestions();

  const AVAILABLE_YEARS = ALL_YEAR_DATA.map((y) => ({ code: y.year, label: y.yearLabel }));
  const AVAILABLE_CATEGORIES = Object.keys(CATEGORY_LABELS).map((code) => ({ code, label: CATEGORY_LABELS[code] }));

  function loadBookmarks() {
    try {
      const raw = localStorage.getItem(LS_BOOKMARKS);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  function saveBookmarks(set) {
    localStorage.setItem(LS_BOOKMARKS, JSON.stringify(Array.from(set)));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const state = {
    screen: "setup", // setup | quiz
    selectedYears: new Set(AVAILABLE_YEARS.map((y) => y.code)),
    selectedCategories: new Set(AVAILABLE_CATEGORIES.map((c) => c.code)),
    bookmarkOnly: false,
    order: localStorage.getItem(LS_ORDER) || "seq",  // seq | random
    bookmarks: loadBookmarks(),
    list: [],
    idx: 0,
    selectedKey: null,
    answered: false
  };

  function matchesFilters(q) {
    if (!state.selectedYears.has(q.year)) return false;
    if (!state.selectedCategories.has(q.category)) return false;
    if (state.bookmarkOnly && !state.bookmarks.has(q.id)) return false;
    return true;
  }

  function countMatches() {
    return ALL_QUESTIONS.filter(matchesFilters).length;
  }

  function currentQuestion() {
    return state.list[state.idx];
  }

  function buildListFromFilters() {
    let list = ALL_QUESTIONS.filter(matchesFilters);
    if (state.order === "random") list = shuffle(list);
    state.list = list;
    state.idx = 0;
    resetQuestionState();
  }

  function resetQuestionState() {
    state.selectedKey = null;
    state.answered = false;
  }

  function startQuiz() {
    if (countMatches() === 0) return;
    buildListFromFilters();
    state.screen = "quiz";
    render();
  }

  function backToSetup() {
    state.screen = "setup";
    render();
  }

  function toggleYear(code) {
    if (state.selectedYears.has(code)) state.selectedYears.delete(code);
    else state.selectedYears.add(code);
    render();
  }

  function toggleCategory(code) {
    if (state.selectedCategories.has(code)) state.selectedCategories.delete(code);
    else state.selectedCategories.add(code);
    render();
  }

  function toggleAllYears() {
    if (state.selectedYears.size === AVAILABLE_YEARS.length) {
      state.selectedYears.clear();
    } else {
      AVAILABLE_YEARS.forEach((y) => state.selectedYears.add(y.code));
    }
    render();
  }

  function toggleAllCategories() {
    if (state.selectedCategories.size === AVAILABLE_CATEGORIES.length) {
      state.selectedCategories.clear();
    } else {
      AVAILABLE_CATEGORIES.forEach((c) => state.selectedCategories.add(c.code));
    }
    render();
  }

  function toggleBookmarkOnly() {
    state.bookmarkOnly = !state.bookmarkOnly;
    render();
  }

  function setOrderSetup(order) {
    state.order = order;
    localStorage.setItem(LS_ORDER, order);
    render();
  }

  function goTo(delta) {
    const next = state.idx + delta;
    if (next < 0 || next >= state.list.length) return;
    state.idx = next;
    resetQuestionState();
    render();
  }

  function toggleBookmark() {
    const q = currentQuestion();
    if (!q) return;
    if (state.bookmarks.has(q.id)) {
      state.bookmarks.delete(q.id);
    } else {
      state.bookmarks.add(q.id);
    }
    saveBookmarks(state.bookmarks);
    render();
  }

  function selectChoice(key) {
    if (state.answered) return;
    state.selectedKey = key;
    render();
  }

  function submitAnswer() {
    if (!state.selectedKey) return;
    state.answered = true;
    render();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function nl2br(str) {
    return escapeHtml(str).replace(/\n/g, "<br>");
  }

  function renderConceptBox(q) {
    return `<div class="concept-box">
      <div class="concept-title">📘 前提知識</div>
      <div class="concept-text">${nl2br(q.concept)}</div>
    </div>`;
  }

  function renderExplainBox(q) {
    let html = '<div class="explain-box">';
    html += renderConceptBox(q);
    html += '<div class="explain-title">選択肢ごとの解説</div>';
    q.choices.forEach((c) => {
      const ok = c.key === q.answer;
      html += `<div class="explain-item">
        <div class="mark ${ok ? "ok" : "ng"}">${ok ? "○" : "✕"}${c.key}</div>
        <div class="body"><span class="etext">${nl2br(c.explain)}</span></div>
      </div>`;
    });
    html += "</div>";
    return html;
  }

  function categoryBadge(q) {
    return `<span class="cat-badge cat-${q.category}">${CATEGORY_LABELS[q.category]}</span>`;
  }

  function renderQuestionCard(q) {
    let choicesHtml = "";
    q.choices.forEach((c) => {
      const isSelected = state.selectedKey === c.key;
      let cls = "choice";
      let markHtml = "";
      if (isSelected && !state.answered) cls += " selected";
      if (state.answered) {
        const isCorrectChoice = c.key === q.answer;
        if (isCorrectChoice) {
          cls += " reveal-correct";
          markHtml = '<span class="mark ok">○</span>';
        } else if (isSelected) {
          cls += " reveal-incorrect";
          markHtml = '<span class="mark ng">✕</span>';
        } else {
          markHtml = '<span class="mark"></span>';
        }
      }
      choicesHtml += `<div class="${cls}"
          onclick="App.selectChoice('${c.key}')">
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
      </div>`;
      explainHtml = renderExplainBox(q);
    }

    const submitDisabled = !state.selectedKey || state.answered;

    return `
      <div class="card">
        <div class="card-head">
          <div class="q-meta">${categoryBadge(q)} ${q.yearLabel}　第${q.no}問${q.sub ? "（設問" + q.sub + "）" : ""}${q.points ? "　配点:" + q.points + "点" : ""}</div>
          <button class="star-btn ${state.bookmarks.has(q.id) ? "on" : ""}" onclick="App.toggleBookmark()">${state.bookmarks.has(q.id) ? "★" : "☆"}</button>
        </div>
        <div class="q-text">${nl2br(q.question)}</div>
        ${q.image ? `<img class="q-image" src="${q.image}" alt="第${q.no}問の図表">` : ""}
        <div class="choice-list">${choicesHtml}</div>
        ${resultBanner}
        ${explainHtml}
        <div class="actions">
          <button class="btn" ${submitDisabled ? "disabled" : ""} onclick="App.submitAnswer()">解答する</button>
        </div>
      </div>
    `;
  }

  function renderSetupScreen() {
    const yearItems = AVAILABLE_YEARS.map((y) => `
      <label class="check-item">
        <input type="checkbox" ${state.selectedYears.has(y.code) ? "checked" : ""} onchange="App.toggleYear('${y.code}')">
        <span>${y.label}</span>
      </label>
    `).join("");

    const catItems = AVAILABLE_CATEGORIES.map((c) => `
      <label class="check-item">
        <input type="checkbox" ${state.selectedCategories.has(c.code) ? "checked" : ""} onchange="App.toggleCategory('${c.code}')">
        <span>${c.label}</span>
      </label>
    `).join("");

    const count = countMatches();

    return `
      <div class="card setup-card">
        <h2 class="setup-h2">年度を選択</h2>
        <button class="link-btn" onclick="App.toggleAllYears()">全て選択/解除</button>
        <div class="check-grid">${yearItems}</div>

        <h2 class="setup-h2">分野を選択</h2>
        <button class="link-btn" onclick="App.toggleAllCategories()">全て選択/解除</button>
        <div class="check-grid">${catItems}</div>

        <h2 class="setup-h2">出題順</h2>
        <div class="seg wide">
          <button class="${state.order === "seq" ? "active" : ""}" onclick="App.setOrderSetup('seq')">順番</button>
          <button class="${state.order === "random" ? "active" : ""}" onclick="App.setOrderSetup('random')">ランダム</button>
        </div>

        <label class="check-item" style="margin-top:14px;">
          <input type="checkbox" ${state.bookmarkOnly ? "checked" : ""} onchange="App.toggleBookmarkOnly()">
          <span>★ ブックマークした問題のみ出題</span>
        </label>

        <div class="match-count">該当する問題数：${count}問</div>

        <div class="actions">
          <button class="btn" ${count === 0 ? "disabled" : ""} onclick="App.startQuiz()">出題開始</button>
        </div>
      </div>
    `;
  }

  function renderQuizScreen() {
    const q = currentQuestion();
    const total = state.list.length;
    const posLabel = total ? `${state.idx + 1} / ${total}` : "0 / 0";
    const pct = total ? Math.round(((state.idx + 1) / total) * 100) : 0;

    const body = q ? renderQuestionCard(q) : `<div class="empty-state">該当する問題がありません。<br>設定画面で条件を見直してください。</div>`;

    const nav = q ? `
      <div class="bottom-nav">
        <button class="btn secondary" ${state.idx <= 0 ? "disabled" : ""} onclick="App.goTo(-1)">← 前の問題</button>
        <button class="btn secondary" ${state.idx >= total - 1 ? "disabled" : ""} onclick="App.goTo(1)">次の問題 →</button>
      </div>
    ` : "";

    return `
      <header class="top">
        <div class="controls">
          <button class="icon-btn" onclick="App.backToSetup()">← 設定に戻る</button>
        </div>
        <div class="progress-row">
          <span>${q ? q.yearLabel : ""}</span>
          <span>${posLabel}</span>
        </div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
      </header>
      ${body}
      ${nav}
    `;
  }

  function render() {
    const root = document.getElementById("root");
    let html;
    if (state.screen === "setup") {
      html = `<header class="top"><h1>経済学・経済政策 一問一答（試作版）</h1></header>` + renderSetupScreen();
    } else {
      html = renderQuizScreen();
    }
    root.innerHTML = html + `<footer class="hint">データはブラウザ内（localStorage）にのみ保存されます。</footer>`;
  }

  window.App = {
    selectChoice,
    submitAnswer,
    goTo,
    toggleBookmark,
    toggleYear,
    toggleCategory,
    toggleAllYears,
    toggleAllCategories,
    toggleBookmarkOnly,
    setOrderSetup,
    startQuiz,
    backToSetup
  };

  document.addEventListener("DOMContentLoaded", () => {
    render();
  });
})();
