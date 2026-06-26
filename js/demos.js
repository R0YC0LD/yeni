import { db, storage } from './firebase.js';
import { collection, addDoc, getDocs, getDoc, doc, setDoc, updateDoc, query, orderBy, limit, startAfter, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  const uploadBtn = document.getElementById('upload-demo-btn');
  if(uploadBtn) uploadBtn.addEventListener('click', uploadDemo);
  
  onAuthStateChanged(auth, (user) => {
    if(user) {
      window.loadDemos();
    }
  });
});

async function uploadDemo() {
  const title = document.getElementById('demo-title').value;
  const bm = document.getElementById('demo-beatmaker').value;
  const file = document.getElementById('demo-file').files[0];
  
  if(!title || !file) return alert("Başlık ve dosya zorunludur!");

  const check = window.validateFile(file, { maxMB: 50, exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'] });
  if(!check.ok) return alert(check.message);

  const uid = localStorage.getItem('uid');

  const btn = document.getElementById('upload-demo-btn');
  btn.innerText = 'Yükleniyor...';
  btn.disabled = true;

  try {
    const fileRef = ref(storage, `demos/${uid}/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    
    await addDoc(collection(db, "demos"), {
      title,
      beatmaker: bm,
      audioUrl: url,
      ownerId: uid,
      ownerName: localStorage.getItem('userName'),
      createdAt: serverTimestamp(),
      scoreData: [] // Puanlama kayıtları
    });
    
    alert("Demo yüklendi!");
    window.loadDemos();
  } catch(e) {
    alert("Hata: " + e.message);
  } finally {
    btn.innerText = 'Demoyu Yükle';
    btn.disabled = false;
  }
}

window.lastVisibleDemo = null;
window.loadDemos = async function(loadMore = false) {
  const list = document.getElementById('demos-list');
  if(!list) return;

  const uid = localStorage.getItem('uid');
  const userRole = localStorage.getItem('userRole');
  const canRate = (userRole === 'admin' || userRole === 'producer');

  let q;
  if(loadMore && window.lastVisibleDemo) {
    q = query(collection(db, "demos"), orderBy('createdAt', 'desc'), startAfter(window.lastVisibleDemo), limit(10));
  } else {
    q = query(collection(db, "demos"), orderBy('createdAt', 'desc'), limit(10));
    list.innerHTML = '';
    window.lastVisibleDemo = null;
  }
  
  try {
    const snap = await getDocs(q);
    const btnId = 'load-more-demos';
    const oldBtn = document.getElementById(btnId);
    if(oldBtn) oldBtn.remove();
    
    if(snap.empty) {
      if(!loadMore) list.innerHTML = `<p>Gösterilecek demo bulunamadı.</p>`;
      return;
    }

    window.lastVisibleDemo = snap.docs[snap.docs.length - 1];
    
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const id = docSnap.id;
      
      let avg = 0;
      if(d.scoreData && d.scoreData.length > 0) {
        let total = 0;
        d.scoreData.forEach(s => {
           total += ((Number(s.s1||0) + Number(s.s2||0) + Number(s.s3||0)) / 3);
        });
        avg = (total / d.scoreData.length).toFixed(1);
      }

      let rateHtml = '';
      if (canRate && uid !== d.ownerId) {
        rateHtml = `<button class="btn btn-secondary" onclick="document.getElementById('rate-${id}').style.display='block'">Puanla</button>`;
      }
      
      let deleteHtml = '';
      if (localStorage.getItem('userRole') === 'admin') {
        deleteHtml = `<button class="btn" style="background:var(--bad); color:#fff; border:none; margin-left:10px;" onclick="window.deleteDemo('${id}')">Sil</button>`;
      }

      const cardId = `demo-card-${id}`;
      list.innerHTML += `
        <div id="${cardId}" class="card item-card" style="position:relative;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
            <div id="av-${id}"></div>
            <div>
              <h4 style="margin:0;">${d.title}</h4>
              <p style="font-size:0.7rem; color:var(--shn-pink); margin:0;">Yükleyen: ${d.ownerName} | Puan: ${avg > 0 ? avg + '/5' : 'Yok'}</p>
            </div>
          </div>
          <audio controls src="${d.audioUrl}" style="width:100%; margin:10px 0;"></audio>
          
          <div>
            ${rateHtml}
            ${deleteHtml}
          </div>
          
          <div id="rate-${id}" class="rating-popup" style="display:none;">
            <div class="rating-group">
              <span class="rating-label">Şarkı (Vibe)</span>
              <div class="star-rating" id="song-${id}">
                <input type="radio" name="sg_${id}" value="5" id="sg5_${id}"><label for="sg5_${id}">★</label>
                <input type="radio" name="sg_${id}" value="4" id="sg4_${id}"><label for="sg4_${id}">★</label>
                <input type="radio" name="sg_${id}" value="3" id="sg3_${id}"><label for="sg3_${id}">★</label>
                <input type="radio" name="sg_${id}" value="2" id="sg2_${id}"><label for="sg2_${id}">★</label>
                <input type="radio" name="sg_${id}" value="1" id="sg1_${id}"><label for="sg1_${id}">★</label>
              </div>
            </div>
            <div class="rating-group">
              <span class="rating-label">Sözler</span>
              <div class="star-rating" id="lyric-${id}">
                <input type="radio" name="ly_${id}" value="5" id="ly5_${id}"><label for="ly5_${id}">★</label>
                <input type="radio" name="ly_${id}" value="4" id="ly4_${id}"><label for="ly4_${id}">★</label>
                <input type="radio" name="ly_${id}" value="3" id="ly3_${id}"><label for="ly3_${id}">★</label>
                <input type="radio" name="ly_${id}" value="2" id="ly2_${id}"><label for="ly2_${id}">★</label>
                <input type="radio" name="ly_${id}" value="1" id="ly1_${id}"><label for="ly1_${id}">★</label>
              </div>
            </div>
            <div class="rating-group">
              <span class="rating-label">Mix & Mastering</span>
              <div class="star-rating" id="mix-${id}">
                <input type="radio" name="mx_${id}" value="5" id="mx5_${id}"><label for="mx5_${id}">★</label>
                <input type="radio" name="mx_${id}" value="4" id="mx4_${id}"><label for="mx4_${id}">★</label>
                <input type="radio" name="mx_${id}" value="3" id="mx3_${id}"><label for="mx3_${id}">★</label>
                <input type="radio" name="mx_${id}" value="2" id="mx2_${id}"><label for="mx2_${id}">★</label>
                <input type="radio" name="mx_${id}" value="1" id="mx1_${id}"><label for="mx1_${id}">★</label>
              </div>
            </div>
            <input type="text" id="note-${id}" placeholder="Demo hakkında notun..." class="mb-3" style="margin-top:5px; margin-bottom:10px;">
            <button class="btn btn-primary" onclick="window.submitDemoRating('${id}', '${d.ownerId}', '${d.title}')" style="width:100%">Oyu Gönder</button>
          </div>
          
          <div class="prod-by">prod by. ${d.beatmaker || 'Bilinmiyor'}</div>
        </div>
      `;
      
      window.getUserAvatar(d.ownerId).then(avUrl => {
        const avEl = document.getElementById(`av-${id}`);
        if(avEl) avEl.innerHTML = window.renderAvatarHtml(avUrl, 40, d.ownerName);
      });
    });

    if(snap.docs.length === 10) {
      list.innerHTML += `<button id="load-more-demos" class="btn btn-secondary" style="width:100%; margin-top:20px; text-align:center;" onclick="window.loadDemos(true)">Daha Fazla Yükle</button>`;
    }
  } catch(e) {
    list.innerHTML = `<p>Demoları görme yetkiniz yok.</p>`;
  }
}

window.submitDemoRating = async function(docId, ownerId, title) {
  const s1 = document.querySelector(`input[name="sg_${docId}"]:checked`)?.value;
  const s2 = document.querySelector(`input[name="ly_${docId}"]:checked`)?.value;
  const s3 = document.querySelector(`input[name="mx_${docId}"]:checked`)?.value;
  const note = document.getElementById(`note-${docId}`).value;

  if(!s1 || !s2 || !s3) return alert("Lütfen tüm kriterleri puanlayın!");

  try {
    // Demo verisine puanı kaydet (aynı kişi tekrar puanlarsa eski puanının üzerine yazılır)
    const demoRef = doc(db, "demos", docId);
    const raterId = localStorage.getItem('uid');
    const demoSnap = await getDoc(demoRef);
    let scoreData = (demoSnap.exists() && demoSnap.data().scoreData) || [];
    scoreData = scoreData.filter(s => s.raterId !== raterId);
    scoreData.push({ raterId, s1: Number(s1), s2: Number(s2), s3: Number(s3), note: note || '' });
    await updateDoc(demoRef, { scoreData });

    // Bildirim gönder
    const msg = `${localStorage.getItem('userName')}, "${title}" demona oylama yaptı. Notu: "${note || 'Not yok'}"`;
    await addDoc(collection(db, `notifications/${ownerId}/user_notifications`), {
      message: msg,
      createdAt: serverTimestamp(),
      type: 'demo_rating',
      link: 'demos.html'
    });

    alert("Puan gönderildi!");
    document.getElementById(`rate-${docId}`).style.display = 'none';
    
    // Yüzeysel refresh (Tam sistemde onSnapshot kullanılır)
    window.loadDemos();
  } catch(e) {
    alert("Hata: " + e.message);
  }
}

window.deleteDemo = async function(demoId) {
    if(!confirm("Bu demoyu tamamen silmek istediğinize emin misiniz? (Dosyalar da silinecek)")) return;
    try {
      const demoRef = doc(db, "demos", demoId);
      const demoSnap = await getDoc(demoRef);
      if(demoSnap.exists()) {
        const d = demoSnap.data();
        if(d.audioUrl) {
          try {
            await deleteObject(ref(storage, d.audioUrl));
          } catch(err) { console.warn("Storage silinirken hata:", err); }
        }
      }
      await deleteDoc(demoRef);
      alert("Demo ve dosyaları başarıyla silindi.");
      window.loadDemos();
    } catch(e) {
      alert("Silme hatası: " + e.message);
    }
  };
