import { auth, db } from "./firebase.js";
import {
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  addDoc,
  query,
  orderBy,
  limit,
  where,
  deleteField,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================================================
   BEKS GAME — CLEAN GAME ENGINE
   Existing public function names are preserved.
   Flow: participant -> team -> one question -> score -> next participant
         -> next NEW question -> winner -> games/wins -> Firebase
========================================================= */

let questions = [[], [], [], [], []];
let currentUserUid = null;
let isGuestUser = false;
let guestQuickLaunch = false;
/*
 * index.html'dagi "Jonli xona / Duel / O'yin boshlash"
 * tugmalaridan (?liveStart=room|duel|play) kelingan
 * bo'lsa — mehmon (guestQuickLaunch) yoki ro'yxatdan
 * o'tgan foydalanuvchi bo'lishidan qat'iy nazar — TRUE
 * bo'ladi. Bu sahifadagi HAR QANDAY "×"/"Yopish" (chiqish)
 * tugmasi bosilganda index.html'ning asosiy maydoniga
 * qaytarish uchun ishlatiladi.
 */
let launchedFromIndex = false;
let currentCell = null;
let currentValue = 0;
let teamCount = 0;
let teamsData = [];
let gameInProgress = false;
let userTimer = 10;
let timer = null;
let timeLeft = 0;
let currentUserTopicId = null;
let userTopics = [];
let pointStep = 100;
let pointMode = "fixed";

/*
 * MAVZULAR KATEGORIYASI — har bir mavzu (topic)
 * ixtiyoriy "category" (string) maydoniga ega.
 * Berilmagan bo'lsa DEFAULT_TOPIC_CATEGORY'ga
 * tushadi — eski mavzular buzilmaydi.
 */
const DEFAULT_TOPIC_CATEGORY = "Umumiy";

/*
 * Kategoriya chiplariga navbat bilan
 * beriladigan ranglar — yorqin/zamonaviy
 * ko'rinish uchun.
 */
const TOPIC_CATEGORY_COLORS = [
  "catPurple",
  "catTeal",
  "catCoral",
  "catPink",
  "catAmber",
  "catBlue",
  "catGreen",
];

function getTopicCategory(topic) {
  const c = (topic?.category || "").toString().trim();

  return c || DEFAULT_TOPIC_CATEGORY;
}

/*
 * MAVZU FANI (SUBJECT) — kategoriyadan
 * BIR POG'ONA YUQORIDA turadi. Admin
 * belgilagan ro'yxatdan (masalan "Ingliz
 * tili", "Koreys tili", "Matematika")
 * biri bo'lishi shart. Eski (fan
 * belgilanmagan) mavzular avtomatik
 * DEFAULT_TOPIC_SUBJECT ("Umumiy")
 * bo'limiga tushadi — hech narsa
 * buzilmaydi.
 */
const DEFAULT_TOPIC_SUBJECT = "Umumiy";

function getTopicSubject(topic) {
  const s = (topic?.subject || "").toString().trim();

  return s || DEFAULT_TOPIC_SUBJECT;
}

/*
 * Berilgan mavzular ro'yxatidan faqat
 * berilgan FANGA tegishlilarini qaytaradi.
 * subject === null/"" bo'lsa — hammasi
 * ("Barchasi" tanlangan holat).
 */
function filterTopicsBySubject(topics, subject) {
  if (!subject) return topics || [];

  return (topics || []).filter((t) => getTopicSubject(t) === subject);
}

/*
 * Fanlar bo'yicha statistika (chap
 * ustunda ko'rsatish uchun) —
 * getTopicCategoryStats bilan bir xil
 * shaklda ({name,count,colorClass}),
 * lekin tartib admin belgilagan
 * "subjects" ro'yxati tartibida, so'ng
 * eski/noma'lum fanlar, eng oxirida
 * "Umumiy" keladi.
 */
function getTopicSubjectStats(topics) {
  const map = new Map();

  (topics || []).forEach((topic) => {
    const name = getTopicSubject(topic);
    map.set(name, (map.get(name) || 0) + 1);
  });

  const known = categorySettingsState.subjects || [];

  const names = [
    ...known.filter((n) => map.has(n)),
    ...[...map.keys()]
      .filter((n) => !known.includes(n) && n !== DEFAULT_TOPIC_SUBJECT)
      .sort((a, b) => a.localeCompare(b)),
    ...(map.has(DEFAULT_TOPIC_SUBJECT) ? [DEFAULT_TOPIC_SUBJECT] : []),
  ];

  return names.map((name, i) => ({
    name,
    count: map.get(name),
    colorClass: TOPIC_CATEGORY_COLORS[i % TOPIC_CATEGORY_COLORS.length],
  }));
}

/*
 * Berilgan mavzular ro'yxatidan
 * unikal kategoriyalar + har birida
 * nechta mavzu borligini hisoblaydi.
 * Natija: [{ name, count, colorClass }]
 */
function getTopicCategoryStats(topics) {
  const map = new Map();

  (topics || []).forEach((topic) => {
    const name = getTopicCategory(topic);

    map.set(name, (map.get(name) || 0) + 1);
  });

  const names = [...map.keys()].sort((a, b) => {
    if (a === DEFAULT_TOPIC_CATEGORY) return 1;

    if (b === DEFAULT_TOPIC_CATEGORY) return -1;

    return a.localeCompare(b);
  });

  return names.map((name, i) => ({
    name,
    count: map.get(name),
    colorClass: TOPIC_CATEGORY_COLORS[i % TOPIC_CATEGORY_COLORS.length],
  }));
}

/*
 * Board (o'z mavzular) va Room
 * Topic Picker (umumiy ro'yxat)
 * uchun alohida-alohida "hozir qaysi
 * kategoriya tanlangan" holati —
 * null = "Barchasi".
 */
let selectedBoardCategory = null;
let selectedRoomPickerCategory = null;
let selectedBoardSubject = null;
let selectedRoomPickerSubject = null;

/*
 * FAN VA KATEGORIYALASH — GLOBAL SOZLAMA (settings/app):
 * admin panelidan boshqariladi.
 *  - categoriesEnabled      → fan/kategoriya UI'si umuman
 *                              ko'rsatilsinmi
 *  - subjects               → admin belgilagan FANLAR
 *                              (yo'nalishlar) ro'yxati
 *                              (masalan "Ingliz tili",
 *                              "Koreys tili", "Matematika";
 *                              soni cheklanmagan). Har bir
 *                              foydalanuvchi mavzu
 *                              qo'shishdan oldin shu
 *                              ro'yxatdan BITTASINI tanlashi
 *                              SHART — erkin matn emas.
 *  - usersCanAddCategories  → oddiy foydalanuvchilar UZI
 *                              tanlagan FAN ICHIDA yangi
 *                              (o'ziga xos) kategoriya
 *                              yoza olsinmi — GLOBAL standart
 *                              holat. Har bir foydalanuvchi
 *                              uchun admin panelidagi shaxsiy
 *                              "Fan ichida o'z kategoriyasini
 *                              qo'shish" svichi bu global
 *                              holatni bosib o'tishi mumkin.
 */
const DEFAULT_SUBJECTS = ["Ingliz tili", "Koreys tili", "Matematika"];

let categorySettingsState = {
  enabled: true,
  subjects: DEFAULT_SUBJECTS,
  usersCanAddCategoriesDefault: true,
};

/*
 * Joriy foydalanuvchining shaxsiy
 * ruxsatlari (getMyPermissions natijasi)
 * — bir marta yuklanib keshlanadi, chunki
 * kategoriya inputini SINXRON chizish
 * kerak (render funksiyalari async emas).
 */
let myPermissionsCache = null;

async function loadCategorySettings() {
  const s = await fetchAppSettingsOnce();

  const enabled = s?.categoriesEnabled !== false;

  // Yangi maydon "subjects"; eski hujjatlarda hali
  // "standardCategories" nomi bilan qolgan bo'lishi
  // mumkin — shu ham o'qib qo'llab-quvvatlanadi.
  const rawSubjectsSource =
    Array.isArray(s?.subjects) && s.subjects.length ? s.subjects : s?.standardCategories;

  const rawList = Array.isArray(rawSubjectsSource)
    ? rawSubjectsSource.map((c) => (c || "").toString().trim()).filter(Boolean)
    : [];

  categorySettingsState = {
    enabled,
    subjects: rawList.length ? rawList : DEFAULT_SUBJECTS,
    usersCanAddCategoriesDefault: s?.usersCanAddCategories !== false,
  };

  document.body.classList.toggle("categoriesDisabled", !enabled);

  myPermissionsCache = await getMyPermissions();

  return categorySettingsState;
}

/*
 * Joriy foydalanuvchi o'ziga xos
 * (standart ro'yxatdan tashqari)
 * kategoriya yoza oladimi?
 * Admin — doim ha. Oddiy foydalanuvchi —
 * shaxsiy ruxsati (agar admin panelida
 * ANIQ belgilangan bo'lsa) yoki bo'lmasa
 * GLOBAL standart holat asosida.
 */
function canUserAddOwnCategory() {
  if (myPermissionsCache?.isAdmin) return true;

  return myPermissionsCache?.canAddCategories ?? categorySettingsState.usersCanAddCategoriesDefault;
}

/*
 * BONUS REJIMI — o'qituvchi Excel matnida
 * qo'lda "2x"/"3x" yozmasa ham, tizim
 * o'zi tasodifiy ravishda ba'zi savollarni
 * bonus (2X/3X) qilib belgilaydi.
 */
let bonusModeEnabled = false;
let bonusQuestionCount = 3;
let bonusMultiplierMode = "2x"; // "2x" | "3x" | "mixed"
let activeBonusQuestions = new Map();

/*
 * KETMA-KET TO'G'RI JAVOB BONUSI (STREAK) —
 * 3 ta ketma-ket to'g'ri javobdan so'ng,
 * navbatdagi savol avtomatik 2X bo'ladi.
 */
let streakBonusEnabled = false;
let consecutiveCorrectStreak = 0;
let nextQuestionForcedBonus = false;

let pendingIntroTopic = null;
let participants = [];
let currentQuestionMultiplier = 1;
let currentQuestionItem = null;
let currentTurnIndex = 0;
let currentQuestionActive = false;
let gameFinalized = false;
let confettiFrame = null;
let winnerTimer = null;
let currentTopicQuestionIndex = 0;
let currentTopicQuestions = [];

/*
 * ===============================================
 * XONA REJIMI (LIVE ROOM / "Kahoot uslubi") —
 * har bir o'quvchi o'z telefonidan xona kodi
 * bilan kirib, real vaqtda javob beradi.
 * ===============================================
 */
let roomCode = null;
let roomData = null;
let roomPlayers = [];
let roomUnsubDoc = null;
let roomUnsubPlayers = null;
let roomChatUnsub = null;
let roomChatMessages = [];
let roomHostChatName = "Nazoratchi";
let roomHostChatSenderId = "host";

/*
 * Ishtirokchisiz ("solo") o'yin
 * statistikasi — jamoa bo'lmasa
 * ham to'g'ri/xato javoblar
 * shu yerda sanaladi.
 */
let soloStats = {
  correct: 0,
  wrong: 0,
};

/*
 * ===============================================
 * DUEL REJIMI — ikki ishtirokchi bir vaqtda,
 * ekranning ikki tomonidan (biri 180° aylantirilgan)
 * turli tasodifiy savollarga javob beradi.
 * ===============================================
 */
let duelActive = false;
let duelPool = [];
let duelTotalRounds = 0;
let duelSidePools = {
  a: [],
  b: [],
};

let duelPlayers = {
  a: null,
  b: null,
};

/*
 * Duel yakunida "🔄 Boshqa mavzu bilan davom etish"
 * bosilganda, tanlangan 2 ishtirokchini shu yerda vaqtincha
 * saqlaymiz — mavzular taxtasidan yangi mavzu tanlanishi
 * bilanoq ular bilan yangi duel (statistikasi 0 dan)
 * avtomatik boshlanadi.
 */
let pendingDuelContinuePlayers = null;

let duelRound = {
  a: {
    item: null,
    correct: "",
    answered: false,
    finished: false,
    index: 0,
    startedAt: 0,
    timer: null,
    timeLeft: 0,
  },
  b: {
    item: null,
    correct: "",
    answered: false,
    finished: false,
    index: 0,
    startedAt: 0,
    timer: null,
    timeLeft: 0,
  },
};

let duelStats = {
  a: { correct: 0, wrong: 0, totalTimeMs: 0 },
  b: { correct: 0, wrong: 0, totalTimeMs: 0 },
};

const $ = (id) => document.getElementById(id);

/*
 * JONLI OQIM TO'SIG'I (LIVE FLOW SHIELD)
 * -----------------------------------------------------------
 * Xona ochish / Duel boshlash kabi ko'p bosqichli
 * jarayonlarda, bosqichlar orasida (masalan Firestore'ga
 * yozish kutilayotganda) o'yin maydoni (board) BIR ZUM ham
 * "yalang'och" ko'rinib qolmasligi uchun ishlatiladi.
 *
 * showFlowShield()   — jarayon boshlanganda darhol chaqiriladi,
 *                       parda paydo bo'ladi (hozircha spinnersiz).
 * showFlowLoading(t) — haqiqiy tarmoq so'rovi ketayotgan
 *                       "bo'sh" lahzalarda (hech qanday alohida
 *                       bosqich oynasi ko'rinmayotganda) spinner
 *                       va matn (t) bilan ko'rsatiladi.
 * hideFlowShield()   — jarayon to'liq yakunlanganda (yakuniy
 *                       ekran ochilganda yoki foydalanuvchi
 *                       bekor qilganda) chaqiriladi.
 */
function showFlowShield() {
  $("liveFlowShieldModal")?.classList.add("show");
}

function showFlowLoading(text) {
  const el = $("liveFlowShieldModal");
  if (!el) return;
  el.classList.add("show");
  el.classList.add("loading");
  const t = $("liveFlowShieldText");
  if (t) t.textContent = text || "Iltimos kuting...";
}

function hideFlowShield() {
  const el = $("liveFlowShieldModal");
  if (!el) return;
  el.classList.remove("show");
  el.classList.remove("loading");
}

window.showFlowShield = showFlowShield;
window.showFlowLoading = showFlowLoading;
window.hideFlowShield = hideFlowShield;
const clickSound = $("clickSound");
const winnerSound = $("winnerSound");

function normalizeName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\w]/g, "");
}

function escapeHtml(value) {
  const d = document.createElement("div");
  d.textContent = String(value ?? "");
  return d.innerHTML;
}

function PARTICIPANTS_KEY() {
  return "participants_" + (currentUserUid || "guest");
}

function getUserTopicsLSKey() {
  return "userTopics_" + (currentUserUid || "guest");
}

function getUserDocRef() {
  return currentUserUid && db ? doc(db, "users", currentUserUid) : null;
}

/*
 * YANGI SAQLASH TIZIMI: har bir mavzu endi
 * "users/{uid}.topics" massiv maydonida EMAS, balki
 * "users/{uid}/topics/{topicId}" — ALOHIDA, kichik
 * hujjat sifatida saqlanadi.
 *
 * SABAB: eski usulda HAR safar (hatto bitta savol
 * qo'shilganda ham) BUTUN "topics" massivi (barcha
 * mavzular + ularning barcha savollari) qayta yozilar
 * edi. Bu ikki jiddiy muammoga olib keldi:
 *  1) foydalanuvchi hujjati vaqt o'tishi bilan
 *     cheksiz kattalashib, Firestore hujjat hajmi
 *     chegarasiga (1MB) yaqinlashib qoladi;
 *  2) sahifa ochilganda ham shu og'ir hujjatni
 *     to'liq yuklab olish kerak bo'lgani uchun
 *     yuklanish sekinlashadi.
 *
 * Endi har bir mavzu MUSTAQIL kichik hujjat — faqat
 * o'sha bitta mavzu o'zgarganda, faqat o'sha bitta
 * hujjat yoziladi.
 */
function getUserTopicsCollectionRef() {
  return currentUserUid && db ? collection(db, "users", currentUserUid, "topics") : null;
}

/*
 * TEZLIK UCHUN MUHIM: avval "participants",
 * "topics" (va eskiroq "gameHistory") uchun
 * HAR BIRI o'zicha alohida getDoc(ref) chaqirar
 * edi — bu bitta "users/{uid}" hujjatini HAR
 * LOGINDA 2-3 MARTA yuklab olish degani edi
 * (har biri alohida tarmoq so'rovi). Endi
 * hujjat FAQAT BIR MARTA o'qiladi va natija
 * shu sessiya davomida keshlanadi — shu bilan
 * yuklanish tezligi sezilarli oshadi.
 */
let _userDocFetchPromise = null;

function resetUserDocCache() {
  _userDocFetchPromise = null;
}

async function fetchUserDocOnce() {
  const ref = getUserDocRef();

  if (!ref) return null;

  if (!_userDocFetchPromise) {
    _userDocFetchPromise = (async () => {
      try {
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
      } catch (e) {
        console.warn("fetchUserDocOnce:", e);
        return null;
      }
    })();
  }

  return _userDocFetchPromise;
}

/*
 * RUXSATLAR TIZIMI:
 * Har bir foydalanuvchi standart holatda (admin
 * cheklamaguncha) TO'RTALA imkoniyatga ham ega:
 *  - canAddQuestions        → yangi mavzu qo'shish
 *                              (limitdan ko'p bo'lsa,
 *                              bu HAM kerak)
 *  - canEditTopics          → mavzuni tahrirlash
 *                              (nomini o'zgartirish,
 *                              savollarni aralashtirish)
 *  - canAddParticipants     → ishtirokchi qo'shish
 *                              (limitdan ko'p bo'lsa,
 *                              bu HAM kerak)
 *  - canSetParticipantImage → ishtirokchiga rasm
 *                              o'rnatish
 *
 * Maydon Firestore'da umuman yo'q bo'lsa (eski
 * hujjatlar) — standart TRUE deb hisoblanadi,
 * faqat ANIQ false qo'yilgan bo'lsa cheklangan
 * hisoblanadi. Bundan tashqari, mavzu va
 * ishtirokchi soni uchun HAMMAGA (admin bundan
 * mustasno) bepul limit bor. Bu limit ENDI QATTIQ
 * KODLANMAGAN — administrator uni "settings/app"
 * hujjatida istalgan songa o'zgartira oladi (admin
 * panelidagi "Sozlamalar" bo'limi orqali). Hech
 * qanday sozlama topilmasa, DEFAULT_* qiymatlar
 * ishlatiladi.
 */
const DEFAULT_TOPIC_LIMIT = 10;
const DEFAULT_PARTICIPANT_LIMIT = 10;

/*
 * UMUMIY SOZLAMALAR (settings/app):
 * bir marta o'qiladi va sessiya davomida keshlanadi
 * (fetchUserDocOnce bilan bir xil mantiq).
 */
let _appSettingsFetchPromise = null;

async function fetchAppSettingsOnce() {
  if (!_appSettingsFetchPromise) {
    _appSettingsFetchPromise = (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "app"));
        return snap.exists() ? snap.data() : null;
      } catch (e) {
        console.warn("fetchAppSettingsOnce:", e);
        return null;
      }
    })();
  }

  return _appSettingsFetchPromise;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function getAppLimits() {
  const s = await fetchAppSettingsOnce();

  return {
    topicLimit: toPositiveInt(s?.topicLimit, DEFAULT_TOPIC_LIMIT),
    participantLimit: toPositiveInt(s?.participantLimit, DEFAULT_PARTICIPANT_LIMIT),
  };
}

/*
 * O'YIN STANDARTLARI (settings/app): Ball, Savol vaqti va
 * Bonus rejimi — bular ilgari FAQAT localStorage'da (har bir
 * admin/qurilma uchun alohida) saqlanardi. Endi boshqaruv
 * panelidan (admin.html) administrator ularni "global
 * standart" sifatida belgilashi mumkin — settings/app
 * hujjatiga yoziladi. Foydalanuvchi o'zi hech qachon
 * o'zgartirmagan bo'lsa (localStorage'da mos kalit umuman
 * yo'q bo'lsa), shu global standart ishlatiladi; o'zi bir
 * marta o'zgartirgan bo'lsa — o'sha shaxsiy qiymati saqlanib
 * qoladi (global standart uni bosib o'tmaydi).
 */
function toPositiveIntOrZero(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function getAppDefaults() {
  const s = await fetchAppSettingsOnce();

  const multiplier = s?.bonusMultiplierMode;

  return {
    pointStep: toPositiveIntOrZero(s?.pointStep, 100),
    timer: toPositiveInt(s?.timer, 10),
    bonusModeEnabled: s?.bonusModeEnabled === true,
    bonusQuestionCount: toPositiveInt(s?.bonusQuestionCount, 3),
    bonusMultiplierMode:
      multiplier === "2x" || multiplier === "3x" || multiplier === "mixed" ? multiplier : "2x",
    streakBonusEnabled: s?.streakBonusEnabled === true,
  };
}

async function getMyPermissions() {
  try {
    const d = await fetchUserDocOnce();

    return {
      isAdmin: d?.role === "admin",
      canAddTopics: d?.canAddQuestions !== false,
      canEditTopics: d?.canEditTopics !== false,
      canAddParticipants: d?.canAddParticipants !== false,
      canSetParticipantImage: d?.canSetParticipantImage !== false,
      canAddCategories: typeof d?.canAddCategories === "boolean" ? d.canAddCategories : null,
    };
  } catch (e) {
    console.warn("getMyPermissions:", e);

    return {
      isAdmin: false,
      canAddTopics: true,
      canEditTopics: true,
      canAddParticipants: true,
      canSetParticipantImage: true,
      canAddCategories: null,
    };
  }
}

function showLimitWarning(message) {
  alert("🔒 " + message);
}

/* ================= SETTINGS ================= */

async function initSettings() {
  const defaults = await getAppDefaults();

  // ---- BALL (Ball qadami) ----
  /*
   * MUHIM TUZATISH: bu qiymat endi HAR DOIM admin panelidagi
   * global standartdan (settings/app -> pointStep) olinadi.
   * Ilgari bu yerda localStorage'dagi SHAXSIY (faqat shu
   * qurilmaga tegishli) qiymat admin standartini "bosib
   * o'tar" edi — shu sabab foydalanuvchi o'z sozlamalaridan
   * ballni o'zgartirsa, keyinchalik index.html orqali qayta
   * kirganida ham (yoki hatto boshqa ishtirokchilarga ham)
   * o'sha ESKI shaxsiy qiymat qo'llanib qolardi. Endi sahifa
   * har safar yuklanganda (index'dan qaytib kirilganda ham)
   * FAQAT admin standarti ishlatiladi.
   */
  pointStep = defaults.pointStep;
  pointMode = localStorage.getItem("pointMode") || "fixed";

  if ($("pointStepInput")) {
    $("pointStepInput").value = pointStep;
  }

  if ($("pointModeSelect")) {
    $("pointModeSelect").value = pointMode;
  }

  // ---- SAVOL VAQTI ----
  {
    const storedTimerRaw = localStorage.getItem("questionTimer");
    if (storedTimerRaw === null) {
      userTimer = defaults.timer;
    } else {
      const storedTimer = parseInt(storedTimerRaw, 10);
      userTimer =
        Number.isFinite(storedTimer) && storedTimer > 0
          ? Math.min(storedTimer, 300)
          : defaults.timer;
    }
  }

  if ($("timerInput")) {
    $("timerInput").value = userTimer;
  }

  // ---- BONUS REJIMI ----
  /*
   * ESKI TIZIM BEKOR QILINDI: bonus sozlamalari
   * (rejim, bonus savol soni, ko'paytiruvchi, streak)
   * ilgari localStorage'da SAQLANIB, bir marta
   * o'zgartirilgandan keyin admin panelidagi yangi
   * GLOBAL standartni "bosib o'tar" edi. Endi bular
   * HAR DOIM admin.html'dagi "O'yin standartlari
   * (global)" bo'limidan o'qiladi — localStorage'dan
   * eski qiymat o'qilmaydi.
   */
  bonusModeEnabled = defaults.bonusModeEnabled;
  bonusQuestionCount = defaults.bonusQuestionCount;
  bonusMultiplierMode = defaults.bonusMultiplierMode;
  streakBonusEnabled = defaults.streakBonusEnabled;

  if ($("bonusModeCheckbox")) {
    $("bonusModeCheckbox").checked = bonusModeEnabled;
  }

  if ($("bonusCountInput")) {
    $("bonusCountInput").value = bonusQuestionCount;
  }

  if ($("bonusMultiplierSelect")) {
    $("bonusMultiplierSelect").value = bonusMultiplierMode;
  }

  if ($("streakBonusCheckbox")) {
    $("streakBonusCheckbox").checked = streakBonusEnabled;
  }
}

function updateBonusSettings() {
  bonusModeEnabled = !!$("bonusModeCheckbox")?.checked;

  const count = parseInt($("bonusCountInput")?.value, 10);

  bonusQuestionCount = Number.isFinite(count) && count > 0 ? count : 3;

  bonusMultiplierMode = $("bonusMultiplierSelect")?.value || "2x";

  streakBonusEnabled = !!$("streakBonusCheckbox")?.checked;

  /*
   * ESKI TIZIM BEKOR QILINDI: bu yerdagi o'zgartirish
   * endi FAQAT joriy sessiya/o'yin uchun amal qiladi
   * va localStorage'ga YOZILMAYDI — aks holda u
   * "shaxsiy standart" bo'lib qolib, admin panelidagi
   * yangi global bonus sozlamalarini keyingi safar
   * sahifa ochilganda bosib o'tar edi. Doimiy standart
   * endi FAQAT admin.html orqali belgilanadi.
   */

  /*
   * Agar hozir biror mavzu savollari
   * yuklangan bo'lsa, o'zgarish darhol
   * amal qilishi uchun bonusni qayta
   * taqsimlaymiz.
   */
  if (Array.isArray(currentTopicQuestions) && currentTopicQuestions.length) {
    assignRandomBonusQuestions(currentTopicQuestions);
  }

  alert("✅ Bonus sozlamalari saqlandi!");
}

window.updateBonusSettings = updateBonusSettings;

/*
 * Tanlangan savollar hovuzidan
 * tasodifiy ravishda bonusQuestionCount
 * tacha savolni tanlab, ularga
 * 2X yoki 3X (yoki aralash) belgi
 * beradi. Faqat bonusModeEnabled
 * yoqilgan bo'lsagina ishlaydi.
 */
function assignRandomBonusQuestions(pool) {
  activeBonusQuestions = new Map();

  if (!bonusModeEnabled) return;

  if (!Array.isArray(pool) || !pool.length) return;

  const indices = shuffleArray(pool.map((_, i) => i)).slice(
    0,
    Math.min(bonusQuestionCount, pool.length),
  );

  indices.forEach((i) => {
    const item = pool[i];

    if (!item) return;

    const multiplier =
      bonusMultiplierMode === "3x"
        ? 3
        : bonusMultiplierMode === "mixed"
          ? Math.random() < 0.5
            ? 2
            : 3
          : 2;

    activeBonusQuestions.set(item, multiplier);
  });
}

function updatePointSettings() {
  const step = parseInt($("pointStepInput")?.value, 10);
  const mode = $("pointModeSelect")?.value || "fixed";

  if (!Number.isFinite(step) || step < 0) {
    return alert("Ball noto'g'ri!");
  }

  /*
   * MUHIM: bu qiymat endi localStorage'ga YOZILMAYDI, shu
   * sababli sahifa qayta yuklanganda (masalan index.html'ga
   * chiqib, keyin yana "o'yin o'ynash"ni bosganda) bu shaxsiy
   * o'zgartirish YO'QOLADI va yana admin panelidagi global
   * standart qaytadan qo'llanadi. Faqat JORIY sahifa
   * (reload'gacha) uchun vaqtinchalik ko'rinishda ishlaydi.
   */
  pointStep = step;
  pointMode = mode;

  localStorage.setItem("pointMode", mode);

  renderBoard();
  renderTeams();

  alert(
    step === 0
      ? "✅ Saqlandi! Endi o'yinda ball ko'rsatilmaydi — to'g'ri/xato javob statistikasi ko'rinadi. (Diqqat: bu faqat joriy seans uchun — admin paneldagi standart o'zgarmaydi.)"
      : "✅ Ball sozlamasi saqlandi! (Diqqat: bu faqat joriy seans uchun — sahifa qayta yuklanganda admin paneldagi standart qiymat qo'llanadi.)",
  );
}

window.updatePointSettings = updatePointSettings;

function updatePointStep() {
  const value = parseInt($("pointStepInput")?.value, 10);

  if (Number.isFinite(value) && value > 0) {
    // Vaqtinchalik (faqat joriy sahifa/seans) — localStorage'ga
    // yozilmaydi, shu sababli admin standartini bosib o'tmaydi.
    pointStep = value;
    renderBoard();
  }
}

window.updatePointStep = updatePointStep;

function updateTimer() {
  const value = parseInt($("timerInput")?.value, 10);

  userTimer = Number.isFinite(value) && value > 0 ? Math.min(value, 300) : 10;

  if ($("timerInput")) {
    $("timerInput").value = userTimer;
  }

  localStorage.setItem("questionTimer", String(userTimer));

  clearInterval(timer);
}

window.updateTimer = updateTimer;

function toggleQuestionSettings() {
  const dock = document.querySelector(".controlDockWide");
  const button = $("settingsToggleBtn");

  if (!dock || !button) return;

  const isClosed = dock.classList.toggle("settingsClosed");
  button.setAttribute("aria-expanded", String(!isClosed));
  button.textContent = isClosed ? "⚙ Sozlamalarni ochish" : "⚙ Sozlamalarni yopish";
}

window.toggleQuestionSettings = toggleQuestionSettings;

/* ================= PARTICIPANTS ================= */

async function saveParticipants() {
  localStorage.setItem(PARTICIPANTS_KEY(), JSON.stringify(participants));

  /*
   * MEHMON (guest) foydalanuvchilar
   * uchun ishtirokchilar FAQAT shu
   * qurilmaning localStorage'ida
   * qoladi — Firestore'ga umuman
   * yozilmaydi. Chunki mehmonlar
   * vaqtinchalik, ro'yxatdan
   * o'tmagan foydalanuvchilar —
   * ularning ma'lumoti bazani
   * keraksiz to'ldirmasligi kerak.
   */
  if (isGuestUser) return;

  const ref = getUserDocRef();

  if (!ref) return;

  try {
    /*
     * Firestore "undefined"
     * qiymatlarni qabul qilmaydi
     * va bunda shovqinsiz xatolik
     * berib, statistika (wins/games)
     * saqlanmay qolishi mumkin edi.
     */
    const safeParticipants = JSON.parse(JSON.stringify(participants));

    await setDoc(ref, { participants: safeParticipants }, { merge: true });
  } catch (e) {
    console.error("Participant Firebase save XATOSI:", e);
  }
}

async function loadParticipants() {
  const local = localStorage.getItem(PARTICIPANTS_KEY());

  try {
    participants = local ? JSON.parse(local) : [];
  } catch {
    participants = [];
  }

  if (!Array.isArray(participants)) {
    participants = [];
  }

  participants = participants.map((p) => ({
    id: p.id ?? Date.now() + Math.random(),
    name: String(p.name ?? "Noma'lum"),
    wins: Number(p.wins) || 0,
    games: Number(p.games) || 0,
    image: p.image || "",
  }));

  renderParticipants();

  try {
    const data = await fetchUserDocOnce();

    const remote = data ? data.participants : null;

    if (Array.isArray(remote)) {
      participants = remote.map((p) => ({
        id: p.id ?? Date.now() + Math.random(),
        name: String(p.name ?? "Noma'lum"),
        wins: Number(p.wins) || 0,
        games: Number(p.games) || 0,
        image: p.image || "",
      }));

      localStorage.setItem(PARTICIPANTS_KEY(), JSON.stringify(participants));

      renderParticipants();
    }
  } catch (e) {
    console.warn("loadParticipants:", e);
  }
}

async function addParticipant() {
  const raw = prompt("Ishtirokchi ismi:");

  if (!raw) return;

  const name = raw.trim();

  if (!name) return;

  if (participants.some((p) => normalizeName(p.name) === normalizeName(name))) {
    return alert("Bu ishtirokchi allaqachon mavjud!");
  }

  const perm = await getMyPermissions();

  if (!perm.isAdmin) {
    if (!perm.canAddParticipants) {
      return showLimitWarning(
        "Sizga yangi ishtirokchi qo'shish huquqi administrator tomonidan cheklangan.",
      );
    }

    const { participantLimit } = await getAppLimits();

    if (participants.length >= participantLimit) {
      return showLimitWarning(
        `Siz maksimal ${participantLimit} tagacha ishtirokchi qo'sha olasiz. Ko'proq kerak bo'lsa, administrator bilan bog'laning.`,
      );
    }
  }

  participants.push({
    id: "p_" + Date.now(),
    name,
    wins: 0,
    games: 0,
    image: "",
  });

  saveParticipants();
  renderParticipants();
}

window.addParticipant = addParticipant;

function findParticipant(ref) {
  if (!ref) return null;

  return (
    participants.find(
      (p) => String(p.id) === String(ref) || normalizeName(p.name) === normalizeName(ref),
    ) || null
  );
}

window.editParticipant = async function (oldName) {
  const p = findParticipant(oldName);

  if (!p) return;

  const newName = prompt("Yangi ism:", p.name);

  if (!newName?.trim()) return;

  p.name = newName.trim();

  await saveParticipants();

  renderParticipants();
};

async function deleteParticipantById(id) {
  const p = findParticipant(id);

  if (!p || !confirm(`"${p.name}" ni o‘chirasizmi?`)) {
    return;
  }

  participants = participants.filter((x) => String(x.id) !== String(p.id));

  await saveParticipants();
  renderParticipants();
}

async function resetParticipantStats(id) {
  const p = findParticipant(id);

  if (!p) return;

  participants = participants.map((x) => {
    if (String(x.id) !== String(p.id)) {
      return x;
    }

    return {
      ...x,
      games: 0,
      wins: 0,
    };
  });

  await saveParticipants();

  renderParticipants();
}

window.resetParticipantStats = resetParticipantStats;

async function resetAllParticipantsStats() {
  if (!participants.length) {
    alert("Hozircha ishtirokchi yo‘q.");
    return;
  }

  if (
    !confirm(
      "Barcha ishtirokchilarning statistikasi (o‘yin/g‘alaba soni) 0 ga tushirilsinmi? Bu amalni orqaga qaytarib bo‘lmaydi!",
    )
  ) {
    return;
  }

  participants = participants.map((x) => ({
    ...x,
    games: 0,
    wins: 0,
  }));

  await saveParticipants();

  renderParticipants();

  alert("✅ Barcha ishtirokchilar statistikasi tozalandi!");
}

window.resetAllParticipantsStats = resetAllParticipantsStats;

function resizeImageFile(file, maxSize = 180, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));

        const canvas = document.createElement("canvas");

        canvas.width = Math.max(1, Math.round(img.width * scale));

        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext("2d");

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderParticipants() {
  const box = $("participantsBox");

  if (!box) return;

  box.innerHTML = "";

  /*
    Faqat o'yinga tanlangan participantlar.
    addTeamWithParticipant() teamsData ichiga
    participantId ni yozadi.
  */
  const activeIds = new Set((teamsData || []).map((team) => String(team.participantId)));

  const sorted = [...participants].sort((a, b) => {
    const aActive = activeIds.has(String(a.id));

    const bActive = activeIds.has(String(b.id));

    // Ikkalasi ham o'yinda bo'lsa:
    // LIVE BALL bo'yicha (yoki ball o'chirilgan
    // bo'lsa — to'g'ri javoblar soni bo'yicha)
    if (aActive && bActive) {
      if (Number(pointStep) === 0) {
        const teamA = teamsData.find((t) => String(t.participantId) === String(a.id));

        const teamB = teamsData.find((t) => String(t.participantId) === String(b.id));

        const correctA = teamA?.correctCount || 0;
        const correctB = teamB?.correctCount || 0;

        return correctB - correctA || b.wins - a.wins || a.name.localeCompare(b.name);
      }

      const scoreA = getLiveParticipantScore(a.id);

      const scoreB = getLiveParticipantScore(b.id);

      return scoreB - scoreA || b.wins - a.wins || a.name.localeCompare(b.name);
    }

    // Faqat A o'yinda
    if (aActive && !bActive) {
      return -1;
    }

    // Faqat B o'yinda
    if (!aActive && bActive) {
      return 1;
    }

    // Ikkalasi ham o'yinda EMAS:
    // eski tizim — WINS bo'yicha
    return b.wins - a.wins || a.name.localeCompare(b.name);
  });

  sorted.forEach((p, index) => {
    /*
      Participant hozir o'yindami?
    */
    const isActive = activeIds.has(String(p.id));

    /*
      Ball faqat o'yindagi participantga tegishli.
    */
    const live = isActive ? getLiveParticipantScore(p.id) : null;

    const liveTeam = isActive
      ? teamsData.find((t) => String(t.participantId) === String(p.id))
      : null;

    const winRate = p.games ? Math.round((p.wins / p.games) * 100) : 0;

    const div = document.createElement("div");

    /*
      ORIGINAL CLASS O'ZGARMAYDI
    */
    div.className = "participant";

    div.dataset.participantId = p.id;

    /*
      Tanlangan participantga mavjud
      CSS orqali active holat beriladi.
    */
    if (isActive) {
      div.classList.add("active");
    }

    div.innerHTML = `
      <div class="participantRank">
        ${index + 1}
      </div>

      <div class="participantAvatarWrap">
        <img
          class="participantAvatar"
          alt=""
          src="${p.image || avatarData(p.name)}"
        >

        <button
          class="avatarBtn"
          type="button"
          title="Rasm tanlash"
        >
          📷
        </button>

        <input
          class="avatarInput"
          type="file"
          accept="image/*"
          hidden
        >
      </div>

      <div class="participantInfo">

        <div class="participantName">
          ${escapeHtml(p.name)}
        </div>

        ${
          isActive
            ? Number(pointStep) === 0
              ? `
                    <div class="participantLiveScore participantLiveScoreCW">
                      ✅ ${liveTeam?.correctCount || 0}
                      ·
                      ❌ ${liveTeam?.wrongCount || 0}
                    </div>
                  `
              : `
                    <div class="participantLiveScore">
                      ${live}
                      <span>ball</span>
                    </div>
                  `
            : ""
        }

        <div class="participantStats">
          🎮 ${p.games}
          ·
          🏆 ${p.wins}
          ·
          ${winRate}%
        </div>

      </div>

      <div class="participantActions">

        <button
          class="editParticipant"
          type="button"
          title="Tahrirlash"
        >
          ✏️
        </button>

        <button
          class="resetParticipantStats"
          type="button"
          title="Statistikani 0 ga tushirish"
        >
          🔄
        </button>

        <button
          class="deleteParticipant"
          type="button"
          title="O‘chirish"
        >
          ×
        </button>

      </div>
    `;

    /*
      PARTICIPANTNI TANLASH
    */
    /* =========================================================
   PARTICIPANT CLICK
   1-bosish  = O'YINGA QO'SHISH
   2-bosish  = O'YINDAN CHIQARISH
========================================================= */

    div.addEventListener("click", (e) => {
      /* Tahrirlash / birlashtirish / o'chirish
     tugmalari bosilganda participant tanlanmasin */
      if (
        e.target.closest(".editParticipant") ||
        e.target.closest(".resetParticipantStats") ||
        e.target.closest(".deleteParticipant")
      ) {
        return;
      }

      /* HOZIRGI HOLATNI TO'G'RIDAN-TO'G'RI TEKSHIRAMIZ */
      const currentTeam = teamsData.find((team) => String(team.participantId) === String(p.id));

      /* =======================================================
     AGAR O'YINDA BO'LSA
     YANA BOSILDI → TANLOV BEKOR
  ======================================================= */

      if (currentTeam) {
        removeTeam(currentTeam.id);

        return;
      }

      /* =======================================================
     AGAR O'YINDA BO'LMASA
     BOSILDI → TANLASH
  ======================================================= */

      addTeamWithParticipant(p);
    });

    /*
      RASM TANLASH
    */
    div.querySelector(".avatarBtn").onclick = (e) => {
      e.stopPropagation();

      div.querySelector(".avatarInput").click();
    };

    /*
      RASM YUKLASH
    */
    div.querySelector(".avatarInput").onchange = async (e) => {
      e.stopPropagation();

      const file = e.target.files?.[0];

      if (!file) return;

      const perm = await getMyPermissions();

      if (!perm.isAdmin && !perm.canSetParticipantImage) {
        e.target.value = "";

        return showLimitWarning(
          "Sizga ishtirokchiga rasm o'rnatish huquqi administrator tomonidan cheklangan.",
        );
      }

      try {
        p.image = await resizeImageFile(file);

        await saveParticipants();

        renderParticipants();
        renderTeams();
      } catch (err) {
        console.warn(err);

        alert("Rasmni yuklashda xato!");
      }
    };

    /*
      EDIT
    */
    div.querySelector(".editParticipant").onclick = (e) => {
      e.stopPropagation();

      window.editParticipant(p.id);
    };

    /*
      STATISTIKANI 0 GA TUSHURISH
    */
    div.querySelector(".resetParticipantStats").onclick = async (e) => {
      e.stopPropagation();

      if (!confirm(`"${p.name}" ning statistikasi (o‘yin/g‘alaba soni) 0 ga tushirilsinmi?`)) {
        return;
      }

      await resetParticipantStats(p.id);
    };

    /*
      DELETE
    */
    div.querySelector(".deleteParticipant").onclick = (e) => {
      e.stopPropagation();

      deleteParticipantById(p.id);
    };

    box.appendChild(div);
  });

  updateParticipantsToggleButton();
}
function avatarData(name) {
  const letter =
    String(name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="128"
      height="128"
    >
      <rect
        width="100%"
        height="100%"
        rx="64"
        fill="#172b4d"
      />

      <text
        x="50%"
        y="56%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="Arial"
        font-size="58"
        font-weight="800"
        fill="#67e8f9"
      >
        ${letter}
      </text>
    </svg>
  `;

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function getLiveParticipantScore(participantId) {
  const team = teamsData.find((t) => String(t.participantId) === String(participantId));

  return team ? team.score : 0;
}

function updateParticipantsToggleButton() {
  const btn = $("toggleParticipantsBtn");

  const box = $("participantsBox");

  if (!btn || !box) return;

  btn.textContent = box.classList.contains("expanded")
    ? `👥 ${participants.length} ishtirokchi ▲`
    : `👥 ${participants.length} ishtirokchi ▼`;
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = $("toggleParticipantsBtn");

  const box = $("participantsBox");

  btn?.addEventListener("click", () => {
    box?.classList.toggle("expanded");

    updateParticipantsToggleButton();
  });
});

/* ================= TEAMS ================= */

window.addSelectedParticipantToTeam = addTeamWithParticipant;

function addTeamWithParticipant(participant) {
  if (!participant?.id) {
    return alert("Ishtirokchi ma'lumoti topilmadi!");
  }

  if (teamsData.some((t) => String(t.participantId) === String(participant.id))) {
    return alert(`"${participant.name}" allaqachon o'yinga qo'shilgan!`);
  }

  teamCount += 1;

  teamsData.push({
    id: teamCount,
    participantId: participant.id,
    name: participant.name,
    image: participant.image || "",
    score: 0,
    correctCount: 0,
    wrongCount: 0,
  });

  renderTeams();
  renderParticipants();
}

function addTeam() {
  const input = $("teamNameInput");

  const name = input?.value?.trim();

  if (!name) {
    return addParticipant();
  }

  const p = findParticipant(name);

  if (p) {
    addTeamWithParticipant(p);
  } else {
    alert("Avval ishtirokchini qo‘shing.");
  }
}

window.addTeam = addTeam;

function removeTeam(id) {
  teamsData = teamsData.filter((t) => t.id !== id);

  renderTeams();
  renderParticipants();
}
function renderTeams() {
  const box = $("teams");

  if (!box) return;

  box.innerHTML = "";

  /*
   * Ball tizimi o'chirilgan (0)
   * bo'lsa, reyting to'g'ri javob
   * soni bo'yicha tuziladi —
   * ballik poyga o'chadi.
   */
  const scoringOff = Number(pointStep) === 0;

  const sorted = [...teamsData].sort((a, b) =>
    scoringOff ? (b.correctCount || 0) - (a.correctCount || 0) : b.score - a.score,
  );

  sorted.forEach((team, rank) => {
    const p = findParticipant(team.participantId);

    const div = document.createElement("div");

    div.className = "team";
    div.dataset.teamId = team.id;

    div.innerHTML = `
        <div class="liveRank">
          #${rank + 1}
        </div>

        <img
          class="teamAvatar"
          src="${p?.image || team.image || avatarData(team.name)}"
          alt=""
        >

        <strong>
          ${escapeHtml(team.name)}
        </strong>

        <span id="t${team.id}" class="${scoringOff ? "hidden" : ""}">
          ${team.score}
        </span>

        <div class="teamStatLine">
          ✅ ${team.correctCount || 0} · ❌ ${team.wrongCount || 0}
        </div>

        <div class="teamStatus">
          ${scoringOff ? "TO‘G‘RI / XATO" : "LIVE SCORE"}
        </div>

        <button
          class="closeBtn"
          type="button"
          title="O‘yindan chiqarish"
        >
          ×
        </button>
      `;

    div.querySelector(".closeBtn").onclick = (e) => {
      e.stopPropagation();
      removeTeam(team.id);
    };

    box.appendChild(div);
  });
}

/* Compatibility only:
   manual +/- UI is removed. */

function addScore() {
  console.info(
    "Manual score boshqaruvi olib tashlangan — ball variant tanlash orqali avtomatik beriladi.",
  );
}

window.addScore = addScore;

function updateTeamScoreUI(team) {
  const el = $("t" + team.id);

  if (el) {
    el.textContent = team.score;
  }

  renderTeams();
  renderParticipants();
  updateTurnIndicator();
}

/* ================= TOPICS ================= */

function questionsObjectToArray(obj) {
  if (!obj || typeof obj !== "object") {
    return [[], [], [], [], []];
  }

  /*
   * MUHIM XATO TUZATILDI:
   * "Randomizer" (savollarni
   * aralashtirish) tugmasi
   * mavzuni {shuffled:[...]}
   * shaklga o'zgartirib
   * qo'yar edi, lekin bu yer
   * faqat eski 0-4 kategoriya
   * shaklini tanir edi — shu
   * sababli qayta yuklanganda
   * (boshqa brovser/qayta kirish)
   * savollar "yo'q" bo'lib
   * ko'rinar edi. Endi ikkala
   * shakl ham qo'llab-quvvatlanadi.
   */
  if (Array.isArray(obj.shuffled)) {
    return [obj.shuffled, [], [], [], []];
  }

  return [0, 1, 2, 3, 4].map((i) => (Array.isArray(obj[i]) ? obj[i] : []));
}

/*
 * MUHIM: bu funksiya endi BUTUN "userTopics" massivini
 * emas, balki FAQAT o'zgargan BITTA mavzuni saqlaydi —
 * shu sabab endi "topicId" argumenti majburiy. Bu
 * eskirgan usulda har bir mayda o'zgarishda BARCHA
 * mavzular/savollar qayta yozilishining oldini oladi.
 */
async function saveTopics(topicId) {
  localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(userTopics));

  const colRef = getUserTopicsCollectionRef();

  if (!colRef) return true;

  const topic = topicId ? userTopics.find((t) => t.id === topicId) : null;

  if (!topic) {
    console.warn("saveTopics: topicId ko'rsatilmadi yoki mavzu topilmadi:", topicId);
    return false;
  }

  /*
   * MUHIM: Firestore "undefined"
   * qiymatlarni umuman qabul
   * qilmaydi va bunda setDoc
   * shovqinsiz (silent) xatolik
   * berib, hech narsa saqlamay
   * qo'yadi. Shu sabab avval
   * ma'lumotni JSON orqali
   * "tozalab" (undefined larsiz)
   * yuboramiz — shu Firestore'ga
   * yangi savollar saqlanmay
   * qolishining asosiy sababi edi.
   */
  const safeTopic = JSON.parse(JSON.stringify(topic));

  try {
    await setDoc(doc(colRef, topic.id), safeTopic);
  } catch (e) {
    console.error("Topics Firebase save XATOSI:", e);

    alert(
      "⚠️ Mavzular/savollar serverga saqlanmadi!\n\n" +
        "Sababi: " +
        (e?.message || e) +
        "\n\nInternetni tekshirib, qayta urinib ko‘ring.",
    );

    return false;
  }

  /*
   * TEZLIK UCHUN MUHIM O'ZGARISH:
   * Avval "boshqalar mavzulari"ni
   * ko'rsatish uchun BARCHA
   * foydalanuvchilarning to'liq
   * hujjati (participants va
   * boshqa maydonlar bilan birga)
   * yuklab olinar edi — shu
   * sekinlikning asosiy sababi
   * edi. Endi har bir mavzu
   * alohida, yengil
   * "sharedTopics/{id}" hujjatiga
   * ham sinxronlanadi, shunda
   * boshqalar faqat shu kichik
   * kolleksiyani o'qiydi.
   */
  try {
    await syncSharedTopics([safeTopic]);
  } catch (e) {
    console.error("sharedTopics sync XATOSI:", e);

    /*
     * Shaxsiy mavzu ("users/{uid}/topics/{id}")
     * MUVAFFAQIYATLI saqlandi — faqat uni
     * umumiy ("boshqa mavzular") ro'yxatiga
     * chiqarish bloklandi. Bu odatda admin
     * tomonidan qo'yilgan cheklovdan (permission-
     * denied) kelib chiqadi — shuning uchun
     * tushunarli, aniq xabar beramiz.
     */
    if (String(e?.code || "").includes("permission-denied")) {
      showLimitWarning(
        "Mavzu shaxsiy ro'yxatingizga saqlandi, lekin uni umumiy (\"boshqa mavzular\") ro'yxatiga chiqarish huquqingiz administrator tomonidan cheklangan.",
      );
    } else {
      alert("⚠️ Mavzu saqlandi, lekin umumiy ro'yxatga sinxronlashda xatolik yuz berdi.");
    }

    return false;
  }

  return true;
}

async function syncSharedTopics(topicsToSync) {
  if (!db || !currentUserUid) {
    return;
  }

  const list = topicsToSync || JSON.parse(JSON.stringify(userTopics));

  if (!list.length) return;

  try {
    const batch = writeBatch(db);

    const ownerName = auth.currentUser?.displayName || "Noma'lum";

    list.forEach((t) => {
      if (!t.id) return;

      batch.set(
        doc(db, "sharedTopics", t.id),
        {
          ...t,
          ownerId: currentUserUid,
          ownerName,
        },
        { merge: true },
      );
    });

    await batch.commit();
  } catch (e) {
    console.warn("sharedTopics sync:", e);
  }
}

async function deleteSharedTopic(topicId) {
  if (!db || !topicId) return;

  try {
    await deleteDoc(doc(db, "sharedTopics", topicId));
  } catch (e) {
    console.warn("sharedTopics delete:", e);
  }
}

async function loadTopicsSafe() {
  try {
    const local = localStorage.getItem(getUserTopicsLSKey());

    userTopics = local ? JSON.parse(local) : [];
  } catch {
    userTopics = [];
  }

  renderUserTopics();

  const colRef = getUserTopicsCollectionRef();

  if (!colRef) return;

  try {
    const snap = await getDocs(colRef);

    if (!snap.empty) {
      userTopics = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
    } else {
      /*
       * YANGI KOLLEKSIYADA HALI HECH NARSA YO'Q —
       * ESKI "users/{uid}.topics" MASSIV MAYDONIDAN
       * BIR MARTALIK KO'CHIRISH (migratsiya). O'sha
       * eski maydon cheksiz kattalashib, hujjat hajmi
       * chegarasiga yaqinlashib qolgan edi — endi u
       * butunlay tark etiladi, har bir mavzu ALOHIDA
       * kichik hujjatga ko'chiriladi.
       */
      const data = await fetchUserDocOnce();

      const legacy = Array.isArray(data?.topics) ? data.topics : [];

      if (legacy.length) {
        await migrateLegacyTopics(legacy);
        userTopics = legacy;
      }
    }

    localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(userTopics));

    renderUserTopics();
  } catch (e) {
    console.warn("Topics load:", e);
  }
}

/*
 * ESKI "users/{uid}.topics" MASSIVIDAGI mavzularni
 * yangi "users/{uid}/topics/{id}" kolleksiyasiga
 * ko'chiradi, so'ng eski (og'ir) maydonni butunlay
 * o'chiradi. Bir nechta mavzu bir xil "id" bilan
 * takrorlangan bo'lsa ham xavfsiz — chunki har biri
 * hujjat ID'siga yoziladi, takrorlar o'z-o'zidan
 * birlashadi.
 *
 * Firestore'ning bitta batch'da 500 tagacha yozuv
 * chegarasi borligi uchun, katta ro'yxatlar
 * bo'laklarga (chunk) bo'lib yoziladi.
 */
async function migrateLegacyTopics(legacyTopics) {
  const colRef = getUserTopicsCollectionRef();

  const userRef = getUserDocRef();

  if (!colRef || !userRef) return;

  const CHUNK_SIZE = 400;

  try {
    for (let i = 0; i < legacyTopics.length; i += CHUNK_SIZE) {
      const slice = legacyTopics.slice(i, i + CHUNK_SIZE);

      const batch = writeBatch(db);

      slice.forEach((t) => {
        if (!t?.id) return;

        const safe = JSON.parse(JSON.stringify(t));

        batch.set(doc(colRef, t.id), safe);
      });

      await batch.commit();
    }

    await updateDoc(userRef, { topics: deleteField() });

    resetUserDocCache();
  } catch (e) {
    console.warn("Legacy topics migration:", e);
  }
}

function renderUserTopics() {
  /*
   * "Mening mavzularim" paneli olib
   * tashlandi — endi mavzular faqat
   * savollar maydonida (board) va
   * Excel maqsad tanlovida ko'rinadi,
   * shu ikkalasi shu yerda sinxronlanadi.
   */

  renderBoard();
  renderExcelTargetOptions();
}

/*
 * "SAVOL QO'SHISH" BIRLASHTIRILGAN OQIMI
 * ---------------------------------------
 * Ilgari mavzu qo'shish va Excel'dan
 * savol yuklash ikki alohida blok va ikki
 * bosqichli jarayon edi. Endi bitta
 * "Savol qo'shish" bloki orqali:
 *  - yangi savol kartasi nomi yoziladi
 *    (yoki eski karta tanlanadi — bu
 *    "replay"/qayta yuklash bo'ladi),
 *  - Excel shabloni shu yerdan yuklab
 *    olinadi va to'ldirilgan fayl shu
 *    yerdan tanlanadi,
 *  - "Saqlash" bosilganda karta (agar
 *    yangi bo'lsa) yaratiladi va Excel
 *    fayldagi savollar bir zumda unga
 *    yuklanadi.
 */

/*
 * MANTIQ (bitta forma, ikkita natija):
 *  - "newUserTopicTitle" maydoniga NOM YOZILSA →
 *    shu nom bilan YANGI savol kartasi yaratiladi
 *    (pastdagi tanlangan eski karta e'tiborga
 *    olinmaydi).
 *  - Nom BO'SH qoldirilib, pastdagi ro'yxatdan
 *    (userTopicExcelTarget) mavjud karta
 *    tanlansa → o'sha kartaning savollari Excel
 *    fayldagilar bilan ALMASHTIRILADI (replace).
 * Bularning qaysi biri ishlatilishini
 * saveQuestionCard() aniqlaydi — alohida
 * "rejim" tugmalari endi kerak emas.
 */

/*
 * Faqat bo'sh savol kartasini
 * yaratadi (nomi bilan). Excel
 * yuklash alohida qadam sifatida
 * applyExcelFileToTopic() orqali
 * amalga oshiriladi.
 */
async function createUserTopic(title, subject, category) {
  const perm = await getMyPermissions();

  if (!perm.isAdmin) {
    if (!perm.canAddTopics) {
      showLimitWarning("Sizga yangi mavzu qo'shish huquqi administrator tomonidan cheklangan.");
      return null;
    }

    const { topicLimit } = await getAppLimits();

    if (userTopics.length >= topicLimit) {
      showLimitWarning(
        `Siz maksimal ${topicLimit} tagacha mavzu qo'sha olasiz. Ko'proq kerak bo'lsa, administrator bilan bog'laning.`,
      );
      return null;
    }
  }

  const newTopic = {
    id: "topic_" + Date.now(),

    title,

    subject: (subject || "").toString().trim() || DEFAULT_TOPIC_SUBJECT,

    category: (category || "").toString().trim() || DEFAULT_TOPIC_CATEGORY,

    questions: {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
    },

    createdAt: Date.now(),
  };

  userTopics.push(newTopic);

  return newTopic;
}

/*
 * Tanlangan Excel faylni o'qib,
 * berilgan topic.questions'ni
 * TO'LIQ almashtiradi. Saqlash
 * (Firebase) va render qilishni
 * chaqiruvchi tomon bajaradi.
 */
/*
 * XLSX KUTUBXONASINI "DangEROSLY" (kerak bo'lganda)
 * YUKLASH: ilgari bu ~ bir necha yuz KB'lik kutubxona
 * game.html'da <script src> orqali HAR DOIM, hatto
 * index'dan mehmon sifatida shunchaki Xona/Duel/Play
 * o'ynayotgan foydalanuvchi uchun ham SINXRON (bloklovchi)
 * ravishda yuklanardi — bu esa sahifaning birinchi marta
 * tayyor bo'lishini (demak — flow-shield/board holatini)
 * kechiktirar, natijada UI "sekin ochilyapti" tuyg'usini
 * kuchaytirar edi. Endi bu kutubxona FAQAT admin/o'qituvchi
 * haqiqatan ham Excel import/export funksiyasidan
 * foydalanganda, talab bilan (on-demand) yuklanadi.
 */
let _xlsxLoadPromise = null;

function loadXlsxLib() {
  if (window.XLSX) {
    return Promise.resolve();
  }

  if (!_xlsxLoadPromise) {
    _xlsxLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
      s.onload = () => resolve();
      s.onerror = () => {
        _xlsxLoadPromise = null;
        reject(new Error("Excel kutubxonasi yuklanmadi. Internetni tekshiring."));
      };
      document.head.appendChild(s);
    });
  }

  return _xlsxLoadPromise;
}

function applyExcelFileToTopic(topic, file) {
  return loadXlsxLib().then(
    () =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onerror = () => reject(new Error("Faylni o'qib bo'lmadi"));

        reader.onload = (e) => {
          try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), {
              type: "array",
            });

            const sheet = workbook.Sheets[workbook.SheetNames[0]];

            const rows = XLSX.utils.sheet_to_json(sheet, {
              defval: "",
            });

            topic.questions = {
              0: [],
              1: [],
              2: [],
              3: [],
              4: [],
            };

            let index = 0;

            rows.forEach((r) => {
              const q = r.Question ?? r.question ?? r.QUESTION ?? "";

              const a = r.Answer ?? r.answer ?? r.ANSWER ?? "";

              if (!String(q).trim() || !String(a).trim()) {
                return;
              }

              let cat = index % 5;

              const c = Number(r.Category ?? r.category ?? r.CATEGORY);

              if (c >= 1 && c <= 5) {
                cat = c - 1;
              }

              /*
               * 3-4-5 USTUNLARDAGI NOTO'G'RI JAVOBLAR
               */
              const wrongAnswers = [r["Wrong Answer 1"], r["Wrong Answer 2"], r["Wrong Answer 3"]]
                .map((value) => String(value ?? "").trim())
                .filter(Boolean);

              topic.questions[cat].push({
                q: String(q).trim(),

                a: String(a).trim(),

                wrongAnswers: wrongAnswers,
              });

              index++;
            });

            resolve(topic);
          } catch (err) {
            reject(err);
          }
        };

        reader.readAsArrayBuffer(file);
      }),
  );
}

/*
 * "Saqlash" tugmasi — yagona
 * kirish nuqtasi. Rejimga qarab
 * yangi karta yaratadi yoki eski
 * kartani tanlaydi, so'ng (agar
 * fayl tanlangan bo'lsa) savollarni
 * bir zumda yuklaydi.
 */
async function saveQuestionCard() {
  const saveBtn = $("qcSaveBtn");

  const file = $("userTopicExcelInput")?.files?.[0];

  const titleInput = $("newUserTopicTitle");

  const title = titleInput?.value?.trim();

  let topic = null;

  if (title) {
    /*
     * FAN — kategoriyalash yoqilgan
     * bo'lsa, admin belgilagan
     * ro'yxatdan BITTASINI tanlash
     * SHART (erkin matn emas).
     */
    const subjectInput = $("newUserTopicSubject");

    let subject = subjectInput?.value?.trim() || "";

    if (categorySettingsState.enabled) {
      const subjectOptions = categorySettingsState.subjects;

      if (!subjectOptions.includes(subject)) {
        alert("Iltimos, avval FANni (yo'nalishni) tanlang: " + subjectOptions.join(", "));
        return;
      }
    } else {
      subject = "";
    }

    /*
     * KATEGORIYA — agar admin
     * kategoriyalashni o'chirgan
     * bo'lsa, umuman tekshirilmaydi.
     * Aks holda: foydalanuvchi tanlagan
     * FAN ICHIDA o'z kategoriyasini
     * yoza olsa — kiritilgan matn
     * qanday bo'lsa shunday qabul
     * qilinadi (bo'sh bo'lsa "Umumiy").
     * Yoza olmasa — FAQAT shu fan
     * ichida ALLAQACHON mavjud bo'lgan
     * kategoriyalardan biriga mos
     * kelishi shart.
     */
    const categoryInput = $("newUserTopicCategory");

    let category = categoryInput?.value?.trim() || "";

    if (categorySettingsState.enabled) {
      if (!canUserAddOwnCategory()) {
        const options = getTopicCategoryStats(filterTopicsBySubject(userTopics, subject)).map(
          (c) => c.name,
        );

        const matched = options.find((o) => o.toLowerCase() === category.toLowerCase());

        if (category && !matched) {
          alert(
            "Bunday kategoriya yo'q. \"" +
              subject +
              '" fani ichida faqat quyidagilardan birini tanlang: ' +
              (options.join(", ") ||
                "(hozircha kategoriya yo'q — administratorga murojaat qiling)"),
          );
          return;
        }

        if (!matched && !options.length) {
          alert(
            '"' +
              subject +
              '" fani ichida hali kategoriya mavjud emas. Administratorga murojaat qiling.',
          );
          return;
        }

        category = matched || options[0] || "";
      }
    } else {
      category = "";
    }

    // NOM YOZILGAN → yangi savol kartasi
    topic = await createUserTopic(title, subject, category);

    if (!topic) return;

    if (titleInput) titleInput.value = "";
    if (categoryInput) categoryInput.value = "";
  } else {
    // NOM BO'SH → pastda tanlangan eski kartani almashtiramiz
    const targetId = $("userTopicExcelTarget")?.value;

    if (!targetId) {
      return alert(
        "Yangi karta uchun nom yozing, yoki almashtirish uchun ro'yxatdan mavjud kartani tanlang!",
      );
    }

    topic = userTopics.find((t) => t.id === targetId);

    if (!topic) {
      return alert("Tanlangan savol kartasi topilmadi!");
    }

    if (!file) {
      return alert("Excel fayl tanlanmadi! Eski kartani almashtirish uchun fayl kerak.");
    }

    const perm = await getMyPermissions();

    if (!perm.isAdmin && !perm.canAddTopics) {
      return showLimitWarning(
        "Sizga savol qo'shish/yangilash huquqi administrator tomonidan cheklangan.",
      );
    }
  }

  if (saveBtn) {
    saveBtn.disabled = true;
  }

  try {
    if (file) {
      await applyExcelFileToTopic(topic, file);
    }

    questions = questionsObjectToArray(topic.questions);

    currentUserTopicId = topic.id;

    localStorage.setItem("lastTopicId", topic.id);

    renderUserTopics();
    renderBoard();
    renderExcelTargetOptions();

    /*
     * Saqlash tugagach, "eski savolni
     * tanlash" ro'yxati har doim
     * bo'sh holatga qaytadi — aks holda
     * oldingi tanlov "yopishib qolib",
     * adashtirib yuboradi.
     */
    const excelTargetSelect = $("userTopicExcelTarget");

    if (excelTargetSelect) {
      excelTargetSelect.value = "";
    }

    const saved = await saveTopics(topic.id);

    await loadOtherTopics();

    const fileInput = $("userTopicExcelInput");

    if (fileInput) fileInput.value = "";

    if (saved) {
      alert(file ? "✅ Savol kartasi va savollar saqlandi!" : "✅ Savol kartasi saqlandi!");
    }
  } catch (err) {
    console.warn("Savol kartasini saqlashda xatolik:", err);

    alert("Excel faylni o'qib bo'lmadi. Fayl shablon bilan mos ekanini tekshiring.");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}

window.saveQuestionCard = saveQuestionCard;

function selectUserTopic(topicId) {
  const topic = userTopics.find((t) => t.id === topicId);

  if (!topic) return;

  currentUserTopicId = topicId;

  localStorage.setItem("lastTopicId", topicId);

  questions = questionsObjectToArray(topic.questions);

  /*
   * QUESTION BOARD
   */
  renderBoard();

  /*
   * Mening mavzularim panelidagi
   * eski tanlovni ham yangilaymiz
   */
  renderUserTopics();
}

window.selectUserTopic = selectUserTopic;

function restoreLastTopic() {
  const id = localStorage.getItem("lastTopicId");

  if (id) {
    selectUserTopic(id);
  }
}

async function editUserTopicTitle(topicId) {
  const topic = userTopics.find((t) => t.id === topicId);

  if (!topic) return;

  const perm = await getMyPermissions();

  if (!perm.isAdmin && !perm.canEditTopics) {
    return showLimitWarning(
      "Sizga mavzularni tahrirlash huquqi administrator tomonidan cheklangan.",
    );
  }

  const title = prompt("Yangi mavzu nomi:", topic.title);

  if (!title?.trim()) return;

  topic.title = title.trim();

  if (categorySettingsState.enabled) {
    const subjectOptions = categorySettingsState.subjects;

    const subjectAnswer = prompt(`Fan (${subjectOptions.join(", ")}):`, getTopicSubject(topic));

    if (subjectAnswer !== null) {
      const trimmedSubject = subjectAnswer.trim();

      const matchedSubject = subjectOptions.find(
        (o) => o.toLowerCase() === trimmedSubject.toLowerCase(),
      );

      if (trimmedSubject && !matchedSubject) {
        alert("Bunday fan yo'q. Faqat quyidagilardan birini tanlang: " + subjectOptions.join(", "));
      } else if (matchedSubject) {
        topic.subject = matchedSubject;
      }
    }

    const subjectForCategory = getTopicSubject(topic);

    const canFree = canUserAddOwnCategory();

    const existingCategoryOptions = getTopicCategoryStats(
      filterTopicsBySubject(userTopics, subjectForCategory),
    ).map((c) => c.name);

    const hint = canFree
      ? "(istalgan nom yozing)"
      : '("' +
        subjectForCategory +
        '" fani ichida: ' +
        (existingCategoryOptions.join(", ") || "hozircha yo'q") +
        ")";

    const category = prompt(`Kategoriya ${hint}:`, getTopicCategory(topic));

    if (category !== null) {
      const trimmed = category.trim();

      if (canFree) {
        topic.category = trimmed || DEFAULT_TOPIC_CATEGORY;
      } else {
        const matched = existingCategoryOptions.find(
          (o) => o.toLowerCase() === trimmed.toLowerCase(),
        );

        if (trimmed && !matched) {
          alert(
            "Bunday kategoriya yo'q. \"" +
              subjectForCategory +
              '" fani ichida faqat quyidagilardan birini tanlang: ' +
              (existingCategoryOptions.join(", ") || "(hozircha yo'q)"),
          );
        } else {
          topic.category = matched || DEFAULT_TOPIC_CATEGORY;
        }
      }
    }
  }

  renderUserTopics();

  await saveTopics(topicId);
}

window.editUserTopicTitle = editUserTopicTitle;

async function deleteUserTopic(topicId) {
  if (!confirm("Mavzu o‘chirilsinmi?")) {
    return;
  }

  userTopics = userTopics.filter((t) => t.id !== topicId);

  if (currentUserTopicId === topicId) {
    currentUserTopicId = null;
  }

  renderUserTopics();

  localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(userTopics));

  const colRef = getUserTopicsCollectionRef();

  if (colRef) {
    try {
      await deleteDoc(doc(colRef, topicId));
    } catch (e) {
      console.warn("Topic delete:", e);
    }
  }

  /*
   * Mavzu o'chirilganda,
   * ulashilgan nusxasi ham
   * "sharedTopics" kolleksiyasidan
   * o'chirilishi kerak — aks
   * holda boshqalarga hali ham
   * ko'rinaveradi.
   */
  await deleteSharedTopic(topicId);
}

window.deleteUserTopic = deleteUserTopic;

function renderExcelTargetOptions() {
  const select = $("userTopicExcelTarget");

  if (!select) return;

  const prevValue = select.value;

  select.innerHTML = "";

  if (!userTopics.length) {
    const opt = document.createElement("option");

    opt.value = "";
    opt.textContent = "Avval mavzu yarating";

    select.appendChild(opt);

    select.disabled = true;

    return;
  }

  select.disabled = false;

  /*
   * Bo'sh / tanlanmagan variant —
   * doim birinchi va STANDART holat.
   * Shu tufayli eski tanlangan mavzu
   * nomi "yopishib qolmaydi" — foydalanuvchi
   * ataylab tanlamaguncha bu joy bo'sh turadi,
   * va adashib tanlab yuborsa shu variantga
   * qaytib bekor qilishi mumkin.
   */
  const blankOpt = document.createElement("option");

  blankOpt.value = "";
  blankOpt.textContent = "— (tanlanmagan)";

  select.appendChild(blankOpt);

  userTopics.forEach((topic) => {
    const opt = document.createElement("option");

    opt.value = topic.id;
    opt.textContent = topic.title;

    select.appendChild(opt);
  });

  const stillExists = userTopics.some((t) => t.id === prevValue);

  select.value = stillExists ? prevValue : "";
}

/* ================= BOARD ================= */

/* =========================
   TOPIC BOARD
========================= */

/* =========================
   TOPIC BOARD
========================= */

/*
 * Kategoriya ustunini (chapdagi
 * ro'yxat) chizadi — board va
 * room-picker uchun umumiy.
 */
function renderCategorySidebar(container, categories, selected, onSelect) {
  if (!container) return;

  const totalCount = categories.reduce((sum, c) => sum + c.count, 0);

  const allChip = `
    <div
      class="categoryChip catAllChip${!selected ? " active" : ""}"
      data-cat=""
    >
      <span>Barchasi</span>
      <small>${totalCount}</small>
    </div>
  `;

  const chips = categories
    .map(
      (c) => `
        <div
          class="categoryChip ${c.colorClass}${selected === c.name ? " active" : ""}"
          data-cat="${escapeHtml(c.name)}"
        >
          <span>${escapeHtml(c.name)}</span>
          <small>${c.count}</small>
        </div>
      `,
    )
    .join("");

  container.innerHTML = allChip + chips;

  container.querySelectorAll(".categoryChip").forEach((chip) => {
    chip.onclick = () => {
      onSelect(chip.dataset.cat || null);
    };
  });
}

/*
 * "+ Yangi" kartasi — bosilganda
 * Savol qo'shish panelini ochib,
 * nom maydoniga fokus qiladi va
 * (agar bitta kategoriya tanlangan
 * bo'lsa) kategoriya maydonini
 * avtomatik shu bilan to'ldiradi.
 */
function focusAddTopicPanel(presetCategory, presetSubject) {
  const dock = document.querySelector(".controlDockWide");

  if (dock && dock.classList.contains("settingsClosed")) {
    toggleQuestionSettings();
  }

  const titleInput = $("newUserTopicTitle");

  const subjectSelect = $("newUserTopicSubject");

  const categoryInput = $("newUserTopicCategory");

  if (subjectSelect && presetSubject && categorySettingsState.subjects.includes(presetSubject)) {
    subjectSelect.value = presetSubject;
    renderTopicCategoryOptions();
  }

  if (categoryInput) {
    categoryInput.value = presetCategory || "";
  }

  titleInput?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  titleInput?.focus();
}

window.focusAddTopicPanel = focusAddTopicPanel;

function appendAddTopicCard(board, presetCategory, presetSubject) {
  const addCard = document.createElement("div");

  addCard.className = "topicBoardCard topicBoardAddCard";

  const labelParts = [];

  if (presetSubject) labelParts.push(presetSubject);
  if (presetCategory) labelParts.push(presetCategory);

  addCard.innerHTML = `
    <div class="topicBoardAddIcon">
      +
    </div>
    <div class="topicBoardInfo">
      <strong>Yangi mavzu</strong>
      <span>
        ${labelParts.length ? escapeHtml(labelParts.join(" / ")) + " uchun" : "Savol qo‘shish"}
      </span>
    </div>
  `;

  addCard.onclick = () => {
    focusAddTopicPanel(presetCategory, presetSubject);
  };

  board.appendChild(addCard);
}

/*
 * "Savol qo'shish" bloki ustidagi
 * FAN (subject) tanlovini to'ldiradi
 * — admin belgilagan "subjects"
 * ro'yxati. Joriy tanlangan board
 * fani (agar "Barchasi" emas) —
 * boshlang'ich qiymat sifatida
 * qo'yiladi.
 */
function renderTopicSubjectOptions() {
  const select = $("newUserTopicSubject");

  if (!select) return;

  const subjects = categorySettingsState.subjects;

  const prevValue = select.value;

  select.innerHTML = subjects
    .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
    .join("");

  const preferred =
    selectedBoardSubject && subjects.includes(selectedBoardSubject)
      ? selectedBoardSubject
      : subjects.includes(prevValue)
        ? prevValue
        : subjects[0] || "";

  select.value = preferred;

  select.onchange = () => {
    renderTopicCategoryOptions();
  };
}

/*
 * "Savol qo'shish" bloki ostidagi
 * Kategoriya inputini to'ldiradi.
 * Datalist tarkibi — joriy tanlangan
 * FAN ICHIDA foydalanuvchining o'z
 * mavzularida allaqachon ishlatilgan
 * kategoriyalar. Agar foydalanuvchi
 * o'z kategoriyasini yoza olmasa
 * (canUserAddOwnCategory() false),
 * maydon FAQAT shu ro'yxatga
 * moslashtirilib tekshiriladi
 * (saveQuestionCard ichida).
 */
function renderTopicCategoryOptions() {
  const list = $("topicCategoryOptions");

  if (!list) return;

  const subject = $("newUserTopicSubject")?.value || "";

  const names = getTopicCategoryStats(filterTopicsBySubject(userTopics, subject)).map(
    (c) => c.name,
  );

  list.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function renderBoard() {
  const board = $("board");

  const subBox = $("boardSubjectList");

  const catBox = $("boardCategoryList");

  if (!board) return;

  board.innerHTML = "";

  renderTopicSubjectOptions();
  renderTopicCategoryOptions();

  if (!Array.isArray(userTopics) || !userTopics.length) {
    if (subBox) subBox.innerHTML = "";
    if (catBox) catBox.innerHTML = "";

    board.innerHTML = `
      <div class="topicBoardEmpty">
        📚 Hozircha mavzu mavjud emas
      </div>
    `;

    appendAddTopicCard(board);

    return;
  }

  /*
   * ENG OXIRGI QO'SHILGAN MAVZU
   * BIRINCHI CHIQADI (createdAt
   * bo'yicha kamayish tartibida).
   */
  const sortedTopics = [...userTopics].sort(
    (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0),
  );

  /*
   * FANLAR VA KATEGORIYALAR —
   * chapdagi ustunlar BARCHA mavzular
   * asosida (qidiruv natijasidan
   * qat'i nazar) chiqadi. Avval FAN
   * tanlanadi, keyin shu FAN ICHIDAGI
   * kategoriyalar ko'rsatiladi. Admin
   * kategoriyalashni o'chirgan bo'lsa —
   * bu ustunlar umuman ko'rsatilmaydi
   * va filtrlash ishlamaydi.
   */
  let subjectFilteredTopics = sortedTopics;

  if (!categorySettingsState.enabled) {
    selectedBoardSubject = null;
    selectedBoardCategory = null;

    if (subBox) subBox.innerHTML = "";
    if (catBox) catBox.innerHTML = "";
  } else {
    const subjects = getTopicSubjectStats(sortedTopics);

    if (selectedBoardSubject && !subjects.some((s) => s.name === selectedBoardSubject)) {
      selectedBoardSubject = null;
      selectedBoardCategory = null;
    }

    renderCategorySidebar(subBox, subjects, selectedBoardSubject, (name) => {
      selectedBoardSubject = name;
      selectedBoardCategory = null;
      renderBoard();
    });

    subjectFilteredTopics = filterTopicsBySubject(sortedTopics, selectedBoardSubject);

    if (!selectedBoardSubject) {
      /*
       * "Barchasi" (hech qanday fan
       * tanlanmagan) holatda kategoriya
       * ustuni butunlay yashiriladi —
       * yuqorida fan qatorida allaqachon
       * "Barchasi" chipi bor va u BARCHA
       * savollarni ko'rsatadi. Kategoriya
       * ustuni FAQAT aniq bir FAN
       * tanlanganda paydo bo'ladi.
       */
      selectedBoardCategory = null;

      if (catBox) catBox.innerHTML = "";
    } else {
      const categories = getTopicCategoryStats(subjectFilteredTopics);

      if (selectedBoardCategory && !categories.some((c) => c.name === selectedBoardCategory)) {
        selectedBoardCategory = null;
      }

      renderCategorySidebar(catBox, categories, selectedBoardCategory, (name) => {
        selectedBoardCategory = name;
        renderBoard();
      });
    }
  }

  /*
   * NOM BO'YICHA QIDIRISH —
   * "1 → 5 kategoriya" yozuvi
   * o'rniga qo'shilgan qidiruv
   * maydoni shu yerda ishlatiladi.
   */
  const searchTerm = ($("boardTopicSearch")?.value || "").trim().toLowerCase();

  let visibleTopics = searchTerm
    ? subjectFilteredTopics.filter((t) => (t.title || "").toLowerCase().includes(searchTerm))
    : subjectFilteredTopics;

  if (selectedBoardCategory) {
    visibleTopics = visibleTopics.filter((t) => getTopicCategory(t) === selectedBoardCategory);
  }

  if (!visibleTopics.length) {
    board.innerHTML = `
      <div class="topicBoardEmpty">
        🔍 "${escapeHtml(searchTerm)}" bo‘yicha mavzu topilmadi
      </div>
    `;

    appendAddTopicCard(board, selectedBoardCategory, selectedBoardSubject);

    return;
  }

  visibleTopics.forEach((topic) => {
    const card = document.createElement("div");

    card.className = "topicBoardCard";

    if (topic.id === currentUserTopicId) {
      card.classList.add("selected");
    }

    const total = Object.values(topic.questions || {}).reduce(
      (sum, category) => sum + (Array.isArray(category) ? category.length : 0),
      0,
    );

    card.innerHTML = `
      <div class="topicBoardIcon">
        📚
      </div>

      <div class="topicBoardInfo">

        <strong>
          ${escapeHtml(topic.title)}
        </strong>

        <span>
          ${total} ta savol${
            categorySettingsState.enabled
              ? " · " +
                escapeHtml(getTopicSubject(topic)) +
                " / " +
                escapeHtml(getTopicCategory(topic))
              : ""
          }
        </span>

        ${
          topic.id === currentUserTopicId
            ? `
              <small>
                ✓ TANLANGAN
              </small>
            `
            : ""
        }

      </div>

      <div class="topicBoardCardActions">
        <button type="button" class="cardIconBtn editBtn" title="Tahrirlash">✏️</button>
        <button type="button" class="cardIconBtn deleteBtn" title="O‘chirish">🗑️</button>
      </div>

      <div class="topicStartOverlay">
        <span>▶</span>
        <strong>O‘YINNI BOSHLASH</strong>
      </div>
    `;

    card.onclick = () => {
      openTopicIntro(topic);
    };

    const editBtn = card.querySelector(".editBtn");

    if (editBtn) {
      editBtn.onclick = (e) => {
        e.stopPropagation();
        editUserTopicTitle(topic.id);
      };
    }

    const deleteBtn = card.querySelector(".deleteBtn");

    if (deleteBtn) {
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteUserTopic(topic.id);
      };
    }

    board.appendChild(card);
  });

  appendAddTopicCard(board, selectedBoardCategory, selectedBoardSubject);
}

/* ================= TOPIC INTRO / PLAY MODAL ================= */

function openTopicIntro(topic) {
  if (!topic) return;

  if (gameFinalized) return;

  /*
   * XONA UCHUN YANGI MAVZU TANLASH REJIMI:
   * agar host "🔄 Boshqa mavzu tanlash"ni
   * bosgan bo'lsa, mavzu kartasiga bosish
   * ODATDAGI intro oynasini emas, balki
   * to'g'ridan-to'g'ri xonaga yangi mavzuni
   * ulashni ishga tushiradi.
   */
  if (roomTopicSwapMode) {
    swapRoomTopic(topic);
    return;
  }

  /*
   * DUEL — "BOSHQA MAVZU BILAN DAVOM ETISH":
   * duel yakunida foydalanuvchi shu tugmani bosgan
   * bo'lsa, mavzu kartasiga bosish ODATDAGI intro
   * oynasini ochmaydi — bir xil 2 ishtirokchi bilan
   * to'g'ridan-to'g'ri yangi duelni (statistikasi
   * 0 dan) ishga tushiradi.
   */
  if (pendingDuelContinuePlayers) {
    const players = pendingDuelContinuePlayers;
    pendingDuelContinuePlayers = null;

    selectUserTopic(topic.id);
    startDuel(topic, players.a, players.b);
    return;
  }

  /*
   * Shu yerdan boshlab (Duel/Xona/Play qaysi biri
   * tanlanishidan qat'iy nazar) board hech qachon
   * "yalang'och" ko'rinib qolmasligi uchun parda ishga
   * tushadi — jarayon tugagach yoki bekor qilinganda
   * o'chiriladi.
   */
  showFlowShield();

  pendingIntroTopic = topic;

  const titleEl = $("introTopicTitle");

  if (titleEl) {
    titleEl.textContent = topic.title || "O‘yin haqida";
  }

  renderIntroParticipants();
  renderIntroRules();

  const modal = $("topicIntroModal");

  if (modal) {
    modal.style.display = "flex";

    modal.classList.add("show");
  }
}

function renderIntroParticipants() {
  const box = $("introParticipants");

  if (!box) return;

  box.innerHTML = "";

  if (!teamsData.length) {
    box.innerHTML = `
      <span class="introEmpty">
        Hozircha ishtirokchi yo‘q
      </span>
    `;

    return;
  }

  teamsData.forEach((team) => {
    const card = document.createElement("div");

    card.className = "introParticipantCard";

    card.innerHTML = `
      <img
        class="introAvatar"
        src="${team.image || avatarData(team.name)}"
        alt=""
      >
      <span>
        ${escapeHtml(team.name)}
      </span>
    `;

    box.appendChild(card);
  });
}

function renderIntroRules() {
  const box = $("introRules");

  if (!box) return;

  const step = Number.isFinite(pointStep) && pointStep >= 0 ? pointStep : 100;

  const isSolo = !teamsData.length;

  box.innerHTML = isSolo
    ? `
      <ul class="introRulesList">
        <li>
          🧠 Ishtirokchi tanlanmagan — <strong>yakka (solo) rejimda</strong> mashq qilasiz
        </li>
        <li>
          🔀 Barcha savollar tasodifiy tartibda beriladi
        </li>
        <li>
          📊 O‘yin oxirida nechta to‘g‘ri va nechta xato javob berganingiz statistikasi ko‘rsatiladi
        </li>
        <li>
          ⏱ Har bir savolga javob berish uchun belgilangan vaqt beriladi
        </li>
      </ul>
    `
    : step > 0
      ? `
      <ul class="introRulesList">
        <li>
          ✅ To‘g‘ri javob — <strong>+${step} ball</strong>
        </li>
        <li>
          ❌ Noto‘g‘ri javob yoki vaqt tugashi — <strong>ball berilmaydi</strong> (ball ayirilmaydi)
        </li>
        <li>
          🔥 Bonus rejimi yoqilgan bo‘lsa, ba’zi savollar tasodifiy 2X/3X bo‘lib chiqadi
        </li>
        <li>
          ⏱ Har bir savolga javob berish uchun belgilangan vaqt beriladi
        </li>
      </ul>
    `
      : `
      <ul class="introRulesList">
        <li>
          🎯 Ball tizimi o‘chirilgan — natija <strong>to‘g‘ri va xato javoblar statistikasi</strong> bilan ko‘rsatiladi
        </li>
        <li>
          🔀 Barcha savollar tasodifiy tartibda beriladi
        </li>
        <li>
          🔥 Bonus rejimi yoqilgan bo‘lsa, ba’zi savollar tasodifiy bonus bo‘lib chiqadi
        </li>
        <li>
          ⏱ Har bir savolga javob berish uchun belgilangan vaqt beriladi
        </li>
      </ul>
    `;
}

function closeTopicIntroModal(cancelling = true) {
  const modal = $("topicIntroModal");

  if (modal) {
    modal.style.display = "none";

    modal.classList.remove("show");
  }

  pendingIntroTopic = null;

  /*
   * "cancelling" faqat foydalanuvchi haqiqatan ham
   * jarayonni bekor qilganda (× yoki "Yopish" tugmasi)
   * true bo'ladi — Duel/Xona/Play davom ettirilayotganda
   * (confirmStartTopicGame/confirmStartDuel/openRoomSetup)
   * `false` uzatiladi, shunda parda keyingi bosqichgacha
   * turib qoladi.
   */
  if (cancelling) {
    hideFlowShield();
  }
}

window.closeTopicIntroModal = closeTopicIntroModal;

function confirmStartTopicGame() {
  if (!pendingIntroTopic) return;

  const topic = pendingIntroTopic;

  closeTopicIntroModal(false);

  selectUserTopic(topic.id);

  startTopicGame(topic);
}

/* =========================================================
   DUEL REJIMI
========================================================= */

function createGuestDuelTeam(name) {
  return {
    id: "guest_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    participantId: null,
    name,
    image: "",
    score: 0,
    correctCount: 0,
    wrongCount: 0,
  };
}

function confirmStartDuel() {
  if (!pendingIntroTopic) return;

  let playerA = null;
  let playerB = null;

  if (teamsData.length === 2) {
    playerA = teamsData[0];
    playerB = teamsData[1];
  } else if (teamsData.length === 1) {
    /*
     * 1 ta ishtirokchi tanlangan —
     * ikkinchisi avtomatik
     * mehmon sifatida qo'shiladi.
     */
    playerA = teamsData[0];
    playerB = createGuestDuelTeam("Ishtirokchi 2");
  } else if (teamsData.length === 0) {
    /*
     * Ishtirokchi tanlanmagan —
     * ikkalasi ham avtomatik
     * "Ishtirokchi 1"/"Ishtirokchi 2"
     * nomi bilan boshlanadi.
     */
    playerA = createGuestDuelTeam("Ishtirokchi 1");

    playerB = createGuestDuelTeam("Ishtirokchi 2");
  } else {
    alert("Duel uchun 2 ta ishtirokchi tanlang (yoki hech kimni tanlamang)!");

    return;
  }

  const topic = pendingIntroTopic;

  closeTopicIntroModal(false);

  selectUserTopic(topic.id);

  startDuel(topic, playerA, playerB);
}

window.confirmStartDuel = confirmStartDuel;

/* =========================================================
   XONA REJIMI (LIVE ROOM) — "Kahoot uslubi"
   Har bir o'quvchi o'z telefonidan xona kodi bilan
   kirib, TO'LIQ AVTOMATIK ishlaydi — javob bersa ham,
   vaqt tugasa ham, o'zi mustaqil keyingi savolga
   o'tadi. Xona ochgan odam (host) ham o'zi ishtirokchi
   bo'lib o'ynaydi. Yakunida host boshqa mavzu tanlab,
   xuddi shu xonada davom ettira oladi.
========================================================= */

let myHostPlayerId = null;
let hostPlayerData = null;
let hostPlayerUnsub = null;
let hostLocalTimer = null;
let hostAdvanceLock = false;
let hostShowingReveal = false;
let hostCurrentTimerIndex = -1;
let roomTopicSwapMode = false;
let roomPickerTargetMode = "room";
let pendingRoomTopic = null;

/*
 * roomHostMode:
 *  "student"  — xona ochgan odam o'zi ham o'yinchi bo'lib qatnashadi (avvalgi standart holat)
 *  "teacher"  — xona ochgan odam faqat nazorat qiladi, o'zi savollarga javob bermaydi
 */
let roomHostMode = "student";

const ROOM_OPTION_CLASSES = ["optA", "optB", "optC", "optD"];

function generateRoomCodeCandidate() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ---------- 1-QADAM: ISM VA VAQTNI BELGILASH ----------
   Mehmon ham, ro'yxatdan o'tgan foydalanuvchi ham xona
   ochib, uni to'liq boshqarishi mumkin (boshlash, tugatish,
   mavzu almashtirish) — bunda u o'zi ham o'yinchi sifatida
   ishtirok etadi.
------------------------------------------------------------ */

function setRoomHostMode(mode) {
  roomHostMode = mode === "teacher" ? "teacher" : "student";

  const studentBtn = $("roomModeStudentBtn");
  const teacherBtn = $("roomModeTeacherBtn");

  studentBtn?.classList.toggle("active", roomHostMode === "student");

  teacherBtn?.classList.toggle("active", roomHostMode === "teacher");

  const nameHint = $("roomSetupNameHint");
  const nameLabel = $("roomSetupNameLabel");
  const nameInput = $("roomSetupName");

  if (roomHostMode === "teacher") {
    /*
     * Nazoratchi (teacher) rejimida xona egasi o'zi
     * o'ynamaydi — ism umuman kerak emas, shu sabab
     * butun ism maydoni yashiriladi.
     */
    if (nameHint) {
      nameHint.textContent = "Siz faqat xonani nazorat qilasiz — ism kiritish shart emas.";
      nameHint.style.display = "block";
    }

    if (nameLabel) {
      nameLabel.style.display = "none";
    }

    if (nameInput) {
      nameInput.style.display = "none";
      nameInput.required = false;
    }
  } else {
    if (nameHint) {
      nameHint.textContent =
        "Siz ham o‘yinchi sifatida ishtirok etasiz — shuning uchun ismingizni kiriting.";
      nameHint.style.display = "block";
    }

    if (nameLabel) {
      nameLabel.style.display = "block";
      nameLabel.textContent = "Sizning ismingiz";
    }

    if (nameInput) {
      nameInput.style.display = "block";
      nameInput.required = true;
    }
  }
}

window.setRoomHostMode = setRoomHostMode;

$("roomModeStudentBtn")?.addEventListener("click", () => setRoomHostMode("student"));

$("roomModeTeacherBtn")?.addEventListener("click", () => setRoomHostMode("teacher"));

function openRoomSetup() {
  if (!pendingIntroTopic) return;

  pendingRoomTopic = pendingIntroTopic;

  closeTopicIntroModal(false);

  const nameInput = $("roomSetupName");

  if (nameInput) {
    nameInput.value = auth.currentUser?.displayName || "";
  }

  /*
   * Mehmon (guest) foydalanuvchi ham, tizimga kirgan
   * foydalanuvchi ham xonani xohlagan rejimda (ishtirokchi
   * yoki nazoratchi) ochishi mumkin — login qilib kirgan
   * holatdan farqi bo'lmasligi kerak.
   */
  const modeRow = $("roomModeRow");

  if (modeRow) {
    modeRow.style.display = "block";
  }

  setRoomHostMode("student");

  const modal = $("roomSetupModal");

  if (modal) {
    modal.style.display = "flex";
  }

  setTimeout(() => nameInput?.focus(), 50);
}

window.openRoomSetup = openRoomSetup;

function closeRoomSetupModal(viaConfirm = false) {
  const modal = $("roomSetupModal");

  if (modal) {
    modal.style.display = "none";
  }

  /*
   * Mehmon (Jonli xona orqali kelgan) "Bekor qilish"
   * bossa — uning uchun ko'rsatiladigan boshqa hech
   * qanday ekran yo'q, index.html'ga qaytaramiz.
   */
  if (!viaConfirm) {
    hideFlowShield();
  }

  if (!viaConfirm && launchedFromIndex) {
    window.location.href = "index.html";
  }
}

window.closeRoomSetupModal = closeRoomSetupModal;

/* ---------- 2-QADAM: XONANI YARATISH ---------- */

async function confirmOpenRoom() {
  const topic = pendingRoomTopic;

  if (!topic) return;

  if (!db || !currentUserUid) {
    alert("Xona ochish uchun internetga ulanish va tizimga kirish kerak.");
    return;
  }

  /*
   * Nazoratchi (teacher) rejimida xona egasi o'zi
   * o'ynamaydi — shu sabab ism kiritish shart emas.
   */
  const isTeacherModeCandidate = roomHostMode === "teacher";

  const hostName = ($("roomSetupName")?.value || "").trim();

  if (!isTeacherModeCandidate && !hostName) {
    alert("Ismingizni kiriting!");
    return;
  }

  const roundSeconds = Math.min(120, Math.max(5, Number($("roomSetupTimer")?.value) || 10));

  let pool = [];

  Object.values(topic.questions || {}).forEach((category) => {
    if (!Array.isArray(category)) {
      return;
    }

    category.forEach((item) => {
      if (item) pool.push(item);
    });
  });

  if (pool.length < 2) {
    alert("Xona uchun mavzuda kamida 2 ta savol bo‘lishi kerak!");
    return;
  }

  pool = shuffleArray(pool).slice(0, 50);

  questions = questionsObjectToArray(topic.questions);

  const preparedQuestions = pool
    .map((item) => {
      const correctAnswer = String(item.a ?? item.answer ?? "").trim();

      const qText = String(item.q ?? item.question ?? "").trim();

      const options = buildAnswerOptions(correctAnswer, item);

      return {
        q: qText,
        options,
        correct: correctAnswer,
      };
    })
    .filter((q) => q.q && q.correct && q.options.length >= 2);

  if (preparedQuestions.length < 2) {
    alert("Savollarni tayyorlashda xatolik — mavzuda yetarli javob variantlari yo‘q.");
    return;
  }

  closeRoomSetupModal(true);

  /*
   * Xona yaratish bir nechta Firestore so'rovini
   * (kod tekshirish, tozalash, yozish) o'z ichiga oladi
   * — shu payt hech qanday bosqich oynasi ko'rinmaydi,
   * shu sabab parda spinner/matn bilan ko'rsatiladi (board
   * hech qachon "yalang'och" ko'rinib qolmaydi).
   */
  showFlowLoading("Xona tayyorlanmoqda...");

  /*
   * MUHIM (XATOLIK TUZATILDI): oldin, agar xona kodi
   * band-emasligini tekshirish (getDoc) tarmoq xatosi
   * tufayli muvaffaqiyatsiz bo'lsa, kod TEKSHIRILMAGAN
   * holda "bo'sh" deb qabul qilinar edi. Natijada yangi
   * xona ESKI (masalan, allaqachon "finished" bo'lgan)
   * xona kodi bilan to'qnashishi mumkin edi — xona
   * hujjatining o'zi qayta yozilsa-da (status: "lobby"),
   * o'sha eski xonaning "players" pastki to'plami
   * tozalanmay qolardi. Shu sabab yangi qo'shilgan
   * o'yinchi ba'zan o'yin boshlanmasdan turib "yakunlandi"
   * holatiga duch kelishi mumkin edi.
   *
   * Endi: xatolik bo'lsa kod TASODIFIY deb qabul
   * qilinmaydi — qayta urinib ko'riladi, va nechta
   * urinishda ham tasdiqlab bo'lmasa, foydalanuvchiga
   * aniq xatolik ko'rsatiladi (yashirin to'qnashuv emas).
   */
  let code = null;

  for (let i = 0; i < 10; i++) {
    const candidate = generateRoomCodeCandidate();

    try {
      const snap = await getDoc(doc(db, "rooms", candidate));

      if (!snap.exists()) {
        code = candidate;
        break;
      }
    } catch (e) {
      console.warn("room code check:", e);
      // Tasdiqlanmagan kodni ISHLATMAYMIZ — keyingi
      // urinishga o'tamiz.
    }
  }

  if (!code) {
    hideFlowShield();
    alert(
      "Xona kodi yaratib bo‘lmadi (internet aloqasi beqaror bo‘lishi mumkin), qayta urinib ko‘ring.",
    );
    return;
  }

  /*
   * QO'SHIMCHA XAVFSIZLIK: kod haqiqatda bo'sh bo'lsa
   * ham, ehtiyot shart sifatida shu kod ostida eskirib
   * qolgan "players" hujjatlari bo'lsa — tozalab
   * tashlaymiz, shunda yangi xona har doim TOZA holatda
   * boshlanadi.
   */
  try {
    const stalePlayersSnap = await getDocs(collection(db, "rooms", code, "players"));

    if (!stalePlayersSnap.empty) {
      const batch = writeBatch(db);

      stalePlayersSnap.docs.forEach((d) => batch.delete(d.ref));

      await batch.commit();
    }
  } catch (e) {
    console.warn("stale players cleanup:", e);
  }

  /*
   * MUHIM TUZATISH: bu yerda XONA (rooms) uchun ball qadami
   * ishlatilyapti — bu xona index.html orqali qo'shiladigan
   * BOSHQA ishtirokchilarga ham umumiy (jonli) ko'rinadi.
   * Shu sabab bu qiymat albatta ADMIN PANELIDAGI global
   * standartdan (settings/app) olinishi SHART — xost
   * qurilmasida localStorage'da saqlangan SHAXSIY (faqat shu
   * qurilma/foydalanuvchi uchun) pointStep sozlamasi xonaga
   * hech qachon ko'chib o'tmasligi kerak (avvalgi xato aynan
   * shu edi). Global sozlamalar fetchAppSettingsOnce() orqali
   * keshlangani uchun bu qo'shimcha so'rov qo'shimcha tarmoq
   * xarajati qilmaydi.
   */
  const roomDefaults = await getAppDefaults();
  const step = roomDefaults.pointStep;

  /*
   * Mehmon (guest) foydalanuvchi ham nazoratchi
   * (teacher) rejimida xona ochishi mumkin — login
   * qilgan foydalanuvchi bilan bir xil imkoniyat.
   */
  const isTeacherMode = roomHostMode === "teacher";

  myHostPlayerId = isTeacherMode
    ? null
    : "host_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  try {
    await setDoc(doc(db, "rooms", code), {
      hostUid: currentUserUid,
      hostPlayerId: myHostPlayerId,
      hostMode: isTeacherMode ? "teacher" : "student",
      status: "lobby",
      roundId: 1,
      /*
       * SINXRON REJIM: xonadagi HAMMA uchun BITTA
       * umumiy joriy savol bo'ladi. Har bir o'yinchi
       * o'z-o'zicha ilgarilamaydi — hammasi javob
       * berganda yoki vaqt tugaganda xona egasi
       * (host) currentIndex'ni bittaga oshiradi.
       */
      currentIndex: 0,
      questionStartedAt: null,
      roundSeconds,
      pointStep: step,
      topicTitle: topic.title || "Mavzu",
      questions: preparedQuestions,
      totalQuestions: preparedQuestions.length,
      createdAt: Date.now(),
      /*
       * XONALAR CHEKSIZ TO'PLANIB QOLMASLIGI UCHUN:
       * bu maydon Firestore'ning o'zining "TTL
       * (Time To Live)" siyosati bilan ishlatiladi —
       * shunda hujjat muddati o'tgach, Firestore
       * uni SERVER TOMONIDA o'zi avtomatik o'chiradi,
       * hech qanday qurilma ochiq turishi shart emas.
       * (Firebase Console → Firestore → TTL siyosati
       * "rooms" kolleksiyasi uchun "expiresAt"
       * maydoniga ulanishi kerak — bir martalik sozlash.)
       */
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    });

    if (!isTeacherMode) {
      await setDoc(doc(db, "rooms", code, "players", myHostPlayerId), {
        uid: currentUserUid,
        name: hostName,
        /*
         * BALLIK REJIM YO'Q — reyting nechta to'g'ri
         * javob va qancha tez javob berilgani bo'yicha
         * hisoblanadi.
         */
        correctCount: 0,
        wrongCount: 0,
        totalTimeMs: 0,
        roundId: 1,
        answeredIndex: -1,
        finishedRound: false,
        lastAnswerChoice: null,
        lastAnswerCorrect: null,
        joinedAt: Date.now(),
        isHost: true,
      });
    }
  } catch (e) {
    hideFlowShield();

    console.error("Xona yaratishda xatolik:", e);

    alert("⚠️ Xona yaratilmadi: " + (e?.message || e));

    return;
  }

  roomCode = code;
  pendingRoomTopic = null;

  roomHostChatSenderId = isTeacherMode ? "host_teacher" : myHostPlayerId;

  roomHostChatName = (!isTeacherMode && hostName) || auth.currentUser?.displayName || "Nazoratchi";

  openRoomHostView();
  subscribeRoomDoc();
  subscribeRoomPlayers();
  subscribeRoomHostChat();

  if (!isTeacherMode) {
    subscribeHostPlayerDoc();
  }
}

window.confirmOpenRoom = confirmOpenRoom;

/* ---------- HAVOLANI NUSXALASH ---------- */

function copyRoomJoinLink(btn) {
  const input = $("roomJoinLinkInput");

  if (!input) return;

  input.select();
  input.setSelectionRange(0, 99999);

  const finish = (ok) => {
    if (!ok || !btn) return;

    const original = btn.textContent;

    btn.textContent = "✅ Nusxalandi!";

    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(input.value)
      .then(() => finish(true))
      .catch(() => {
        try {
          document.execCommand("copy");
          finish(true);
        } catch {
          alert("Nusxalab bo‘lmadi — havolani qo‘lda tanlab, nusxalang.");
        }
      });
  } else {
    try {
      document.execCommand("copy");
      finish(true);
    } catch {
      alert("Nusxalab bo‘lmadi — havolani qo‘lda tanlab, nusxalang.");
    }
  }
}

window.copyRoomJoinLink = copyRoomJoinLink;

/* ---------- JONLI TINGLASH ---------- */

function subscribeRoomDoc() {
  if (!roomCode) return;

  roomUnsubDoc?.();

  roomUnsubDoc = onSnapshot(
    doc(db, "rooms", roomCode),
    (snap) => {
      if (!snap.exists()) {
        roomData = null;
        return;
      }

      const prevRoundId = roomData?.roundId;

      roomData = snap.data();

      /*
       * XATOLIK TUZATILDI: avval bu tekshiruv faqat
       * host o'zining player hujjatini kuzatuvchi
       * subscribeHostPlayerDoc() ichida edi. Lekin
       * swapRoomTopic() faqat XONA hujjatini
       * yangilaydi, host o'zining player hujjatini
       * emas — shuning uchun o'sha listener HECH
       * QACHON qayta ishga tushmas, va host doimiy
       * "Yangi mavzu tayyorlanmoqda..." holatida
       * qolib ketardi. Endi aynan shu — XONA hujjati
       * o'zgarganda — darhol reset qilinadi.
       */
      if (
        roomHostMode === "student" &&
        myHostPlayerId &&
        hostPlayerData &&
        prevRoundId != null &&
        roomData.roundId !== prevRoundId &&
        hostPlayerData.roundId !== roomData.roundId
      ) {
        resetHostRoundProgress();
      } else {
        renderRoomHostView();
        maybeAutoAdvance();
      }
    },
    (e) => console.warn("room doc listen:", e),
  );
}

function subscribeRoomPlayers() {
  if (!roomCode) return;

  roomUnsubPlayers?.();

  roomUnsubPlayers = onSnapshot(
    collection(db, "rooms", roomCode, "players"),
    (snap) => {
      roomPlayers = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      renderRoomHostView();
      maybeAutoAdvance();
    },
    (e) => console.warn("room players listen:", e),
  );
}

function subscribeHostPlayerDoc() {
  if (!roomCode || !myHostPlayerId) {
    return;
  }

  hostPlayerUnsub?.();

  hostPlayerUnsub = onSnapshot(
    doc(db, "rooms", roomCode, "players", myHostPlayerId),
    (snap) => {
      const prevRoundId = hostPlayerData?.roundId;

      hostPlayerData = snap.exists() ? snap.data() : null;

      if (
        roomData &&
        hostPlayerData &&
        hostPlayerData.roundId !== roomData.roundId &&
        prevRoundId != null
      ) {
        resetHostRoundProgress();
      } else {
        renderRoomHostView();
      }
    },
    (e) => console.warn("host player listen:", e),
  );
}

async function resetHostRoundProgress() {
  hostCurrentTimerIndex = -1;

  try {
    await updateDoc(doc(db, "rooms", roomCode, "players", myHostPlayerId), {
      roundId: roomData.roundId,
      answeredIndex: -1,
      finishedRound: false,
      correctCount: 0,
      wrongCount: 0,
      totalTimeMs: 0,
      lastAnswerChoice: null,
      lastAnswerCorrect: null,
    });
  } catch (e) {
    console.warn("host round reset:", e);
  }
}

/* ---------- OYNANI OCHISH / YOPISH ---------- */

function openRoomHostView() {
  const modal = $("roomHostModal");

  if (modal) {
    modal.style.display = "flex";
  }

  hideFlowShield();
}

function hideRoomHostViewOnly() {
  const modal = $("roomHostModal");

  if (modal) {
    modal.style.display = "none";
  }
}

function closeRoomHostView() {
  roomUnsubDoc?.();
  roomUnsubPlayers?.();
  hostPlayerUnsub?.();
  roomChatUnsub?.();

  roomUnsubDoc = null;
  roomUnsubPlayers = null;
  hostPlayerUnsub = null;
  roomChatUnsub = null;
  roomChatMessages = [];

  clearHostLocalTimer();
  hostCurrentTimerIndex = -1;
  hostAdvancing = false;
  roomWinnerModalShownFor = null;

  const modal = $("roomHostModal");

  if (modal) {
    modal.style.display = "none";
  }

  /*
   * Ro'yxatdan o'tgan foydalanuvchi xonani yopganda,
   * o'zining oddiy o'yin sahifasini (board) qaytadan
   * ko'rishi kerak (mehmon uchun bu shart emas — u
   * baribir index.html'ga qaytariladi).
   */
  if (!guestQuickLaunch) {
    document.body.classList.remove("guestQuickLaunchMode");
  }

  roomCode = null;
  roomData = null;
  roomPlayers = [];
  myHostPlayerId = null;
  hostPlayerData = null;
  roomTopicSwapMode = false;
  roomHostMode = "student";

  $("roomChatBox")?.classList.add("hidden");

  setRoomSwapBanner(false);

  hideFlowShield();
}

/*
 * XONA VA UNING ISHTIROKCHILAR SUB-KOLLEKSIYASINI
 * TO'LIQ O'CHIRISH — umumiy (qayta ishlatiladigan)
 * funksiya. Buni ham "Xonani yopish" tugmasi, ham
 * quyidagi avtomatik tozalash (cleanup) chaqiradi.
 */
async function deleteRoomAndPlayers(codeToDelete) {
  if (!codeToDelete) return;

  try {
    const playersSnap = await getDocs(collection(db, "rooms", codeToDelete, "players"));

    const batch = writeBatch(db);

    playersSnap.docs.forEach((d) => batch.delete(d.ref));

    batch.delete(doc(db, "rooms", codeToDelete));

    await batch.commit();
  } catch (e) {
    console.warn("room cleanup:", e);
  }
}

/*
 * ESKI, TASHLAB KETILGAN XONALARNI FONDA TOZALASH.
 *
 * MUAMMO: agar xona egasi "Xonani yopish" tugmasini
 * bosmasdan shunchaki brauzerni yopib ketsa (yoki
 * ilova o'zi keyingi safar ochilganda), xona hujjati
 * Firestore'da ABADIY qolib ketaverardi — vaqt o'tishi
 * bilan bunday "o'lik" xonalar to'planib, ma'lumotlar
 * bazasi hajmiga ta'sir qilishi mumkin.
 *
 * Bu funksiya ilova ochilganda (fonda, UI'ni kutdirmasdan)
 * "createdAt"i ROOM_STALE_MS'dan eski bo'lgan bir nechta
 * xonani topib, ularni ishtirokchilari bilan birga
 * o'chiradi. Bu — QO'SHIMCHA/yordamchi chora: eng ishonchli
 * yechim — Firebase Console → Firestore → "TTL siyosati"
 * bo'limida "rooms" kolleksiyasi uchun "expiresAt" maydonini
 * yoqish, shunda Firestore o'zi SERVER TOMONIDA muddati
 * o'tgan xonalarni avtomatik o'chiradi (bu kodning ishlab-
 * ishlamasligidan qat'iy nazar).
 *
 * ESLATMA: agar Firestore xavfsizlik qoidalarida "rooms"
 * kolleksiyasini ro'yxatlash (list/query) cheklangan bo'lsa,
 * bu funksiya sokin ravishda hech narsa qilmaydi (xatolik
 * consolega yoziladi, lekin ilovaga ta'sir qilmaydi).
 */
const ROOM_STALE_MS = 12 * 60 * 60 * 1000; // 12 soat

async function cleanupStaleRoomsOnce() {
  if (!db) return;

  try {
    const staleBefore = Date.now() - ROOM_STALE_MS;

    const staleQuery = query(
      collection(db, "rooms"),
      where("createdAt", "<", staleBefore),
      limit(15),
    );

    const snap = await getDocs(staleQuery);

    if (snap.empty) return;

    for (const roomDoc of snap.docs) {
      await deleteRoomAndPlayers(roomDoc.id);
    }
  } catch (e) {
    console.warn("stale rooms cleanup:", e);
  }
}

async function endRoomAndDelete() {
  if (!roomCode) {
    closeRoomHostView();

    if (launchedFromIndex) {
      window.location.href = "index.html";
    }

    return;
  }

  if (!confirm("Xonani yopasizmi? Barcha ma’lumotlar o‘chiriladi.")) {
    return;
  }

  const codeToDelete = roomCode;

  closeRoomHostView();

  await deleteRoomAndPlayers(codeToDelete);

  if (launchedFromIndex) {
    window.location.href = "index.html";
  }
}

window.endRoomAndDelete = endRoomAndDelete;

/* ---------- O'YINNI BOSHLASH (birinchi raund) ---------- */

async function hostStartRoom() {
  if (!roomCode || !roomData) {
    return;
  }

  try {
    await updateDoc(doc(db, "rooms", roomCode), {
      status: "playing",
      currentIndex: 0,
      questionStartedAt: Date.now(),
    });
  } catch (e) {
    console.warn("start room:", e);
  }
}

window.hostStartRoom = hostStartRoom;

/* ---------- BOSHQA MAVZU TANLAB DAVOM ETTIRISH ---------- */

/* ---------- SINXRON OQIM: HAMMA JAVOB BERGANMI? ---------- */

function allActivePlayersAnsweredIndex(idx) {
  if (!roomPlayers.length) return false;

  return roomPlayers.every((p) => (Number(p.answeredIndex) ?? -1) >= idx);
}

let hostAdvancing = false;

/*
 * XONANI KEYINGI SAVOLGA (yoki yakunga) O'TKAZISH.
 * Buni FAQAT xona egasi (bu qurilma) chaqiradi — u
 * "teacher" (faqat nazorat) yoki "student" (o'zi ham
 * o'ynaydigan) rejimda bo'lishidan qat'iy nazar, u
 * doim xonada bo'lgani uchun aynan shu qurilma butun
 * xonaning "soatini" boshqaradi.
 */
async function hostAdvanceRoom(fromIndex) {
  if (!roomCode || !roomData) return;
  if (hostAdvancing) return;
  if (roomData.currentIndex !== fromIndex) return;

  hostAdvancing = true;

  clearHostLocalTimer();

  const nextIndex = fromIndex + 1;
  const isDone = nextIndex >= roomData.totalQuestions;

  try {
    await updateDoc(
      doc(db, "rooms", roomCode),
      isDone
        ? { status: "finished" }
        : {
            currentIndex: nextIndex,
            questionStartedAt: Date.now(),
          },
    );
  } catch (e) {
    console.warn("room advance:", e);
  }

  hostAdvancing = false;
}

/*
 * QO'LDA YAKUNLASH: agar biror ishtirokchi javob
 * bermay uzoq kutib qolinsa — nazoratchi (yoki
 * o'yin boshlovchi) joriy savolni HAMMA javob
 * berishini kutmasdan, qo'lda keyingi savolga (yoki
 * yakunga) o'tkazishi mumkin. Javob bermagan
 * ishtirokchilar "javobsiz/xato" deb hisoblanadi —
 * bu ularning o'z tarafida (play.js) avtomatik
 * ravishda amalga oshadi.
 */
function hostForceAdvanceRound() {
  if (!roomData) return;
  if (roomData.status !== "playing") return;

  const idx = roomData.currentIndex || 0;

  hostAdvanceRoom(idx);
}

window.hostForceAdvanceRound = hostForceAdvanceRound;

/*
 * Har safar o'yinchilar ro'yxati yoki xona hujjati
 * yangilanganda tekshiramiz: joriy savolga HAMMA javob
 * berib bo'ldimi? Bo'lsa — avtomatik ravishda keyingi
 * savolga (yoki yakunga) o'tkazamiz.
 */
function maybeAutoAdvance() {
  if (!roomData) return;
  if (roomData.status !== "playing") return;

  const idx = roomData.currentIndex || 0;

  if (allActivePlayersAnsweredIndex(idx)) {
    hostAdvanceRoom(idx);
  }
}

function startRoomTopicSwap() {
  if (!roomCode) return;

  /*
   * Bu tugma endi FAQAT xona "finished" (butunlay
   * yakunlangan) holatda ko'rsatiladi — shu sabab
   * "hammasi javob berdimi" tekshiruvi shart emas.
   */

  roomTopicSwapMode = true;

  /*
   * Xona egasi allaqachon xonada — mavzu almashtirish
   * jarayonida ham board/orqa fon ko'rinib qolmasligi
   * uchun parda yoqiladi (roomTopicPicker va undan keyingi
   * Firestore yozuvi tugagunga qadar).
   */
  showFlowShield();

  hideRoomHostViewOnly();

  setRoomSwapBanner(true);

  /*
   * Kartalar taxtasi o'rniga — xuddi xona ochishdagi
   * kabi qidiruvli RO'YXATdan yangi mavzu tanlash
   * imkonini beramiz.
   */
  openRoomTopicPicker();
}

window.startRoomTopicSwap = startRoomTopicSwap;

function cancelRoomTopicSwap() {
  roomTopicSwapMode = false;

  setRoomSwapBanner(false);

  if (roomCode) {
    openRoomHostView();
  }
}

window.cancelRoomTopicSwap = cancelRoomTopicSwap;

function setRoomSwapBanner(show) {
  const banner = $("roomSwapBanner");

  if (banner) {
    banner.style.display = show ? "flex" : "none";
  }
}

async function swapRoomTopic(topic) {
  roomTopicSwapMode = false;

  setRoomSwapBanner(false);

  if (!roomCode || !topic) {
    openRoomHostView();
    return;
  }

  let pool = [];

  Object.values(topic.questions || {}).forEach((category) => {
    if (!Array.isArray(category)) {
      return;
    }

    category.forEach((item) => {
      if (item) pool.push(item);
    });
  });

  if (pool.length < 2) {
    alert("Bu mavzuda kamida 2 ta savol bo‘lishi kerak!");

    openRoomHostView();

    return;
  }

  pool = shuffleArray(pool).slice(0, 50);

  questions = questionsObjectToArray(topic.questions);

  const preparedQuestions = pool
    .map((item) => {
      const correctAnswer = String(item.a ?? item.answer ?? "").trim();

      const qText = String(item.q ?? item.question ?? "").trim();

      const options = buildAnswerOptions(correctAnswer, item);

      return {
        q: qText,
        options,
        correct: correctAnswer,
      };
    })
    .filter((q) => q.q && q.correct && q.options.length >= 2);

  if (preparedQuestions.length < 2) {
    alert("Savollarni tayyorlashda xatolik.");

    openRoomHostView();

    return;
  }

  const newRoundId = (roomData?.roundId || 1) + 1;

  showFlowLoading("Mavzu almashtirilmoqda...");

  try {
    hostAdvancing = false;

    await updateDoc(doc(db, "rooms", roomCode), {
      topicTitle: topic.title || "Mavzu",
      questions: preparedQuestions,
      totalQuestions: preparedQuestions.length,
      roundId: newRoundId,
      currentIndex: 0,
      /*
       * MUHIM (XATOLIK TUZATILDI): bu yerda "status"
       * yangilanmagani uchun, agar oldingi raund
       * "finished" bo'lgan bo'lsa, yangi mavzu/savollar
       * yozilgan bo'lsa ham xona STATUS'i hamon
       * "finished" bo'lib qolar edi. Natijada yangi
       * raund savollari umuman ochilmasdan, xona yana
       * bir zumda "yakunlandi" holatida ko'rinar edi.
       * Endi status har doim "playing"ga qaytariladi.
       */
      status: "playing",
      questionStartedAt: Date.now(),
      /*
       * Xona hali FAOL ishlatilyapti — TTL muddatini
       * yana 24 soatga uzaytiramiz.
       */
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    });
  } catch (e) {
    console.error("Mavzu almashtirishda xatolik:", e);

    alert("⚠️ Mavzu almashtirilmadi: " + (e?.message || e));
  }

  openRoomHostView();
}

/* ---------- TAYMER (host uchun, mustaqil) ---------- */

function startHostLocalTimer(startedAt) {
  clearHostLocalTimer();

  const duration = Number(roomData.roundSeconds) || 10;

  const idxAtStart = roomData.currentIndex || 0;

  const tick = () => {
    const elapsed = (Date.now() - startedAt) / 1000;

    const left = Math.max(0, Math.ceil(duration - elapsed));

    const ring = $("roomTimerRing");

    if (ring) {
      ring.textContent = left;
    }

    if (left <= 0) {
      clearHostLocalTimer();

      /*
       * MUHIM (XATOLIK TUZATILDI): agar xonada HALI
       * HECH KIM (bironta ishtirokchi ham) bo'lmasa —
       * ayniqsa NAZORATCHI (teacher) rejimida, chunki u
       * o'zi o'ynamaydi — taymer tugashi bilan savolni
       * "kutuvchisiz" majburiy o'tkazib yubormaymiz.
       * Aks holda: nazoratchi xonani ochib "start"
       * bossa-yu, ishtirokchilar hali ulgurib
       * qo'shilmagan bo'lsa, butun o'yin ULAR
       * QO'SHILISHIDAN OLDIN, hech kim javob bermasdan
       * turib "yakunlandi" holatiga o'tib qolar edi.
       * Shu sabab: xonada kamida bitta ishtirokchi
       * paydo bo'lgunicha — shu savol uchun taymer
       * shunchaki qayta boshlanadi (kutish davom etadi).
       */
      if (!roomPlayers.length) {
        (async () => {
          try {
            await updateDoc(doc(db, "rooms", roomCode), {
              questionStartedAt: Date.now(),
            });
          } catch (e) {
            console.warn("timer restart (empty room):", e);
          }

          startHostLocalTimer(Date.now());
        })();

        return;
      }

      /*
       * Vaqt tugadi. Agar xona egasi o'zi ham o'ynasa
       * (student rejimi) va hali javob bermagan bo'lsa —
       * o'zi uchun "javobsiz/xato" deb yozamiz. Keyin,
       * boshqalar javob berganmi yoki yo'qmi — baribir
       * XONANI KEYINGI SAVOLGA MAJBURIY o'tkazamiz, chunki
       * taymerning vazifasi aynan shu (hech kim abadiy
       * kutib qolmasligi kerak).
       */
      if (
        roomHostMode === "student" &&
        hostPlayerData &&
        (hostPlayerData.answeredIndex ?? -1) < idxAtStart &&
        !hostAdvanceLock
      ) {
        hostSubmitAnswer(null);
      }

      hostAdvanceRoom(idxAtStart);
    }
  };

  tick();

  hostLocalTimer = setInterval(tick, 250);
}

function clearHostLocalTimer() {
  if (hostLocalTimer) {
    clearInterval(hostLocalTimer);
  }

  hostLocalTimer = null;
}

/* ---------- JAVOB BERISH (host o'zi ham o'ynaydi) ---------- */

async function hostSubmitAnswer(choiceText) {
  if (hostAdvanceLock || !hostPlayerData || !roomData) {
    return;
  }

  hostAdvanceLock = true;

  clearHostLocalTimer();

  document.querySelectorAll("#roomAnswerButtons .qOptionBtn").forEach((b) => (b.disabled = true));

  const idx = roomData.currentIndex || 0;

  const q = roomData.questions[idx];

  const isCorrect = choiceText != null && choiceText === q.correct;

  const roundMs = (Number(roomData.roundSeconds) || 10) * 1000;

  const responseMs = Math.min(Date.now() - (roomData.questionStartedAt || Date.now()), roundMs);

  const isDone = idx >= roomData.totalQuestions - 1;

  const updatedLocal = {
    ...hostPlayerData,

    correctCount: (Number(hostPlayerData.correctCount) || 0) + (isCorrect ? 1 : 0),

    wrongCount: (Number(hostPlayerData.wrongCount) || 0) + (isCorrect ? 0 : 1),

    totalTimeMs: (Number(hostPlayerData.totalTimeMs) || 0) + responseMs,

    answeredIndex: idx,

    finishedRound: isDone,
  };

  hostPlayerData = updatedLocal;

  showHostRevealLocal(isCorrect, q.correct);

  try {
    await updateDoc(doc(db, "rooms", roomCode, "players", myHostPlayerId), {
      correctCount: updatedLocal.correctCount,
      wrongCount: updatedLocal.wrongCount,
      totalTimeMs: updatedLocal.totalTimeMs,
      answeredIndex: updatedLocal.answeredIndex,
      finishedRound: updatedLocal.finishedRound,
      lastAnswerChoice: choiceText,
      lastAnswerCorrect: isCorrect,
    });
  } catch (e) {
    console.warn("host javob saqlash:", e);
  }
}

function showHostRevealLocal(isCorrect, correctText) {
  hostShowingReveal = true;

  const box = $("roomHostContent");

  if (box) {
    box.innerHTML = `
      <div class="roomRevealBox">

        <div class="revealMark ${isCorrect ? "isCorrect" : "isWrong"}">
          ${isCorrect ? "✅" : "❌"}
        </div>

        <div class="revealCorrectAnswer">
          To‘g‘ri javob: <strong>${escapeHtml(correctText)}</strong>
        </div>

        <div class="revealScoreCard">
          <span class="revealScoreLabel">TO‘G‘RI JAVOBLAR</span>
          <strong class="revealScoreValue">${hostPlayerData?.correctCount || 0} / ${(hostPlayerData?.answeredIndex ?? 0) + 1}</strong>
        </div>

      </div>
    `;
  }

  setTimeout(() => {
    hostShowingReveal = false;
    renderRoomHostView();
  }, 1000);
}

/* ---------- YORDAMCHI: REYTING TARTIBI ----------
   Ballik emas — avval ko'proq TO'G'RI javob bergan,
   teng bo'lsa TEZROQ javob bergan yuqorida turadi.
------------------------------------------------------ */

function rankRoomPlayers(players) {
  return [...players].sort((a, b) => {
    const ac = Number(a.correctCount) || 0;
    const bc = Number(b.correctCount) || 0;

    if (bc !== ac) return bc - ac;

    const at = Number(a.totalTimeMs) || 0;
    const bt = Number(b.totalTimeMs) || 0;

    return at - bt;
  });
}

/* ---------- JONLI REYTING (faqat yakunda to'liq ko'rsatiladi) ---------- */

function renderRoomLiveLeaderboardInto(containerId) {
  const el = $(containerId);

  if (!el) return;

  const sorted = rankRoomPlayers(roomPlayers);

  el.innerHTML = sorted
    .map(
      (p, i) => `
        <div class="roomLeaderRow${p.id === myHostPlayerId ? " isRoomWinner" : ""}">
          <span>${i === 0 ? "🏆" : "#" + (i + 1)}</span>
          <strong>${escapeHtml(p.name)}${p.isHost ? " 👑" : ""}</strong>
          <span class="roomLeaderScore">✅${p.correctCount || 0} · ❌${p.wrongCount || 0}</span>
          <span class="roomLeaderMark">${p.finishedRound ? "✅" : "⏳"}</span>
        </div>
      `,
    )
    .join("");
}

/* ---------- ISHTIROKCHILAR (savol paytida, natijasiz) ----------
   O'yin davomida hech kimning to'g'ri/xato javobi yoki
   reytingi ko'rsatilmaydi — faqat kim javob berib
   ulgurgani (✅) va kim hali kutayotgani (⏳). Bu qiziqish
   uyg'otadi, natija esa faqat yakunda e'lon qilinadi.
------------------------------------------------------ */

function renderRoomQuestionParticipants(containerId, idx) {
  const el = $(containerId);

  if (!el) return;

  if (!roomPlayers.length) {
    el.innerHTML = `<span class="introEmpty">Hali hech kim qo‘shilmadi...</span>`;
    return;
  }

  el.innerHTML = roomPlayers
    .map((p) => {
      const answered = (Number(p.answeredIndex) ?? -1) >= idx;

      return `<span class="roomPlayerChip${answered ? " answered" : ""}">${escapeHtml(p.name)}${
        p.isHost ? " 👑" : ""
      } ${answered ? "✅" : "⏳"}</span>`;
    })
    .join("");
}

/* ---------- EKRANLARNI CHIZISH ---------- */

function renderRoomHostView() {
  const box = $("roomHostContent");

  if (!box || !roomData) return;

  updateRoomChatVisibility(roomData.status);

  if (hostShowingReveal) return;

  const joinUrl = new URL("index.html?code=" + roomCode, window.location.href).href;

  /*
   * XONA KODI/HAVOLASI ENDI FAQAT LOBBY (o'yin
   * boshlanishidan oldin) EKRANIDA ko'rsatiladi —
   * o'yin boshlangach kerak emas, chunki hamma
   * allaqachon qo'shilib bo'lgan.
   */
  if (roomData.status === "lobby") {
    renderRoomLobbyView(box, joinUrl);
    return;
  }

  if (roomData.status === "finished") {
    renderRoomWinnerView(box);
    return;
  }

  const idx = roomData.currentIndex || 0;

  /*
   * Xona egasi qaysi rejimda bo'lishidan (o'qituvchi
   * yoki o'quvchi) qat'iy nazar — aynan shu qurilma
   * butun xonaning umumiy taymerini yuritadi va
   * hammasi javob berganda keyingi savolga o'tkazadi.
   */
  ensureHostTimerRunning(idx);

  /*
   * O'QITUVCHI (nazorat) rejimi: bu odam o'zi
   * o'yinchi emas — lekin ENDI savol va variantlarni
   * (faqat ko'rish uchun, bosib bo'lmaydi) ko'radi,
   * shuningdek kim javob berganini kuzatadi.
   */
  if (roomHostMode === "teacher") {
    renderTeacherMonitorView(box, idx);
    return;
  }

  if (!hostPlayerData) {
    box.innerHTML = `<div class="roomLoadingNote">Yuklanmoqda...</div>`;
    return;
  }

  if (hostPlayerData.roundId !== roomData.roundId) {
    box.innerHTML = `<div class="roomLoadingNote">Yangi mavzu tayyorlanmoqda...</div>`;
    return;
  }

  /*
   * Xona egasi (o'quvchi rejimida) joriy savolga
   * ALLAQACHON javob bergan bo'lsa — u boshqalarni
   * kutadi (savol/variantlar hali ko'rinadi, lekin
   * bosib bo'lmaydi).
   */
  if ((hostPlayerData.answeredIndex ?? -1) >= idx) {
    renderHostWaitingView(box, idx);
    return;
  }

  renderRoomQuestionView(box, idx);
}

function ensureHostTimerRunning(idx) {
  if (hostCurrentTimerIndex !== idx) {
    hostCurrentTimerIndex = idx;
    hostAdvanceLock = false;

    const startedAt = roomData.questionStartedAt || Date.now();

    startHostLocalTimer(startedAt);
  }
}

/* ---------- O'QITUVCHI (NAZORAT) PANELI ----------
   Savol va variantlarni ko'rsatadi (faqat ko'rish
   uchun — o'qituvchi javob bermaydi), shuningdek
   kim javob berganini (natijasiz) kuzatadi. Hammasi
   javob berganda yoki vaqt tugaganda — AVTOMATIK
   ravishda keyingi savolga o'tadi.
------------------------------------------------------ */

function renderTeacherMonitorView(box, idx) {
  const q = roomData.questions?.[idx];

  if (!q) return;

  const answeredCount = roomPlayers.filter((p) => (Number(p.answeredIndex) ?? -1) >= idx).length;

  box.innerHTML = `
    <div class="roomQuestionHead">
      <span class="roomRoundLabel">SAVOL ${idx + 1}/${roomData.totalQuestions}</span>
      <span class="roomTimerRing" id="roomTimerRing">${roomData.roundSeconds || 10}</span>
      <span class="roomAnsweredCount">${answeredCount}/${roomPlayers.length} javob berdi</span>
    </div>

    <div class="roomQuestionText">${escapeHtml(q.q || "")}</div>

    <div class="roomAnswerButtons" id="roomAnswerButtons">
      ${(q.options || [])
        .map(
          (opt, i) =>
            `<button type="button" disabled class="qOptionBtn ${
              ROOM_OPTION_CLASSES[i] || "optA"
            }">${escapeHtml(opt)}</button>`,
        )
        .join("")}
    </div>

    <div class="roomLiveMini">
      <div class="roomLiveMiniHead">
        <span class="toolTitle">👥 Ishtirokchilar (${roomPlayers.length})</span>
      </div>
      <div id="roomHostParticipants" class="roomPlayerChips"></div>
    </div>

    <div class="roomLiveMini">
      ${roomLiveMiniHeaderHtml("📊 Jonli reyting (faqat sizga ko‘rinadi)")}
      <div id="roomHostLiveLeaderboardPlaying" class="roomLeaderboard"></div>
    </div>

    <div class="modalActions">
      <button class="bigBtn secondaryBtn" onclick="endRoomAndDelete()">Xonani yopish</button>
      <button class="bigBtn primaryBtn" onclick="hostForceAdvanceRound()" title="Kimdir javob bermay uzoq kutib qolinsa, savolni majburan yakunlab, keyingisiga o‘tkazadi">⏭ Savolni yakunlash</button>
    </div>
  `;

  renderRoomQuestionParticipants("roomHostParticipants", idx);

  renderRoomLiveLeaderboardInto("roomHostLiveLeaderboardPlaying");
}

function renderHostWaitingView(box, idx) {
  const q = roomData.questions?.[idx];

  if (!q) return;

  box.innerHTML = `
    <div class="roomQuestionHead">
      <span class="roomRoundLabel">SAVOL ${idx + 1}/${roomData.totalQuestions}</span>
      <span class="roomTimerRing" id="roomTimerRing">${roomData.roundSeconds || 10}</span>
      <span class="roomAnsweredCount">✅ ${hostPlayerData.correctCount || 0} · ❌ ${hostPlayerData.wrongCount || 0}</span>
    </div>

    <div class="roomQuestionText">${escapeHtml(q.q || "")}</div>

    <div class="roomAnswerButtons" id="roomAnswerButtons">
      ${(q.options || [])
        .map(
          (opt, i) =>
            `<button type="button" disabled class="qOptionBtn ${ROOM_OPTION_CLASSES[i] || "optA"}${
              opt === hostPlayerData.lastAnswerChoice ? " chosen" : ""
            }">${escapeHtml(opt)}</button>`,
        )
        .join("")}
    </div>

    <div class="roomWaitingNote">✅ Javobingiz qabul qilindi — boshqalarni kutmoqdamiz...</div>

    <div class="roomLiveMini">
      <div class="roomLiveMiniHead">
        <span class="toolTitle">👥 Ishtirokchilar (${roomPlayers.length})</span>
      </div>
      <div id="roomHostParticipants" class="roomPlayerChips"></div>
    </div>

    <div class="roomLiveMini">
      ${roomLiveMiniHeaderHtml("📊 Jonli reyting (faqat sizga ko‘rinadi)")}
      <div id="roomHostLiveLeaderboardPlaying" class="roomLeaderboard"></div>
    </div>

    <div class="modalActions">
      <button class="bigBtn primaryBtn wideBtn" onclick="hostForceAdvanceRound()" title="Kimdir javob bermay uzoq kutib qolinsa, savolni majburan yakunlab, keyingisiga o‘tkazadi">⏭ Savolni yakunlash</button>
    </div>
  `;

  renderRoomQuestionParticipants("roomHostParticipants", idx);

  renderRoomLiveLeaderboardInto("roomHostLiveLeaderboardPlaying");
}

/* ---------- XONA YAKUNLANDI — G'OLIB VA TO'LIQ REYTING ---------- */

let roomWinnerModalShownFor = null;

function renderRoomWinnerView(box) {
  const ranked = rankRoomPlayers(roomPlayers);

  box.innerHTML = `
    <div class="roomFinishedTitle">🏁 Xona yakunlandi!</div>

    <div class="roomLiveMini">
      ${roomLiveMiniHeaderHtml("Yakuniy reyting")}
      <div id="roomHostLiveLeaderboard" class="roomLeaderboard"></div>
    </div>

    <div class="modalActions">
      <button class="bigBtn secondaryBtn" onclick="endRoomAndDelete()">Xonani yopish</button>
      <button
        class="bigBtn primaryBtn"
        onclick="startRoomTopicSwap()"
      >🔄 Boshqa mavzu bilan davom etish</button>
    </div>
  `;

  renderRoomLiveLeaderboardInto("roomHostLiveLeaderboard");

  const bannerKey = roomCode + ":" + roomData.roundId;

  if (roomWinnerModalShownFor !== bannerKey && ranked.length) {
    roomWinnerModalShownFor = bannerKey;

    showRoomWinnerModal(ranked);
  }
}

/*
 * G'OLIBNI SHOV-SHUV BILAN E'LON QILISH — mavjud
 * winnerModal/confetti/tovush infratuzilmasidan
 * (taxta/solo o'yin uchun ishlatiladigan) foydalanadi.
 */
function showRoomWinnerModal(ranked) {
  const modal = $("winnerModal");
  const text = $("winnerText");
  const rest = $("restWinners");

  if (!modal || !ranked.length) return;

  const winner = ranked[0];

  text.innerHTML = `
    <div class="winnerHero">
      <div>
        <div class="winnerCrown">🏆 G‘OLIB</div>
        <div>${escapeHtml(winner.name)}</div>
        <div class="winnerStats">
          ✅ ${winner.correctCount || 0} to‘g‘ri &nbsp;
          ❌ ${winner.wrongCount || 0} xato &nbsp;
          ⏱ ${((Number(winner.totalTimeMs) || 0) / 1000).toFixed(1)}s
        </div>
      </div>
    </div>
  `;

  rest.innerHTML = ranked
    .slice(1)
    .map(
      (p, i) => `
        <div class="winnerRow">
          <span>#${i + 2}</span>
          <strong>${escapeHtml(p.name)}</strong>
          <span class="winnerRowStats">
            ✅${p.correctCount || 0} ❌${p.wrongCount || 0} ·
            ${((Number(p.totalTimeMs) || 0) / 1000).toFixed(1)}s
          </span>
        </div>
      `,
    )
    .join("");

  modal.style.display = "flex";

  playWinSound();
  launchConfetti();

  clearTimeout(winnerTimer);

  winnerTimer = setTimeout(() => {
    modal.style.display = "none";
    stopConfetti();
  }, 12000);
}

/* =========================================================
   XONA CHATI (HOST) — faqat lobbi va yakun ekranida
   ko'rinadi, savol/reveal paytida yashiriladi.
========================================================= */

function updateRoomChatVisibility(status) {
  const chatBox = $("roomChatBox");

  if (!chatBox) return;

  const shouldShow = status === "lobby" || status === "finished";

  chatBox.classList.toggle("hidden", !shouldShow);
}

function subscribeRoomHostChat() {
  roomChatUnsub?.();

  roomChatUnsub = onSnapshot(
    query(collection(db, "rooms", roomCode, "messages"), orderBy("createdAt", "asc"), limit(200)),
    (snap) => {
      roomChatMessages = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      renderRoomHostChatMessages();
    },
    (e) => console.warn("host chat listen:", e),
  );
}

async function sendRoomHostChatMessage(text) {
  const trimmed = (text || "").trim();

  if (!trimmed || !roomCode) return;

  try {
    await addDoc(collection(db, "rooms", roomCode, "messages"), {
      text: trimmed.slice(0, 300),
      name: roomHostChatName || "Nazoratchi",
      senderId: roomHostChatSenderId,
      isHost: true,
      createdAt: Date.now(),
    });
  } catch (e) {
    console.warn("host chat send:", e);
  }
}

function renderRoomHostChatMessages() {
  const el = $("roomChatMessages");

  if (!el) return;

  el.innerHTML = roomChatMessages
    .map((m) => {
      const isMe = m.senderId === roomHostChatSenderId;

      return `
        <div class="chatBubble${isMe ? " isMe" : ""}${m.isHost ? " isHost" : ""}">
          <span class="chatBubbleName">${escapeHtml(m.name || "—")}${m.isHost ? " 👑" : ""}</span>
          <span class="chatBubbleText">${escapeHtml(m.text || "")}</span>
        </div>
      `;
    })
    .join("");

  el.scrollTop = el.scrollHeight;
}

function submitRoomHostChat() {
  const input = $("roomChatInput");

  if (!input) return;

  sendRoomHostChatMessage(input.value);

  input.value = "";
}

$("roomChatSendBtn")?.addEventListener("click", submitRoomHostChat);

$("roomChatInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    submitRoomHostChat();
  }
});

/*
 * XONA EGASI ISHTIROKCHINI CHIQARISHI:
 * faqat lobbi bosqichida (o'yin boshlanmasdan oldin)
 * ishlatiladi — agar kimdir noto'g'ri kirib qolgan
 * yoki ishtirok etishni to'xtatgan bo'lsa.
 */
async function kickRoomPlayer(playerId) {
  if (!roomCode || !playerId) return;

  if (!confirm("Bu ishtirokchini xonadan chiqarasizmi?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "rooms", roomCode, "players", playerId));
  } catch (e) {
    console.warn("kick player:", e);
    alert("Xatolik: " + (e?.message || e));
  }
}

window.kickRoomPlayer = kickRoomPlayer;

function renderRoomLobbyView(box, joinUrl) {
  box.innerHTML = `
    <div class="roomCodeDisplay">
      <span class="roomCodeLabel">XONA KODI</span>
      <strong class="roomCodeValue">${escapeHtml(roomCode)}</strong>
      <span class="roomCodeHint">Ishtirokchilar shu kod bilan yoki quyidagi havola orqali qo‘shiladi</span>

      <div class="roomJoinLinkRow">
        <input
          type="text"
          class="roomJoinLinkInput"
          id="roomJoinLinkInput"
          value="${escapeHtml(joinUrl)}"
          readonly
        >
        <button
          type="button"
          class="smallBtn"
          onclick="copyRoomJoinLink(this)"
        >
          📋 Nusxalash
        </button>
        <a
          class="smallBtn secondaryBtn"
          href="${escapeHtml(joinUrl)}"
          target="_blank"
          rel="noopener"
        >
          🔗 Ochish
        </a>
      </div>
    </div>

    <div class="roomPlayersLive">
      <span class="toolTitle">Qo‘shilgan ishtirokchilar (${roomPlayers.length})</span>
      <div class="roomPlayerChips">
        ${
          roomPlayers.length
            ? roomPlayers
                .map(
                  (p) =>
                    `<span class="roomPlayerChip lobbyChip" data-player-id="${escapeHtml(p.id)}">
                      ${escapeHtml(p.name)}${p.isHost ? " 👑" : ""}
                      ${
                        p.isHost
                          ? ""
                          : `<button type="button" class="roomPlayerKickBtn" data-kick-id="${escapeHtml(p.id)}" title="Ishtirokchini chiqarish">✕</button>`
                      }
                    </span>`,
                )
                .join("")
            : `<span class="introEmpty">Hali hech kim qo‘shilmadi...</span>`
        }
      </div>
    </div>

    <div class="modalActions">
      <button class="bigBtn secondaryBtn" onclick="endRoomAndDelete()">Xonani yopish</button>
      <button class="bigBtn primaryBtn" onclick="hostStartRoom()">▶ Boshlash</button>
    </div>
  `;

  box.querySelectorAll(".roomPlayerKickBtn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      kickRoomPlayer(btn.dataset.kickId);
    };
  });
}

function renderRoomQuestionView(box, idxParam) {
  const idx = idxParam ?? roomData.currentIndex ?? 0;

  const q = roomData.questions?.[idx];

  if (!q) return;

  box.innerHTML = `
    <div class="roomQuestionHead">
      <span class="roomRoundLabel">SAVOL ${idx + 1}/${roomData.totalQuestions}</span>
      <span class="roomTimerRing" id="roomTimerRing">${roomData.roundSeconds || 10}</span>
      <span class="roomAnsweredCount">✅ ${hostPlayerData.correctCount || 0} · ❌ ${hostPlayerData.wrongCount || 0}</span>
    </div>

    <div class="roomQuestionText">${escapeHtml(q.q || "")}</div>

    <div class="roomAnswerButtons" id="roomAnswerButtons">
      ${(q.options || [])
        .map(
          (opt, i) =>
            `<button type="button" class="qOptionBtn ${
              ROOM_OPTION_CLASSES[i] || "optA"
            }" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`,
        )
        .join("")}
    </div>

    <div class="roomLiveMini">
      <div class="roomLiveMiniHead">
        <span class="toolTitle">👥 Ishtirokchilar (${roomPlayers.length})</span>
      </div>
      <div id="roomHostParticipants" class="roomPlayerChips"></div>
    </div>

    <div class="roomLiveMini">
      ${roomLiveMiniHeaderHtml("📊 Jonli reyting (faqat sizga ko‘rinadi)")}
      <div id="roomHostLiveLeaderboardPlaying" class="roomLeaderboard"></div>
    </div>

    <div class="modalActions">
      <button class="bigBtn secondaryBtn wideBtn" onclick="hostForceAdvanceRound()" title="Kimdir javob bermay uzoq kutib qolinsa, savolni majburan yakunlab, keyingisiga o‘tkazadi">⏭ Savolni yakunlash</button>
    </div>
  `;

  box.querySelectorAll("#roomAnswerButtons .qOptionBtn").forEach((btn) => {
    btn.onclick = () => hostSubmitAnswer(btn.dataset.opt);
  });

  renderRoomQuestionParticipants("roomHostParticipants", idx);

  renderRoomLiveLeaderboardInto("roomHostLiveLeaderboardPlaying");
}

/* ---------- JONLI REYTING SARLAVHASI + ULASHISH TUGMASI ---------- */

function roomLiveMiniHeaderHtml(label) {
  return `
    <div class="roomLiveMiniHead">
      <span class="toolTitle">${label}</span>
      <button type="button" class="smallBtn" onclick="shareLeaderboardImage()">📤 Ulashish</button>
    </div>
  `;
}

/* ---------- JONLI REYTINGNI RASM QILIB ULASHISH ---------- */

function wrapHostCanvasText(ctx, text, maxWidth) {
  const words = String(text || "").split(" ");
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const test = line ? line + " " + word : word;

    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });

  if (line) lines.push(line);

  return lines;
}

async function buildLeaderboardImageBlob() {
  const sorted = rankRoomPlayers(roomPlayers);

  const ROW_H = 74;
  const TOP = 210;
  const BOTTOM = 70;

  const W = 720;
  const H = TOP + Math.max(sorted.length, 1) * ROW_H + BOTTOM;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#07111f");
  bg.addColorStop(1, "#0b1930");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow1 = ctx.createRadialGradient(80, 60, 10, 80, 60, 260);
  glow1.addColorStop(0, "rgba(32,217,255,.22)");
  glow1.addColorStop(1, "rgba(32,217,255,0)");
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  const glow2 = ctx.createRadialGradient(W - 80, 90, 10, W - 80, 90, 280);
  glow2.addColorStop(0, "rgba(140,92,255,.24)");
  glow2.addColorStop(1, "rgba(140,92,255,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#f7f9fc";
  ctx.font = "900 34px Inter, Arial, sans-serif";
  ctx.fillText("Beks Game", W / 2, 70);

  ctx.fillStyle = "#20d9ff";
  ctx.font = "800 15px Inter, Arial, sans-serif";
  ctx.fillText("JONLI REYTING", W / 2, 100);

  if (roomData?.topicTitle) {
    ctx.fillStyle = "#9eacc0";
    ctx.font = "700 17px Inter, Arial, sans-serif";
    const topicLines = wrapHostCanvasText(ctx, roomData.topicTitle, W - 140);
    topicLines.slice(0, 1).forEach((line) => {
      ctx.fillText(line, W / 2, 135);
    });
  }

  const rowX = 50;
  const rowW = W - 100;

  sorted.forEach((p, i) => {
    const y = TOP + i * ROW_H;
    const rowH = ROW_H - 14;
    const radius = 16;

    ctx.beginPath();
    ctx.moveTo(rowX + radius, y);
    ctx.arcTo(rowX + rowW, y, rowX + rowW, y + rowH, radius);
    ctx.arcTo(rowX + rowW, y + rowH, rowX, y + rowH, radius);
    ctx.arcTo(rowX, y + rowH, rowX, y, radius);
    ctx.arcTo(rowX, y, rowX + rowW, y, radius);
    ctx.closePath();

    if (i === 0) {
      const winBg = ctx.createLinearGradient(rowX, y, rowX + rowW, y + rowH);
      winBg.addColorStop(0, "rgba(32,217,255,.22)");
      winBg.addColorStop(1, "rgba(255,255,255,.04)");
      ctx.fillStyle = winBg;
      ctx.strokeStyle = "rgba(32,217,255,.55)";
    } else {
      ctx.fillStyle = "rgba(255,255,255,.045)";
      ctx.strokeStyle = "rgba(255,255,255,.14)";
    }

    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();

    const centerY = y + rowH / 2 + 8;

    ctx.textAlign = "left";
    ctx.fillStyle = i === 0 ? "#20d9ff" : "#8fa3b9";
    ctx.font = "900 26px Inter, Arial, sans-serif";
    ctx.fillText(i === 0 ? "🏆" : "#" + (i + 1), rowX + 22, centerY);

    ctx.fillStyle = "#f1f6fb";
    ctx.font = "800 24px Inter, Arial, sans-serif";
    const nameLines = wrapHostCanvasText(ctx, p.name || "—", rowW - 220);
    ctx.fillText(nameLines[0] || "—", rowX + 90, centerY);

    ctx.textAlign = "right";
    ctx.fillStyle = "#67e8f9";
    ctx.font = "900 26px Inter, Arial, sans-serif";
    ctx.fillText("✅" + (p.correctCount || 0), rowX + rowW - 24, centerY);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#5c6c82";
  ctx.font = "700 14px Inter, Arial, sans-serif";
  ctx.fillText("Xona kodi: " + (roomCode || "—"), W / 2, H - 28);

  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function shareLeaderboardImage() {
  try {
    const blob = await buildLeaderboardImageBlob();

    if (!blob) throw new Error("Rasm yaratilmadi");

    const file = new File([blob], "reyting.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Beks Game — jonli reyting",
        text: "Jonli xona reytingi!",
      });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reyting.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.warn("Reytingni ulashishda xato:", e);
      alert("Rasmni ulashib bo‘lmadi: " + (e?.message || e));
    }
  }
}

window.shareLeaderboardImage = shareLeaderboardImage;

function startDuel(topic, playerA, playerB) {
  if (!topic) return;

  /*
   * Mavzudagi barcha savollarni
   * bitta massivga yig'ib,
   * tasodifiy tartibga solamiz.
   */
  let pool = [];

  Object.values(topic.questions || {}).forEach((category) => {
    if (!Array.isArray(category)) {
      return;
    }

    category.forEach((item) => {
      if (item) pool.push(item);
    });
  });

  if (pool.length < 2) {
    hideFlowShield();

    alert("Duel uchun mavzuda kamida 2 ta savol bo‘lishi kerak!");

    return;
  }

  pool = shuffleArray(pool);

  /*
   * Ikki tomonga BIR XIL savol
   * tushib qolmasligi uchun,
   * pool'ni ikkiga bo'lib,
   * har biriga alohida navbat
   * beramiz (A: juft, B: toq).
   */
  duelPool = pool;
  duelSidePools = {
    a: pool.filter((_, index) => index % 2 === 0),
    b: pool.filter((_, index) => index % 2 === 1),
  };

  duelTotalRounds = Math.max(duelSidePools.a.length, duelSidePools.b.length);

  duelPlayers = {
    a: playerA || teamsData[0],
    b: playerB || teamsData[1],
  };

  duelStats = {
    a: { correct: 0, wrong: 0, totalTimeMs: 0 },
    b: { correct: 0, wrong: 0, totalTimeMs: 0 },
  };

  duelActive = true;

  updateDuelStatsUI();

  /*
   * Ishtirokchilar ma'lumotlari
   */
  const pa = findParticipant(duelPlayers.a.participantId);

  const pb = findParticipant(duelPlayers.b.participantId);

  if ($("duelAImg")) {
    $("duelAImg").src = pa?.image || duelPlayers.a.image || avatarData(duelPlayers.a.name);
  }

  if ($("duelBImg")) {
    $("duelBImg").src = pb?.image || duelPlayers.b.image || avatarData(duelPlayers.b.name);
  }

  if ($("duelAName")) {
    $("duelAName").textContent = duelPlayers.a.name;
  }

  if ($("duelBName")) {
    $("duelBName").textContent = duelPlayers.b.name;
  }

  if ($("duelRoundTotal")) {
    $("duelRoundTotal").textContent = duelTotalRounds;
  }

  const modal = $("duelModal");

  if (modal) {
    modal.style.display = "flex";
  }

  hideFlowShield();

  renderDuelRound();
}

function renderDuelRound() {
  if (!duelActive) return;

  duelRound = {
    a: {
      ...duelRound.a,
      index: 0,
      answered: false,
      finished: false,
    },
    b: {
      ...duelRound.b,
      index: 0,
      answered: false,
      finished: false,
    },
  };

  if ($("duelRoundNow")) {
    $("duelRoundNow").textContent = 1;
  }

  renderDuelSideRound("a");
  renderDuelSideRound("b");

  updateDuelStatsUI();
}

function renderDuelSideRound(side) {
  const item = duelSidePools[side][duelRound[side].index];

  if (!item) {
    duelRound[side].finished = true;
    clearInterval(duelRound[side].timer);
    return;
  }

  duelRound[side].item = item;
  duelRound[side].correct = String(item.a ?? item.answer ?? "").trim();
  duelRound[side].answered = false;
  duelRound[side].startedAt = Date.now();

  renderDuelSide(side, item);
  startDuelSideTimer(side);
}

function renderDuelSide(side, item) {
  const qBox = $(side === "a" ? "duelAQText" : "duelBQText");

  const optBox = $(side === "a" ? "duelAAnswers" : "duelBAnswers");

  if (!qBox || !optBox) return;

  qBox.textContent = item.q ?? item.question ?? "";

  const correct = duelRound[side].correct;

  const options = buildAnswerOptions(correct, item);

  optBox.innerHTML = "";

  options.forEach((answer, i) => {
    const btn = document.createElement("button");

    btn.type = "button";
    btn.className = "answerOption duelAnswerBtn";

    btn.dataset.answer = answer;

    btn.innerHTML = `
        <span class="answerLetter">
          ${String.fromCharCode(65 + i)}
        </span>
        <span class="answerText"></span>
      `;

    btn.querySelector(".answerText").textContent = answer;

    btn.onclick = () => handleDuelAnswer(side, btn, answer, correct);

    optBox.appendChild(btn);
  });
}

function startDuelSideTimer(side) {
  clearInterval(duelRound[side].timer);

  duelRound[side].timeLeft = userTimer || 10;

  const timerId = side === "a" ? "duelATimer" : "duelBTimer";
  const el = $(timerId);

  if (el) {
    el.textContent = duelRound[side].timeLeft;
  }

  duelRound[side].timer = setInterval(() => {
    if (!duelActive || duelRound[side].answered) return;

    duelRound[side].timeLeft--;

    if (el) {
      el.textContent = Math.max(0, duelRound[side].timeLeft);
    }

    if (duelRound[side].timeLeft <= 0) {
      clearInterval(duelRound[side].timer);
      resolveDuelSide(side, false, true);
    }
  }, 1000);
}

function handleDuelAnswer(side, button, selected, correct) {
  if (!duelActive || duelRound[side].answered) {
    return;
  }

  const isCorrect = String(selected).trim() === String(correct).trim();

  const optBox = $(side === "a" ? "duelAAnswers" : "duelBAnswers");

  optBox?.querySelectorAll(".duelAnswerBtn").forEach((btn) => {
    btn.disabled = true;

    const value = String(btn.dataset.answer ?? "").trim();

    if (value === String(correct).trim()) {
      btn.classList.add("correct");
    }

    if (btn === button && !isCorrect) {
      btn.classList.add("wrong");
    }
  });

  resolveDuelSide(side, isCorrect, false);
}

function resolveDuelSide(side, isCorrect, timedOut) {
  if (duelRound[side].answered) {
    return;
  }

  duelRound[side].answered = true;

  const timeMs = timedOut ? (userTimer || 10) * 1000 : Date.now() - duelRound[side].startedAt;

  duelStats[side].totalTimeMs += timeMs;

  if (isCorrect) {
    duelStats[side].correct++;
  } else {
    duelStats[side].wrong++;
  }

  /*
   * Vaqt tugab javob berilmagan
   * bo'lsa ham, to'g'ri javobni
   * ko'rsatib qo'yamiz.
   */
  if (timedOut) {
    const optBox = $(side === "a" ? "duelAAnswers" : "duelBAnswers");

    optBox?.querySelectorAll(".duelAnswerBtn").forEach((btn) => {
      btn.disabled = true;

      const value = String(btn.dataset.answer ?? "").trim();

      if (value === duelRound[side].correct) {
        btn.classList.add("correct");
      }
    });
  }

  updateDuelStatsUI();

  setTimeout(() => advanceDuelSide(side), 1000);
}

function advanceDuelSide(side) {
  if (!duelActive || !duelRound[side].answered) return;

  duelRound[side].index++;

  if (duelRound[side].index >= duelSidePools[side].length) {
    duelRound[side].finished = true;
    clearInterval(duelRound[side].timer);
    clearDuelSideUI(side);

    if (duelRound.a.finished && duelRound.b.finished) {
      finishDuel();
    }

    return;
  }

  renderDuelSideRound(side);

  if ($("duelRoundNow")) {
    $("duelRoundNow").textContent = Math.max(duelRound.a.index, duelRound.b.index) + 1;
  }
}

function clearDuelSideUI(side) {
  const qBox = $(side === "a" ? "duelAQText" : "duelBQText");
  const optBox = $(side === "a" ? "duelAAnswers" : "duelBAnswers");

  if (qBox) qBox.textContent = "Yakunlandi";
  if (optBox) optBox.innerHTML = "";
}

function updateDuelStatsUI() {
  if ($("duelACorrect")) {
    $("duelACorrect").textContent = duelStats.a.correct;
  }

  if ($("duelAWrong")) {
    $("duelAWrong").textContent = duelStats.a.wrong;
  }

  if ($("duelBCorrect")) {
    $("duelBCorrect").textContent = duelStats.b.correct;
  }

  if ($("duelBWrong")) {
    $("duelBWrong").textContent = duelStats.b.wrong;
  }

  updateDuelProgressBar();
}

function updateDuelProgressBar() {
  const step = Number.isFinite(pointStep) && pointStep >= 0 ? pointStep : 100;

  /*
   * Noto'g'ri javob endi ball
   * ayirmaydi — progress faqat
   * TO'G'RI javoblarga qarab
   * hisoblanadi. Ball 0 qilib
   * o'chirilgan bo'lsa, progress
   * to'g'ri javob SONI bo'yicha
   * ishlaydi (honadagi kabi).
   */
  const useCountRace = step === 0;

  const scoreA = useCountRace ? duelStats.a.correct : duelStats.a.correct * step;

  const scoreB = useCountRace ? duelStats.b.correct : duelStats.b.correct * step;

  const diff = scoreA - scoreB;

  /*
   * 5 ball (yoki 5 ta to'g'ri
   * javob) farqida "yo'l"
   * to'liq to'lgan bo'ladi.
   */
  const maxDiff = useCountRace ? 5 : step * 5;

  const ratio = Math.max(-1, Math.min(1, diff / maxDiff));

  const percent = Math.abs(ratio) * 50;

  const fillA = $("duelProgressFillA");

  const fillB = $("duelProgressFillB");

  const pctA = ratio > 0 ? percent : 0;

  const pctB = ratio < 0 ? percent : 0;

  if (fillA) {
    fillA.style.height = pctA + "%";
    fillA.style.width = pctA + "%";
  }

  if (fillB) {
    fillB.style.height = pctB + "%";
    fillB.style.width = pctB + "%";
  }
}

function finishDuel() {
  duelActive = false;

  clearInterval(duelRound.a.timer);
  clearInterval(duelRound.b.timer);

  const modal = $("duelModal");

  if (modal) {
    modal.style.display = "none";
  }

  /*
   * G'olibni aniqlaymiz:
   * ko'proq to'g'ri javob —
   * teng bo'lsa, tezroq javob
   * bergan g'olib bo'ladi.
   */
  const a = duelStats.a;
  const b = duelStats.b;

  let winnerSide = null;

  if (a.correct !== b.correct) {
    winnerSide = a.correct > b.correct ? "a" : "b";
  } else if (a.totalTimeMs !== b.totalTimeMs) {
    winnerSide = a.totalTimeMs < b.totalTimeMs ? "a" : "b";
  }

  /*
   * Umumiy ball tizimiga
   * ham qo'shib qo'yamiz —
   * statistikalar boshqa
   * ekranlar bilan mos bo'lsin.
   */
  const step = Number.isFinite(pointStep) && pointStep >= 0 ? pointStep : 100;

  const teamA = duelPlayers.a;

  const teamB = duelPlayers.b;

  if (teamA) {
    /*
     * Noto'g'ri javoblar endi
     * ball ayirmaydi.
     */
    teamA.score += a.correct * step;

    teamA.correctCount = (teamA.correctCount || 0) + a.correct;

    teamA.wrongCount = (teamA.wrongCount || 0) + a.wrong;

    updateTeamScoreUI(teamA);
  }

  if (teamB) {
    teamB.score += b.correct * step;

    teamB.correctCount = (teamB.correctCount || 0) + b.correct;

    teamB.wrongCount = (teamB.wrongCount || 0) + b.wrong;

    updateTeamScoreUI(teamB);
  }

  showDuelResult(winnerSide, a, b);
}

function showDuelResult(winnerSide, a, b) {
  const box = $("duelResultContent");

  if (!box) return;

  const nameA = duelPlayers.a?.name || "A";

  const nameB = duelPlayers.b?.name || "B";

  const secA = (a.totalTimeMs / 1000).toFixed(1);

  const secB = (b.totalTimeMs / 1000).toFixed(1);

  const winnerText =
    winnerSide === "a"
      ? `🏆 ${escapeHtml(nameA)} g‘olib!`
      : winnerSide === "b"
        ? `🏆 ${escapeHtml(nameB)} g‘olib!`
        : "🤝 Durrang!";

  box.innerHTML = `
    <div class="duelResultWinner">
      ${winnerText}
    </div>

    <div class="duelResultGrid">

      <div class="duelResultCard${winnerSide === "a" ? " isDuelWinner" : ""}">
        <strong>${escapeHtml(nameA)}</strong>
        <span>✅ ${a.correct} to‘g‘ri &nbsp; ❌ ${a.wrong} xato</span>
        <span>⏱ ${secA} soniya</span>
      </div>

      <div class="duelResultCard${winnerSide === "b" ? " isDuelWinner" : ""}">
        <strong>${escapeHtml(nameB)}</strong>
        <span>✅ ${b.correct} to‘g‘ri &nbsp; ❌ ${b.wrong} xato</span>
        <span>⏱ ${secB} soniya</span>
      </div>

    </div>
  `;

  const modal = $("duelResultModal");

  if (modal) {
    modal.style.display = "flex";
  }

  playWinSound();
}

function closeDuelResultModal(viaContinue = false) {
  const modal = $("duelResultModal");

  if (modal) {
    modal.style.display = "none";
  }

  /*
   * "🔄 Boshqa mavzu bilan davom etish" tugmasi bosilganda
   * (viaContinue = true) — natija oynasi shunchaki yopiladi,
   * chunki undan keyin mavzu tanlash ro'yxati (roomTopicPicker)
   * ochiladi. index.html'ga faqat foydalanuvchi HAQIQATAN HAM
   * "×"/"Yopish" bosib, duelni butunlay tugatganda qaytariladi.
   */
  if (viaContinue) return;

  /*
   * Agar bu duel index.html'dagi "Jonli xona / Duel / Play"
   * orqali (mehmon yoki ro'yxatdan o'tgan foydalanuvchi
   * bo'lishidan qat'iy nazar) boshlangan bo'lsa, natija
   * oynasi yopilganda index.html asosiy sahifasiga
   * qaytaramiz — aks holda game.html'da bo'sh (board'siz)
   * maydon qolib ketadi.
   */
  if (launchedFromIndex) {
    window.location.href = "index.html";
  }
}

window.closeDuelResultModal = closeDuelResultModal;

/*
 * "🔄 Boshqa mavzu bilan davom etish" — duel natijasi
 * oynasini yopib, mavzu tanlash RO'YXATINI (qidiruvli
 * picker) ochadi. Bu — asosiy "board" render qilingan
 * yoki qilinmaganidan (mehmon/tezkor kirish holatlarida
 * board umuman render qilinmaydi) qat'iy nazar har doim
 * ishlaydi. Aynan shu 2 ishtirokchi (duelPlayers.a/b)
 * saqlanib qoladi — ro'yxatdan yangi mavzu tanlashi
 * bilanoq, statistikasi 0 dan boshlangan yangi duel
 * avtomatik boshlanadi (qarang: selectTopicForRoomOpen).
 */
function continueDuelWithNewTopic() {
  if (!duelPlayers.a || !duelPlayers.b) {
    closeDuelResultModal(true);
    return;
  }

  pendingDuelContinuePlayers = {
    a: duelPlayers.a,
    b: duelPlayers.b,
  };

  closeDuelResultModal(true);

  roomPickerTargetMode = "duel";
  openRoomTopicPicker();
}

window.continueDuelWithNewTopic = continueDuelWithNewTopic;

function exitDuel() {
  if (launchedFromIndex) {
    window.location.href = "index.html";
    return;
  }

  duelActive = false;

  clearInterval(duelRound.a.timer);
  clearInterval(duelRound.b.timer);

  const modal = $("duelModal");

  if (modal) {
    modal.style.display = "none";
  }
}

function startTopicGame(topic) {
  if (!topic) return;

  if (gameFinalized) return;

  currentUserTopicId = topic.id;

  localStorage.setItem("lastTopicId", topic.id);

  /*
   * Tanlangan mavzudagi barcha
   * savollarni bitta massivga yig‘amiz
   */
  currentTopicQuestions = [];

  Object.values(topic.questions || {}).forEach((category) => {
    if (!Array.isArray(category)) {
      return;
    }

    category.forEach((item) => {
      if (item) {
        currentTopicQuestions.push(item);
      }
    });
  });

  if (!currentTopicQuestions.length) {
    hideFlowShield();

    alert("Bu mavzuda savollar mavjud emas!");

    return;
  }

  /*
   * Har o'yinda savollar
   * tasodifiy tartibda beriladi.
   */
  currentTopicQuestions = shuffleArray(currentTopicQuestions);

  /*
   * Bonus rejimi (admin panelidan yoqilgan bo'lsa)
   * tasodifiy savollarga 2X/3X belgisini shu yerda
   * qo'yadi — bu ADMIN boshqaradigan yagona bonus
   * manbai.
   */
  assignRandomBonusQuestions(currentTopicQuestions);

  /*
   * Streak (ketma-ket to'g'ri javob)
   * hisoblagichini yangi o'yin uchun
   * tozalaymiz.
   */
  consecutiveCorrectStreak = 0;
  nextQuestionForcedBonus = false;

  /*
   * Solo statistikasini
   * yangi o'yin uchun tozalaymiz.
   */
  soloStats = {
    correct: 0,
    wrong: 0,
  };

  /*
   * Hozirgi savoldan boshlaymiz
   */
  currentTopicQuestionIndex = 0;

  /*
   * Eski answer-options tizimi
   * uchun questionsni ham yangilaymiz.
   */
  questions = [currentTopicQuestions];

  /*
   * Birinchi savol
   */
  openTopicQuestion();
}

function openTopicQuestion() {
  if (!currentTopicQuestions.length) {
    return;
  }

  const item = currentTopicQuestions[currentTopicQuestionIndex];

  if (!item) {
    declareWinner();

    return;
  }

  /*
   * Savol raqami / jami savollar va
   * hozirgacha javob berilgan savollar
   * sonini ko'rsatib turamiz.
   */
  const progressEl = $("questionProgress");

  if (progressEl) {
    const totalQuestions = currentTopicQuestions.length;

    const questionNumber = currentTopicQuestionIndex + 1;

    const answeredCount = currentTopicQuestionIndex;

    progressEl.textContent = `${questionNumber}-savol / ${totalQuestions} tadan · ✅ Javob berilgan: ${answeredCount}`;
  }

  /*
   * Ball tizimi saqlanadi.
   */
  const score = Number.isFinite(pointStep) && pointStep >= 0 ? pointStep : 100;

  /*
   * Eski openQ modal tizimini
   * ishlatamiz.
   *
   * Virtual cell kerak emas.
   */
  openQ(null, item, score);
}
/* ================= QUESTION ENGINE ================= */

function getAllAnswers() {
  const out = [];

  const cats = Array.isArray(questions) ? questions : Object.values(questions || {});

  cats.forEach((cat) =>
    (cat || []).forEach((item) => {
      const a = String(item?.a ?? item?.answer ?? "").trim();

      if (a) {
        out.push(a);
      }
    }),
  );

  return [...new Set(out)];
}

function shuffleArray(arr) {
  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function buildAnswerOptions(correctAnswer, questionItem) {
  const correct = String(correctAnswer ?? "").trim();

  if (!correct) {
    return [];
  }

  const correctKey = correct.toLowerCase();

  /*
   * ==========================================
   * 1. EXCEL 3-4-5 USTUNLARDAGI JAVOBLAR
   * ==========================================
   */

  const manualWrong = Array.isArray(questionItem?.wrongAnswers)
    ? questionItem.wrongAnswers.map((answer) => String(answer ?? "").trim()).filter(Boolean)
    : [];

  const wrongAnswers = [];

  /*
   * Excel'dan berilgan noto'g'ri
   * javoblarni qo'shamiz
   */

  manualWrong.forEach((answer) => {
    const key = answer.toLowerCase();

    if (!key) {
      return;
    }

    if (key === correctKey) {
      return;
    }

    if (wrongAnswers.some((x) => x.toLowerCase() === key)) {
      return;
    }

    wrongAnswers.push(answer);
  });

  /*
   * ==========================================
   * 2. AGAR 3 TA TO'LMAGAN BO'LSA
   *    ESKI TIZIMDAGI KABI BOSHQA
   *    SAVOLLARDAN JAVOB OLAMIZ
   * ==========================================
   */

  if (wrongAnswers.length < 3) {
    const fallback = getAllAnswers().filter((answer) => {
      const key = String(answer).trim().toLowerCase();

      if (!key) {
        return false;
      }

      if (key === correctKey) {
        return false;
      }

      return !wrongAnswers.some((x) => x.toLowerCase() === key);
    });

    const shuffled = shuffleArray(fallback);

    for (const answer of shuffled) {
      if (wrongAnswers.length >= 3) {
        break;
      }

      wrongAnswers.push(answer);
    }
  }

  /*
   * ==========================================
   * 3. TO'G'RI + 3 TA NOTO'G'RI
   * ==========================================
   */

  return shuffleArray([correct, ...wrongAnswers.slice(0, 3)]);
}

function ensureAnswerOptionsUI() {
  const modalBox = document.querySelector("#modal .questionBox");

  if (!modalBox) return null;

  let container = $("answerOptions");

  if (!container) {
    container = document.createElement("div");

    container.id = "answerOptions";

    container.className = "answerOptions";

    const q = $("qText");

    q?.parentNode?.insertBefore(container, q.nextSibling);

    if (!q) {
      modalBox.appendChild(container);
    }
  }

  return container;
}

function renderAnswerOptions(options, correctAnswer) {
  const box = ensureAnswerOptionsUI();

  if (!box) return;

  box.innerHTML = "";

  options.forEach((answer, i) => {
    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "answerOption";

    btn.dataset.answer = answer;

    btn.innerHTML = `
        <span class="answerLetter">
          ${String.fromCharCode(65 + i)}
        </span>

        <span class="answerText"></span>
      `;

    btn.querySelector(".answerText").textContent = answer;

    btn.onclick = () => handleAnswerSelection(btn, answer, correctAnswer);

    box.appendChild(btn);
  });
}

function updateTurnIndicator() {
  const el = $("questionParticipants");

  const sideBox = $("participantsSideBox");

  const wrap = document.querySelector(".questionModalWrap");

  if (!el) return;

  if (!teamsData.length) {
    /*
     * Ishtirokchi tanlanmagan
     * bo'lsa (solo rejim),
     * o'ng panelni umuman
     * ko'rsatmaymiz — savol
     * qutisi butun kenglikni
     * egallaydi.
     */
    if (sideBox) {
      sideBox.style.display = "none";
    }

    wrap?.classList.add("soloMode");

    el.innerHTML = "";

    return;
  }

  if (sideBox) {
    sideBox.style.display = "";
  }

  wrap?.classList.remove("soloMode");

  /*
   * Ballik hisob o'chirilgan (pointStep === 0)
   * bo'lsa, bu yerda ham ball emas —
   * to'g'ri/xato javoblar soni ko'rsatiladi,
   * aks holda hech qachon o'zgarmagan "0"
   * ko'rinib qolaveradi.
   */
  const scoringOff = Number(pointStep) === 0;

  /*
   * Ball (yoki ballik o'chirilgan bo'lsa —
   * to'g'ri javoblar) bo'yicha eng
   * yuqoridan saralanadi — jonli reyting
   * ko'rinishida. Navbatdagi
   * ishtirokchi alohida belgi
   * bilan ajratiladi.
   */
  const sorted = [...teamsData].sort((a, b) =>
    scoringOff ? (b.correctCount || 0) - (a.correctCount || 0) : (b.score || 0) - (a.score || 0),
  );

  const cardsHtml = sorted
    .map((team) => {
      const isCurrent = teamsData[currentTurnIndex] === team;

      const p = findParticipant(team.participantId);

      return `
        <div class="qParticipantCard${isCurrent ? " isCurrentTurn" : ""}">

          <div class="qParticipantAvatar">
            <img
              src="${p?.image || team.image || avatarData(team.name)}"
              alt=""
            >
          </div>

          <div class="qParticipantInfo">

            <strong class="qParticipantName">
              ${escapeHtml(team.name)}
            </strong>

            <span class="qParticipantScore">
              ${
                scoringOff
                  ? `✅ ${team.correctCount || 0} · ❌ ${team.wrongCount || 0}`
                  : `${Number(team.score || 0)} ball`
              }
            </span>

          </div>

          ${isCurrent ? `<span class="turnBadge">NAVBAT</span>` : ""}

        </div>
      `;
    })
    .join("");

  el.innerHTML = cardsHtml;
}

function openQ(cell, item, score) {
  if (!item) {
    return;
  }

  if (gameFinalized) {
    return;
  }

  /*
   * Savol oynasi haqiqatan ham ko'rsatilyapti —
   * jonli oqim to'sig'i (agar Duel/Xona/Play orqali
   * kelingan bo'lsa) endi kerak emas.
   */
  hideFlowShield();

  clearInterval(timer);

  /*
   * Yangi topic tizimida
   * haqiqiy .cell yo‘q.
   */
  currentCell = null;

  currentValue = Number(score) || 0;

  currentQuestionItem = item;

  currentQuestionMultiplier = 1;

  currentQuestionActive = true;

  gameInProgress = true;

  let questionText = String(item.q ?? item.question ?? "");

  /*
   * ESKI TIZIM O'CHIRILDI: ilgari savol matni
   * boshida qo'lda yozilgan "2x"/"3x" (masalan
   * Excel'dan yuklangan eski savollarda) shu
   * yerda o'qilib, AVTOMATIK ravishda bonus
   * (ball ko'paytmasi) sifatida qo'llanardi.
   * Endi bonus FAQAT admin panelidagi bonus
   * tizimi (tasodifiy tayinlash / streak bonusi)
   * orqali beriladi — matndagi "Nx" yozuvi endi
   * hech qanday ball ko'paytmasi bermaydi, faqat
   * (agar eski savollarda qolib ketgan bo'lsa)
   * ko'rinishni tozalash uchun matndan olib
   * tashlanadi.
   */
  questionText = questionText.replace(/^\s*\d+x\s*/i, "");

  if (activeBonusQuestions.has(item)) {
    /*
     * Matnda qo'lda "Nx" yozilmagan,
     * lekin "Tasodifiy bonus savollar"
     * rejimi shu savolni bonus qilib
     * belgilagan.
     */
    currentQuestionMultiplier = activeBonusQuestions.get(item);

    showBonusEffect(currentValue, currentQuestionMultiplier);

    playBonusSound();
  } else if (streakBonusEnabled && nextQuestionForcedBonus) {
    /*
     * Oldingi 3 ta ketma-ket to'g'ri
     * javob tufayli, shu savol
     * avtomatik 2X bo'ladi.
     */
    currentQuestionMultiplier = 2;

    nextQuestionForcedBonus = false;

    showBonusEffect(currentValue, currentQuestionMultiplier);

    playBonusSound();
  }

  if ($("qText")) {
    $("qText").textContent = questionText;
  }

  $("aText")?.classList.add("hidden");

  renderAnswerOptions(buildAnswerOptions(item.a ?? item.answer), item.a ?? item.answer);

  updateTurnIndicator();

  const modal = $("modal");

  if (modal) {
    modal.style.display = "flex";

    modal.classList.add("show");
  }

  clickSound?.play().catch(() => {});

  startTimer();
}

function startTimer() {
  clearInterval(timer);

  timeLeft = Math.max(1, Number(userTimer) || 10);

  const el = $("timer");

  if (el) {
    el.textContent = timeLeft;
  }

  timer = setInterval(() => {
    timeLeft--;

    if (el) {
      el.textContent = timeLeft;

      el.classList.remove("timer-animate");

      void el.offsetWidth;

      el.classList.add("timer-animate");

      if (timeLeft <= 3 && timeLeft > 0) {
        el.classList.add("timer-last");
      }
    }

    if (timeLeft <= 0) {
      clearInterval(timer);

      handleTimeExpired();
    }
  }, 1000);
}

function handleAnswerSelection(button, selectedAnswer, correctAnswer) {
  if (!currentQuestionActive) {
    return;
  }

  clearInterval(timer);

  /*
   * Ishtirokchi tanlanmagan
   * bo'lsa ham (solo rejim)
   * javob ishlashi kerak.
   */
  const team = teamsData[currentTurnIndex] || null;

  const selected = String(selectedAnswer ?? "").trim();

  const correct = String(correctAnswer ?? "").trim();

  const isCorrect = selected === correct;

  document.querySelectorAll("#answerOptions .answerOption").forEach((btn) => {
    btn.disabled = true;

    const value = String(btn.dataset.answer ?? "").trim();

    if (value === correct) {
      btn.classList.add("correct");
    }

    if (btn === button && !isCorrect) {
      btn.classList.add("wrong");
    }
  });

  /*
   * Noto'g'ri javob uchun ball
   * AYIRILMAYDI — faqat to'g'ri
   * javob ball qo'shadi. Xato/
   * to'g'ri soni statistikada
   * alohida hisoblanadi.
   */
  const points = isCorrect ? currentValue * currentQuestionMultiplier : 0;

  /*
   * KETMA-KET TO'G'RI JAVOB (STREAK)
   * hisoblagichi — team/solo'dan
   * qat'i nazar, umumiy o'yin
   * oqimi bo'yicha kuzatiladi.
   */
  if (streakBonusEnabled) {
    if (isCorrect) {
      consecutiveCorrectStreak++;

      if (consecutiveCorrectStreak >= 3) {
        nextQuestionForcedBonus = true;
        consecutiveCorrectStreak = 0;
      }
    } else {
      consecutiveCorrectStreak = 0;
    }
  }

  if (team) {
    team.score += points;

    if (isCorrect) {
      team.correctCount = (team.correctCount || 0) + 1;
    } else {
      team.wrongCount = (team.wrongCount || 0) + 1;
    }

    updateTeamScoreUI(team);
  } else {
    if (isCorrect) {
      soloStats.correct++;
    } else {
      soloStats.wrong++;
    }
  }

  showAnswerResult(isCorrect, points, team);

  setTimeout(() => finishCurrentQuestionAndAdvance(), 2000);
}

function handleTimeExpired() {
  if (!currentQuestionActive) {
    return;
  }

  const team = teamsData[currentTurnIndex] || null;

  const correct = String(currentQuestionItem?.a ?? currentQuestionItem?.answer ?? "").trim();

  document.querySelectorAll("#answerOptions .answerOption").forEach((btn) => {
    btn.disabled = true;

    if (String(btn.dataset.answer ?? "").trim() === correct) {
      btn.classList.add("correct");
    }
  });

  if (streakBonusEnabled) {
    consecutiveCorrectStreak = 0;
  }

  if (team) {
    /*
     * Vaqt tugashi ham "xato javob"
     * bilan bir xil — ball
     * AYIRILMAYDI, faqat xato
     * hisoblanadi.
     */
    team.wrongCount = (team.wrongCount || 0) + 1;

    updateTeamScoreUI(team);
  } else {
    soloStats.wrong++;
  }

  const a = $("aText");

  if (a) {
    a.textContent = "⏰ Vaqt tugadi! Ball berilmadi";

    a.classList.remove("hidden");
  }

  setTimeout(() => finishCurrentQuestionAndAdvance(), 2000);
}

function showAnswerResult(isCorrect, points, team) {
  const a = $("aText");

  if (!a) return;

  a.textContent = team
    ? isCorrect
      ? `✅ To‘g‘ri! ${points > 0 ? "+" + points + " ball — " : ""}${team.name}`
      : `❌ Xato! Ball berilmadi — ${team.name}`
    : `${isCorrect ? "✅ To‘g‘ri!" : "❌ Xato!"}`;

  a.classList.remove("hidden");
}

function finishCurrentQuestionAndAdvance() {
  if (!currentQuestionActive) {
    return;
  }

  clearInterval(timer);

  currentQuestionActive = false;

  currentQuestionItem = null;

  currentCell = null;

  currentQuestionMultiplier = 1;

  /*
   * Keyingi ishtirokchi
   */
  currentTurnIndex = teamsData.length ? (currentTurnIndex + 1) % teamsData.length : 0;

  /*
   * Keyingi savol
   */
  currentTopicQuestionIndex++;

  /*
   * Barcha savollar tugagan bo‘lsa
   */
  if (currentTopicQuestionIndex >= currentTopicQuestions.length) {
    closeModal(false);

    declareWinner();

    return;
  }

  /*
   * Keyingi savolni ochamiz
   */
  openTopicQuestion();
}

function showAnswer() {
  clearInterval(timer);

  const correct = String(currentQuestionItem?.a ?? currentQuestionItem?.answer ?? "").trim();

  document.querySelectorAll("#answerOptions .answerOption").forEach((btn) => {
    btn.disabled = true;

    if (String(btn.dataset.answer ?? "").trim() === correct) {
      btn.classList.add("correct");
    }
  });

  const a = $("aText");

  if (a) {
    a.textContent = `💡 To‘g‘ri javob: ${correct}`;

    a.classList.remove("hidden");
  }
}

window.showAnswer = showAnswer;

window.handleTimeExpired = handleTimeExpired;

/* =========================================================
   CLOSE / PAUSE QUESTION
   Savol yopiladi, lekin savol YO'QOLMAYDI.
   Keyingi savol tanlansa o'yin davom etadi.
========================================================= */

function closeModal(userInitiated = true) {
  /*
   * MUHIM TUZATISH: bu funksiya ikki xil holatda
   * chaqiriladi —
   *  1) Foydalanuvchi "Yopish" tugmasini bosganda
   *     (userInitiated = true, standart qiymat) —
   *     mehmon (guestQuickLaunch) uchun ko'rsatiladigan
   *     boshqa hech qanday ekran yo'q, shu sabab
   *     index.html'ga qaytariladi.
   *  2) O'yin ICHKARIDAN (barcha savollar tugaganda,
   *     finishCurrentQuestionAndAdvance() ichida)
   *     closeModal(false) sifatida chaqirilganda —
   *     bu holatda hech qayerga qaytarilmasligi kerak,
   *     aks holda declareWinner() ishga tushmasdan
   *     sahifa index.html'ga o'tib ketadi va g'olib
   *     modali/statistika HECH QACHON ko'rinmaydi.
   */
  if (userInitiated && launchedFromIndex) {
    window.location.href = "index.html";
    return;
  }

  // Timer to'xtaydi
  clearInterval(timer);

  // O'yin vaqtincha pauza
  gameInProgress = false;

  // Savol oynasini yopish
  const modal = document.getElementById("modal");

  if (modal) {
    modal.style.display = "none";
  }

  // Variantlarni tozalash
  const answerOptions = document.getElementById("answerOptions");

  if (answerOptions) {
    answerOptions.innerHTML = "";
  }

  // Javob matnini yashirish
  const answerText = document.getElementById("aText");

  if (answerText) {
    answerText.classList.add("hidden");
    answerText.innerText = "";
  }

  console.log("⏸ Savol yopildi — o'yin pauzada.");
}
function showBonusEffect(points, multiplier) {
  const el = $("bonusEffect");

  if (!el) return;

  el.textContent = `🔥 ${multiplier}X BONUS (${points * multiplier}) 🔥`;

  el.classList.remove("hidden");

  setTimeout(() => el.classList.add("hidden"), 1500);
}

function playBonusSound() {
  const s = $("bonusSound");

  s?.play().catch(() => {});
}

/* ================= WINNER / STATS / FIREBASE ================= */

async function updateParticipantsStats(sortedTeams) {
  const played = new Set(sortedTeams.map((t) => String(t.participantId)).filter(Boolean));

  const winnerId = sortedTeams[0]?.participantId;

  participants = participants.map((p) => {
    if (!played.has(String(p.id))) {
      return p;
    }

    return {
      ...p,

      games: (Number(p.games) || 0) + 1,

      wins: String(p.id) === String(winnerId) ? (Number(p.wins) || 0) + 1 : Number(p.wins) || 0,
    };
  });

  await saveParticipants();

  renderParticipants();
}

async function declareWinner() {
  if (gameFinalized) {
    return;
  }

  gameFinalized = true;

  gameInProgress = false;

  clearInterval(timer);

  /*
   * ISHTIROKCHISIZ (SOLO) YAKUN
   */
  if (!teamsData.length) {
    showSoloResultModal();

    return;
  }

  const sorted = [...teamsData].sort((a, b) => b.score - a.score);

  /*
   * O'yin tarixi butunlay olib
   * tashlandi (Firestore hujjatini
   * cheksiz kattalashtirib, saytni
   * sekinlashtirar edi). Ishtirokchi
   * statistikasi (g'alaba/o'yin soni)
   * mustaqil ravishda, to'g'ridan-to'g'ri
   * shu yerda yangilanadi.
   */
  try {
    await updateParticipantsStats(sorted);
  } catch (e) {
    console.error("Participant stats update error:", e);
  }

  showWinnerModal(sorted);
}

function showSoloResultModal() {
  const modal = $("winnerModal");

  const text = $("winnerText");

  const rest = $("restWinners");

  if (!modal) return;

  const total = soloStats.correct + soloStats.wrong;

  const percent = total ? Math.round((soloStats.correct / total) * 100) : 0;

  text.innerHTML = `
    <div class="winnerHero soloHero">
      <div class="winnerCrown">
        🎯 O‘YIN YAKUNLANDI
      </div>

      <div>
        Yakka (solo) natija
      </div>

      <small>
        ✅ ${soloStats.correct} to‘g‘ri &nbsp; ❌ ${soloStats.wrong} xato &nbsp; (${percent}%)
      </small>
    </div>
  `;

  rest.innerHTML = "";

  modal.style.display = "flex";

  playWinSound();
  launchConfetti();

  clearTimeout(winnerTimer);

  winnerTimer = setTimeout(() => {
    modal.style.display = "none";

    stopConfetti();

    afterGameModalClosed();
  }, 3000);
}

function showWinnerModal(sorted) {
  const modal = $("winnerModal");

  const text = $("winnerText");

  const rest = $("restWinners");

  if (!modal || !sorted.length) {
    return;
  }

  const winner = sorted[0];

  const p = findParticipant(winner.participantId);

  const img = p?.image || winner.image || avatarData(winner.name);

  text.innerHTML = `
    <div class="winnerHero">
      <img
        class="winnerAvatar"
        src="${img}"
        alt=""
      >

      <div>
        <div class="winnerCrown">
          🏆 G‘OLIB
        </div>

        <div>
          ${escapeHtml(winner.name)}
        </div>

        <small>
          ${winner.score} ball
        </small>

        <div class="winnerStats">
          ✅ ${winner.correctCount || 0} to‘g‘ri &nbsp; ❌ ${winner.wrongCount || 0} xato
        </div>
      </div>
    </div>
  `;

  rest.innerHTML = sorted
    .slice(1)
    .map((t, i) => {
      const tp = findParticipant(t.participantId);

      return `
            <div class="winnerRow">
              <span>
                #${i + 2}
              </span>

              <img
                src="${tp?.image || t.image || avatarData(t.name)}"
                alt=""
              >

              <strong>
                ${escapeHtml(t.name)}
              </strong>

              <b>
                ${t.score}
              </b>

              <span class="winnerRowStats">
                ✅${t.correctCount || 0} ❌${t.wrongCount || 0}
              </span>
            </div>
          `;
    })
    .join("");

  modal.style.display = "flex";

  playWinSound();
  launchConfetti();

  clearTimeout(winnerTimer);

  winnerTimer = setTimeout(() => {
    modal.style.display = "none";

    stopConfetti();

    afterGameModalClosed();
  }, 3000);
}

/*
 * winnerModal (g'olib e'lon qilish/konfetti) o'z-o'zidan
 * yopilgach chaqiriladi. Board darhol "yalang'och" (bo'sh)
 * ko'rinib qolmasligi uchun avval tozalanadi (resetBoardOnly),
 * so'ng — agar bu o'yin index.html'dagi "O'yin boshlash"
 * orqali boshlangan bo'lsa — alohida "gameEndModal" ochiladi:
 * u yerda ishtirokchilar ro'yxati (endi 0 holatida) va
 * "Yopish" / "Boshqa mavzu bilan davom etish" tugmalari bor.
 * Aks holda (oddiy, index'dan kelmagan ro'yxatdan o'tgan
 * foydalanuvchi) — avvalgidek shunchaki o'z board'i ko'rinadi.
 */
function afterGameModalClosed() {
  resetBoardOnly();

  if (launchedFromIndex) {
    openGameEndModal();
    return;
  }

  document.body.classList.remove("guestQuickLaunchMode");
}

/*
 * "gameEndModal" — ishtirokchilar ro'yxatini (ballari
 * endi 0'dan boshlanadi) ko'rsatadi.
 */
function openGameEndModal() {
  const modal = $("gameEndModal");

  const box = $("gameEndParticipants");

  if (!modal) return;

  if (box) {
    if (teamsData.length) {
      box.innerHTML = teamsData
        .map((t) => {
          const p = findParticipant(t.participantId);

          return `
            <div class="team">
              <img
                class="teamAvatar"
                src="${p?.image || t.image || avatarData(t.name)}"
                alt=""
              >
              <strong>${escapeHtml(t.name)}</strong>
              <span>${t.score || 0}</span>
              <div class="teamStatLine">
                ✅ ${t.correctCount || 0} · ❌ ${t.wrongCount || 0}
              </div>
            </div>
          `;
        })
        .join("");
    } else {
      box.innerHTML = `<div style="color:var(--muted);padding:20px;text-align:center;font-size:13.5px;">Yakka (solo) tartibda o'ynalgan edi.</div>`;
    }
  }

  modal.style.display = "flex";
}

/*
 * "×" / "Yopish" — gameEndModal'ni yopish. index.html'dagi
 * "O'yin boshlash" orqali kelingan bo'lsa, index.html asosiy
 * sahifasiga qaytaramiz.
 */
function closeGameEndModal() {
  const modal = $("gameEndModal");

  if (modal) {
    modal.style.display = "none";
  }

  if (launchedFromIndex) {
    window.location.href = "index.html";
    return;
  }

  document.body.classList.remove("guestQuickLaunchMode");
}

window.closeGameEndModal = closeGameEndModal;

/*
 * "🔄 Boshqa mavzu bilan davom etish" — gameEndModal
 * yopiladi va mavzu tanlash ro'yxati ochiladi, shu bilan
 * bir xil ishtirokchilar (teamsData) bilan yangi mavzuda
 * o'yinni davom ettirish mumkin bo'ladi.
 */
function continueGameWithNewTopic() {
  const modal = $("gameEndModal");

  if (modal) {
    modal.style.display = "none";
  }

  roomPickerTargetMode = "play";

  openRoomTopicPicker();
}

window.continueGameWithNewTopic = continueGameWithNewTopic;

function playWinSound() {
  winnerSound?.play().catch(() => {});
}

function launchConfetti() {
  const canvas = $("confetti");

  if (!canvas) return;

  stopConfetti();

  canvas.width = innerWidth;

  canvas.height = innerHeight;

  const ctx = canvas.getContext("2d");

  const ps = Array.from(
    {
      length: 140,
    },
    () => ({
      x: Math.random() * canvas.width,

      y: -Math.random() * canvas.height,

      r: 2 + Math.random() * 5,

      v: 2 + Math.random() * 4,

      h: Math.random() * 360,
    }),
  );

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ps.forEach((p) => {
      ctx.fillStyle = `hsl(${p.h},95%,60%)`;

      ctx.fillRect(p.x, p.y, p.r, p.r * 2);

      p.y += p.v;

      if (p.y > canvas.height) {
        p.y = -10;
      }
    });

    confettiFrame = requestAnimationFrame(draw);
  };

  draw();
}

function stopConfetti() {
  if (confettiFrame) {
    cancelAnimationFrame(confettiFrame);
  }

  confettiFrame = null;

  const c = $("confetti");

  c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
}

/* ================= RESET / SHUFFLE ================= */

function resetBoardOnly() {
  clearInterval(timer);

  currentTopicQuestionIndex = 0;

  currentQuestionActive = false;
  currentQuestionItem = null;
  currentCell = null;
  currentQuestionMultiplier = 1;

  gameFinalized = false;
  gameInProgress = false;

  currentTurnIndex = 0;

  teamsData.forEach((t) => {
    t.score = 0;
    t.correctCount = 0;
    t.wrongCount = 0;
  });

  soloStats = {
    correct: 0,
    wrong: 0,
  };

  /*
   * Tanlangan mavzu bo‘yicha
   * savollarni qayta tayyorlaymiz
   */
  if (currentUserTopicId) {
    const topic = userTopics.find((t) => t.id === currentUserTopicId);

    if (topic) {
      currentTopicQuestions = [];

      Object.values(topic.questions || {}).forEach((category) => {
        if (!Array.isArray(category)) {
          return;
        }

        category.forEach((item) => {
          if (item) {
            currentTopicQuestions.push(item);
          }
        });
      });

      questions = [currentTopicQuestions];
    }
  }

  renderTeams();
  renderParticipants();
  renderBoard();
}

window.resetBoardOnly = resetBoardOnly;

async function shuffleTopicQuestions() {
  if (!currentUserTopicId) {
    alert("Avval mavzuni tanlang!");

    return;
  }

  const topic = userTopics.find((t) => t.id === currentUserTopicId);

  if (!topic) {
    return;
  }

  const perm = await getMyPermissions();

  if (!perm.isAdmin && !perm.canEditTopics) {
    return showLimitWarning(
      "Sizga mavzularni tahrirlash huquqi administrator tomonidan cheklangan.",
    );
  }

  const allQuestions = [];

  Object.values(topic.questions || {}).forEach((category) => {
    if (!Array.isArray(category)) {
      return;
    }

    category.forEach((item) => {
      if (item) {
        allQuestions.push(item);
      }
    });
  });

  if (allQuestions.length < 2) {
    alert("Aralashtirish uchun savollar yetarli emas!");

    return;
  }

  /*
   * Fisher-Yates
   */
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }

  /*
   * Muhim:
   * 5 ta ustunga bo‘lmaymiz.
   *
   * Bitta massiv sifatida
   * saqlaymiz.
   */
  topic.questions = {
    shuffled: allQuestions,
  };

  currentTopicQuestions = allQuestions;

  questions = [allQuestions];

  currentTopicQuestionIndex = 0;

  await saveTopics(topic.id);

  renderUserTopics();

  renderBoard();
}

function shuffleQuestionsByButton() {
  shuffleTopicQuestions();
}

window.shuffleTopicQuestions = shuffleTopicQuestions;

window.shuffleQuestionsByButton = shuffleQuestionsByButton;

/* ================= OTHER TOPICS ================= */

let otherTopics = [];

async function loadOtherTopics() {
  if (!db || !currentUserUid) {
    return;
  }

  try {
    otherTopics = [];

    /*
     * TEZLASHTIRISH: avval BARCHA
     * foydalanuvchilarning to'liq
     * hujjati (har birining
     * boshqa maydonlari bilan birga)
     * yuklanardi — bu foydalanuvchilar
     * ko'paygan sari doimiy
     * sekinlashib borar edi. Endi
     * faqat yengil "sharedTopics"
     * kolleksiyasi o'qiladi —
     * har bir hujjatda faqat
     * bitta mavzu bor, boshqa
     * hech narsa yo'q.
     */
    const snap = await getDocs(collection(db, "sharedTopics"));

    snap.docs.forEach((d) => {
      const data = d.data();

      if (data.ownerId === currentUserUid) {
        return;
      }

      otherTopics.push({
        ...data,
        id: data.id || d.id,
      });
    });

    renderOtherTopics("");
  } catch (e) {
    console.warn("other topics:", e);
  }
}

/*
 * ===============================================
 * MEHMON (GUEST) REJIMI — ro'yxatdan o'tmagan
 * foydalanuvchi uchun, ulashilgan BARCHA mavzular
 * to'g'ridan-to'g'ri o'yin maydonida (board) ko'rinadi
 * va o'ynaladi (xuddi o'zinikidek), lekin ularni
 * tahrirlash / o'chirish / yangi mavzu qo'shish kabi
 * imkoniyatlar berilmaydi — buning uchun ro'yxatdan
 * o'tishi kerak.
 * ===============================================
 */
function setupGuestDemoTopic() {
  /*
   * Ulashilgan mavzularning BARCHASINI
   * to'g'ridan-to'g'ri board'ga chiqaramiz
   * (userTopics'ga faqat vaqtincha, xotirada —
   * hech qachon saqlanmaydi/o'zgartirilmaydi).
   */
  userTopics = otherTopics.map((topic) => ({ ...topic }));

  currentUserTopicId = null;

  renderBoard();

  /*
   * Mehmon uchun barcha
   * boshqaruv/sozlash imkoniyatlarini
   * "teacherLocked" mexanizmi orqali
   * yashiramiz (mavzu qo'shish, Excel,
   * ball, randomizer, statistikani
   * tozalash, tahrirlash/o'chirish
   * tugmalari va h.k.) — bu mexanizm
   * allaqachon mavjud va sinovdan
   * o'tgan.
   */
  document.body.classList.add("guestMode", "teacherLocked");

  const banner = $("guestBanner");

  if (banner) {
    banner.style.display = "block";
  }
}

function renderOtherTopics(filterText = "") {
  const box = $("otherTopicPanel");

  if (!box) return;

  box.innerHTML = "";

  const list = otherTopics.filter((t) =>
    String(t.title || "")
      .toLowerCase()
      .includes(filterText.toLowerCase()),
  );

  if (!list.length) {
    box.innerHTML = "<p>🔎 Mavzu topilmadi</p>";

    return;
  }

  list.forEach((topic) => {
    const d = document.createElement("div");

    d.className = "topicCard otherTopic";

    const total = Object.values(topic.questions || {}).reduce(
      (s, c) => s + (Array.isArray(c) ? c.length : 0),
      0,
    );

    d.innerHTML = `
        <strong>
          ${escapeHtml(topic.title)}
        </strong>

        <span>
          ${total} ta savol
        </span>

        <small>
          👤 ${escapeHtml(topic.ownerName)}
        </small>
      `;

    d.onclick = () => openTopicIntro(topic);

    box.appendChild(d);
  });
}

window.loadOtherTopics = loadOtherTopics;

$("otherTopicSearchInput")?.addEventListener("input", (e) =>
  renderOtherTopics(e.target.value.trim()),
);

$("boardTopicSearch")?.addEventListener("input", () => renderBoard());

/* =========================================================
   XONA UCHUN MAVZU TANLASH — QIDIRUVLI RO'YXAT
   (kartalar o'rniga, xona ochish uchun tezkor tanlov)
========================================================= */

function sortTopicsByNewest(list) {
  return [...list].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

function getRoomPickerTopics() {
  /*
   * Mehmon (guest) uchun userTopics allaqachon
   * BARCHA ulashilgan mavzularni o'z ichiga oladi
   * (bootstrap paytida "sharedTopics"dan to'g'ridan-
   * to'g'ri yuklanadi) — shu sabab otherTopics bilan
   * qo'shib takrorlash shart emas. Ro'yxatdan o'tgan
   * foydalanuvchi uchun esa ikkalasini (o'zinikilar +
   * boshqalarniki) birlashtiramiz.
   */
  const rawOwn = Array.isArray(userTopics) ? userTopics : [];

  /*
   * MUHIM: ro'yxat ENG OXIRGI qo'shilgan (yoki
   * yaqinda yuklangan) mavzu birinchi ko'rinadigan
   * qilib tartiblanadi — "savollar" (board) panelidagi
   * tartib bilan bir xil.
   */
  if (isGuestUser) {
    return sortTopicsByNewest(rawOwn);
  }

  /*
   * O'ZINING mavzulari uchun — "kim qo'shgan"
   * ma'lumoti serverga sinxron qilinmagan yoki
   * displayName bo'sh bo'lgani sabab yo'qolib
   * qolmasin deb, joriy hisob egasining ismini
   * to'g'ridan-to'g'ri shu yerda qo'yamiz.
   */
  const myName = auth.currentUser?.displayName || "Siz";

  const own = rawOwn.map((t) => ({
    ...t,
    ownerName: myName,
  }));

  const seen = new Set(own.map((t) => t.id));

  const merged = [...own];

  (otherTopics || []).forEach((t) => {
    if (!seen.has(t.id)) {
      merged.push(t);
      seen.add(t.id);
    }
  });

  return sortTopicsByNewest(merged);
}

function openRoomTopicPicker() {
  const modal = $("roomTopicPickerModal");

  if (!modal) return;

  showFlowShield();

  const titleEl = $("roomTopicPickerTitle");

  if (titleEl) {
    titleEl.textContent =
      roomPickerTargetMode === "duel"
        ? "⚔️ Duel uchun mavzu tanlang"
        : roomPickerTargetMode === "play"
          ? "🎯 O‘yin uchun mavzu tanlang"
          : "📱 Xona uchun mavzu tanlang";
  }

  const searchInput = $("roomTopicPickerSearch");

  if (searchInput) searchInput.value = "";

  selectedRoomPickerCategory = null;

  renderRoomTopicPickerList("");

  modal.style.display = "flex";

  setTimeout(() => searchInput?.focus(), 50);
}

window.openRoomTopicPicker = openRoomTopicPicker;

function closeRoomTopicPickerModal(viaSelection = false) {
  const modal = $("roomTopicPickerModal");

  if (modal) modal.style.display = "none";

  /*
   * Agar bu "boshqa mavzu tanlash" (swap) rejimida
   * ochilgan bo'lsa-yu, foydalanuvchi hech narsa
   * tanlamasdan × tugmasi bilan yopib qo'ysa —
   * swap rejimini bekor qilib, xona ekraniga
   * qaytaramiz.
   */
  if (!viaSelection && roomTopicSwapMode) {
    cancelRoomTopicSwap();
    return;
  }

  /*
   * Duel "boshqa mavzu bilan davom etish" rejimida
   * ochilgan bo'lsa-yu, foydalanuvchi hech narsa
   * tanlamasdan yopib qo'ysa — bu rejim bekor qilinadi
   * (aks holda keyinroq boshqa joyda mavzu tanlanganda
   * kutilmagan duel boshlanib qolishi mumkin edi).
   */
  if (!viaSelection && pendingDuelContinuePlayers) {
    pendingDuelContinuePlayers = null;
  }

  /*
   * Mehmon (index.html'dagi Jonli xona/Duel/Play orqali
   * kelgan) hech narsa tanlamasdan ro'yxatni yopsa —
   * uning uchun ko'rsatiladigan boshqa hech qanday
   * ekran yo'q, shu sabab index.html'ga qaytaramiz.
   */
  if (!viaSelection && launchedFromIndex) {
    window.location.href = "index.html";
    return;
  }

  /*
   * Ro'yxatdan o'tgan foydalanuvchi (mehmon emas) hech
   * narsa tanlamasdan oynani yopsa — o'zining oddiy
   * o'yin sahifasini (board) qaytadan ko'rishi kerak.
   */
  if (!viaSelection) {
    document.body.classList.remove("guestQuickLaunchMode");

    hideFlowShield();
  }
}

window.closeRoomTopicPickerModal = closeRoomTopicPickerModal;

function renderRoomTopicPickerList(filterText = "") {
  const box = $("roomTopicPickerList");

  const subBox = $("roomTopicPickerSubjectList");

  const catBox = $("roomTopicPickerCategoryList");

  if (!box) return;

  const term = filterText.trim().toLowerCase();

  const all = getRoomPickerTopics();

  /*
   * FANLAR VA KATEGORIYALAR —
   * qidiruvdan qat'i nazar BARCHA
   * mavzular asosida (tepadagi
   * qatorlarda doim to'liq ro'yxat
   * ko'rinsin). Admin o'chirgan
   * bo'lsa — bu qatorlar umuman
   * ko'rsatilmaydi.
   */
  let subjectFiltered = all;

  if (!categorySettingsState.enabled) {
    selectedRoomPickerSubject = null;
    selectedRoomPickerCategory = null;

    if (subBox) subBox.innerHTML = "";
    if (catBox) catBox.innerHTML = "";
  } else {
    const subjects = getTopicSubjectStats(all);

    if (selectedRoomPickerSubject && !subjects.some((s) => s.name === selectedRoomPickerSubject)) {
      selectedRoomPickerSubject = null;
      selectedRoomPickerCategory = null;
    }

    renderCategorySidebar(subBox, subjects, selectedRoomPickerSubject, (name) => {
      selectedRoomPickerSubject = name;
      selectedRoomPickerCategory = null;
      renderRoomTopicPickerList($("roomTopicPickerSearch")?.value || "");
    });

    subjectFiltered = filterTopicsBySubject(all, selectedRoomPickerSubject);

    if (!selectedRoomPickerSubject) {
      /*
       * "Barchasi" (hech qanday fan
       * tanlanmagan) holatda kategoriya
       * qatori ko'rsatilmaydi — fan
       * qatoridagi "Barchasi" chipi
       * allaqachon BARCHA mavzularni
       * ko'rsatadi. Kategoriya qatori
       * FAQAT aniq bir FAN tanlanganda
       * paydo bo'ladi.
       */
      selectedRoomPickerCategory = null;

      if (catBox) catBox.innerHTML = "";
    } else {
      const categories = getTopicCategoryStats(subjectFiltered);

      if (
        selectedRoomPickerCategory &&
        !categories.some((c) => c.name === selectedRoomPickerCategory)
      ) {
        selectedRoomPickerCategory = null;
      }

      renderCategorySidebar(catBox, categories, selectedRoomPickerCategory, (name) => {
        selectedRoomPickerCategory = name;
        renderRoomTopicPickerList($("roomTopicPickerSearch")?.value || "");
      });
    }
  }

  let list = term
    ? subjectFiltered.filter((t) => (t.title || "").toLowerCase().includes(term))
    : subjectFiltered;

  if (selectedRoomPickerCategory) {
    list = list.filter((t) => getTopicCategory(t) === selectedRoomPickerCategory);
  }

  if (!list.length) {
    box.innerHTML = `
      <div class="roomTopicPickerEmpty">
        🔍 Mavzu topilmadi
      </div>
    `;
    return;
  }

  box.innerHTML = list
    .map((topic, i) => {
      const total = Object.values(topic.questions || {}).reduce(
        (sum, category) => sum + (Array.isArray(category) ? category.length : 0),
        0,
      );

      return `
        <div class="roomTopicPickerRow" data-idx="${i}">
          <div class="roomTopicPickerRowInfo">
            <strong class="rtpName">${escapeHtml(topic.title || "")}</strong>
            <span class="rtpCount">${total} ta savol</span>
            <span class="rtpOwner">👤 ${escapeHtml(topic.ownerName || "Noma'lum")}${
              categorySettingsState.enabled
                ? " · " +
                  escapeHtml(getTopicSubject(topic)) +
                  " / " +
                  escapeHtml(getTopicCategory(topic))
                : ""
            }</span>
          </div>
          <span class="roomTopicPickerRowArrow">▶</span>
        </div>
      `;
    })
    .join("");

  box.querySelectorAll(".roomTopicPickerRow").forEach((row) => {
    row.onclick = () => {
      const idx = Number(row.dataset.idx);
      const topic = list[idx];

      if (!topic) return;

      selectTopicForRoomOpen(topic);
    };
  });
}

/*
 * Ro'yxatdan mavzu tanlanganda:
 * - Agar "boshqa mavzu tanlash" (swap) rejimida
 *   bo'lsak — to'g'ridan-to'g'ri xonaga yangi
 *   mavzuni ulaymiz.
 * - Aks holda — roomPickerTargetMode ga qarab:
 *   "room" -> xona ochish bosqichi (ism+vaqt),
 *   "duel" -> Duel'ni to'g'ridan-to'g'ri boshlaymiz
 *             (teamsData index.html'dan oldindan
 *             tayyorlangan bo'lishi mumkin),
 *   "play" -> yakka/jamoaviy o'yinni boshlaymiz
 *             (xuddi shunday, teamsData orqali).
 */
function selectTopicForRoomOpen(topic) {
  const wasSwap = roomTopicSwapMode;

  closeRoomTopicPickerModal(true);

  /*
   * DUEL — "BOSHQA MAVZU BILAN DAVOM ETISH": ro'yxatdan
   * mavzu tanlanishi bilanoq, saqlangan 2 ishtirokchi
   * bilan to'g'ridan-to'g'ri yangi duel (statistikasi
   * 0 dan) boshlanadi — oddiy "duel" rejimi bosqichlarini
   * (ism kiritish va h.k.) qayta o'tmaydi.
   */
  if (pendingDuelContinuePlayers) {
    const players = pendingDuelContinuePlayers;
    pendingDuelContinuePlayers = null;

    selectUserTopic(topic.id);
    startDuel(topic, players.a, players.b);
    return;
  }

  if (wasSwap) {
    swapRoomTopic(topic);
    return;
  }

  pendingIntroTopic = topic;

  if (roomPickerTargetMode === "duel") {
    confirmStartDuel();
    return;
  }

  if (roomPickerTargetMode === "play") {
    confirmStartTopicGame();
    return;
  }

  openRoomSetup();
}

$("roomTopicPickerSearch")?.addEventListener("input", (e) =>
  renderRoomTopicPickerList(e.target.value),
);

$("quickRoomBtn")?.addEventListener("click", () => {
  roomPickerTargetMode = "room";
  openRoomTopicPicker();
});

/* ================= CHART ================= */

function renderStatsChart() {
  const ctx = $("statsChart");

  if (!ctx || typeof Chart === "undefined") {
    return;
  }

  new Chart(ctx, {
    type: "bar",

    data: {
      labels: participants.map((p) => p.name),

      datasets: [
        {
          label: "G‘alabalar",

          data: participants.map((p) => p.wins),
        },
      ],
    },
  });
}

window.renderStatsChart = renderStatsChart;

/* ================= PROFILE ================= */

const accountBtn = $("accountBtn");

const accountModal = $("accountModal");

const displayNameInput = $("displayNameInput");

const saveProfileBtn = $("saveProfileBtn");

accountBtn?.addEventListener("click", () => {
  if (displayNameInput) {
    displayNameInput.value = auth.currentUser?.displayName || "";
  }

  if (accountModal) {
    accountModal.style.display = "flex";
  }
});

window.closeAccountModal = () => {
  if (accountModal) {
    accountModal.style.display = "none";
  }
};

/* =========================================================
   MUROJAATLAR (SUPPORT MESSAGES)
   ---------------------------------------------------------
   Oddiy, ammo to'liq ishlaydigan yozishma tizimi:
   - Foydalanuvchi "Bog'lanish" oynasida xabar yozadi →
     Firestore'dagi "supportMessages" kolleksiyasiga
     addDoc qilinadi (uid, email, matn, sana).
   - Admin panelida ("Murojaatlar" bo'limi) BARCHA xabarlar
     real vaqtda ko'rinadi, admin har biriga javob yozib
     yuboradi (updateDoc: adminReply, repliedAt) yoki
     kerak bo'lmasa butunlay o'chirib tashlaydi (deleteDoc)
     — shu bilan ro'yxat cheksiz to'lib ketmaydi.
   - Foydalanuvchiga javob kelganda, header ostida sariq
     chiziq bilan o'ralgan bildirishnoma chiqadi (real
     vaqtda, onSnapshot orqali). "×" tugmasi bosilsa,
     faqat "dismissedByUser" maydoni true qilinadi — xabar
     o'zi Firestore'da qoladi (admin panelida tarix sifatida
     ko'rinishda davom etadi, admin xohlasa keyin o'chiradi).
   - Foydalanuvchi shu oynada o'zining oldingi barcha
     murojaatlari va ularga berilgan javoblarni ham ko'radi
     (oddiy support-ticket tizimlaridagi kabi).
========================================================= */

const SUPPORT_COLLECTION = "supportMessages";

const contactModal = $("contactModal");
const contactModalBody = $("contactModalBody");
const contactMessageInput = $("contactMessageInput");
const contactSendBtn = $("contactSendBtn");
const contactSendStatus = $("contactSendStatus");
const adminReplyBannersEl = $("adminReplyBanners");

let myMessages = [];
let myMessagesUnsub = null;

function tt(key, fallback) {
  return typeof t === "function" ? t(key, fallback) : fallback;
}

function formatSupportDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "";

    const localeMap = { uz: "uz-UZ", en: "en-GB", ru: "ru-RU" };
    const lang = typeof getAppLang === "function" ? getAppLang() : "uz";

    return d.toLocaleString(localeMap[lang] || "uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

function renderMyMessages() {
  if (!contactModalBody) return;

  if (!myMessages.length) {
    const emptyText = tt("contact.empty", "Hali murojaat yubormagansiz.");

    contactModalBody.innerHTML = `<div class="usersEmpty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  contactModalBody.innerHTML = myMessages
    .map((m) => {
      const answered = !!m.adminReply;

      const badge = answered
        ? `<span class="contactStatusBadge answered">✅ ${escapeHtml(
            tt("contact.answered", "Javob berildi"),
          )}</span>`
        : `<span class="contactStatusBadge pending">⏳ ${escapeHtml(
            tt("contact.pending", "Javob kutilmoqda"),
          )}</span>`;

      const replyBlock = answered
        ? `<div class="contactHistoryReply"><strong>${escapeHtml(
            tt("contact.adminReplyLabel", "Administrator javobi"),
          )}:</strong> ${escapeHtml(m.adminReply)}</div>`
        : "";

      return `
        <div class="contactHistoryItem">
          <div class="contactHistoryMeta">
            <span class="contactHistoryDate">${escapeHtml(formatSupportDate(m.createdAt))}</span>
            ${badge}
          </div>
          <div class="contactHistoryMsg">${escapeHtml(m.message)}</div>
          ${replyBlock}
        </div>
      `;
    })
    .join("");
}

function renderReplyBanners() {
  if (!adminReplyBannersEl) return;

  const unseen = myMessages.filter((m) => m.adminReply && !m.dismissedByUser);

  if (!unseen.length) {
    adminReplyBannersEl.innerHTML = "";
    adminReplyBannersEl.classList.add("hidden");
    return;
  }

  adminReplyBannersEl.classList.remove("hidden");

  adminReplyBannersEl.innerHTML = unseen
    .map(
      (m) => `
        <div class="adminReplyBanner">
          <span class="adminReplyIcon">❗</span>
          <div class="adminReplyText">
            <strong>${escapeHtml(
              tt("contact.adminReplyLabel", "Administrator javobi"),
            )}:</strong> ${escapeHtml(m.adminReply)}
          </div>
          <button
            type="button"
            class="adminReplyCloseBtn"
            data-action="dismissReply"
            data-id="${escapeHtml(m.id)}"
          >×</button>
        </div>
      `,
    )
    .join("");
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='dismissReply']");
  if (!btn) return;

  const id = btn.dataset.id;
  if (!id) return;

  btn.disabled = true;

  try {
    await updateDoc(doc(db, SUPPORT_COLLECTION, id), {
      dismissedByUser: true,
    });
  } catch (err) {
    console.warn("dismissReply:", err);
    btn.disabled = false;
  }
});

function startMyMessagesListener() {
  if (myMessagesUnsub) {
    myMessagesUnsub();
    myMessagesUnsub = null;
  }

  if (!currentUserUid || isGuestUser) return;

  try {
    /*
     * MUHIM: bu yerda ATAYLAB orderBy ISHLATILMAYDI.
     * Firestore'da "where(uid==...) + orderBy(createdAt)"
     * kombinatsiyasi maxsus composite index talab qiladi —
     * agar u Firebase konsolida yaratilmagan bo'lsa, so'rov
     * xato bilan (permission/failed-precondition) muvaffaqiyatsiz
     * tugaydi va onSnapshot HECH QANDAY ma'lumot bermaydi
     * (aynan shu sabab avvalgi versiyada foydalanuvchi o'z
     * murojaatlarini va admin javobini ko'ra olmagan edi).
     * Shu sabab faqat oddiy "where" so'rovi yuboriladi,
     * saralash esa pastda JS orqali qo'lda amalga oshiriladi.
     */
    const q = query(collection(db, SUPPORT_COLLECTION), where("uid", "==", currentUserUid));

    myMessagesUnsub = onSnapshot(
      q,
      (snap) => {
        myMessages = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return bt - at;
          })
          .slice(0, 30);

        renderMyMessages();
        renderReplyBanners();
      },
      (err) => {
        console.error("startMyMessagesListener:", err);

        if (contactModalBody) {
          contactModalBody.innerHTML = `<div class="usersEmpty">❌ Murojaatlar tarixini yuklab bo'lmadi (${escapeHtml(
            err?.code || err?.message || "xatolik",
          )}). Firestore qoidalarini tekshiring.</div>`;
        }
      },
    );
  } catch (e) {
    console.error("startMyMessagesListener:", e);
  }
}

async function submitContactMessage() {
  const text = contactMessageInput?.value?.trim();

  if (!text) {
    return alert("🔒 " + tt("contact.emptyWarning", "Iltimos, xabar matnini kiriting."));
  }

  if (!currentUserUid || isGuestUser) {
    return alert(
      "🔒 " +
        tt(
          "contact.guestOnly",
          "Murojaat yuborish uchun ro'yxatdan o'tgan hisobingiz bilan tizimga kiring.",
        ),
    );
  }

  if (contactSendBtn) contactSendBtn.disabled = true;

  try {
    await addDoc(collection(db, SUPPORT_COLLECTION), {
      uid: currentUserUid,
      email: auth.currentUser?.email || "",
      displayName: auth.currentUser?.displayName || "",
      message: text,
      createdAt: serverTimestamp(),
      adminReply: "",
      repliedAt: null,
      dismissedByUser: false,
    });

    if (contactMessageInput) contactMessageInput.value = "";

    if (contactSendStatus) {
      contactSendStatus.textContent = "✅ " + tt("contact.sent", "Xabaringiz yuborildi!");

      clearTimeout(submitContactMessage._t);
      submitContactMessage._t = setTimeout(() => {
        if (contactSendStatus) contactSendStatus.textContent = "";
      }, 3000);
    }
  } catch (e) {
    console.error("submitContactMessage:", e);
    alert("❌ Xabarni yuborib bo'lmadi: " + e.message);
  } finally {
    if (contactSendBtn) contactSendBtn.disabled = false;
  }
}

window.submitContactMessage = submitContactMessage;

function openContactModal() {
  if (!contactModal) return;
  contactModal.style.display = "flex";
  renderMyMessages();
}

function closeContactModal() {
  if (!contactModal) return;
  contactModal.style.display = "none";
}

window.openContactModal = openContactModal;
window.closeContactModal = closeContactModal;

document.addEventListener("beks:langchange", () => {
  renderMyMessages();
  renderReplyBanners();
});

/* =========================================================
   O'QITUVCHI QULFI (TEACHER LOCK)
   O'quvchilar mavzu/ishtirokchini bilmasdan
   o'chirib yubormasligi uchun — boshqaruv
   funksiyalari PIN kod bilan qulflanadi.
========================================================= */

/*
 * Standart holat — OCHIQ. Foydalanuvchi
 * o'zi xohlaganda header/board'dagi 🔒
 * tugmasini bosib qulflaydi (PIN so'ralmaydi),
 * qayta ochish uchun esa PIN kerak bo'ladi.
 */
let teacherUnlocked = true;

function getTeacherPinKey() {
  return "teacherPin_" + (currentUserUid || "guest");
}

function getTeacherPin() {
  return localStorage.getItem(getTeacherPinKey());
}

function setTeacherPin(pin) {
  localStorage.setItem(getTeacherPinKey(), pin);
}

function applyLockUI() {
  document.body.classList.toggle("teacherLocked", !teacherUnlocked);

  const btn = $("teacherLockBtn");

  if (btn) {
    btn.textContent = teacherUnlocked ? "🔓" : "🔒";

    btn.title = teacherUnlocked
      ? "Boshqaruv ochiq — qulflash uchun bosing"
      : "Boshqaruv qulflangan — ochish uchun bosing";
  }
}

function openTeacherLockModal() {
  /*
   * Allaqachon ochiq bo'lsa —
   * PIN so'ralmasdan darhol
   * qayta qulflanadi.
   */
  if (teacherUnlocked) {
    teacherUnlocked = false;
    applyLockUI();
    return;
  }

  const hasPin = !!getTeacherPin();

  const title = $("teacherLockTitle");

  const hint = $("teacherLockHint");

  const input = $("teacherLockPinInput");

  const submitBtn = $("teacherLockSubmitBtn");

  if (title) {
    title.textContent = hasPin ? "Boshqaruvni ochish" : "PIN kod o‘rnating";
  }

  if (hint) {
    hint.textContent = hasPin
      ? "Boshqaruv funksiyalarini (mavzu/ishtirokchi o‘chirish, sozlamalar) ochish uchun PIN kodni kiriting."
      : "Bu birinchi marta ishlatilyapti — o‘zingiz uchun PIN kod o‘rnating. Bu kod orqali keyinchalik boshqaruvni ochasiz.";
  }

  if (input) {
    input.value = "";
  }

  if (submitBtn) {
    submitBtn.textContent = hasPin ? "Ochish" : "O‘rnatish";
  }

  const modal = $("teacherLockModal");

  if (modal) {
    modal.style.display = "flex";
  }

  setTimeout(() => input?.focus(), 50);
}

function closeTeacherLockModal() {
  const modal = $("teacherLockModal");

  if (modal) {
    modal.style.display = "none";
  }
}

window.closeTeacherLockModal = closeTeacherLockModal;

function submitTeacherLockPin() {
  const input = $("teacherLockPinInput");

  const pin = (input?.value || "").trim();

  if (!pin) {
    alert("PIN kodni kiriting!");
    return;
  }

  const hasPin = !!getTeacherPin();

  if (!hasPin) {
    if (pin.length < 4) {
      alert("PIN kod kamida 4 ta belgidan iborat bo‘lsin!");
      return;
    }

    setTeacherPin(pin);

    teacherUnlocked = true;

    applyLockUI();

    closeTeacherLockModal();

    alert(
      "✅ PIN kod o‘rnatildi va boshqaruv ochildi. Bu kodni eslab qoling — Profil bo‘limidan o‘zgartirishingiz mumkin!",
    );

    return;
  }

  if (pin === getTeacherPin()) {
    teacherUnlocked = true;

    applyLockUI();

    closeTeacherLockModal();
  } else {
    alert("❌ PIN kod noto‘g‘ri!");
  }
}

$("teacherLockBtn")?.addEventListener("click", () => {
  openTeacherLockModal();
});

$("teacherLockSubmitBtn")?.addEventListener("click", () => {
  submitTeacherLockPin();
});

$("teacherLockPinInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    submitTeacherLockPin();
  }
});

$("savePinBtn")?.addEventListener("click", () => {
  const input = $("teacherPinInput");

  const pin = (input?.value || "").trim();

  if (!pin) {
    alert("Yangi PIN kodni kiriting!");
    return;
  }

  if (pin.length < 4) {
    alert("PIN kod kamida 4 ta belgidan iborat bo‘lsin!");
    return;
  }

  setTeacherPin(pin);

  if (input) {
    input.value = "";
  }

  alert("✅ Yangi PIN kod saqlandi!");
});

$("changePasswordBtn")?.addEventListener("click", async () => {
  if (!auth.currentUser || !auth.currentUser.email || currentUserUid === "guest_offline") {
    alert(
      "Mehmon (offline) rejimida parolni o‘zgartirib bo‘lmaydi. " +
        "Bu funksiyadan foydalanish uchun ro‘yxatdan o‘ting.",
    );
    return;
  }

  const currentPassword = ($("currentPasswordInput")?.value || "").trim();

  const newPassword = ($("newPasswordInput")?.value || "").trim();

  const newPasswordConfirm = ($("newPasswordConfirmInput")?.value || "").trim();

  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    alert("Barcha parol maydonlarini to‘ldiring!");
    return;
  }

  if (newPassword.length < 6) {
    alert("Yangi parol kamida 6 ta belgidan iborat bo‘lsin!");
    return;
  }

  if (newPassword !== newPasswordConfirm) {
    alert("Yangi parol va tasdiqlash mos emas!");
    return;
  }

  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);

    await reauthenticateWithCredential(auth.currentUser, credential);

    await updatePassword(auth.currentUser, newPassword);

    $("currentPasswordInput").value = "";
    $("newPasswordInput").value = "";
    $("newPasswordConfirmInput").value = "";

    alert("✅ Parol muvaffaqiyatli yangilandi!");
  } catch (e) {
    console.error(e);

    if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
      alert("Joriy parol noto‘g‘ri!");
    } else if (e.code === "auth/too-many-requests") {
      alert("Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.");
    } else {
      alert("Xato: " + (e.message || e));
    }
  }
});

/*
 * Boshlang'ich holat — sahifa
 * har ochilganda OCHIQ holatda
 * boshlanadi (standart holat).
 * Foydalanuvchi xohlasa, header/board
 * dagi 🔒 tugmasini bosib o'zi qulflaydi.
 */
applyLockUI();

$("introPlayBtn")?.addEventListener("click", () => {
  confirmStartTopicGame();
});

$("introDuelBtn")?.addEventListener("click", () => {
  confirmStartDuel();
});

$("introRoomBtn")?.addEventListener("click", () => {
  openRoomSetup();
});

$("roomSetupConfirmBtn")?.addEventListener("click", () => {
  confirmOpenRoom();
});

$("duelExitBtn")?.addEventListener("click", () => {
  exitDuel();
});

saveProfileBtn?.addEventListener("click", async () => {
  const name = displayNameInput?.value?.trim();

  if (!name) {
    return alert("Iltimos ism kiriting!");
  }

  try {
    await updateProfile(auth.currentUser, {
      displayName: name,
    });

    const ref = getUserDocRef();

    if (ref) {
      await updateDoc(ref, {
        displayName: name,
      });
    }

    window.closeAccountModal();
  } catch (e) {
    console.error(e);

    alert("Xatolik yuz berdi");
  }
});

$("logoutBtn")?.addEventListener("click", () =>
  signOut(auth).then(() => (location.href = "index.html")),
);

/* ================= INIT ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html";

    return;
  }

  currentUserUid = user.uid;

  isGuestUser = !!user.isAnonymous;

  localStorage.setItem("uid", currentUserUid);

  /*
   * Murojaatlar (support messages) tinglovchisini
   * ishga tushiramiz — real vaqtda o'z xabarlari va
   * ularga berilgan admin javoblarini kuzatib boradi
   * (mehmon foydalanuvchilar uchun ishlamaydi).
   */
  startMyMessagesListener();

  /*
   * Har yangi kirishda (login)
   * hujjat keshi tozalanadi —
   * shunda eski/boshqa
   * foydalanuvchiga tegishli
   * ma'lumot qolib ketmaydi.
   */
  resetUserDocCache();

  await loadCategorySettings();

  await loadParticipants();

  /*
   * index.html'dagi "Jonli xona / Duel / Play"
   * tugmalaridan kelingan bo'lsa aniqlaymiz.
   *
   * ?liveStart=room|duel|play — qaysi rejim uchun
   *   kelinganini bildiradi ("room" — eski
   *   ?openRoom=1 bilan ham mos keladi).
   * ?names=Ali,Vali,... — Duel/Play uchun
   *   index.html'da oldindan kiritilgan
   *   ishtirokchi ismlari (bo'lsa).
   */
  const params = new URLSearchParams(window.location.search);

  const liveStart = params.get("liveStart") || (params.get("openRoom") === "1" ? "room" : null);

  const hasValidLiveStart = liveStart === "room" || liveStart === "duel" || liveStart === "play";

  /*
   * MUHIM (XATOLIK TUZATILDI): ilgari bu klass FAQAT
   * mehmon (guest) uchun qo'shilardi. Ro'yxatdan o'tgan
   * foydalanuvchi index.html'dagi "Jonli xona" tugmasi
   * orqali kelganda esa, mavzu tanlash oynasi ochilishidan
   * OLDIN bir nechta tarmoq so'rovi (loadTopicsSafe,
   * loadOtherTopics va h.k.) amalga oshardi — shu vaqt
   * ichida asosiy o'yin sahifasi (board) BIR ZUM to'liq
   * ko'rinib, keyin ustidan modal ochilardi. Endi bu
   * klass "hasValidLiveStart" aniqlangan zahoti — har
   * qanday keyingi kodni kutmasdan — qo'shiladi, shu
   * sabab board hech qachon "yalang'och" ko'rinmaydi.
   */
  if (hasValidLiveStart) {
    document.body.classList.add("guestQuickLaunchMode");
    launchedFromIndex = true;
  }

  if (isGuestUser) {
    /*
     * MUHIM: savollar kartasi bor asosiy
     * boshqaruv paneli ("board") faqat haqiqiy
     * (ro'yxatdan o'tgan) foydalanuvchilar uchun.
     * Mehmon (anonim) sessiya aniq maqsadsiz
     * (Jonli xona/Duel/Play'dan kelmagan holda)
     * bu sahifaga tushib qolsa — darhol
     * index.html'ga qaytariladi, board hech
     * qachon render qilinmaydi.
     */
    if (!hasValidLiveStart) {
      window.location.href = "index.html";
      return;
    }

    guestQuickLaunch = true;

    await initSettings();

    /*
     * Faqat mavzular RO'YXATI uchun kerak bo'lgan
     * ma'lumotni to'g'ridan-to'g'ri "sharedTopics"
     * kolleksiyasidan yuklaymiz — board hech qachon
     * render qilinmaydi (setupGuestDemoTopic()
     * o'rniga, chunki u board'ni ko'rsatib qo'yardi).
     */
    await loadOtherTopics();

    userTopics = otherTopics.map((t) => ({ ...t }));

    currentUserTopicId = null;

    renderTeams();
  } else {
    await loadTopicsSafe();

    await initSettings();

    restoreLastTopic();

    renderBoard();

    renderTeams();

    await loadOtherTopics();

    /*
     * Eski usulda saqlangan
     * mavzularni ("users" hujjati
     * ichida) yangi, tez ishlaydigan
     * "sharedTopics" kolleksiyasiga
     * fonda ko'chirib qo'yamiz —
     * UI'ni kutdirmaslik uchun
     * await qilinmaydi.
     */
    syncSharedTopics();

    /*
     * Tashlab ketilgan (host tomonidan yopilmagan)
     * eski xonalarni fonda tozalab boramiz — UI'ni
     * kutdirmaslik uchun await qilinmaydi.
     */
    cleanupStaleRoomsOnce();

    /*
     * "🛠 Boshqaruv paneli" tugmasi faqat
     * users/{uid} hujjatida role: "admin"
     * bo'lganlarga ko'rinadi. fetchUserDocOnce()
     * boshqa joylarda ham ishlatilgani uchun
     * (keshlangan) qo'shimcha tarmoq so'rovi
     * qilmaydi.
     */
    try {
      const myDoc = await fetchUserDocOnce();

      if (myDoc?.role === "admin" && $("adminPanelBtn")) {
        $("adminPanelBtn").classList.remove("hidden");
      }
    } catch (e) {
      console.warn("Admin holatini tekshirishda xatolik:", e);
    }
  }

  if (hasValidLiveStart) {
    roomPickerTargetMode = liveStart;

    const namesParam = params.get("names");

    if ((liveStart === "duel" || liveStart === "play") && namesParam) {
      const names = namesParam
        .split(",")
        .map((n) => decodeURIComponent(n).trim())
        .filter(Boolean)
        .slice(0, 40);

      teamsData = names.map((n) => createGuestDuelTeam(n));

      renderTeams();
    }

    /*
     * ?timer=NN — index.html'dagi "Play" bosqichida
     * mehmon o'zi tanlagan savol vaqti (soniya). Faqat
     * "play" rejimi uchun ishlatiladi; kiritilmagan yoki
     * noto'g'ri bo'lsa, initSettings() allaqachon
     * o'rnatgan standart (shaxsiy yoki global) qiymat
     * o'zgarishsiz qoladi.
     */
    if (liveStart === "play") {
      const timerParam = parseInt(params.get("timer"), 10);

      if (Number.isFinite(timerParam) && timerParam > 0) {
        userTimer = Math.min(timerParam, 300);

        if ($("timerInput")) {
          $("timerInput").value = userTimer;
        }
      }
    }

    openRoomTopicPicker();
  }
});

/* ================= TEMPLATE DOWNLOAD ================= */

$("downloadTemplateBtn")?.addEventListener("click", async () => {
  try {
    await loadXlsxLib();
  } catch (e) {
    alert("Excel kutubxonasi yuklanmadi. Internetni tekshirib, qayta urinib ko'ring.");
    return;
  }

  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([
    ["Question", "Answer", "Wrong Answer 1", "Wrong Answer 2", "Wrong Answer 3"],

    ["Savol matni", "To'g'ri javob", "Noto'g'ri javob 1", "Noto'g'ri javob 2", "Noto'g'ri javob 3"],

    ["Savol matni", "To'g'ri javob", "Noto'g'ri javob 1", "Noto'g'ri javob 2", "Noto'g'ri javob 3"],
  ]);

  XLSX.utils.book_append_sheet(wb, ws, "Shablon");

  XLSX.writeFile(wb, "BeksGame_Shablon.xlsx");
});

/* Final public exports (single place to avoid duplicates) */
window.openQ = openQ;
window.closeModal = closeModal;
window.addTeamWithParticipant = addTeamWithParticipant;
window.addSelectedParticipantToTeam = addTeamWithParticipant;
window.addScore = addScore;