import { db } from './firebase.js';
import { collection, getDocs, doc, setDoc, addDoc, serverTimestamp, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  // Firestore "users" listesi isSignedIn() gerektiriyor; auth durumu henüz
  // çözülmeden getDocs çağrılırsa permission-denied alınır ve liste boş kalır.
  // Bu yüzden onAuthStateChanged ile auth hazır olana kadar bekliyoruz.
  onAuthStateChanged(auth, (user) => {
    if (user) {
      loadUsers();
      loadTaskAssignTargets();
      loadActivityLog();
    }
  });

  const sendBtn = document.getElementById('btn-send-task');
  if (sendBtn) sendBtn.addEventListener('click', sendProducerTask);
});

async function loadUsers() {
  const list = document.getElementById('user-list');
  const pendingList = document.getElementById('pending-users-list');
  if(!list) return;

  try {
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = '';
    if(pendingList) pendingList.innerHTML = '';
    
    let pendingCount = 0;

    snap.forEach(d => {
      const u = d.data();
      const id = d.id;
      
      // Admin her zaman onaylı sayılır
      const isApproved = u.isApproved === true || u.role === 'admin';

      if (!isApproved && pendingList) {
        pendingCount++;
        pendingList.innerHTML += `
          <div style="background:var(--glass); padding:1rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-left: 4px solid var(--shn-pink);">
            <div style="display:flex; align-items:center; gap:15px;">
              <div id="adm-av-p-${id}" style="cursor:pointer;" onclick="window.location.href='profile.html?uid=${id}'"></div>
              <div style="cursor:pointer;" onclick="window.location.href='profile.html?uid=${id}'">
                <h4 style="margin:0;">${u.name || 'İsimsiz'}</h4>
                <button class="btn btn-ghost btn-sm" style="padding:2px 6px; font-size:0.65rem;" onclick="event.stopPropagation(); this.nextElementSibling.classList.remove('hidden'); this.classList.add('hidden')">Maili Göster</button>
                <span class="hidden" style="font-size:0.8rem; color:var(--mut);">${u.email}</span>
              </div>
            </div>
            <button class="btn btn-primary" onclick="window.approveUser('${id}', '${(u.name || u.email || '').replace(/'/g, "\\'")}')">Erişim Ver</button>
          </div>
        `;
        window.getUserAvatar(id).then(url => {
          const el = document.getElementById(`adm-av-p-${id}`);
          if(el) el.innerHTML = window.renderAvatarHtml(url, 40, u.name || 'User');
        });
      } else {
        list.innerHTML += `
          <div style="background:var(--glass); padding:1rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:15px;">
              <div id="adm-av-${id}" style="cursor:pointer;" onclick="window.location.href='profile.html?uid=${id}'"></div>
              <div style="cursor:pointer;" onclick="window.location.href='profile.html?uid=${id}'">
                <h4 style="margin:0;">${u.name || 'İsimsiz'}</h4>
                <button class="btn btn-ghost btn-sm" style="padding:2px 6px; font-size:0.65rem;" onclick="event.stopPropagation(); this.nextElementSibling.classList.remove('hidden'); this.classList.add('hidden')">Maili Göster</button>
                <span class="hidden" style="font-size:0.8rem; color:var(--mut);">${u.email}</span>
              </div>
            </div>
            <select onchange="window.changeUserRole('${id}', this.value, '${(u.name || u.email || '').replace(/'/g, "\\'")}')">
              <option value="artist" ${u.role === 'artist' ? 'selected' : ''}>Sanatçı</option>
              <option value="producer" ${u.role === 'producer' ? 'selected' : ''}>Prodüktör</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Yönetici</option>
            </select>
          </div>
        `;
        window.getUserAvatar(id).then(url => {
          const el = document.getElementById(`adm-av-${id}`);
          if(el) el.innerHTML = window.renderAvatarHtml(url, 40, u.name || 'User');
        });
      }
    });

    if (pendingCount === 0 && pendingList) {
      pendingList.innerHTML = '<p style="font-size: 0.8rem; color: var(--mut);">Şu anda onay bekleyen kullanıcı yok.</p>';
    }

  } catch(e) {
    list.innerHTML = `<p style="color:var(--bad)">Hata: ${e.message}. Sadece yöneticiler erişebilir.</p>`;
    if(pendingList) pendingList.innerHTML = `<p style="color:var(--bad)">Hata: Yüklenemedi.</p>`;
  }
}

window.approveUser = async function(uid, name) {
  try {
    await setDoc(doc(db, "users", uid), { isApproved: true }, { merge: true });
    window.logActivity('Kullanıcıyı onayladı', name);
    alert("Kullanıcıya sisteme erişim izni verildi.");
    loadUsers(); // Listeyi yenile
  } catch(e) {
    alert("Yetki Hatası: " + e.message);
  }
}

window.changeUserRole = async function(uid, role, name) {
  try {
    // Admin yapılırken isApproved otomatik true olsun
    const data = role === 'admin' ? { role: role, isApproved: true } : { role: role };
    await setDoc(doc(db, "users", uid), data, { merge: true });
    window.logActivity(`Rolü "${role}" yaptı`, name);
    alert("Kullanıcı rolü başarıyla güncellendi.");
  } catch(e) {
    alert("Yetki Hatası: " + e.message);
  }
}

// ---------- Prodüktöre Görev / Mesaj Gönderme ----------
async function loadTaskAssignTargets() {
  const prodSelect = document.getElementById('task-producer-select');
  const userSelect = document.getElementById('task-user-select');
  if (!prodSelect || !userSelect) return;

  try {
    const snap = await getDocs(collection(db, "users"));
    let prodOptions = '<option value="">-- Prodüktör seç --</option>';
    let userOptions = '<option value="">-- İlgili kullanıcı (opsiyonel) --</option>';

    snap.forEach(d => {
      const u = d.data();
      const label = `${u.name || 'İsimsiz'} (${u.email})`;
      if (u.role === 'producer' || u.role === 'admin') {
        prodOptions += `<option value="${d.id}">${label}</option>`;
      }
      userOptions += `<option value="${d.id}" data-name="${(u.name || u.email || '').replace(/"/g, '')}">${label}</option>`;
    });

    prodSelect.innerHTML = prodOptions;
    userSelect.innerHTML = userOptions;
  } catch (e) {
    console.error("Görev hedefleri yüklenemedi:", e);
  }
}

async function sendProducerTask() {
  const prodSelect = document.getElementById('task-producer-select');
  const userSelect = document.getElementById('task-user-select');
  const msgInput = document.getElementById('task-message-input');
  const btn = document.getElementById('btn-send-task');

  const producerId = prodSelect.value;
  const message = msgInput.value.trim();
  if (!producerId) return alert("Lütfen bir prodüktör seçin.");
  if (!message) return alert("Lütfen bir görev/mesaj yazın.");

  const targetUserId = userSelect.value || null;
  const targetUserName = targetUserId ? userSelect.options[userSelect.selectedIndex].dataset.name : null;

  btn.disabled = true;
  btn.innerText = "Gönderiliyor...";

  try {
    await addDoc(collection(db, `tasks/${producerId}/assigned`), {
      message,
      targetUserId,
      targetUserName,
      done: false,
      createdAt: serverTimestamp()
    });

    // Prodüktöre bildirim gönder
    await addDoc(collection(db, `notifications/${producerId}/user_notifications`), {
      message: `Yöneticiden yeni bir görev aldın: "${message.substring(0, 40)}"`,
      createdAt: serverTimestamp(),
      type: 'task_assign',
      link: 'dashboard.html'
    });

    const prodName = prodSelect.options[prodSelect.selectedIndex].innerText;
    window.logActivity('Prodüktöre görev gönderdi', prodName);

    msgInput.value = '';
    userSelect.value = '';
    if (window.showToast) window.showToast("Görev prodüktöre gönderildi.");
    else alert("Görev prodüktöre gönderildi.");
  } catch (e) {
    alert("Hata: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Gönder";
  }
}

// ---------- Aktivite Günlüğü ----------
async function loadActivityLog() {
  const list = document.getElementById('activity-log-list');
  if (!list) return;

  try {
    const q = query(collection(db, "activity_log"), orderBy('createdAt', 'desc'), limit(20));
    const snap = await getDocs(q);

    if (snap.empty) {
      list.innerHTML = '<p style="font-size:0.8rem; color:var(--mut);">Henüz bir kayıt yok.</p>';
      return;
    }

    list.innerHTML = '';
    snap.forEach(d => {
      const a = d.data();
      const time = a.createdAt ? a.createdAt.toDate().toLocaleString('tr-TR') : '';
      list.innerHTML += `
        <div style="font-size:0.78rem; padding:0.6rem 0; border-bottom:1px solid var(--line);">
          <span style="color:#fff; font-weight:bold;">${a.actorName}</span> ${a.action}${a.targetName ? `: <span style="color:var(--shn-pink);">${a.targetName}</span>` : ''}
          <span style="color:var(--mut); float:right;">${time}</span>
        </div>
      `;
    });
  } catch (e) {
    list.innerHTML = `<p style="color:var(--bad)">Aktivite günlüğü yüklenemedi: ${e.message}</p>`;
  }
}
