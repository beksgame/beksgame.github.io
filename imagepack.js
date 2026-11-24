/* ==========================================================
   BEKS GAME — RASMLI PAKET (imagepack.js)

   Zip ichidagi rasmlardan avtomatik savollar yasash va ularni
   o'yin paytida ko'rsatish uchun umumiy yordamchi. game.html va
   index.html'da ulanadi.

   Savolda rasm havolasi shunday saqlanadi:
        img: "<zip havolasi>#<fayl nomi>"
   (masalan "img/mevalar.zip#olma.jpg"). Rasmning o'zi Firestore'ga
   YOZILMAYDI — zip bir marta yuklab olinadi va brauzerda ochiladi.
========================================================== */
(function () {
  "use strict";

  var IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  var MIME = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    bmp: "image/bmp",
  };

  var JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var jszipPromise = null;
  var packCache = {}; // zipUrl -> Promise<{files: [{file,label,url}], map}>

  function loadJsZip() {
    if (window.JSZip) return Promise.resolve();
    if (!jszipPromise) {
      jszipPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = JSZIP_URL;
        s.onload = function () {
          resolve();
        };
        s.onerror = function () {
          jszipPromise = null;
          reject(new Error("Zip kutubxonasi yuklanmadi. Internetni tekshiring."));
        };
        document.head.appendChild(s);
      });
    }
    return jszipPromise;
  }

  /* GitHub "blob" havolasini to'g'ridan-to'g'ri (raw) havolaga aylantiradi */
  function normalizeUrl(url) {
    url = String(url || "").trim();
    var m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
    if (m) {
      return "https://raw.githubusercontent.com/" + m[1] + "/" + m[2] + "/" + m[3] + "/" + m[4];
    }
    return url;
  }

  /* "yashil_olma-2.JPG" -> "Yashil olma 2" */
  function labelFromFile(name) {
    var base = String(name || "")
      .normalize("NFC")
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
    base = base.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!base) return "";
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function splitRef(ref) {
    ref = String(ref || "");
    var i = ref.lastIndexOf("#");
    if (i < 0) return { zip: "", file: ref };
    return { zip: ref.slice(0, i), file: ref.slice(i + 1) };
  }

  function makeRef(zipUrl, file) {
    return normalizeUrl(zipUrl) + "#" + file;
  }

  function loadPack(zipUrl) {
    zipUrl = normalizeUrl(zipUrl);
    if (!zipUrl) return Promise.reject(new Error("Zip havolasi bo'sh."));

    if (!packCache[zipUrl]) {
      packCache[zipUrl] = Promise.all([loadJsZip(), fetch(zipUrl)])
        .then(function (r) {
          var res = r[1];
          if (!res.ok) throw new Error("Zip yuklanmadi (" + res.status + "). Havolani tekshiring.");
          return res.arrayBuffer();
        })
        .then(function (buf) {
          /*
           * Fayl nomlari UTF-8 bo'lmagan (eski Windows/koreys CP949)
           * zip'lar uchun zaxira dekoder: avval UTF-8, bo'lmasa EUC-KR.
           */
          return window.JSZip.loadAsync(buf, {
            decodeFileName: function (bytes) {
              var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
              try {
                return new TextDecoder("utf-8", { fatal: true }).decode(u8);
              } catch (e) {
                try {
                  return new TextDecoder("euc-kr").decode(u8);
                } catch (e2) {
                  return new TextDecoder("utf-8").decode(u8);
                }
              }
            },
          });
        })
        .then(function (zip) {
          var entries = [];
          zip.forEach(function (path, entry) {
            if (entry.dir) return;
            var base = path.replace(/^.*[\\/]/, "");
            if (!base || base.charAt(0) === "." || path.indexOf("__MACOSX") === 0) return;
            if (!IMG_EXT.test(base)) return;
            entries.push({ path: path, base: base, entry: entry });
          });
          entries.sort(function (a, b) {
            return a.base.localeCompare(b.base);
          });

          return Promise.all(
            entries.map(function (e) {
              return e.entry.async("blob").then(function (blob) {
                var ext = e.base.split(".").pop().toLowerCase();
                var typed = new Blob([blob], { type: MIME[ext] || "image/jpeg" });
                return {
                  file: e.base,
                  label: labelFromFile(e.base),
                  url: URL.createObjectURL(typed),
                };
              });
            }),
          );
        })
        .then(function (files) {
          var map = {};
          files.forEach(function (f) {
            map[f.file.normalize("NFC").toLowerCase()] = f.url;
          });
          return { files: files, map: map };
        })
        .catch(function (err) {
          delete packCache[zipUrl]; // keyingi urinishda qayta yuklansin
          throw err;
        });
    }
    return packCache[zipUrl];
  }

  /* ref -> tayyor <img src> manzili */
  function resolve(ref) {
    ref = String(ref || "").trim();
    if (!ref) return Promise.resolve("");

    var p = splitRef(ref);
    if (!p.zip) {
      // oddiy to'g'ridan-to'g'ri rasm havolasi
      return Promise.resolve(normalizeUrl(ref));
    }
    return loadPack(p.zip).then(function (pack) {
      return pack.map[p.file.normalize("NFC").toLowerCase()] || "";
    });
  }

  /* Savollar ro'yxatidagi barcha zip'larni oldindan yuklab qo'yish */
  function prefetch(refs) {
    var seen = {};
    (refs || []).forEach(function (ref) {
      var p = splitRef(ref);
      if (p.zip && !seen[p.zip]) {
        seen[p.zip] = true;
        loadPack(p.zip).catch(function () {});
      }
    });
  }

  function escAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /* innerHTML shablonlari uchun: <img data-bpref="..."> */
  function imageHtml(ref) {
    if (!ref) return "";
    return (
      '<div class="qImageWrap"><img class="qImage" alt="" data-bpref="' +
      escAttr(ref) +
      '"></div>'
    );
  }

  function hydrateImg(img) {
    var ref = img.getAttribute("data-bpref");
    if (!ref || img.getAttribute("data-bp-state")) return;
    img.setAttribute("data-bp-state", "loading");
    img.closest(".qImageWrap") && img.closest(".qImageWrap").classList.add("loading");

    resolve(ref)
      .then(function (url) {
        var wrap = img.closest(".qImageWrap");
        if (!url) throw new Error("Rasm topilmadi");
        img.onload = function () {
          wrap && wrap.classList.remove("loading");
        };
        img.src = url;
        img.setAttribute("data-bp-state", "ok");
      })
      .catch(function () {
        var wrap = img.closest(".qImageWrap");
        if (wrap) {
          wrap.classList.remove("loading");
          wrap.classList.add("failed");
          wrap.setAttribute("data-msg", "🖼 Rasm yuklanmadi");
        }
        img.setAttribute("data-bp-state", "error");
      });
  }

  function hydrate(root) {
    (root || document).querySelectorAll("img[data-bpref]:not([data-bp-state])").forEach(hydrateImg);
  }

  /* #qText oldiga (yoki berilgan elementdan oldin) rasm qo'yadi / yashiradi */
  function setBefore(textEl, ref) {
    if (!textEl || !textEl.parentNode) return;
    var holder = textEl.parentNode.querySelector(":scope > .qImageWrap.bpHolder");

    if (!ref) {
      if (holder) holder.remove();
      return;
    }
    if (holder) holder.remove();

    var tmp = document.createElement("div");
    tmp.innerHTML = imageHtml(ref);
    holder = tmp.firstChild;
    holder.classList.add("bpHolder");
    textEl.parentNode.insertBefore(holder, textEl);
    hydrate(holder);
  }

  /* DOM'ga keyin qo'shilgan har qanday <img data-bpref> ni avtomatik tayyorlaydi */
  if (window.MutationObserver) {
    var started = false;
    var startObserver = function () {
      if (started || !document.body) return;
      started = true;
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes && muts[i].addedNodes.length) {
            hydrate(document);
            break;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) startObserver();
    else document.addEventListener("DOMContentLoaded", startObserver);
  }

  /* ---------- Zip'dan savollar yasash ----------
     Savol matni: "Rasmda nima tasvirlangan?"
     To'g'ri javob: fayl nomi (olma.jpg -> "Olma")
     Variantlar: shu zip'dagi boshqa rasmlar nomlaridan 3 tasi */
  var DEFAULT_QUESTION = "Rasmda nima tasvirlangan?";

  function buildQuestions(zipUrl, files, questionText) {
    var labels = [];
    var seenLabels = {};
    var items = [];

    files.forEach(function (f) {
      var key = f.label.toLowerCase();
      if (!f.label || seenLabels[key]) return; // bir xil nomli rasmni o'tkazib yuboramiz
      seenLabels[key] = true;
      labels.push(f.label);
      items.push(f);
    });

    return items.map(function (f) {
      var others = labels.filter(function (l) {
        return l !== f.label;
      });
      // Fisher-Yates
      for (var i = others.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = others[i];
        others[i] = others[j];
        others[j] = t;
      }
      return {
        q: questionText || DEFAULT_QUESTION,
        a: f.label,
        wrongAnswers: others.slice(0, 3),
        img: makeRef(zipUrl, f.file),
      };
    });
  }

  window.BeksImagePack = {
    normalizeUrl: normalizeUrl,
    labelFromFile: labelFromFile,
    loadPack: loadPack,
    resolve: resolve,
    prefetch: prefetch,
    imageHtml: imageHtml,
    hydrate: hydrate,
    setBefore: setBefore,
    buildQuestions: buildQuestions,
    DEFAULT_QUESTION: DEFAULT_QUESTION,
  };
})();