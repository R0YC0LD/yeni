import { initAuth } from './auth.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Dinamik olarak sidebar ve navbar'ı yükle (Sadece login değilse)
  if (!window.location.pathname.includes('login.html')) {
    const sidebarContainer = document.getElementById('sidebar-container');
    const navbarContainer = document.getElementById('navbar-container');

    if (sidebarContainer) {
      const resp = await fetch('components/sidebar.html');
      sidebarContainer.innerHTML = await resp.text();
    }
    
    if (navbarContainer) {
      const resp = await fetch('components/navbar.html');
      navbarContainer.innerHTML = await resp.text();
      
      const un = localStorage.getItem('userName');
      if(un) {
          const el = document.getElementById('nav-username');
          if(el) el.innerText = un;
      }
      
      const av = localStorage.getItem('userAvatar');
      if(av) {
          const el = document.getElementById('nav-avatar');
          if(el) el.style.backgroundImage = `url(${av})`;
      }
      
      const btn = document.getElementById('mobile-menu-btn');
      if(btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sidebar = document.querySelector('.sidebar');
          if(sidebar) sidebar.classList.toggle('open');
        });
      }

      // Mobilde panel açıkken dışarıya tıklayınca kapansın
      document.addEventListener('click', (e) => {
        const sidebar = document.querySelector('.sidebar');
        if(sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      });
    }

    // Aktif sayfayı işaretle
    const path = window.location.pathname;
    const pageName = path.split('/').pop().replace('.html', '');
    const activeLink = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if(activeLink) activeLink.classList.add('active');
    
    const pageTitle = document.getElementById('page-title');
    if(pageTitle) {
      // Sidebar'da karşılığı olmayan sayfalarda (profil, mesajlar vb.) sabit "Dashboard"
      // göstermek yerine sayfanın kendi <title>'ından türetilmiş başlığı kullan.
      const docTitle = (document.title.split(' - ')[0] || '').trim();
      pageTitle.innerText = activeLink ? activeLink.innerText.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ ]/g, '').trim() : (docTitle || 'Dashboard');
    }
  }

  initAuth();
});

// UI Toast & Notification Injections
document.addEventListener("DOMContentLoaded", () => {
  if(!document.getElementById("toast")) {
    const t = document.createElement("div");
    t.className = "toast";
    t.id = "toast";
    document.body.appendChild(t);
  }
  if(!document.getElementById("notif-pop")) {
    const n = document.createElement("div");
    n.className = "notif-pop";
    n.id = "notif-pop";
    n.innerHTML = `<div class="np-ic">🔔</div><div><div class="np-t"></div><div class="np-s"></div></div>`;
    document.body.appendChild(n);
  }
});

window.showToast = function(msg) {
  const el = document.getElementById("toast");
  if(!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
};

window.playNotificationSound = function(type = 'default') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if(!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    
    if (type === 'message') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.1); // A5
    } else {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    }
    
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
};

window.showNotif = function(title, text, type = 'default') {
  const el = document.getElementById("notif-pop");
  if(!el) return;
  el.querySelector(".np-t").textContent = title;
  el.querySelector(".np-s").textContent = text;
  el.classList.add("show");
  
  window.playNotificationSound(type);
  
  setTimeout(() => el.classList.remove("show"), 4000);
};

// Override window.alert visually to toast if we want, or just let users manually call showToast instead.


// Global User Avatar Fetcher (Cache)
import { getDoc, doc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase.js";

// Yükleme öncesi dosya boyutu/format kontrolü (kullanıcıya anlık, anlaşılır hata göstermek için)
window.validateFile = function(file, { maxMB, exts } = {}) {
  if (!file) return { ok: false, message: "Lütfen bir dosya seçin." };
  if (maxMB && file.size > maxMB * 1024 * 1024) {
    return { ok: false, message: `Dosya çok büyük (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimum ${maxMB}MB olmalı.` };
  }
  if (exts && exts.length) {
    const name = file.name.toLowerCase();
    if (!exts.some(ext => name.endsWith(ext))) {
      return { ok: false, message: `Desteklenmeyen dosya formatı. Kabul edilenler: ${exts.join(', ')}` };
    }
  }
  return { ok: true };
};

// Admin işlemlerini kayıt altına alan basit aktivite günlüğü
window.logActivity = async function(action, targetName) {
  try {
    await addDoc(collection(db, "activity_log"), {
      actorId: localStorage.getItem('uid') || '',
      actorName: localStorage.getItem('userName') || 'Bilinmiyor',
      action,
      targetName: targetName || '',
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("Aktivite günlüğü yazılamadı:", e);
  }
};

window.userCache = new Map();

window.getUserAvatar = async function(uid, fallbackName) {
  if(!uid) return "";
  if(window.userCache.has(uid)) {
    return window.userCache.get(uid).avatarUrl || "";
  }
  try {
    const s = await getDoc(doc(db, "users", uid));
    if(s.exists()) {
      window.userCache.set(uid, s.data());
      return s.data().avatarUrl || "";
    }
  } catch(e) {}
  return "";
};

window.renderAvatarHtml = function(url, size, fallbackChar) {
  if(url) {
    return `<div class="avatar" style="width:${size}px;height:${size}px;background-size:cover;background-position:center;background-image:url(${url});flex-shrink:0;"></div>`;
  }
  return `<div class="avatar" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#222;font-family:'Syncopate';flex-shrink:0;">${fallbackChar ? fallbackChar.charAt(0).toUpperCase() : '?'}</div>`;
};

// Global Notifications Listener
import { query, orderBy, onSnapshot, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from "./auth.js";

let _notifUnsub = null;
let _firstNotifLoad = true;

onAuthStateChanged(auth, (user) => {
  if(user) {
    if(_notifUnsub) _notifUnsub();
    const q = query(collection(db, `notifications/${user.uid}/user_notifications`), orderBy('createdAt', 'desc'), limit(1));
    _notifUnsub = onSnapshot(q, (snapshot) => {
      if(_firstNotifLoad) {
        _firstNotifLoad = false;
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          window.showNotif("Yeni Bildirim", data.message);
          
          const pop = document.getElementById("notif-pop");
          if(pop) {
             pop.onclick = () => {
                if(data.link) window.location.href = data.link;
             };
             pop.style.cursor = data.link ? "pointer" : "default";
          }
        }
      });
    });
  } else {
    if(_notifUnsub) _notifUnsub();
  }
});


window.compressImage = function(file, maxWidth, maxHeight, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if(!file.type.startsWith('image/')) { resolve(file); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if(w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
        if(h > maxHeight) { w = Math.round((w * maxHeight) / h); h = maxHeight; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
           if(blob) {
              const newFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
              resolve(newFile);
           } else { resolve(file); }
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

