/* ============================================================
 * 真经刷词神器 · Web 版
 * 依赖：js/data.js（window.VOCAB_DATA）
 * 说明：纯原生 JS，无构建步骤，可直接以 file:// 或 HTTP 方式打开
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 数据 ---------- */
  var DATA = window.VOCAB_DATA;
  if (!DATA || !DATA.chapters) {
    document.getElementById('dataInfo').textContent = '⚠️ 未找到词汇数据 js/data.js';
    return;
  }
  var CHAPTER_IDS = Object.keys(DATA.chapters).map(Number).sort(function (a, b) { return a - b; });
  var TOTAL_WORDS = CHAPTER_IDS.reduce(function (s, id) { return s + DATA.chapters[id].length; }, 0);

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var chapterSelect = $('chapterSelect');
  var progressFill = $('progressFill'), progressText = $('progressText');
  var correctCountEl = $('correctCount'), wrongCountEl = $('wrongCount'), streakCountEl = $('streakCount');
  var modeIcon = $('modeIcon'), modeText = $('modeText'), speechStatus = $('speechStatus');
  var chineseDisplay = $('chineseDisplay'), audioPlayBtn = $('audioPlayBtn');
  var letterSlots = $('letterSlots'), resultArea = $('resultArea');
  var wordCard = $('wordCard');
  var wcWord = $('wcWord'), wcPhonetic = $('wcPhonetic'), wcPos = $('wcPos'), wcTag = $('wcTag');
  var wcMeaning = $('wcMeaning'), wcRoot = $('wcRoot'), wcExtra = $('wcExtra');
  var wcExampleEN = $('wcExampleEN'), wcExampleCN = $('wcExampleCN');
  var nextBtn = $('nextBtn'), skipBtn = $('skipBtn'), restartBtn = $('restartBtn'), repeatBtn = $('repeatBtn');
  var addNewWordBtn = $('addNewWordBtn');
  var wrongList = $('wrongList'), wrongBookCount = $('wrongBookCount');
  var newWordList = $('newWordList'), newWordCount = $('newWordCount');
  var hintToggle = $('hintToggle'), timerToggle = $('timerToggle'), keyboardToggle = $('keyboardToggle');
  var timerDisplay = $('timerDisplay'), timerSeconds = $('timerSeconds');
  var goalCount = $('goalCount'), goalFill = $('goalFill'), setGoalBtn = $('setGoalBtn');
  var sidebar = $('vocabSidebar'), sidebarList = $('sidebarList'), sidebarSearch = $('sidebarSearch');
  var sidebarStats = $('sidebarStats'), sidebarToggleBtn = $('sidebarToggle');
  var closeSidebarBtn = $('closeSidebarBtn'), sidebarOverlay = $('sidebarOverlay');
  var softKeyboard = $('softKeyboard');
  var modalRoot = $('modalRoot'), modalContent = $('modalContent');
  var darkModeToggle = $('darkModeToggle');
  $('dataInfo').textContent = '共 ' + CHAPTER_IDS.length + ' 章 · ' + TOTAL_WORDS + ' 词';

  /* ---------- 常量 ---------- */
  var STORAGE_KEY = 'theo-vocab-web-state-v1';
  var TIMER_DURATION = 10;

  /* ---------- 运行时状态 ---------- */
  var currentVocabulary = [];   // 当前题库（章节或复习池）
  var shuffledWords = [];       // 打乱后的练习序列
  var currentIndex = 0;
  var currentWord = null;
  var currentMode = 'chinese';  // 本题实际模式
  var globalMode = 'random';
  var userInput = [];
  var isAnswered = false;
  var correctTotal = 0, wrongTotal = 0, completedCount = 0, streak = 0;
  var wrongBook = [];           // [{key, chapter, id, word, meaningCN}]
  var newWordBook = [];
  var hintEnabled = false, timerEnabled = false;
  var timerInterval = null;
  var dailyGoal = 50, dailyCount = 0, todayStr = today();
  var reviewMode = false;
  var kbShift = false;
  // 每章统计：{ completed, correct, wrong, mastery: {key: 正确次数} }
  var chapterStats = {};

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function wordKey(w) { return w.chapter + ':' + w.id; }
  function findWord(key) {
    var parts = key.split(':');
    var ch = DATA.chapters[Number(parts[0])] || [];
    for (var i = 0; i < ch.length; i++) if (String(ch[i].id) === parts[1]) return ch[i];
    return null;
  }
  function chapterWordCount(id) { return (DATA.chapters[id] || []).length; }

  /* ---------- 音效与语音 ---------- */
  var audioCtx = null;
  function getCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playTone(freq, dur, type) {
    var c = getCtx();
    if (!c) return;
    try {
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.2, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    } catch (e) { /* 忽略音频错误 */ }
  }
  function playCorrect() { playTone(880, 0.1); setTimeout(function () { playTone(1100, 0.12); }, 100); }
  function playWrong() { playTone(300, 0.15, 'square'); setTimeout(function () { playTone(200, 0.2, 'square'); }, 150); }

  var voices = [], speechReady = false;
  function loadVoices() {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis) return resolve();
      voices = speechSynthesis.getVoices();
      if (voices.length) return resolve();
      speechSynthesis.addEventListener('voiceschanged', function () {
        voices = speechSynthesis.getVoices();
        resolve();
      }, { once: true });
      setTimeout(resolve, 800); // 部分浏览器不触发 voiceschanged
    });
  }
  function initSpeech() {
    if (speechReady || !window.speechSynthesis) return Promise.resolve(false);
    return loadVoices().then(function () {
      try { speechSynthesis.resume(); } catch (e) { /* noop */ }
      speechReady = true;
      return true;
    });
  }
  function speakWord(word) {
    if (!window.speechSynthesis || !word) return;
    initSpeech().then(function () {
      try {
        speechSynthesis.cancel();
        setTimeout(function () {
          if (voices.length === 0) voices = speechSynthesis.getVoices();
          var u = new SpeechSynthesisUtterance(word);
          u.lang = 'en-US'; u.rate = 0.9; u.volume = 1;
          var pref = voices.filter(function (v) { return v.lang === 'en-US'; })[0]
                 || voices.filter(function (v) { return /^en/i.test(v.lang); })[0];
          if (pref) u.voice = pref;
          u.onstart = function () { speechStatus.textContent = '🔊 播放中'; };
          u.onend = function () { speechStatus.textContent = ''; };
          u.onerror = function () { speechStatus.textContent = '⚠️'; };
          speechSynthesis.speak(u);
        }, 60);
      } catch (e) { /* noop */ }
    });
  }
  document.addEventListener('pointerdown', function () { initSpeech(); }, { once: true });
  document.addEventListener('keydown', function () { initSpeech(); }, { once: true });

  /* ---------- 持久化 ---------- */
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        chapter: Number(chapterSelect.value) || 1,
        reviewMode: reviewMode,
        poolKeys: shuffledWords.map(wordKey),
        poolSource: reviewMode ? 'review' : ('chapter' + (Number(chapterSelect.value) || 1)),
        globalMode: globalMode,
        correctTotal: correctTotal, wrongTotal: wrongTotal, completedCount: completedCount,
        currentIndex: currentIndex,
        wrongBook: wrongBook.map(function (w) { return w.key; }),
        newWordBook: newWordBook.map(function (w) { return w.key; }),
        hintEnabled: hintEnabled, timerEnabled: timerEnabled,
        dailyGoal: dailyGoal, dailyCount: dailyCount, dailyDate: todayStr,
        chapterStats: chapterStats
      }));
    } catch (e) { /* 存储失败（隐私模式等）不影响使用 */ }
  }

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* ---------- 章节与题库 ---------- */
  function buildChapterOptions() {
    chapterSelect.innerHTML = '';
    CHAPTER_IDS.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id;
      o.textContent = '第' + id + '章（' + chapterWordCount(id) + '词）';
      chapterSelect.appendChild(o);
    });
  }

  function setPool(words, opts) {
    currentVocabulary = words;
    shuffledWords = words.slice();
    if (opts && opts.shuffle !== false) shuffle(shuffledWords);
    currentIndex = 0;
    correctTotal = 0; wrongTotal = 0; completedCount = 0; streak = 0;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function switchChapter(id) {
    reviewMode = false;
    var words = DATA.chapters[id] || [];
    if (!words.length) return;
    setPool(words);
    updateWrongBookUI(); updateNewWordBookUI(); updateSidebar();
    loadNextWord(); updateStats(); saveState();
  }

  function getChapterStats(id) {
    var key = String(id);
    if (!chapterStats[key]) chapterStats[key] = { completed: 0, correct: 0, wrong: 0, mastery: {} };
    return chapterStats[key];
  }

  /* 单词的掌握次数（答对≥2次记为掌握），按单词所属章节统计 */
  function masteryOf(w) {
    return getChapterStats(w.chapter).mastery[wordKey(w)] || 0;
  }

  function enterReviewMode() {
    var all = wrongBook.concat(newWordBook.filter(function (w) {
      return !wrongBook.some(function (wb) { return wb.key === w.key; });
    }));
    if (!all.length) { showModal('<h2>📚 复习</h2><p>错题本和生词本都为空，先去刷词吧！</p>', [{ text: '知道啦', primary: true }]); return; }
    reviewMode = true;
    var words = all.map(function (w) { return findWord(w.key); }).filter(Boolean);
    setPool(words);
    updateSidebar();
    loadNextWord(); updateStats(); saveState();
    showModal('<h2>📚 复习模式</h2><p>已加载 <strong>' + words.length + '</strong> 个错题和生词，加油！</p>', [{ text: '开始', primary: true }]);
  }

  /* ---------- 出题与渲染 ---------- */
  function loadNextWord() {
    if (!shuffledWords.length) return;
    clearInterval(timerInterval);
    currentIndex = currentIndex % shuffledWords.length;
    currentWord = shuffledWords[currentIndex];
    userInput = []; isAnswered = false;
    resultArea.textContent = '';
    wordCard.hidden = true;
    audioPlayBtn.hidden = true;
    if (globalMode === 'random') currentMode = Math.random() < 0.5 ? 'chinese' : 'audio';
    else currentMode = globalMode;
    if (currentMode === 'chinese') {
      chineseDisplay.textContent = currentWord.meaningCN;
    } else {
      chineseDisplay.textContent = '🔊 听音拼写';
      audioPlayBtn.hidden = false;
      speakWord(currentWord.word);
    }
    if (hintEnabled && currentWord.word.length) userInput = [currentWord.word[0].toLowerCase()];
    renderSlots();
    if (timerEnabled) startTimer();
    updateStats();
    saveState();
  }

  function renderSlots() {
    if (!currentWord) return;
    var len = currentWord.word.length;
    var html = '';
    for (var i = 0; i < len; i++) {
      var letter = userInput[i] || '';
      var cls = 'slot';
      if (hintEnabled && i === 0 && !isAnswered) cls += ' hint';
      if (!isAnswered && i === userInput.length) cls += ' active-slot';
      if (isAnswered) {
        var correct = currentWord.word[i].toLowerCase();
        if (letter && letter.toLowerCase() === correct) cls += ' correct';
        else cls += ' wrong miss';
      }
      html += '<div class="' + cls + '">' + escapeHtml(letter) + '</div>';
    }
    letterSlots.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showWordCard(w) {
    wcWord.textContent = w.word;
    wcPhonetic.textContent = w.phonetic || '';
    wcPos.textContent = w.pos || '';
    wcTag.textContent = w.tag || '';
    wcTag.hidden = !w.tag;
    wcMeaning.textContent = w.meaningCN || '';
    wcMeaning.dataset.label = '释义';
    wcRoot.textContent = w.root || '';
    wcRoot.dataset.label = '词根';
    wcRoot.hidden = !w.root;
    wcExtra.textContent = w.extra || '';
    wcExtra.dataset.label = '笔记';
    wcExtra.hidden = !w.extra;
    var hasExample = w.exampleEN || w.exampleCN;
    wcExampleEN.textContent = w.exampleEN ? '“' + w.exampleEN + '”' : '';
    wcExampleCN.textContent = w.exampleCN || '';
    wcExampleEN.hidden = !w.exampleEN;
    wcExampleCN.hidden = !w.exampleCN;
    wordCard.hidden = !hasExample && !w.root && !w.extra;
  }

  function updateStats() {
    var total = shuffledWords.length;
    progressText.textContent = completedCount + '/' + total;
    correctCountEl.textContent = correctTotal;
    wrongCountEl.textContent = wrongTotal;
    streakCountEl.textContent = streak;
    progressFill.style.width = (total > 0 ? (completedCount / total) * 100 : 0) + '%';
  }

  function updateGoalDisplay() {
    goalCount.textContent = dailyCount + '/' + dailyGoal;
    goalFill.style.width = Math.min(100, (dailyCount / dailyGoal) * 100) + '%';
  }

  function incrementDaily() {
    dailyCount++;
    if (dailyCount >= dailyGoal) {
      showReward();
      dailyCount = 0;
    }
    updateGoalDisplay();
    saveState();
  }

  /* ---------- 答题流程 ---------- */
  function startTimer() {
    clearInterval(timerInterval);
    var remaining = TIMER_DURATION;
    timerSeconds.textContent = remaining;
    timerSeconds.classList.remove('urgent');
    timerInterval = setInterval(function () {
      remaining--;
      timerSeconds.textContent = remaining;
      timerSeconds.classList.toggle('urgent', remaining <= 3 && remaining > 0);
      if (remaining <= 3) playTone(600, 0.05);
      if (remaining <= 0) { clearInterval(timerInterval); timerSeconds.classList.remove('urgent'); handleTimeout(); }
    }, 1000);
  }

  function handleTimeout() {
    if (isAnswered || !currentWord) return;
    isAnswered = true;
    wrongTotal++; streak = 0; playWrong();
    resultArea.innerHTML = '<span style="color:var(--wrong);">⏰ 时间到！正确单词：<strong>' + escapeHtml(currentWord.word) + '</strong></span>';
    addToWrongBook(currentWord);
    completedCount++;
    renderSlots();
    showWordCard(currentWord);
    speakWord(currentWord.word);
    updateWrongBookUI(); updateStats(); incrementDaily(); saveState(); updateSidebar();
    bumpChapterStats(currentWord, false);
  }

  function submitAnswer() {
    if (!currentWord || isAnswered) return;
    if (userInput.length < currentWord.word.length) {
      resultArea.innerHTML = '<span style="color:var(--new-word);">请先完成单词再提交</span>';
      return;
    }
    clearInterval(timerInterval);
    isAnswered = true;
    var inputWord = userInput.join('').toLowerCase();
    var isCorrect = inputWord === currentWord.word.toLowerCase();
    if (isCorrect) {
      correctTotal++; streak++;
      playCorrect();
      resultArea.innerHTML = '<span style="color:var(--correct);">✔️ 正确！' + (streak >= 3 ? '连续 ' + streak + ' 个，稳住！' : '') + '</span>';
      bumpChapterStats(currentWord, true);
    } else {
      wrongTotal++; streak = 0;
      playWrong();
      resultArea.innerHTML = '<span style="color:var(--wrong);">❌ 错误！正确单词：<strong>' + escapeHtml(currentWord.word) + '</strong></span>';
      addToWrongBook(currentWord);
      bumpChapterStats(currentWord, false);
    }
    completedCount++;
    renderSlots();
    showWordCard(currentWord);
    speakWord(currentWord.word);
    updateWrongBookUI(); updateStats(); incrementDaily(); saveState(); updateSidebar();
    if (completedCount >= shuffledWords.length) showReport();
  }

  function bumpChapterStats(word, correct) {
    var st = getChapterStats(word.chapter);
    st.completed++;
    if (correct) {
      st.correct++;
      st.mastery[wordKey(word)] = (st.mastery[wordKey(word)] || 0) + 1;
    } else {
      st.wrong++;
    }
  }

  function moveToNextWord() {
    if (!isAnswered) return;
    currentIndex++;
    if (currentIndex >= shuffledWords.length) {
      shuffle(shuffledWords);
      currentIndex = 0;
      completedCount = 0;
    }
    loadNextWord();
  }

  function skipWord() {
    if (!currentWord) return;
    currentIndex++;
    if (currentIndex >= shuffledWords.length) {
      shuffle(shuffledWords);
      currentIndex = 0;
      completedCount = 0;
    }
    loadNextWord();
  }

  function resetAndStart() {
    setPool(currentVocabulary.slice());
    updateWrongBookUI(); updateNewWordBookUI(); updateSidebar();
    loadNextWord(); updateStats(); saveState();
  }

  /* ---------- 错题本 / 生词本 ---------- */
  function addToWrongBook(word) {
    if (wrongBook.some(function (w) { return w.key === wordKey(word); })) return;
    wrongBook.push({ key: wordKey(word), chapter: word.chapter, id: word.id, word: word.word, meaningCN: word.meaningCN });
  }

  function bookChip(w, type) {
    return '<div class="word-chip' + (type === 'new' ? ' new-word' : '') + '" data-key="' + w.key + '" title="点击发音">' +
      '<span class="chip-word">' + escapeHtml(w.word) + '</span>' +
      '<span class="chip-meaning">' + escapeHtml(w.meaningCN) + '</span>' +
      '<span class="chip-remove" data-remove="' + w.key + '" title="移除">✕</span></div>';
  }

  function renderBook(listEl, book, type) {
    if (!book.length) {
      listEl.innerHTML = '<span class="word-chip empty-tip">' + (type === 'new' ? '暂无生词' : '暂无错题') + '</span>';
      return;
    }
    listEl.innerHTML = book.map(function (w) { return bookChip(w, type); }).join('');
    Array.prototype.forEach.call(listEl.querySelectorAll('.chip-remove'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var key = el.dataset.remove;
        if (type === 'new') newWordBook = newWordBook.filter(function (w) { return w.key !== key; });
        else wrongBook = wrongBook.filter(function (w) { return w.key !== key; });
        renderBook(listEl, type === 'new' ? newWordBook : wrongBook, type);
        updateBookCounts(); saveState(); updateSidebar();
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.word-chip:not(.empty-tip)'), function (chip) {
      chip.addEventListener('click', function () {
        var w = findWord(chip.dataset.key);
        if (w) speakWord(w.word);
      });
    });
  }

  function updateWrongBookUI() { renderBook(wrongList, wrongBook, 'wrong'); updateBookCounts(); }
  function updateNewWordBookUI() { renderBook(newWordList, newWordBook, 'new'); updateBookCounts(); }
  function updateBookCounts() {
    wrongBookCount.textContent = wrongBook.length;
    newWordCount.textContent = newWordBook.length;
  }

  /* ---------- 侧边栏 ---------- */
  function openSidebar() { sidebar.classList.add('open'); sidebarOverlay.classList.add('active'); updateSidebar(); }
  function closeSidebar() { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('active'); }

  function updateSidebar() {
    if (!sidebar.classList.contains('open')) return;
    var query = sidebarSearch.value.trim().toLowerCase();
    var list = currentVocabulary.filter(function (w) {
      return !query || w.word.toLowerCase().indexOf(query) >= 0 || (w.meaningCN || '').indexOf(query) >= 0;
    });
    var wrongKeys = {}, newKeys = {};
    wrongBook.forEach(function (w) { wrongKeys[w.key] = 1; });
    newWordBook.forEach(function (w) { newKeys[w.key] = 1; });
    var mastered = 0, weak = 0;
    currentVocabulary.forEach(function (w) {
      var k = wordKey(w);
      if (masteryOf(w) >= 2) mastered++;
      if (wrongKeys[k]) weak++;
    });
    sidebarStats.innerHTML = '<span>共 ' + currentVocabulary.length + ' 词</span>' +
      '<span style="color:var(--correct);">✓ 掌握 ' + mastered + '</span>' +
      '<span style="color:var(--wrong);">✗ 错题 ' + weak + '</span>' +
      '<span style="color:var(--new-word);">★ 生词 ' + newWordBook.length + '</span>';
    if (!list.length) {
      sidebarList.innerHTML = '<div class="sidebar-item" style="cursor:default;">未找到匹配单词</div>';
      return;
    }
    sidebarList.innerHTML = list.map(function (w) {
      var k = wordKey(w);
      var icon;
      if (wrongKeys[k]) icon = '<span class="status-icon" style="color:var(--wrong);" title="错题本">✗</span>';
      else if (newKeys[k]) icon = '<span class="status-icon" style="color:var(--new-word);" title="生词本">★</span>';
      else if (masteryOf(w) >= 2) icon = '<span class="status-icon" style="color:var(--correct);" title="已掌握">✓</span>';
      else icon = '<span class="status-icon" style="color:var(--text-secondary);" title="未学">○</span>';
      return '<div class="sidebar-item" data-key="' + k + '">' +
        '<span class="word-text">' + escapeHtml(w.word) + '</span>' +
        '<span class="word-meaning">' + escapeHtml(w.meaningCN) + '</span>' + icon + '</div>';
    }).join('');
    Array.prototype.forEach.call(sidebarList.querySelectorAll('.sidebar-item[data-key]'), function (item) {
      item.addEventListener('click', function () { jumpToWord(item.dataset.key); });
    });
  }

  function jumpToWord(key) {
    var w = findWord(key);
    if (!w) return;
    var idx = shuffledWords.findIndex(function (x) { return wordKey(x) === key; });
    if (idx === -1) shuffledWords.splice(currentIndex, 0, w);
    else {
      var t = shuffledWords[currentIndex];
      shuffledWords[currentIndex] = shuffledWords[idx];
      shuffledWords[idx] = t;
    }
    currentWord = shuffledWords[currentIndex];
    loadNextWord();
    closeSidebar();
  }

  /* ---------- 弹窗 ---------- */
  function showModal(html, actions) {
    modalContent.innerHTML = html;
    var actionsEl = document.createElement('div');
    actionsEl.className = 'modal-actions';
    (actions || [{ text: '关闭', primary: true }]).forEach(function (a) {
      var b = document.createElement('button');
      b.textContent = a.text;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', function () {
        if (a.onClick) a.onClick();
        closeModal();
      });
      actionsEl.appendChild(b);
    });
    modalContent.appendChild(actionsEl);
    modalRoot.hidden = false;
  }
  function closeModal() { modalRoot.hidden = true; modalContent.innerHTML = ''; }
  modalRoot.addEventListener('click', function (e) { if (e.target === modalRoot) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (sidebar.classList.contains('open')) { closeSidebar(); return; }
    if (!modalRoot.hidden) closeModal();
  });

  /* 轻量 confetti：全屏 Canvas 粒子，约 1.8s 后自动清理；尊重 reduced-motion */
  function fireConfetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1200;';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var W = canvas.width = window.innerWidth, H = canvas.height = window.innerHeight;
    var colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
    var parts = [];
    for (var i = 0; i < 90; i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.5,
        y: H / 3 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 9,
        vy: Math.random() * -9 - 3,
        size: 4 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3
      });
    }
    var frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      frames++;
      parts.forEach(function (p) {
        p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - frames / 100);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (frames < 100) requestAnimationFrame(tick);
      else canvas.remove();
    })();
  }

  function showReward() {
    fireConfetti();
    showModal('<h2>🎉 恭喜！</h2><p>你已完成今日目标 <strong>' + dailyGoal + '</strong> 词，继续保持！</p>',
      [{ text: '太棒了', primary: true }]);
  }

  /* 首次访问引导（仅全新用户，有历史记录的用户不弹） */
  function showOnboarding() {
    showModal(
      '<h2>👋 欢迎使用真经刷词神器</h2>' +
      '<p>· 顶部切换 <strong>看中文 / 听音 / 随机</strong> 三种模式</p>' +
      '<p>· 直接敲键盘拼写，<strong>回车</strong>提交，再回车下一题</p>' +
      '<p>· 💡提示 自动填首字母，⏱️计时 每题 10 秒</p>' +
      '<p>· 答错自动进 <strong>错题本</strong>，📌 收藏生词，📚 一键合并复习</p>' +
      '<p>· 📋 总览全章单词掌握状态，点击可跳练</p>' +
      '<p>· 进度自动存在本机浏览器，刷新不丢失</p>',
      [{ text: '开始刷词', primary: true }]
    );
  }

  function showReport() {
    var total = shuffledWords.length;
    var accuracy = total ? Math.round((correctTotal / total) * 100) : 0;
    var mastered = 0;
    currentVocabulary.forEach(function (w) { if (masteryOf(w) >= 2) mastered++; });
    var weakWords = wrongBook.filter(function (w) {
      return currentVocabulary.some(function (c) { return wordKey(c) === w.key; });
    });
    var reportText =
      '真经刷词神器 · 学习报告\n' +
      '========================\n' +
      '日期：' + new Date().toLocaleString('zh-CN') + '\n' +
      '范围：' + (reviewMode ? '错题+生词复习' : '第' + chapterSelect.value + '章') + '\n' +
      '本轮词数：' + total + '\n' +
      '答对：' + correctTotal + '｜答错：' + wrongTotal + '\n' +
      '正确率：' + accuracy + '%\n' +
      '已掌握（答对≥2次）：' + mastered + '\n' +
      '薄弱词：' + (weakWords.length ? weakWords.map(function (w) { return w.word; }).join(', ') : '无') + '\n';
    showModal(
      '<h2>📊 学习报告</h2>' +
      '<div class="report-grid">' +
      '<div class="report-cell"><div class="num">' + accuracy + '%</div><div class="lbl">正确率</div></div>' +
      '<div class="report-cell"><div class="num">' + correctTotal + '/' + total + '</div><div class="lbl">答对/总数</div></div>' +
      '<div class="report-cell"><div class="num">' + mastered + '</div><div class="lbl">已掌握</div></div>' +
      '</div>' +
      '<p>薄弱词：</p><div class="report-weak">' +
      (weakWords.length ? weakWords.map(function (w) { return escapeHtml(w.word) + ' ' + escapeHtml(w.meaningCN); }).join('<br>') : '无，全部拿下！💪') +
      '</div>',
      [
        { text: '📄 导出报告', onClick: function () { downloadReport(reportText); } },
        { text: '关闭', primary: true }
      ]
    );
  }

  function downloadReport(text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '刷词报告_' + today() + '.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 输入处理 ---------- */
  function inputLetter(ch) {
    if (!currentWord || isAnswered) return;
    if (userInput.length < currentWord.word.length) {
      userInput.push(ch.toLowerCase());
      renderSlots();
    }
  }
  function backspace() {
    if (!currentWord || isAnswered) return;
    if (hintEnabled && userInput.length <= 1) return;
    if (userInput.length > 0) { userInput.pop(); renderSlots(); }
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!modalRoot.hidden) {
        var primary = modalContent.querySelector('.modal-actions button.primary');
        if (primary) primary.click();
        return;
      }
      if (!isAnswered) submitAnswer(); else moveToNextWord();
      return;
    }
    if (isAnswered) return;
    if (/^[a-zA-Z\- ]$/.test(e.key)) { e.preventDefault(); inputLetter(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
  });

  /* ---- 软键盘 ---- */
  function makeKey(ch, label, extraCls) {
    var b = document.createElement('button');
    b.className = 'kb-key' + (extraCls ? ' ' + extraCls : '');
    b.textContent = label != null ? label : (kbShift ? ch.toUpperCase() : ch);
    if (ch != null) b.dataset.key = ch;
    return b;
  }

  function buildSoftKeyboard() {
    var rows = softKeyboard.querySelectorAll('.kb-row');
    // 第一行：qwertyuiop
    rows[0].innerHTML = '';
    'qwertyuiop'.split('').forEach(function (ch) { rows[0].appendChild(makeKey(ch)); });
    // 第二行：asdfghjkl
    rows[1].innerHTML = '';
    'asdfghjkl'.split('').forEach(function (ch) { rows[1].appendChild(makeKey(ch)); });
    // 第三行：⇧ + zxcvbnm + ⌫
    rows[2].innerHTML = '';
    var shiftBtn = document.createElement('button');
    shiftBtn.className = 'kb-key kb-key-fn' + (kbShift ? ' shifted' : '');
    shiftBtn.textContent = '⇧';
    shiftBtn.dataset.action = 'shift';
    shiftBtn.title = '大写切换';
    rows[2].appendChild(shiftBtn);
    'zxcvbnm'.split('').forEach(function (ch) { rows[2].appendChild(makeKey(ch)); });
    var bsBtn = document.createElement('button');
    bsBtn.className = 'kb-key kb-key-fn';
    bsBtn.textContent = '⌫';
    bsBtn.dataset.action = 'backspace';
    bsBtn.title = '退格';
    rows[2].appendChild(bsBtn);
    // 第四行：- 空格 ⏎
    rows[3].innerHTML = '';
    rows[3].appendChild(makeKey('-', '-', 'kb-key-wide'));
    rows[3].appendChild(makeKey(' ', '空格', 'kb-key-wide'));
    var enterBtn = document.createElement('button');
    enterBtn.className = 'kb-key kb-key-wide kb-key-enter';
    enterBtn.textContent = '⏎';
    enterBtn.dataset.action = 'enter';
    enterBtn.title = '提交 / 下一题';
    rows[3].appendChild(enterBtn);
  }

  softKeyboard.addEventListener('click', function (e) {
    var btn = e.target.closest('.kb-key');
    if (!btn) return;
    var action = btn.dataset.action;
    if (action === 'enter') {
      if (!modalRoot.hidden) {
        var primary = modalContent.querySelector('.modal-actions button.primary');
        if (primary) primary.click();
      } else if (!isAnswered) submitAnswer();
      else moveToNextWord();
    } else if (action === 'backspace') {
      backspace();
    } else if (action === 'shift') {
      kbShift = !kbShift;
      buildSoftKeyboard();
    } else if (btn.dataset.key) {
      inputLetter(btn.dataset.key);
    }
  });

  /* ---------- 控件事件 ---------- */
  buildChapterOptions();
  buildSoftKeyboard();

  chapterSelect.addEventListener('change', function () { switchChapter(Number(chapterSelect.value)); });

  Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      globalMode = b.dataset.mode;
      updateModeIndicator();
      if (currentWord && !isAnswered) loadNextWord(); // 立即应用新模式
      saveState();
    });
  });

  hintToggle.addEventListener('click', function () {
    hintEnabled = !hintEnabled;
    hintToggle.classList.toggle('active', hintEnabled);
    if (currentWord && !isAnswered) {
      userInput = hintEnabled && currentWord.word.length ? [currentWord.word[0].toLowerCase()] : [];
      renderSlots();
    }
    saveState();
  });
  timerToggle.addEventListener('click', function () {
    timerEnabled = !timerEnabled;
    timerToggle.classList.toggle('active', timerEnabled);
    timerDisplay.hidden = !timerEnabled;
    if (!timerEnabled) clearInterval(timerInterval);
    else if (currentWord && !isAnswered) startTimer();
    saveState();
  });
  keyboardToggle.addEventListener('click', function () {
    softKeyboard.hidden = !softKeyboard.hidden;
    keyboardToggle.classList.toggle('active', !softKeyboard.hidden);
    saveState();
  });

  function updateModeIndicator() {
    if (globalMode === 'chinese') { modeIcon.textContent = '📖'; modeText.textContent = '看中文拼写'; }
    else if (globalMode === 'audio') { modeIcon.textContent = '🔊'; modeText.textContent = '听音拼写'; }
    else { modeIcon.textContent = '🎲'; modeText.textContent = '随机模式'; }
  }

  nextBtn.addEventListener('click', function () { if (!isAnswered) submitAnswer(); else moveToNextWord(); });
  skipBtn.addEventListener('click', skipWord);
  restartBtn.addEventListener('click', resetAndStart);
  repeatBtn.addEventListener('click', function () { if (currentWord) speakWord(currentWord.word); });
  audioPlayBtn.addEventListener('click', function () { if (currentWord) speakWord(currentWord.word); });

  addNewWordBtn.addEventListener('click', function () {
    if (!currentWord) return;
    var k = wordKey(currentWord);
    if (!newWordBook.some(function (w) { return w.key === k; })) {
      newWordBook.push({ key: k, chapter: currentWord.chapter, id: currentWord.id, word: currentWord.word, meaningCN: currentWord.meaningCN });
      updateNewWordBookUI(); saveState(); updateSidebar();
      resultArea.innerHTML = '<span style="color:var(--new-word);">📌 已加入生词本</span>';
    } else {
      resultArea.innerHTML = '<span style="color:var(--text-secondary);">该词已在生词本中</span>';
    }
  });

  $('clearWrongBtn').addEventListener('click', function () {
    if (!wrongBook.length) return;
    wrongBook = []; updateWrongBookUI(); saveState(); updateSidebar();
  });
  $('clearNewWordsBtn').addEventListener('click', function () {
    if (!newWordBook.length) return;
    newWordBook = []; updateNewWordBookUI(); saveState(); updateSidebar();
  });
  $('reviewBookBtn').addEventListener('click', enterReviewMode);

  $('wrongBookToggle').addEventListener('click', function () {
    wrongList.classList.toggle('hidden');
    this.querySelector('.arrow').textContent = wrongList.classList.contains('hidden') ? '▶' : '▼';
  });
  $('newWordBookToggle').addEventListener('click', function () {
    newWordList.classList.toggle('hidden');
    this.querySelector('.arrow').textContent = newWordList.classList.contains('hidden') ? '▶' : '▼';
  });

  sidebarToggleBtn.addEventListener('click', function () {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  sidebarOverlay.addEventListener('click', closeSidebar);
  closeSidebarBtn.addEventListener('click', closeSidebar);
  sidebarSearch.addEventListener('input', updateSidebar);

  setGoalBtn.addEventListener('click', function () {
    showModal(
      '<h2>🎯 每日目标</h2><p>设置每天要刷的词汇数量（完成目标会有庆祝动画）：</p>' +
      '<div class="goal-input-row"><input type="number" id="goalInput" min="1" max="999" value="' + dailyGoal + '"></div>',
      [{
        text: '保存', primary: true, onClick: function () {
          var v = parseInt($('goalInput').value, 10);
          if (v > 0 && v <= 999) { dailyGoal = v; updateGoalDisplay(); saveState(); }
        }
      }]
    );
    setTimeout(function () { var i = $('goalInput'); if (i) { i.focus(); i.select(); } }, 50);
  });

  function updateDarkIcon() {
    var dark = document.body.classList.contains('dark');
    darkModeToggle.textContent = dark ? '☀️' : '🌙';
    darkModeToggle.title = dark ? '切换到浅色模式' : '切换到深色模式';
  }
  darkModeToggle.addEventListener('click', function () {
    document.body.classList.toggle('dark');
    updateDarkIcon();
    try { localStorage.setItem('theo-vocab-web-dark', document.body.classList.contains('dark') ? '1' : '0'); } catch (e) { /* noop */ }
  });
  try {
    if (localStorage.getItem('theo-vocab-web-dark') === '1') document.body.classList.add('dark');
  } catch (e) { /* noop */ }
  updateDarkIcon();

  /* ---------- 初始化 ---------- */
  function restore(state) {
    chapterSelect.value = String(state.chapter || 1);
    globalMode = state.globalMode || 'random';
    hintEnabled = !!state.hintEnabled;
    timerEnabled = !!state.timerEnabled;
    dailyGoal = state.dailyGoal || 50;
    todayStr = today();
    dailyCount = (state.dailyDate === todayStr) ? (state.dailyCount || 0) : 0;
    chapterStats = state.chapterStats || {};
    correctTotal = state.correctTotal || 0;
    wrongTotal = state.wrongTotal || 0;
    completedCount = state.completedCount || 0;
    currentIndex = state.currentIndex || 0;

    Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (b) {
      b.classList.toggle('active', b.dataset.mode === globalMode);
    });
    hintToggle.classList.toggle('active', hintEnabled);
    timerToggle.classList.toggle('active', timerEnabled);
    timerDisplay.hidden = !timerEnabled;

    wrongBook = (state.wrongBook || []).map(function (k) {
      var w = findWord(k);
      return w ? { key: k, chapter: w.chapter, id: w.id, word: w.word, meaningCN: w.meaningCN } : null;
    }).filter(Boolean);
    newWordBook = (state.newWordBook || []).map(function (k) {
      var w = findWord(k);
      return w ? { key: k, chapter: w.chapter, id: w.id, word: w.word, meaningCN: w.meaningCN } : null;
    }).filter(Boolean);

    reviewMode = !!state.reviewMode;
    if (reviewMode && state.poolKeys && state.poolKeys.length) {
      var pool = state.poolKeys.map(findWord).filter(Boolean);
      if (pool.length) {
        currentVocabulary = pool;
        shuffledWords = pool;
        currentIndex = Math.min(currentIndex, shuffledWords.length - 1);
      }
    } else if (state.poolKeys && state.poolKeys.length && state.poolSource === 'chapter' + (Number(state.chapter) || 1)) {
      var pool2 = state.poolKeys.map(findWord).filter(Boolean);
      if (pool2.length) {
        currentVocabulary = DATA.chapters[Number(state.chapter)] || pool2;
        shuffledWords = pool2;
        currentIndex = Math.min(currentIndex, shuffledWords.length - 1);
      }
    }
    if (!shuffledWords.length) {
      reviewMode = false;
      currentVocabulary = DATA.chapters[Number(chapterSelect.value)] || [];
      shuffledWords = currentVocabulary.slice();
      shuffle(shuffledWords);
      currentIndex = 0;
    }

    updateWrongBookUI(); updateNewWordBookUI(); updateModeIndicator(); updateGoalDisplay();
    if (shuffledWords.length) loadNextWord();
    updateStats();
    saveState();
  }

  var state = loadState();
  if (state) {
    restore(state);
  } else {
    chapterSelect.value = '1';
    globalMode = 'random';
    updateModeIndicator(); updateGoalDisplay();
    switchChapter(1);
    showOnboarding();
  }

  /* ---------- 调试 / 自检句柄 ---------- */
  window.__vocab = {
    getCurrentWord: function () { return currentWord; },
    getPool: function () { return shuffledWords; },
    getCounts: function () { return { correct: correctTotal, wrong: wrongTotal, completed: completedCount, streak: streak }; },
    getBooks: function () { return { wrong: wrongBook, fresh: newWordBook }; },
    getDaily: function () { return { count: dailyCount, goal: dailyGoal }; },
    isReviewMode: function () { return reviewMode; },
    inputLetter: inputLetter,
    backspace: backspace,
    submitAnswer: submitAnswer,
    getChapterStats: function (id) { return getChapterStats(id); }
  };
})();
