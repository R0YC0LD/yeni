import { db, storage } from './firebase.js';
import { collection, addDoc, getDocs, getDoc, doc, updateDoc, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  const upBeat = document.getElementById('upload-beat-btn');
  const upPreset = document.getElementById('upload-preset-btn');
  const upStem = document.getElementById('upload-stem-btn');

  if(upBeat) upBeat.addEventListener('click', () => uploadItem('beat'));
  if(upPreset) upPreset.addEventListener('click', () => uploadItem('preset'));
  if(upStem) upStem.addEventListener('click', () => uploadItem('stem'));

  onAuthStateChanged(auth, (user) => {
    if(user) {
      loadItems('beats');
      loadItems('presets');
      loadItems('stems');
    }
  });
});

async function uploadItem(type) {
  const title = document.getElementById(`${type}-title`).value;
  const file = document.getElementById(`${type}-file`).files[0];
  const btn = document.getElementById(`upload-${type}-btn`);
  
  if(!title || !file) return alert("Başlık ve dosya zorunludur!");

  const limits = {
    beat: { maxMB: 50, exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'] },
    preset: { maxMB: 50 },
    stem: { maxMB: 100, exts: ['.zip', '.rar'] }
  };
  const check = window.validateFile(file, limits[type]);
  if(!check.ok) return alert(check.message);

  const uid = localStorage.getItem('uid');
  
  btn.innerText = 'Yükleniyor...';
  btn.disabled = true;

  try {
    const fileRef = ref(storage, `${type}s/${uid}/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    
    const data = {
      title,
      fileUrl: url,
      ownerId: uid,
      ownerName: localStorage.getItem('userName'),
      createdAt: serverTimestamp(),
      scoreData: []
    };

    if(type === 'preset') {
      data.description = document.getElementById('preset-desc').value || "";
    }
    if(type === 'stem') {
      data.bpm = document.getElementById('stem-bpm').value;
      data.key = document.getElementById('stem-key').value;
    }

    await addDoc(collection(db, `${type}s`), data);
    
    if(type === 'stem') {
      // Prodüktörlere bildirim yolla
      const usersSnap = await getDocs(query(collection(db, "users"), where("role", "==", "producer")));
      const msg = `YENİ STEM: ${localStorage.getItem('userName')}, "${title}" adlı şarkının stemlerini yükledi.`;
      usersSnap.forEach(async (uDoc) => {
        if(uDoc.id !== uid) {
          await addDoc(collection(db, `notifications/${uDoc.id}/user_notifications`), {
            message: msg,
            createdAt: serverTimestamp(),
            type: 'stem_alert'
          });
        }
      });
    }

    alert(`${type.toUpperCase()} yüklendi!`);
    loadItems(`${type}s`);
  } catch(e) {
    alert("Hata: " + e.message);
  } finally {
    btn.innerText = 'Yükle';
    btn.disabled = false;
  }
}

async function loadItems(collectionName) {
  const list = document.getElementById(`${collectionName}-list`);
  if(!list) return;
  const q = query(collection(db, collectionName), orderBy('createdAt', 'desc'));
  
  try {
    const snap = await getDocs(q);
    list.innerHTML = '';
    
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const id = docSnap.id;
      
      let avg = 0;
      if(d.scoreData && d.scoreData.length > 0) {
        let total = 0;
        d.scoreData.forEach(s => {
           total += ((Number(s.s1||0) + Number(s.s2||0) + Number(s.s3||0) + Number(s.s4||0)) / 4);
        });
        avg = (total / d.scoreData.length).toFixed(1);
      }

      let innerHtml = '';
      if(collectionName === 'beats') {
        innerHtml = `
          <h4 style="margin-bottom:5px;">${d.title}</h4>
          <p style="font-size:0.7rem; color:var(--shn-pink); margin-bottom:5px;">Puan: ${avg > 0 ? avg + '/5' : 'Yok'}</p>
          <audio controls src="${d.fileUrl}" style="width:100%; margin:10px 0;"></audio>
          <button class="btn btn-secondary" style="margin-top:10px" onclick="document.getElementById('rate-beat-${id}').style.display='block'">Puanla</button>
          
          <div id="rate-beat-${id}" class="rating-popup">
            ${createStarRating(id, 'type', 'Type')}
            ${createStarRating(id, 'vibe', 'Vibe')}
            ${createStarRating(id, 'melody', 'Melody')}
            ${createStarRating(id, 'drum', 'Drum')}
            <input type="text" id="note-beat-${id}" placeholder="Beat hakkında notun..." class="mb-3" style="margin-top:5px; margin-bottom:10px;">
            <button class="btn btn-primary" onclick="window.submitBeatRating('${id}', '${d.ownerId}', '${d.title}')" style="width:100%">Oyu Gönder</button>
          </div>
        `;
      } else if(collectionName === 'presets') {
        innerHtml = `
          <h4 style="margin-bottom:5px;">${d.title}</h4>
          <p style="font-size:0.8rem; margin:10px 0; color:#ddd; font-family:'Space Mono'; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">${d.description || 'Açıklama yok'}</p>
          <a href="${d.fileUrl}" target="_blank" class="btn btn-primary" style="margin-top:10px;">İndir</a>
        `;
      } else if(collectionName === 'stems') {
        innerHtml = `
          <h4 style="margin-bottom:5px;">${d.title}</h4>
          <p style="font-size:0.8rem; margin:10px 0; color:var(--shn-pink); font-family:'Space Mono';">BPM: ${d.bpm || '?'} | Ton: ${d.key || '?'}</p>
          <a href="${d.fileUrl}" target="_blank" class="btn btn-primary" style="margin-top:10px;">İndir</a>
        `;
      }

      list.innerHTML += `
        <div class="card item-card">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px; border-bottom:1px solid var(--line); padding-bottom:10px;">
            <div id="k-av-${id}"></div>
            <div>
              <div id="k-name-${id}" style="font-family:'Space Mono'; font-size:0.8rem; font-weight:bold; color:#fff;">${d.ownerName}</div>
              <div style="font-size:0.65rem; color:var(--text-mut);">Yükleyen</div>
            </div>
          </div>
          ${innerHtml}
        </div>
      `;

      // Async avatar + güncel isim (yükleme anında kaydedilen isim eskiyse, kullanıcı profilinden tazelenir)
      window.getUserAvatar(d.ownerId).then(avUrl => {
        const avEl = document.getElementById(`k-av-${id}`);
        const freshName = window.userCache.get(d.ownerId)?.name || d.ownerName;
        if(avEl) avEl.innerHTML = window.renderAvatarHtml(avUrl, 36, freshName);
        const nameEl = document.getElementById(`k-name-${id}`);
        if(nameEl) nameEl.innerText = freshName;
      });
    });
  } catch(e) {
    list.innerHTML = `<p>Yetki hatası veya veri yok.</p>`;
  }
}

function createStarRating(id, prefix, label) {
  return `
    <div class="rating-group">
      <span class="rating-label">${label}</span>
      <div class="star-rating" id="${prefix}-${id}">
        <input type="radio" name="${prefix}_${id}" value="5" id="${prefix}5_${id}"><label for="${prefix}5_${id}">★</label>
        <input type="radio" name="${prefix}_${id}" value="4" id="${prefix}4_${id}"><label for="${prefix}4_${id}">★</label>
        <input type="radio" name="${prefix}_${id}" value="3" id="${prefix}3_${id}"><label for="${prefix}3_${id}">★</label>
        <input type="radio" name="${prefix}_${id}" value="2" id="${prefix}2_${id}"><label for="${prefix}2_${id}">★</label>
        <input type="radio" name="${prefix}_${id}" value="1" id="${prefix}1_${id}"><label for="${prefix}1_${id}">★</label>
      </div>
    </div>
  `;
}

window.submitBeatRating = async function(docId, ownerId, title) {
  const s1 = document.querySelector(`input[name="type_${docId}"]:checked`)?.value;
  const s2 = document.querySelector(`input[name="vibe_${docId}"]:checked`)?.value;
  const s3 = document.querySelector(`input[name="melody_${docId}"]:checked`)?.value;
  const s4 = document.querySelector(`input[name="drum_${docId}"]:checked`)?.value;
  const note = document.getElementById(`note-beat-${docId}`).value;

  if(!s1 || !s2 || !s3 || !s4) return alert("Lütfen tüm kriterleri puanlayın!");

  try {
    // Beat verisine puanı kaydet (aynı kişi tekrar puanlarsa eski puanının üzerine yazılır)
    const beatRef = doc(db, "beats", docId);
    const raterId = localStorage.getItem('uid');
    const beatSnap = await getDoc(beatRef);
    let scoreData = (beatSnap.exists() && beatSnap.data().scoreData) || [];
    scoreData = scoreData.filter(s => s.raterId !== raterId);
    scoreData.push({ raterId, s1: Number(s1), s2: Number(s2), s3: Number(s3), s4: Number(s4), note: note || '' });
    await updateDoc(beatRef, { scoreData });

    const msg = `${localStorage.getItem('userName')}, "${title}" adlı beatini oyladı. Notu: "${note || 'Not yok'}"`;
    await addDoc(collection(db, `notifications/${ownerId}/user_notifications`), {
      message: msg,
      createdAt: serverTimestamp(),
      type: 'beat_rating', link: 'kitchen.html'
    });

    alert("Puan ve notun iletildi!");
    document.getElementById(`rate-beat-${docId}`).style.display = 'none';
  } catch(e) {
    alert("Hata: " + e.message);
  }
}
