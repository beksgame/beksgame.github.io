import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = id => document.getElementById(id);

const deniedScreen = $("deniedScreen");
const adminPanel = $("adminPanel");
const usersList = $("usersList");
const statsRow = $("adminStatsRow");
const searchInput = $("userSearchInput");
const toastEl = $("adminToast");

const topicLimitInput = $("topicLimitInput");
const participantLimitInput = $("participantLimitInput");
const saveSettingsBtn = $("saveSettingsBtn");
const adminMessagesList = $("adminMessagesList");

const DEFAULT_TOPIC_LIMIT = 10;
const DEFAULT_PARTICIPANT_LIMIT = 10;
const SUPPORT_COLLECTION = "supportMessages";

let allUsers = [];
let currentUid = null;
let supportMessages = [];
let messagesUnsub = null;

/*
 * 4 TA MUSTAQIL RUXSAT.
 * Firestore'da maydon UMUMAN yo'q bo'lsa (masalan eski
 * hujjatlar) — standart TRUE deb hisoblanadi (hamma narsa
 * ruxsat etilgan), faqat admin ANIQ false qo'ysa cheklangan
 * hisoblanadi. Shu sabab checkbox'ning boshlang'ich holati
 * har doim "field !== false" orqali aniqlanadi.
 */
const PERMISSIONS = [
  { key: "canAddQuestions", label: "Mavzu qo'shish" },
  { key: "canEditTopics", label: "Mavzu tahrirlash" },
  { key: "canAddParticipants", label: "Ishtirokchi qo'shish" },
  { key: "canSetParticipantImage", label: "Ishtirokchi rasmi" }
];

function escapeHtml(value) {
  const d = document.createElement("div");
  d.textContent = String(value ?? "");
  return d.innerHTML;
}

function showToast(text, isError = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle("isError", isError);
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2600);
}

/* ================= AUTH / ADMIN TEKSHIRUVI ================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "index.html";
    return;
  }

  currentUid = user.uid;

  let myRole = null;

  try {
    const mySnap = await getDoc(doc(db, "users", user.uid));
    myRole = mySnap.exists() ? mySnap.data().role : null;
  } catch (e) {
    console.error("Admin tekshiruvi xatosi:", e);
  }

  if (myRole !== "admin") {
    deniedScreen.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    return;
  }

  deniedScreen.classList.add("hidden");
  adminPanel.classList.remove("hidden");

  await Promise.all([loadUsers(), loadAppSettings()]);
  startMessagesListener();
});

$("adminLogoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    location.href = "index.html";
  } catch (e) {
    console.error(e);
  }
});

/* ================= FOYDALANUVCHILARNI YUKLASH ================= */

async function loadUsers() {
  usersList.innerHTML = '<div class="usersLoading">Yuklanmoqda...</div>';

  try {
    const snap = await getDocs(collection(db, "users"));

    allUsers = snap.docs.map(d => {
      const data = d.data();

      const perms = {};
      PERMISSIONS.forEach(p => {
        perms[p.key] = data[p.key] !== false;
      });

      return {
        uid: d.id,
        displayName: data.displayName || "",
        email: data.email || "",
        role: data.role || "user",
        ...perms
      };
    });

    // Ismi bo'lmaganlar oxirida, qolganlari alifbo tartibida
    allUsers.sort((a, b) => {
      const an = a.displayName || "\uffff";
      const bn = b.displayName || "\uffff";
      return an.localeCompare(bn, "uz");
    });

    renderStats();
    renderUsers(allUsers);
  } catch (e) {
    console.error("Foydalanuvchilarni yuklashda xatolik:", e);
    usersList.innerHTML =
      '<div class="usersEmpty">❌ Foydalanuvchilarni yuklab bo\'lmadi. Firestore qoidalarini tekshiring.</div>';
  }
}

function renderStats() {
  const total = allUsers.length;
  const admins = allUsers.filter(u => u.role === "admin").length;
  const restricted = allUsers.filter(u =>
    PERMISSIONS.some(p => !u[p.key])
  ).length;

  statsRow.innerHTML = `
    <div class="adminStatChip"><strong>${total}</strong>jami foydalanuvchi</div>
    <div class="adminStatChip"><strong>${restricted}</strong>kamida bitta cheklovi bor</div>
    <div class="adminStatChip"><strong>${admins}</strong>administrator</div>
  `;
}

function renderUsers(list) {
  if (!list.length) {
    usersList.innerHTML = '<div class="usersEmpty">Hech kim topilmadi.</div>';
    return;
  }

  usersList.innerHTML = list.map(u => {
    const name = u.displayName || "Ismsiz foydalanuvchi";
    const initial = (u.displayName || "?").trim().charAt(0).toUpperCase() || "?";
    const metaParts = [u.email, u.uid].filter(Boolean);
    const isAdmin = u.role === "admin";

    const permsHtml = PERMISSIONS.map(p => `
      <label class="permToggle">
        <span class="permToggleLabel">${escapeHtml(p.label)}</span>
        <span class="toggleSwitch">
          <input
            type="checkbox"
            data-action="togglePerm"
            data-key="${p.key}"
            ${u[p.key] ? "checked" : ""}
          >
          <span class="toggleTrack"><span class="toggleThumb"></span></span>
        </span>
      </label>
    `).join("");

    return `
      <div class="userRow" data-uid="${escapeHtml(u.uid)}">
        <div class="userTop">
          <div class="userAvatar">${escapeHtml(initial)}</div>
          <div class="userInfo">
            <div class="userName">
              ${escapeHtml(name)}
              ${isAdmin ? '<span class="roleBadge isAdmin">Admin</span>' : ""}
            </div>
            <div class="userMeta">${escapeHtml(metaParts.join(" · "))}</div>
          </div>
          <button
            type="button"
            class="adminToggleBtn"
            data-action="toggleAdmin"
            ${u.uid === currentUid ? "disabled title=\"O'zingizni bu yerdan o'zgartira olmaysiz\"" : ""}
          >${isAdmin ? "👑 Admin olib tashlash" : "👑 Admin qilish"}</button>
        </div>

        <div class="userPerms">
          ${permsHtml}
        </div>
      </div>
    `;
  }).join("");
}

/* ================= RUXSATLARNI O'ZGARTIRISH ================= */

usersList.addEventListener("click", async e => {
  const btn = e.target.closest("button[data-action='toggleAdmin']");
  if (!btn || btn.disabled) return;

  const row = e.target.closest(".userRow");
  const uid = row?.dataset?.uid;
  const user = allUsers.find(u => u.uid === uid);
  if (!user) return;

  btn.disabled = true;

  try {
    const makingAdmin = user.role !== "admin";
    const ok = confirm(
      makingAdmin
        ? `${user.displayName || "Bu foydalanuvchi"}ni administrator qilmoqchimisiz? Ular ham shu panelga kira oladi.`
        : `${user.displayName || "Bu foydalanuvchi"}dan administratorlik huquqini olib tashlaymi?`
    );
    if (!ok) {
      btn.disabled = false;
      return;
    }
    const nextRole = makingAdmin ? "admin" : "user";
    await updateDoc(doc(db, "users", uid), { role: nextRole });
    user.role = nextRole;
    showToast(
      makingAdmin
        ? `${user.displayName || "Foydalanuvchi"} administrator qilindi`
        : `${user.displayName || "Foydalanuvchi"} oddiy foydalanuvchiga aylantirildi`
    );

    renderStats();
    renderUsers(applySearch(searchInput.value));
  } catch (err) {
    console.error(err);
    showToast("❌ Xatolik: " + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

usersList.addEventListener("change", async e => {
  const input = e.target.closest("input[data-action='togglePerm']");
  if (!input) return;

  const row = e.target.closest(".userRow");
  const uid = row?.dataset?.uid;
  const user = allUsers.find(u => u.uid === uid);
  const key = input.dataset.key;
  const permMeta = PERMISSIONS.find(p => p.key === key);
  if (!user || !permMeta) return;

  const next = input.checked;
  input.disabled = true;

  try {
    await updateDoc(doc(db, "users", uid), { [key]: next });
    user[key] = next;

    showToast(
      next
        ? `${user.displayName || "Foydalanuvchi"} uchun "${permMeta.label}" yoqildi`
        : `${user.displayName || "Foydalanuvchi"} uchun "${permMeta.label}" cheklandi`
    );

    renderStats();
  } catch (err) {
    console.error(err);
    input.checked = !next;
    showToast("❌ Xatolik: " + err.message, true);
  } finally {
    input.disabled = false;
  }
});

/* ================= QIDIRUV ================= */

function applySearch(term) {
  const q = term.trim().toLowerCase();
  if (!q) return allUsers;
  return allUsers.filter(u =>
    (u.displayName || "").toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q) ||
    (u.uid || "").toLowerCase().includes(q)
  );
}

searchInput?.addEventListener("input", () => {
  renderUsers(applySearch(searchInput.value));
});

/* ================= SOZLAMALAR: LIMITLAR =================
 *
 * settings/app { topicLimit, participantLimit } — game.js
 * shu qiymatlarni o'qib, oddiy foydalanuvchilar uchun bepul
 * limit sifatida qo'llaydi (hech narsa kiritilmasa — 10
 * ishlatiladi).
 *
 * MUHIM: bu hujjat barcha login qilgan foydalanuvchilar
 * tomonidan O'QILISHI, lekin FAQAT admin tomonidan
 * YOZILISHI kerak — buni Firestore xavfsizlik qoidalarida
 * (security rules) alohida belgilash zarur, bu yerdagi kod
 * uni ta'minlay olmaydi.
 */

function toPositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function loadAppSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "app"));
    const data = snap.exists() ? snap.data() : {};

    if (topicLimitInput) {
      topicLimitInput.value = toPositiveInt(
        data.topicLimit,
        DEFAULT_TOPIC_LIMIT
      );
    }

    if (participantLimitInput) {
      participantLimitInput.value = toPositiveInt(
        data.participantLimit,
        DEFAULT_PARTICIPANT_LIMIT
      );
    }
  } catch (e) {
    console.error("Sozlamalarni yuklashda xatolik:", e);
    showToast(
      "❌ Sozlamalarni yuklab bo'lmadi: " + e.message,
      true
    );
  }
}

saveSettingsBtn?.addEventListener("click", async () => {
  const topicLimit = toPositiveInt(
    topicLimitInput?.value,
    DEFAULT_TOPIC_LIMIT
  );

  const participantLimit = toPositiveInt(
    participantLimitInput?.value,
    DEFAULT_PARTICIPANT_LIMIT
  );

  saveSettingsBtn.disabled = true;

  try {
    await setDoc(
      doc(db, "settings", "app"),
      { topicLimit, participantLimit },
      { merge: true }
    );

    // Amalda ishlatilgan (tozalangan) qiymatlarni inputlarga qaytaramiz
    if (topicLimitInput) topicLimitInput.value = topicLimit;
    if (participantLimitInput) {
      participantLimitInput.value = participantLimit;
    }

    showToast("✅ Sozlamalar saqlandi");
  } catch (err) {
    console.error(err);
    showToast("❌ Xatolik: " + err.message, true);
  } finally {
    saveSettingsBtn.disabled = false;
  }
});

/* ================= MUROJAATLAR (FOYDALANUVCHI XABARLARI) =================
 *
 * supportMessages/{id} {
 *   uid, email, displayName, message, createdAt,
 *   adminReply, repliedAt, dismissedByUser
 * }
 *
 * Boshqa platformalardagi kabi oddiy "ticket" mantig'i:
 * foydalanuvchi yozadi → admin bu yerda BARCHA murojaatlarni
 * (eng yangisi tepada) real vaqtda ko'radi, har biriga javob
 * yozib yuborishi (updateDoc) yoki butunlay o'chirib
 * tashlashi (deleteDoc) mumkin — shu bilan ro'yxat cheksiz
 * to'lib ketmaydi. Javob yuborilganda "dismissedByUser" ham
 * false qilib qo'yiladi — shu orqali foydalanuvchi tomonida
 * (game.html) yangi javob haqidagi bildirishnoma qayta chiqadi.
 */

function formatMsgDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "";

    return d.toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return "";
  }
}

function startMessagesListener() {
  if (messagesUnsub || !adminMessagesList) return;

  try {
    const q = query(
      collection(db, SUPPORT_COLLECTION),
      orderBy("createdAt", "desc")
    );

    messagesUnsub = onSnapshot(
      q,
      snap => {
        supportMessages = snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }));
        renderMessages();
      },
      err => {
        console.error("startMessagesListener:", err);
        adminMessagesList.innerHTML =
          '<div class="usersEmpty">❌ Murojaatlarni yuklab bo\'lmadi. Firestore qoidalarini tekshiring.</div>';
      }
    );
  } catch (e) {
    console.error("startMessagesListener:", e);
  }
}

function renderMessages() {
  if (!adminMessagesList) return;

  if (!supportMessages.length) {
    adminMessagesList.innerHTML =
      '<div class="usersEmpty">Hozircha murojaatlar yo\'q.</div>';
    return;
  }

  adminMessagesList.innerHTML = supportMessages
    .map(m => {
      const answered = !!m.adminReply;
      const fromLabel = m.email || m.displayName || m.uid || "Noma'lum";

      return `
        <div class="messageRow ${
          answered ? "isAnswered" : "isPending"
        }" data-id="${escapeHtml(m.id)}">
          <div class="messageFrom">
            <span class="messageEmail">${escapeHtml(fromLabel)}</span>
            <span class="messageDate">${escapeHtml(
              formatMsgDate(m.createdAt)
            )}</span>
            <button
              type="button"
              class="messageDeleteBtn"
              data-action="deleteMessage"
              title="O'chirish"
            >🗑</button>
          </div>

          <div class="messageMain">
            <div class="messageText">${escapeHtml(m.message)}</div>
            ${
              answered
                ? `<div class="messageExistingReply"><strong>Javob:</strong> ${escapeHtml(
                    m.adminReply
                  )}</div>`
                : '<div class="messageStatusPending">⏳ Javob kutilmoqda</div>'
            }
            <div class="messageReplyBlock">
              <textarea
                class="messageReplyInput"
                rows="1"
                placeholder="Javob yozing..."
              >${escapeHtml(m.adminReply || "")}</textarea>
              <button type="button" class="messageReplyBtn" data-action="sendReply">
                ${answered ? "Yangilash" : "Yuborish"}
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

adminMessagesList?.addEventListener("click", async e => {
  const row = e.target.closest(".messageRow");
  if (!row) return;

  const id = row.dataset.id;
  if (!id) return;

  if (e.target.closest("[data-action='deleteMessage']")) {
    if (!confirm("Bu murojaatni o'chirmoqchimisiz?")) return;

    try {
      await deleteDoc(doc(db, SUPPORT_COLLECTION, id));
      showToast("Murojaat o'chirildi");
    } catch (err) {
      console.error(err);
      showToast("❌ Xatolik: " + err.message, true);
    }

    return;
  }

  const replyBtn = e.target.closest("[data-action='sendReply']");
  if (replyBtn) {
    const textarea = row.querySelector(".messageReplyInput");
    const replyText = textarea?.value?.trim();

    if (!replyText) {
      return showToast("Javob matnini kiriting", true);
    }

    replyBtn.disabled = true;

    try {
      await updateDoc(doc(db, SUPPORT_COLLECTION, id), {
        adminReply: replyText,
        repliedAt: serverTimestamp(),
        dismissedByUser: false
      });

      showToast("✅ Javob yuborildi");
    } catch (err) {
      console.error(err);
      showToast("❌ Xatolik: " + err.message, true);
    } finally {
      replyBtn.disabled = false;
    }
  }
});