/* ==========================================================
   GAP TUZISH — o'yin mantig'i (sentence.js)

   - Koreys so'zlari tepadan tushadi; o'yinchi ularni TO'G'RI TARTIBDA
     bosib gap tuzadi (o'zbekcha tarjima ko'rsatma sifatida turadi).
   - Yakka: har gap uchun vaqt + xatolar bo'yicha ball.
   - Ikki kishi: bir ekranda ikki o'yinchi, kim tez tuzsa raundni oladi.
   - Oxirida g'olib e'lon qilinadi (konfeti bilan), natija o'zi yopilmaydi.
========================================================== */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var LS_CUSTOM = "beksSentenceCustom";
  var LS_BEST = "beksSentenceBest";
  var LS_SETUP = "beksSentenceSetup";

  /* ---------- holat ---------- */
  var mode = "solo";
  var game = null; // joriy o'yin
  var rafId = 0;
  var soundOn = true;

  /* ---------- yordamchilar ---------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function tokensOf(ko) {
    return String(ko || "").trim().split(/\s+/).filter(Boolean);
  }

  function levelOf(n) {
    return n <= 4 ? "easy" : n === 5 ? "medium" : "hard";
  }

  function fmtTime(sec) {
    return (Math.round(sec * 10) / 10).toFixed(1) + " s";
  }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  /* ---------- ovoz (WebAudio, fayl kerak emas) ---------- */
  var actx = null;
  function beep(freq, dur, type, vol) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.value = vol || 0.08;
      o.connect(g); g.connect(actx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur);
    } catch (e) { /* ovoz yo'q bo'lsa ham o'yin ishlayveradi */ }
  }
  var sfx = {
    ok: function () { beep(660, 0.09, "triangle", 0.09); },
    bad: function () { beep(150, 0.22, "sawtooth", 0.07); },
    done: function () { beep(523, 0.1, "triangle"); setTimeout(function () { beep(784, 0.18, "triangle"); }, 110); },
    tick: function () { beep(440, 0.06, "square", 0.04); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { beep(f, 0.22, "triangle", 0.1); }, i * 130); }); }
  };

  /* ---------- konfeti ---------- */
  var confettiFrame = 0;
  function startConfetti() {
    var c = $("confetti");
    if (!c) return;
    stopConfetti();
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    var ctx = c.getContext("2d");
    var ps = [];
    for (var i = 0; i < 180; i++) {
      ps.push({
        x: Math.random() * c.width, y: -Math.random() * c.height,
        r: 3 + Math.random() * 6, v: 2 + Math.random() * 4, h: Math.random() * 360,
        s: (Math.random() - 0.5) * 2
      });
    }
    (function draw() {
      ctx.clearRect(0, 0, c.width, c.height);
      ps.forEach(function (p) {
        ctx.fillStyle = "hsl(" + p.h + ",95%,60%)";
        ctx.fillRect(p.x, p.y, p.r, p.r * 2);
        p.y += p.v; p.x += p.s;
        if (p.y > c.height) { p.y = -10; p.x = Math.random() * c.width; }
      });
      confettiFrame = requestAnimationFrame(draw);
    })();
  }
  function stopConfetti() {
    if (confettiFrame) cancelAnimationFrame(confettiFrame);
    confettiFrame = 0;
    var c = $("confetti");
    if (c && c.getContext) c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  /* ---------- jumlalar bazasi ---------- */
  function parseCustom(text) {
    var out = [];
    String(text || "").split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var parts = line.split("|");
      var ko = (parts[0] || "").trim();
      var uz = (parts.slice(1).join("|") || "").trim();
      if (tokensOf(ko).length >= 3) out.push({ ko: ko, uz: uz || "(tarjima kiritilmagan)" });
    });
    return out;
  }

  function buildPool(level, onlyCustom) {
    var custom = parseCustom(lsGet(LS_CUSTOM, ""));
    var base = onlyCustom && custom.length ? custom : custom.concat(window.BEKS_SENTENCES || []);
    var filtered = level === "mix" ? base : base.filter(function (s) { return levelOf(tokensOf(s.ko).length) === level; });
    return { all: base, pool: filtered.length ? filtered : base };
  }

  function pickSentences(pool, n) {
    var picked = [];
    var round = shuffle(pool);
    while (picked.length < n) {
      if (!round.length) round = shuffle(pool);
      picked.push(round.pop());
    }
    return picked;
  }

  /* ---------- sozlamalar ekrani ---------- */
  function readSetup() {
    try { return JSON.parse(lsGet(LS_SETUP, "{}")) || {}; } catch (e) { return {}; }
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll(".sgTab").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-mode") === m);
    });
    $("nameRow2").classList.toggle("hidden", m !== "duo");
    $("name1Label").textContent = m === "duo" ? "1-o'yinchi (ixtiyoriy)" : "Ismingiz (ixtiyoriy)";
    refreshBest();
  }

  function refreshBest() {
    var best = null;
    try { best = JSON.parse(lsGet(LS_BEST, "null")); } catch (e) { best = null; }
    $("bestLine").textContent = best && best.score
      ? "🏆 Eng yaxshi yakka natija: " + best.score + " ball"
      : "";
  }

  function refreshCustomInfo() {
    var n = parseCustom($("customText").value).length;
    $("customInfo").textContent = n
      ? "✅ " + n + " ta jumla tayyor."
      : "Hozircha o'z jumlalaringiz yo'q (" + (window.BEKS_SENTENCES || []).length + " ta tayyor jumla ishlatiladi).";
  }

  function initSetup() {
    var s = readSetup();
    if (s.name1) $("name1").value = s.name1;
    if (s.name2) $("name2").value = s.name2;
    if (s.level) $("levelSel").value = s.level;
    if (s.rounds) $("roundsSel").value = s.rounds;
    $("customText").value = lsGet(LS_CUSTOM, "");
    $("onlyCustom").checked = !!s.onlyCustom;
    setMode(s.mode === "duo" ? "duo" : "solo");
    refreshCustomInfo();

    document.querySelectorAll(".sgTab").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    });
    $("customText").addEventListener("input", function () {
      lsSet(LS_CUSTOM, $("customText").value);
      refreshCustomInfo();
    });
    $("startBtn").addEventListener("click", startFromSetup);
  }

  function showSetupError(msg) {
    var el = $("setupError");
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  function startFromSetup() {
    var level = $("levelSel").value;
    var rounds = parseInt($("roundsSel").value, 10) || 5;
    var onlyCustom = $("onlyCustom").checked;
    var n1 = $("name1").value.trim();
    var n2 = $("name2").value.trim();

    var p = buildPool(level, onlyCustom);
    if (!p.pool.length) { showSetupError("Jumlalar topilmadi."); return; }
    showSetupError("");

    lsSet(LS_SETUP, JSON.stringify({
      mode: mode, name1: n1, name2: n2, level: level, rounds: rounds, onlyCustom: onlyCustom
    }));

    startGame({
      mode: mode,
      names: mode === "duo" ? [n1 || "1-o'yinchi", n2 || "2-o'yinchi"] : [n1 || "Siz"],
      rounds: rounds,
      level: level,
      pool: p.pool,
      allWords: p.all
    });
  }

  /* ---------- o'yin ---------- */
  function startGame(cfg) {
    stopConfetti();
    cancelAnimationFrame(rafId);
    $("finalModal").classList.add("hidden");
    $("setupScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");

    game = {
      cfg: cfg,
      mode: cfg.mode,
      sentences: pickSentences(cfg.pool, cfg.rounds),
      roundIdx: -1,
      phase: "idle", // idle | countdown | play | between | over
      lanes: [],
      t0: 0,
      limit: 60,
      totalScore: 0,   // yakka
      maxScore: 0,
      timers: []
    };

    var arenas = $("arenas");
    arenas.innerHTML = "";
    arenas.className = "sgArenas" + (cfg.mode === "duo" ? " duo" : "");

    cfg.names.forEach(function (name, p) {
      game.lanes.push(createLane(p, name, arenas, cfg.mode === "duo"));
    });

    nextRound();
  }

  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    game.timers.push(id);
    return id;
  }

  function clearTimers() {
    if (!game) return;
    game.timers.forEach(clearTimeout);
    game.timers = [];
  }

  function createLane(p, name, container, duo) {
    var el = document.createElement("section");
    el.className = "lane lane" + p + (duo ? " duoLane" : "");
    el.innerHTML =
      '<header class="laneHead"><span class="laneName"></span>' +
      '<span class="laneStat"><span class="laneWins"></span><span class="laneMiss">❌ 0</span></span></header>' +
      '<div class="field"><div class="freezeMsg">⛔ Xato! Kuting…</div></div>' +
      '<div class="tray"></div>';
    el.querySelector(".laneName").textContent = name;
    container.appendChild(el);

    return {
      p: p, name: name, el: el,
      field: el.querySelector(".field"),
      tray: el.querySelector(".tray"),
      winsEl: el.querySelector(".laneWins"),
      missEl: el.querySelector(".laneMiss"),
      tokens: [], idx: 0, mistakes: 0, penaltyMs: 0, frozenUntil: 0,
      finished: false, timeSec: 0, chips: [], slots: [],
      wins: 0, totalTime: 0, totalMiss: 0, roundsDone: 0
    };
  }

  function updateLaneStat(l) {
    l.missEl.textContent = "❌ " + l.mistakes;
    if (game.mode === "duo") l.winsEl.textContent = "🏆 " + l.wins;
    else l.winsEl.textContent = "⭐ " + game.totalScore;
  }

  function nextRound() {
    clearTimers();
    game.roundIdx++;
    if (game.roundIdx >= game.sentences.length) { finishGame(); return; }

    var s = game.sentences[game.roundIdx];
    var tokens = tokensOf(s.ko);
    game.cur = s;
    game.tokens = tokens;
    game.par = tokens.length * 3.2;                     // "yaxshi" vaqt (s)
    game.limit = Math.round(tokens.length * 9 + 15);   // raund vaqt chegarasi
    game.fallTime = { easy: 9, medium: 7.5, hard: 6 }[levelOf(tokens.length)];

    // Chalg'ituvchi so'zlar: boshqa jumlalardan, shu gapda yo'q so'zlar (ikki o'yinchiga bir xil)
    var extraN = { easy: 2, medium: 3, hard: 4 }[levelOf(tokens.length)];
    var bag = [];
    (game.cfg.allWords || []).forEach(function (sn) {
      tokensOf(sn.ko).forEach(function (w) {
        if (tokens.indexOf(w) < 0 && bag.indexOf(w) < 0) bag.push(w);
      });
    });
    game.extras = shuffle(bag).slice(0, extraN);

    $("roundInfo").textContent = (game.roundIdx + 1) + "/" + game.sentences.length;
    $("hintUz").textContent = s.uz;
    $("timerInfo").textContent = "⏱ " + game.limit + " s";
    $("timerInfo").classList.remove("low");

    game.lanes.forEach(function (l) {
      l.field.querySelectorAll(".sgChip").forEach(function (c) { c.remove(); });
      l.chips = []; l.tokens = tokens.slice(); l.idx = 0; l.mistakes = 0;
      l.penaltyMs = 0; l.frozenUntil = 0; l.finished = false; l.timeSec = 0;
      l.el.classList.remove("frozen");
      buildTray(l);
      updateLaneStat(l);
    });

    runCountdown();
  }

  function buildTray(l) {
    l.tray.innerHTML = "";
    l.slots = l.tokens.map(function () {
      var s = document.createElement("div");
      s.className = "sgSlot";
      s.textContent = "";
      s.style.minWidth = "44px";
      l.tray.appendChild(s);
      return s;
    });
    markNext(l);
  }

  function markNext(l) {
    l.slots.forEach(function (s, i) { s.classList.toggle("next", i === l.idx); });
  }

  /* ---------- sanoq ---------- */
  function showOverlay(html) {
    $("overlayBox").innerHTML = html;
    $("overlay").classList.remove("hidden");
  }
  function hideOverlay() { $("overlay").classList.add("hidden"); }

  function runCountdown() {
    game.phase = "countdown";
    var steps = [3, 2, 1];
    showOverlay(
      '<p class="sgOverlayTitle">' + (game.roundIdx + 1) + "-gap · tayyor bo'ling" + "</p>" +
      '<div class="sgUzLine">' + escapeHtml(game.cur.uz) + "</div>" +
      '<div class="sgCount" id="cdNum">3</div>'
    );
    sfx.tick();
    steps.forEach(function (n, i) {
      if (i === 0) return;
      later(function () {
        var el = $("cdNum");
        if (el) { el.textContent = n; el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
        sfx.tick();
      }, i * 800);
    });
    later(beginPlay, steps.length * 800);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- tushayotgan so'zlar ---------- */
  var CHIP_COLORS = 5;

  function spawnChips(l) {
    var tokens = l.tokens.slice();
    // chalg'ituvchi so'zlar raund boshida BIR MARTA tanlanadi (ikki o'yinchiga bir xil)
    var extras = game.extras;

    var W = l.field.clientWidth;
    var H = l.field.clientHeight;

    var items = tokens.map(function (t) { return { text: t, extra: false }; })
      .concat(extras.map(function (t) { return { text: t, extra: true }; }));

    shuffle(items).forEach(function (it, i) {
      var el = document.createElement("div");
      el.className = "sgChip c" + (i % CHIP_COLORS);
      el.textContent = it.text;
      l.field.appendChild(el);

      var chip = { el: el, text: it.text, extra: it.extra, x: 0, y: 0, v: 0, w: el.offsetWidth, h: el.offsetHeight };
      /* Boshida bir qismi allaqachon ko'rinadi — so'zlar kechikmay tusha boshlaydi */
      chip.y = -chip.h * 1.2 + (Math.random() - 0.35) * H * 0.9;
      chip.x = pickX(l, chip, W);
      chip.v = speedFor(H, chip.h);
      l.chips.push(chip);
      place(chip);

      el.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        onTap(l, chip);
      });
    });
  }

  function speedFor(H, h) {
    return ((H + h) / game.fallTime) * (0.85 + Math.random() * 0.3);
  }

  function pickX(l, chip, W) {
    var maxX = Math.max(4, W - chip.w - 4);
    var best = 4, bestOverlap = Infinity;
    for (var tries = 0; tries < 12; tries++) {
      var x = 4 + Math.random() * (maxX - 4);
      var overlap = 0;
      l.chips.forEach(function (o) {
        if (o === chip) return;
        if (Math.abs(o.y - chip.y) < chip.h + 6 && x < o.x + o.w + 6 && x + chip.w + 6 > o.x) overlap++;
      });
      if (overlap < bestOverlap) { bestOverlap = overlap; best = x; if (!overlap) break; }
    }
    return best;
  }

  function place(chip) {
    chip.el.style.transform = "translate3d(" + chip.x + "px," + chip.y + "px,0)";
  }

  function beginPlay() {
    hideOverlay();
    game.phase = "play";
    game.t0 = performance.now();
    game.last = game.t0;
    game.lanes.forEach(spawnChips);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function elapsedSec(l) {
    return (performance.now() - game.t0 + (l ? l.penaltyMs : 0)) / 1000;
  }

  function frame(ts) {
    if (!game || game.phase !== "play") return;
    var dt = Math.min(0.05, (ts - game.last) / 1000);
    game.last = ts;

    var now = performance.now();
    game.lanes.forEach(function (l) {
      var W = l.field.clientWidth;
      var H = l.field.clientHeight;
      l.chips.forEach(function (c) {
        c.y += c.v * dt;
        if (c.y > H) {
          c.y = -c.h - Math.random() * H * 0.2;
          c.x = pickX(l, c, W);
          c.v = speedFor(H, c.h);
        }
        place(c);
      });
      if (l.frozenUntil && now >= l.frozenUntil) {
        l.frozenUntil = 0;
        l.el.classList.remove("frozen");
      }
    });

    var remain = game.limit - (now - game.t0) / 1000;
    var tEl = $("timerInfo");
    tEl.textContent = "⏱ " + Math.max(0, Math.ceil(remain)) + " s";
    tEl.classList.toggle("low", remain <= 10);
    if (remain <= 0) { endRound(null, "timeout"); return; }

    rafId = requestAnimationFrame(frame);
  }

  /* ---------- bosish ---------- */
  function onTap(l, chip) {
    if (!game || game.phase !== "play" || l.finished) return;
    if (performance.now() < l.frozenUntil) return;

    var expected = l.tokens[l.idx];

    if (chip.text === expected) {
      var slot = l.slots[l.idx];
      slot.textContent = chip.text;
      slot.classList.add("filled");
      l.idx++;
      chip.el.remove();
      l.chips.splice(l.chips.indexOf(chip), 1);
      markNext(l);
      sfx.ok();

      if (l.idx >= l.tokens.length) {
        l.finished = true;
        l.timeSec = elapsedSec(l);
        sfx.done();
        endRound(l, "done");
      }
      return;
    }

    // xato so'z
    l.mistakes++;
    sfx.bad();
    chip.el.classList.remove("bad");
    void chip.el.offsetWidth;
    chip.el.classList.add("bad");

    if (game.mode === "duo") {
      l.frozenUntil = performance.now() + 1000;
      l.el.classList.add("frozen");
    } else {
      l.penaltyMs += 2000;
      var pop = document.createElement("div");
      pop.className = "penaltyPop";
      pop.textContent = "+2 s";
      l.field.appendChild(pop);
      setTimeout(function () { pop.remove(); }, 900);
    }
    updateLaneStat(l);
  }

  /* ---------- raund yakuni ---------- */
  function soloRoundScore(l) {
    var bonus = Math.max(0, Math.min(1, (game.par - l.timeSec) / game.par)) * 100;
    return Math.max(20, Math.round(100 + bonus - 10 * l.mistakes));
  }

  function endRound(winner, reason) {
    if (!game || game.phase !== "play") return;
    game.phase = "between";
    cancelAnimationFrame(rafId);
    clearTimers();

    var s = game.cur;
    var head = "";
    var meta = "";

    game.lanes.forEach(function (l) {
      l.totalMiss += l.mistakes;
      l.roundsDone++;
    });

    if (game.mode === "solo") {
      var l0 = game.lanes[0];
      game.maxScore += 200;
      if (reason === "done") {
        var sc = soloRoundScore(l0);
        game.totalScore += sc;
        l0.totalTime += l0.timeSec;
        head = "✅ To'g'ri! +" + sc + " ball";
        meta = "<span>⏱ " + fmtTime(l0.timeSec) + "</span><span>❌ " + l0.mistakes + " xato</span>";
      } else {
        head = "⏰ Vaqt tugadi";
        meta = "<span>Bu gap uchun ball berilmadi</span>";
      }
      updateLaneStat(l0);
    } else {
      if (winner) {
        winner.wins++;
        winner.totalTime += winner.timeSec;
        head = "🏆 " + escapeHtml(winner.name) + " tezroq!";
        meta = "<span>⏱ " + fmtTime(winner.timeSec) + "</span>" +
          game.lanes.map(function (l) { return "<span>" + escapeHtml(l.name) + ": ❌ " + l.mistakes + "</span>"; }).join("");
      } else {
        head = "⏰ Hech kim ulgurmadi";
        meta = "<span>Bu raund durang</span>";
      }
      game.lanes.forEach(updateLaneStat);
    }

    // Ikki kishi: kimdir g'alabani oldindan ta'minlasa — tugatamiz
    var clinched = false;
    if (game.mode === "duo") {
      var need = Math.floor(game.sentences.length / 2) + 1;
      clinched = game.lanes.some(function (l) { return l.wins >= need; });
    }
    var isLast = game.roundIdx >= game.sentences.length - 1 || clinched;

    showOverlay(
      '<p class="sgOverlayTitle">' + head + "</p>" +
      '<div class="sgKoLine">' + escapeHtml(s.ko) + "</div>" +
      '<div class="sgUzLine">' + escapeHtml(s.uz) + "</div>" +
      '<div class="sgMeta">' + meta + "</div>" +
      '<button type="button" class="sgBtn sgBtnPrimary sgNextBtn" id="nextBtn">' +
      (isLast ? "🏁 Natijani ko'rish" : "Keyingi gap ▶") + "</button>"
    );

    var go = function () {
      if (game.phase !== "between") return;
      game.phase = "idle";
      hideOverlay();
      if (isLast) finishGame(); else nextRound();
    };
    $("nextBtn").addEventListener("click", go);
    // Natijani o'qib ulgurish uchun avtomatik o'tish biroz uzoqroq
    later(go, isLast ? 6000 : 3800);
  }

  /* ---------- o'yin yakuni ---------- */
  function finishGame() {
    clearTimers();
    game.phase = "over";
    hideOverlay();
    if (game.mode === "solo") finishSolo(); else finishDuo();

    $("finalModal").classList.remove("hidden");
    startConfetti();
    sfx.win();
  }

  function finishSolo() {
    var l = game.lanes[0];
    var pct = game.maxScore ? game.totalScore / game.maxScore : 0;
    var stars = pct >= 0.7 ? 3 : pct >= 0.45 ? 2 : pct > 0 ? 1 : 0;

    var best = null;
    try { best = JSON.parse(lsGet(LS_BEST, "null")); } catch (e) { best = null; }
    var isRecord = game.totalScore > ((best && best.score) || 0);
    if (isRecord) lsSet(LS_BEST, JSON.stringify({ score: game.totalScore, date: Date.now() }));

    var avg = l.roundsDone ? l.totalTime / Math.max(1, game.sentences.length) : 0;

    $("finalBody").innerHTML =
      '<div class="sgCrown">🎉</div>' +
      '<h2 class="sgWinTitle">Tabriklaymiz, ' + escapeHtml(l.name) + "!</h2>" +
      '<div class="sgStars">' + "⭐".repeat(stars) + "☆".repeat(3 - stars) + "</div>" +
      '<div class="sgBigScore">' + game.totalScore + ' <small style="font-size:.4em;color:var(--muted)">/ ' + game.maxScore + "</small></div>" +
      (isRecord ? '<div class="sgNewRecord">🏆 Yangi rekord!</div>' : "") +
      '<table class="sgStatTable"><tr><th>Ko\'rsatkich</th><th>Natija</th></tr>' +
      "<tr><td>Gaplar soni</td><td>" + game.sentences.length + "</td></tr>" +
      "<tr><td>O'rtacha vaqt</td><td>" + fmtTime(avg) + "</td></tr>" +
      "<tr><td>Jami xatolar</td><td>" + l.totalMiss + "</td></tr></table>";
  }

  function finishDuo() {
    var a = game.lanes[0], b = game.lanes[1];
    var winner = null, why = "";

    if (a.wins !== b.wins) {
      winner = a.wins > b.wins ? a : b; why = "ko'proq raund yutdi";
    } else if (a.wins && Math.abs(a.totalTime - b.totalTime) > 0.05) {
      winner = a.totalTime < b.totalTime ? a : b; why = "tezroq vaqt bilan";
    } else if (a.totalMiss !== b.totalMiss) {
      winner = a.totalMiss < b.totalMiss ? a : b; why = "kamroq xato qildi";
    }

    function row(l, win) {
      var avg = l.wins ? l.totalTime / l.wins : 0;
      return '<tr class="' + (win ? "win" : "") + '"><td>' + escapeHtml(l.name) + "</td><td>" + l.wins +
        "</td><td>" + (l.wins ? fmtTime(avg) : "—") + "</td><td>" + l.totalMiss + "</td></tr>";
    }

    $("finalBody").innerHTML =
      '<div class="sgCrown">' + (winner ? "🏆" : "🤝") + "</div>" +
      '<h2 class="sgWinTitle">' + (winner ? "G'olib" : "Durang!") + "</h2>" +
      (winner
        ? '<div class="sgWinName">' + escapeHtml(winner.name) + "</div>" +
          '<p class="sgUzLine">' + escapeHtml(winner.name) + " " + why + "</p>"
        : '<p class="sgUzLine">Ikkala o\'yinchi teng natija ko\'rsatdi</p>') +
      '<table class="sgStatTable"><tr><th>O\'yinchi</th><th>Raund</th><th>O\'rt. vaqt</th><th>Xato</th></tr>' +
      row(a, winner === a) + row(b, winner === b) + "</table>";
  }

  /* ---------- chiqish / qayta ---------- */
  function backToSetup() {
    clearTimers();
    cancelAnimationFrame(rafId);
    stopConfetti();
    if (game) game.phase = "idle";
    $("finalModal").classList.add("hidden");
    $("gameScreen").classList.add("hidden");
    $("setupScreen").classList.remove("hidden");
    hideOverlay();
    refreshBest();
  }

  function init() {
    initSetup();

    $("soundBtn").addEventListener("click", function () {
      soundOn = !soundOn;
      $("soundBtn").textContent = soundOn ? "🔊" : "🔇";
    });
    $("quitBtn").addEventListener("click", function () {
      if (confirm("O'yindan chiqasizmi?")) backToSetup();
    });
    $("finalClose").addEventListener("click", backToSetup);
    $("setupBtn").addEventListener("click", backToSetup);
    $("againBtn").addEventListener("click", function () {
      if (!game) return;
      var cfg = game.cfg;
      startGame({
        mode: cfg.mode, names: cfg.names, rounds: cfg.rounds,
        level: cfg.level, pool: cfg.pool, allWords: cfg.allWords
      });
    });

    // Tab yashirilsa — vaqt "to'xtaydi"
    document.addEventListener("visibilitychange", function () {
      if (!game || game.phase !== "play") return;
      if (document.hidden) {
        game.hiddenAt = performance.now();
      } else if (game.hiddenAt) {
        var gap = performance.now() - game.hiddenAt;
        game.t0 += gap;
        game.last = performance.now();
        game.hiddenAt = 0;
      }
    });
  }

  init();
})();
