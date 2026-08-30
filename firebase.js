// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAnalytics, isSupported, logEvent } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyCjb_SxZGmzVQdrY9bCceyEP4jYVTAq8Ps",
    authDomain: "beks-game.firebaseapp.com",
    projectId: "beks-game",
    storageBucket: "beks-game.firebasestorage.app",
    messagingSenderId: "101120658989",
    appId: "1:101120658989:web:513fd1ef29a003605a72a4",
    measurementId: "G-TJHYR914SQ"
  };
  


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

/*
 * MUHIM: ba'zi tarmoqlar (maktab/tashkilot
 * Wi-Fi'si, antivirus, reklama blokerlari)
 * Firestore'ning odatiy WebChannel
 * (streaming) ulanishini to'sib qo'yadi —
 * natijada "Could not reach Cloud Firestore
 * backend" / "transport errored" xatolari
 * takrorlanaveradi, garchi internet o'zi
 * ishlab tursa ham.
 *
 * "experimentalAutoDetectLongPolling"
 * shunday tarmoqlarda avtomatik ravishda
 * oddiy uzun-so'rov (long polling) rejimiga
 * o'tkazadi, bu deyarli har qanday tarmoqda
 * ishlaydi (biroz sekinroq, lekin barqaror).
 */
export const db = initializeFirestore(app, {
  /*
   * "AutoDetect" avval oddiy (WebChannel/streaming)
   * usulni sinaydi, u ba'zi tarmoqlarda (maktab Wi-Fi,
   * mobil operator, antivirus) bloklanadi -> 404 xatosi
   * -> keyin sekin-asta long-polling'ga o'tadi. Shu
   * o'tish payti sahifa "osilib qolgandek" ko'rinadi.
   *
   * "ForceLongPolling" bu aniqlash bosqichini butunlay
   * tashlab yuboradi va BIRINCHI URINISHDANOQ barqaror
   * usuldan foydalanadi -> muvaffaqiyatsiz "Listen" oqim
   * xatolari deyarli yo'qoladi. Ozgina sekinroq (ayniqsa
   * ochilishda), lekin ancha ishonchli.
   */
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

/*
 * GOOGLE ANALYTICS (GA4)
 * ------------------------------------------------------
 * Sahifaga necha kishi kirganini, qachon eng faol
 * bo'lishlarini va h.k. ko'rish uchun. Bu Firestore'ga
 * HECH QANDAY yozuv qilmaydi (alohida, mustaqil Google
 * tizimi) — shu sabab saytning tezligiga ta'sir qilmaydi.
 *
 * Natijalarni ko'rish: Firebase Console -> Analytics,
 * yoki to'g'ridan-to'g'ri analytics.google.com.
 *
 * "isSupported()" tekshiruvi shart — chunki Analytics
 * ba'zi muhitlarda (masalan localhost'da ba'zan, yoki
 * cookie/tracking bloklangan brauzerlarda) ishlamaydi;
 * shunday holatda xatolik chiqarmasdan "analytics" shunchaki
 * null bo'lib qoladi.
 */
export let analytics = null;

(async () => {
  try {
    if (await isSupported()) {
      analytics = getAnalytics(app);

      logEvent(analytics, "page_view", {
        page_title: document.title,
        page_location: window.location.href,
        page_path: window.location.pathname
      });
    }
  } catch (e) {
    console.warn("Analytics init:", e);
  }
})();