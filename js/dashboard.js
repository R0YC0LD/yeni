import { db } from './firebase.js';
import { collection, getDocs, query, where, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
  // Give auth a moment to load
  setTimeout(loadStats, 1000);
  setTimeout(loadTasks, 1000);
});

async function loadTasks() {
  const list = document.getElementById('tasks-list');
  if (!list) return;

  const uid = localStorage.getItem('uid');
  if (!uid) return;

  try {
    const q = query(collection(db, `tasks/${uid}/assigned`), where('done', '==', false));
    const snap = await getDocs(q);

    if (snap.empty) {
      list.innerHTML = '<p class="text-mut">Henüz atanmış bir göreviniz bulunmuyor.</p>';
      return;
    }

    // Composite index gerektirmemek için sıralamayı client-side yapıyoruz
    const docs = snap.docs.slice().sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));

    list.innerHTML = '';
    docs.forEach(d => {
      const t = d.data();
      list.innerHTML += `
        <div style="background:var(--glass); padding:1rem; border-radius:10px; display:flex; justify-content:space-between; align-items:center; gap:1rem; border-left: 4px solid var(--shn-pink);">
          <div>
            <p style="margin:0; color:#fff;">${t.message}</p>
            ${t.targetUserId ? `<a href="profile.html?uid=${t.targetUserId}" style="font-size:0.75rem;">👤 İlgili kullanıcı: ${t.targetUserName || 'Profili gör'}</a>` : ''}
          </div>
          <button class="btn btn-secondary" onclick="window.completeTask('${d.id}')">Tamamla</button>
        </div>
      `;
    });
  } catch (e) {
    list.innerHTML = `<p style="color:var(--bad)">Görevler yüklenemedi: ${e.message}</p>`;
  }
}

window.completeTask = async function(taskId) {
  const uid = localStorage.getItem('uid');
  try {
    await updateDoc(doc(db, `tasks/${uid}/assigned`, taskId), { done: true });
    loadTasks();
  } catch (e) {
    alert("Hata: " + e.message);
  }
};

async function loadStats() {
  const role = localStorage.getItem('userRole') || 'artist';
  const uid = localStorage.getItem('uid');
  if(!uid) return;

  try {
    let demosSnap, relSnap, beatsSnap, presetsSnap;

    // Yetki kontrolüne göre veri çekme
    if(role === 'admin' || role === 'producer') {
      demosSnap = await getDocs(collection(db, "demos"));
      beatsSnap = await getDocs(collection(db, "beats"));
      presetsSnap = await getDocs(collection(db, "presets"));
    } else {
      // Sadece sanatçının kendi yükledikleri
      demosSnap = await getDocs(query(collection(db, "demos"), where("ownerId", "==", uid)));
      beatsSnap = { size: 0 }; // Sanatçı beat göremez
      presetsSnap = { size: 0 }; // Sanatçı preset göremez
    }

    // Release için admin tüm bekleyenleri, diğerleri sadece kendininkini görür
    if(role === 'admin') {
      relSnap = await getDocs(query(collection(db, "releases"), where("status", "==", "bekliyor")));
    } else {
      relSnap = await getDocs(query(collection(db, "releases"), where("ownerId", "==", uid), where("status", "==", "bekliyor")));
    }
    
    // DOM Güncelleme
    const stDemos = document.getElementById('stat-demos');
    const stRel = document.getElementById('stat-releases');
    const stBeats = document.getElementById('stat-beats');
    const stPresets = document.getElementById('stat-presets');

    if(stDemos) stDemos.innerText = demosSnap.size;
    if(stRel) stRel.innerText = relSnap.size;
    if(stBeats) stBeats.innerText = beatsSnap.size;
    if(stPresets) stPresets.innerText = presetsSnap.size;

  } catch(e) {
    console.error("Dashboard Stats Error:", e);
  }
}
