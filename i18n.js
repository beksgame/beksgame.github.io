/* ==========================================================
   BEKS GAME — TIL SOZLAMALARI (i18n)
   --------------------------------------------------------
   Bitta umumiy fayl — index.html, game.html va admin.html
   uchastkalariga bir xil ulanadi. Vazifalari:

   1) O'ng yuqori burchakka til almashtirgich (UZ / EN / RU)
      chizadi (JS orqali, HTML'ga qo'l tegmasdan).
   2) [data-i18n] / [data-i18n-placeholder] / [data-i18n-title]
      / [data-i18n-html] atributiga ega elementlarni joriy
      tilga qarab yangilaydi.
   3) Tanlangan til localStorage'da saqlanadi va sahifa
      qayta ochilganda ham eslab qoladi.
   4) Boshqa skriptlar (game.js, admin.js) foydalanishi uchun
      window.t(key, vars) va window.getAppLang() funksiyalarini
      hamda til o'zgarganda "beks:langchange" hodisasini beradi.

   MUHIM: bu fayl HAR BIR sahifada <script src="i18n.js"></script>
   ko'rinishida (module EMAS, oddiy script) eng birinchi
   skriptlardan biri sifatida ulanishi kerak.
========================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "beksAppLang";
  var DEFAULT_LANG = "uz";
  var SUPPORTED = ["uz", "en", "ru"];

  var LANG_META = {
    uz: { flag: "🇺🇿", short: "UZ", label: "O‘zbekcha" },
    en: { flag: "🇬🇧", short: "EN", label: "English" },
    ru: { flag: "🇷🇺", short: "RU", label: "Русский" }
  };

  /* ================= TARJIMALAR LUG'ATI ================= */

  var DICT = {

    /* ---------- Umumiy sarlavha / tugmalar ---------- */
    "brand.tagline.index": {
      uz: "O‘yin bilan tez o‘rganasiz",
      en: "Learn fast through play",
      ru: "Учись быстро через игру"
    },
    "brand.tagline.game": {
      uz: "Top <span class=\"brand-f\">F</span>ast Education",
      en: "Top <span class=\"brand-f\">F</span>ast Education",
      ru: "Top <span class=\"brand-f\">F</span>ast Education"
    },
    "brand.tagline.admin": {
      uz: "Foydalanuvchi <span class=\"brand-f\">R</span>uxsatlari",
      en: "User <span class=\"brand-f\">P</span>ermissions",
      ru: "Права <span class=\"brand-f\">П</span>ользователей"
    },

    "header.adminPanel": { uz: "🛠 Boshqaruv paneli", en: "🛠 Admin panel", ru: "🛠 Панель админа" },
    "header.quickRoom": { uz: "📱 Xona ochish", en: "📱 Open room", ru: "📱 Открыть комнату" },
    "header.profile": { uz: "👤 Profil", en: "👤 Profile", ru: "👤 Профиль" },
    "header.logout": { uz: "↪ Chiqish", en: "↪ Log out", ru: "↪ Выйти" },
    "header.backToGame": { uz: "← O‘yinga qaytish", en: "← Back to game", ru: "← Назад к игре" },
    "header.contact": { uz: "📞 Bog‘lanish", en: "📞 Contact", ru: "📞 Связаться" },

    /* ---------- index.html: kirish sahifasi ---------- */
    "games.title": { uz: "🎮 O‘yin rejimlari", en: "🎮 Game modes", ru: "🎮 Режимы игры" },
    "games.room.title": { uz: "🏠 Jonli xona", en: "🏠 Live room", ru: "🏠 Живая комната" },
    "games.room.guide": {
      uz: "Onlayn xona oching — ishtirokchilar boshqa qurilmadan xona kodi bilan real vaqtda qo‘shilib, birga musobaqalashadi.",
      en: "Open an online room — participants join in real time from other devices using the room code and compete together.",
      ru: "Откройте онлайн-комнату — участники присоединяются в реальном времени с других устройств по коду комнаты и соревнуются вместе."
    },
    "games.duel.title": { uz: "⚔️ Duel", en: "⚔️ Duel", ru: "⚔️ Дуэль" },
    "games.duel.guide": {
      uz: "Bitta qurilmada ikki kishi navbat bilan bellashadi. Ism kiritmasangiz — \"Ishtirokchi 1\" va \"Ishtirokchi 2\" nomi bilan boshlanadi.",
      en: "Two people take turns on one device. If you don't enter a name, it starts as \"Participant 1\" and \"Participant 2\".",
      ru: "Двое соревнуются по очереди на одном устройстве. Если не ввести имя, начнётся как «Участник 1» и «Участник 2»."
    },
    "games.play.title": { uz: "🎯 Play", en: "🎯 Play", ru: "🎯 Play" },
    "games.play.guide": {
      uz: "Yakka mashq qiling yoki bir nechta ishtirokchi ismini kiritib, ular orasida navbat bilan reyting shakllantiring.",
      en: "Practice alone, or enter several participant names and build a turn-by-turn ranking between them.",
      ru: "Тренируйтесь в одиночку или введите несколько имён участников и формируйте рейтинг по очереди."
    },

    "auth.login": { uz: "🔑 Kirish", en: "🔑 Log in", ru: "🔑 Войти" },
    "auth.register": { uz: "📝 Ro‘yxatdan o‘tish", en: "📝 Sign up", ru: "📝 Регистрация" },
    "auth.login.plain": { uz: "Kirish", en: "Log in", ru: "Войти" },
    "auth.register.plain": { uz: "Ro‘yxatdan o‘tish", en: "Sign up", ru: "Регистрация" },
    "common.close": { uz: "Yopish", en: "Close", ru: "Закрыть" },
    "auth.back": { uz: "Orqaga", en: "Back", ru: "Назад" },
    "auth.email.ph": { uz: "Email", en: "Email", ru: "Email" },
    "auth.password.ph": { uz: "Parol", en: "Password", ru: "Пароль" },
    "auth.passwordConfirm.ph": { uz: "Parolni tasdiqlash", en: "Confirm password", ru: "Подтвердите пароль" },
    "auth.name.ph": { uz: "Ism", en: "Name", ru: "Имя" },

    /* ---------- Admin panel ---------- */
    "admin.title": { uz: "Boshqaruv paneli", en: "Admin panel", ru: "Панель администратора" },
    "admin.eyebrow": { uz: "ADMIN", en: "ADMIN", ru: "АДМИН" },
    "admin.users.title": { uz: "Foydalanuvchilar", en: "Users", ru: "Пользователи" },
    "admin.search.ph": {
      uz: "Ism, email yoki UID bo‘yicha qidirish...",
      en: "Search by name, email or UID...",
      ru: "Поиск по имени, email или UID..."
    },
    "admin.denied.title": {
      uz: "Bu sahifa faqat administratorlar uchun",
      en: "This page is for administrators only",
      ru: "Эта страница только для администраторов"
    },
    "admin.denied.text": {
      uz: "Sizning hisobingizda boshqaruv paneliga kirish huquqi yo‘q. Agar bu xato deb hisoblasangiz, tizim egasi bilan bog‘laning.",
      en: "Your account doesn't have access to the admin panel. If you think this is a mistake, contact the system owner.",
      ru: "У вашего аккаунта нет доступа к панели администратора. Если это ошибка, обратитесь к владельцу системы."
    },
    "admin.denied.back": { uz: "O‘yinga qaytish", en: "Back to game", ru: "Назад к игре" },

    "admin.settings.eyebrow": { uz: "SOZLAMALAR", en: "SETTINGS", ru: "НАСТРОЙКИ" },
    "admin.settings.title": {
      uz: "Limitlar va aloqa ma’lumotlari",
      en: "Limits and contact info",
      ru: "Лимиты и контактная информация"
    },
    "admin.settings.topicLimit": {
      uz: "Bepul mavzu/savol limiti",
      en: "Free topic/question limit",
      ru: "Бесплатный лимит тем/вопросов"
    },
    "admin.settings.participantLimit": {
      uz: "Bepul ishtirokchi limiti",
      en: "Free participant limit",
      ru: "Бесплатный лимит участников"
    },
    "admin.settings.telegram": { uz: "Telegram (masalan @username)", en: "Telegram (e.g. @username)", ru: "Telegram (например @username)" },
    "admin.settings.phone": { uz: "Telefon raqam", en: "Phone number", ru: "Номер телефона" },
    "admin.settings.note": {
      uz: "Foydalanuvchilarga ko‘rinadigan xabar",
      en: "Message shown to users",
      ru: "Сообщение для пользователей"
    },
    "admin.settings.note.ph": {
      uz: "Masalan: Savol yoki takliflaringiz bo‘lsa, quyidagi orqali bog‘laning",
      en: "E.g.: If you have questions or suggestions, reach us below",
      ru: "Например: если у вас есть вопросы, свяжитесь с нами ниже"
    },
    "admin.settings.save": { uz: "💾 Sozlamalarni saqlash", en: "💾 Save settings", ru: "💾 Сохранить настройки" },

    /* ---------- Aloqa oynasi (barcha userlar) ---------- */
    "contact.title": { uz: "Administrator bilan bog‘lanish", en: "Contact the administrator", ru: "Связаться с администратором" },
    "contact.loading": { uz: "Yuklanmoqda...", en: "Loading...", ru: "Загрузка..." },
    "contact.empty": {
      uz: "Administrator hozircha aloqa ma’lumotini kiritmagan.",
      en: "The administrator hasn't added contact info yet.",
      ru: "Администратор пока не добавил контактную информацию."
    },
    "contact.telegram": { uz: "Telegram", en: "Telegram", ru: "Telegram" },
    "contact.phone": { uz: "Telefon", en: "Phone", ru: "Телефон" },
    "contact.open": { uz: "Ochish", en: "Open", ru: "Открыть" }
  };

  /* ================= YORDAMCHI FUNKSIYALAR ================= */

  function getSavedLang() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v && SUPPORTED.indexOf(v) !== -1) return v;
    } catch (e) {}
    return DEFAULT_LANG;
  }

  var currentLang = getSavedLang();

  function t(key, fallback) {
    var entry = DICT[key];
    if (!entry) return fallback !== undefined ? fallback : key;
    return entry[currentLang] || entry[DEFAULT_LANG] || fallback || key;
  }

  function applyTranslations(root) {
    var scope = root || document;

    var els = scope.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute("data-i18n");
      el.textContent = t(key, el.textContent);
    }

    var htmlEls = scope.querySelectorAll("[data-i18n-html]");
    for (var j = 0; j < htmlEls.length; j++) {
      var elh = htmlEls[j];
      var keyh = elh.getAttribute("data-i18n-html");
      elh.innerHTML = t(keyh, elh.innerHTML);
    }

    var phEls = scope.querySelectorAll("[data-i18n-placeholder]");
    for (var k = 0; k < phEls.length; k++) {
      var elp = phEls[k];
      var keyp = elp.getAttribute("data-i18n-placeholder");
      elp.setAttribute("placeholder", t(keyp, elp.getAttribute("placeholder")));
    }

    var titleEls = scope.querySelectorAll("[data-i18n-title]");
    for (var m = 0; m < titleEls.length; m++) {
      var elt = titleEls[m];
      var keyt = elt.getAttribute("data-i18n-title");
      elt.setAttribute("title", t(keyt, elt.getAttribute("title")));
    }

    if (document.documentElement) {
      document.documentElement.setAttribute("lang", currentLang);
    }
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    applyTranslations(document);
    updateSwitcherUI();
    try {
      document.dispatchEvent(new CustomEvent("beks:langchange", { detail: { lang: lang } }));
    } catch (e) {}
  }

  /* ================= TIL ALMASHTIRGICH (UI) ================= */

  var switcherRoot = null;
  var switcherMenu = null;

  function buildSwitcher() {
    if (switcherRoot) return;

    var style = document.createElement("style");
    style.textContent =
      ".beksLangSwitch{position:fixed;top:16px;right:16px;z-index:3000;font-family:Inter,'Segoe UI',Arial,sans-serif;}" +
      ".beksLangBtn{display:flex;align-items:center;gap:6px;min-height:38px;padding:7px 12px;border-radius:11px;" +
        "border:1px solid rgba(255,255,255,.16);background:rgba(10,20,36,.72);backdrop-filter:blur(10px);" +
        "color:#f7f9fc;font-size:12.5px;font-weight:800;cursor:pointer;box-shadow:0 10px 25px rgba(0,0,0,.25);}" +
      ".beksLangBtn:hover{border-color:rgba(32,217,255,.45);background:rgba(32,217,255,.14);}" +
      ".beksLangMenu{position:absolute;top:calc(100% + 8px);right:0;min-width:150px;padding:6px;border-radius:12px;" +
        "border:1px solid rgba(255,255,255,.16);background:rgba(9,18,33,.96);backdrop-filter:blur(14px);" +
        "box-shadow:0 18px 40px rgba(0,0,0,.35);display:none;flex-direction:column;gap:2px;}" +
      ".beksLangMenu.show{display:flex;}" +
      ".beksLangOpt{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;border:none;" +
        "background:transparent;color:#f7f9fc;font-size:12.5px;font-weight:700;text-align:left;cursor:pointer;}" +
      ".beksLangOpt:hover{background:rgba(255,255,255,.08);}" +
      ".beksLangOpt.active{background:rgba(32,217,255,.16);color:#20d9ff;}" +
      "@media(max-width:560px){.beksLangSwitch{top:10px;right:10px;}.beksLangBtn{min-height:34px;padding:6px 10px;font-size:11.5px;}}";
    document.head.appendChild(style);

    switcherRoot = document.createElement("div");
    switcherRoot.className = "beksLangSwitch";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "beksLangBtn";
    btn.id = "beksLangBtn";

    switcherMenu = document.createElement("div");
    switcherMenu.className = "beksLangMenu";
    switcherMenu.id = "beksLangMenu";

    SUPPORTED.forEach(function (code) {
      var opt = document.createElement("button");
      opt.type = "button";
      opt.className = "beksLangOpt";
      opt.setAttribute("data-lang", code);
      opt.textContent = LANG_META[code].flag + "  " + LANG_META[code].label;
      opt.addEventListener("click", function () {
        setLang(code);
        switcherMenu.classList.remove("show");
      });
      switcherMenu.appendChild(opt);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      switcherMenu.classList.toggle("show");
    });

    document.addEventListener("click", function (e) {
      if (switcherMenu && !switcherRoot.contains(e.target)) {
        switcherMenu.classList.remove("show");
      }
    });

    switcherRoot.appendChild(btn);
    switcherRoot.appendChild(switcherMenu);

    (document.body || document.documentElement).appendChild(switcherRoot);

    updateSwitcherUI();
  }

  function updateSwitcherUI() {
    var btn = document.getElementById("beksLangBtn");
    if (btn) {
      var meta = LANG_META[currentLang];
      btn.textContent = meta.flag + " " + meta.short + " ▾";
    }
    var opts = document.querySelectorAll(".beksLangOpt");
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle("active", opts[i].getAttribute("data-lang") === currentLang);
    }
  }

  function init() {
    buildSwitcher();
    applyTranslations(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ================= TASHQI API ================= */

  window.t = t;
  window.getAppLang = function () { return currentLang; };
  window.setAppLang = setLang;
  window.applyBeksTranslations = applyTranslations;
})();
