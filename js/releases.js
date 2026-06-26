import { auth, db, storage } from './firebase.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
  // Kullanıcı adını otomatik doldur
  onAuthStateChanged(auth, (user) => {
    if(user) {
      document.getElementById('rel-artist').value = localStorage.getItem('userName') || user.email.split('@')[0];
    }
  });

  const btn = document.getElementById('submit-release-btn');
  if(btn) btn.addEventListener('click', submitRelease);

  // Pop-up işlemleri
  const openLegal = document.getElementById('open-legal');
  const closeLegal = document.getElementById('close-legal');
  const popup = document.getElementById('legal-popup');

  if(openLegal) openLegal.addEventListener('click', (e) => { e.preventDefault(); popup.style.display = 'flex'; });
  if(closeLegal) closeLegal.addEventListener('click', () => { 
    popup.style.display = 'none'; 
    document.getElementById('rel-agreement').checked = true;
  });
});

async function submitRelease() {
  const title = document.getElementById('rel-title').value;
  const coverFile = document.getElementById('rel-cover').files[0];
  const audioFile = document.getElementById('rel-audio').files[0];
  const date = document.getElementById('rel-date').value;
  const lyrics = document.getElementById('rel-lyrics').value;
  const isExplicit = document.getElementById('rel-explicit').checked;
  const hasLicense = document.getElementById('rel-license').checked;
  const agmt = document.getElementById('rel-agreement').checked;
  
  if(!title || !coverFile || !audioFile || !date) return alert("Tüm zorunlu alanları (Ad, Kapak, Müzik, Tarih) doldurun!");
  if(!agmt) return alert("Kullanıcı sözleşmesini okuyup kabul etmelisiniz.");
  if(!hasLicense) return alert("Beat lisansını onaylamadan yayın yapamazsınız.");

  const coverCheck = window.validateFile(coverFile, { maxMB: 5, exts: ['.jpg', '.jpeg', '.png', '.webp'] });
  if(!coverCheck.ok) return alert(coverCheck.message);
  const audioCheck = window.validateFile(audioFile, { maxMB: 25, exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'] });
  if(!audioCheck.ok) return alert(audioCheck.message);

  const uid = localStorage.getItem('uid');
  const btn = document.getElementById('submit-release-btn');
  btn.innerText = 'Yükleniyor (Zaman alabilir)...';
  btn.disabled = true;

  try {
    btn.innerText = 'Görsel Sıkıştırılıyor...';
    const compressedCover = await window.compressImage(coverFile, 1024, 1024, 0.8);
    btn.innerText = 'Yükleniyor (Zaman alabilir)...';

    const cRef = ref(storage, `releases_covers/${uid}/${Date.now()}_${compressedCover.name}`);
    await uploadBytes(cRef, compressedCover);
    const coverUrl = await getDownloadURL(cRef);
    
    const aRef = ref(storage, `releases_audio/${uid}/${Date.now()}_${audioFile.name}`);
    await uploadBytes(aRef, audioFile);
    const audioUrl = await getDownloadURL(aRef);
    
    await addDoc(collection(db, "releases"), {
      title,
      coverUrl,
      audioUrl,
      releaseDate: date,
      lyrics: lyrics || "",
      isExplicit: isExplicit,
      ownerId: uid,
      artistName: document.getElementById('rel-artist').value,
      status: 'bekliyor',
      createdAt: serverTimestamp()
    });
    
    alert("Şarkınız yayına hazırlanmak üzere kurula iletildi!");
    window.location.href = 'dashboard.html';
  } catch (e) {
    alert("Hata: Yükleme başarısız. " + e.message);
  } finally {
    btn.innerText = 'ŞARKINI YAYINLA';
    btn.disabled = false;
  }
}

import { getDocs, getDoc, deleteDoc, updateDoc, doc, query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if(user && localStorage.getItem('userRole') === 'admin') {
      document.getElementById('admin-releases-section').style.display = 'block';
      window.loadAdminReleases();
    }
  });
});

window.lastVisibleRelease = null;
window.loadAdminReleases = async function(loadMore = false) {
  const list = document.getElementById('releases-list');
  if(!loadMore) list.innerHTML = 'Yükleniyor...';

  try {
    let q;
    if(loadMore && window.lastVisibleRelease) {
      q = query(collection(db, "releases"), orderBy('createdAt', 'desc'), startAfter(window.lastVisibleRelease), limit(10));
    } else {
      q = query(collection(db, "releases"), orderBy('createdAt', 'desc'), limit(10));
      list.innerHTML = '';
      window.lastVisibleRelease = null;
    }

    const snap = await getDocs(q);
    const btnId = 'load-more-releases';
    const oldBtn = document.getElementById(btnId);
    if(oldBtn) oldBtn.remove();

    if(snap.empty) { 
      if(!loadMore) list.innerHTML = 'Bekleyen yayın yok.'; 
      return; 
    }
    
    if(!loadMore) list.innerHTML = '';
    window.lastVisibleRelease = snap.docs[snap.docs.length - 1];

    snap.forEach(d => {
      const data = d.data();
      const status = data.status || 'bekliyor';
      const statusBadge = {
        bekliyor: '<span class="badge" style="color:#e3b341; border-color:rgba(227,179,65,.4);">BEKLİYOR</span>',
        onaylandı: '<span class="badge" style="color:#4ade80; border-color:rgba(74,222,128,.4);">ONAYLANDI</span>',
        reddedildi: '<span class="badge" style="color:var(--bad); border-color:var(--bad);">REDDEDİLDİ</span>'
      }[status] || '';

      const decisionBtns = status === 'bekliyor' ? `
          <button class="btn btn-ghost" style="color:#4ade80;" onclick="window.approveRelease('${d.id}', '${(data.title||'').replace(/'/g,"\\'")}', '${data.ownerId}')">✅ Onayla</button>
          <button class="btn btn-ghost" style="color:var(--bad);" onclick="window.rejectRelease('${d.id}', '${(data.title||'').replace(/'/g,"\\'")}', '${data.ownerId}')">❌ Reddet</button>
        ` : '';

      list.innerHTML += `<div style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:10px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
          <div>
            <h4 style="color:#fff">${data.title} ${statusBadge}</h4>
            <p style="font-size:0.8rem; color:var(--mut);">Sanatçı: ${data.artistName}</p>
          </div>
          <div style="display:flex; gap:0.5rem;">
            ${decisionBtns}
            <button class="btn btn-ghost" style="color:var(--bad);" onclick="deleteRelease('${d.id}')">🗑️ Sil</button>
          </div>
        </div>`;
    });

    if(snap.docs.length === 10) {
      list.innerHTML += `<button id="load-more-releases" class="btn btn-secondary" style="width:100%; margin-top:10px;" onclick="window.loadAdminReleases(true)">Daha Fazla Yükle</button>`;
    }
  } catch(e) { list.innerHTML = 'Hata: ' + e.message; }
}

window.approveRelease = async function(id, title, ownerId) {
  try {
    await updateDoc(doc(db, "releases", id), { status: 'onaylandı' });
    await addDoc(collection(db, `notifications/${ownerId}/user_notifications`), {
      message: `"${title}" adlı şarkın onaylandı ve yayına hazırlanıyor!`,
      createdAt: serverTimestamp(),
      type: 'release_approved',
      link: 'releases.html'
    });
    window.logActivity('Release onayladı', title);
    window.loadAdminReleases();
  } catch(e) { alert('Hata: ' + e.message); }
}

window.rejectRelease = async function(id, title, ownerId) {
  const reason = prompt('Red sebebini yazabilirsin (opsiyonel):', '') || '';
  try {
    await updateDoc(doc(db, "releases", id), { status: 'reddedildi', rejectReason: reason });
    await addDoc(collection(db, `notifications/${ownerId}/user_notifications`), {
      message: `"${title}" adlı şarkın reddedildi.${reason ? ' Sebep: ' + reason : ''}`,
      createdAt: serverTimestamp(),
      type: 'release_rejected',
      link: 'releases.html'
    });
    window.logActivity('Release reddetti', title);
    window.loadAdminReleases();
  } catch(e) { alert('Hata: ' + e.message); }
}

window.deleteRelease = async function(id) {
    if(!confirm('Bu yayını silmek istediğinize emin misiniz? (Dosyalar da silinecek)')) return;
    try {
      const releaseRef = doc(db, "releases", id);
      const releaseSnap = await getDoc(releaseRef);
      if(releaseSnap.exists()) {
        const d = releaseSnap.data();
        if(d.coverUrl) {
          try { await deleteObject(ref(storage, d.coverUrl)); } catch(err) {}
        }
        if(d.audioUrl) {
          try { await deleteObject(ref(storage, d.audioUrl)); } catch(err) {}
        }
        window.logActivity('Release sildi', d.title);
      }
      await deleteDoc(releaseRef);
      window.loadAdminReleases();
    } catch(e) { alert('Hata: ' + e.message); }
  }
