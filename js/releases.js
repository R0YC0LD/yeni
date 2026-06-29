import { auth, db, storage } from './firebase.js';
import { collection, addDoc, serverTimestamp, getDocs, query, where, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Kapak görselinin gerçek piksel boyutunu okur (etiket "en az 3000x3000px" diyor ama
// önceden hiçbir yerde gerçekten kontrol edilmiyordu - bu fonksiyon o kontrolü sağlıyor).
function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Görsel okunamadı.')); };
    img.src = url;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Kullanıcı adını otomatik doldur
  onAuthStateChanged(auth, (user) => {
    if(user) {
      document.getElementById('rel-artist').value = localStorage.getItem('userName') || user.email.split('@')[0];
      window.loadMyReleases();
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

  try {
    const dims = await getImageDimensions(coverFile);
    if(dims.width < 3000 || dims.height < 3000) {
      return alert(`Kapak görseli en az 3000x3000px olmalı (yüklediğin görsel: ${dims.width}x${dims.height}px).`);
    }
  } catch(e) {
    return alert('Kapak görseli okunamadı, lütfen geçerli bir görsel dosyası seç.');
  }

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

// Yöneticinin tüm yayınları onaylama/reddetme/indirme arayüzü admin-releases.html sayfasına
// taşındı (js/admin-releases.js). Burada sadece kullanıcının kendi gönderdiği yayınların
// geçmişini (durum + yönetici notu) ve reddedilen yayınları düzeltip yeniden gönderme
// akışını gösteriyoruz.
let myReleasesCache = [];

window.loadMyReleases = async function() {
  const list = document.getElementById('my-releases-list');
  if(!list) return;

  const uid = localStorage.getItem('uid');
  if(!uid) return;

  list.innerHTML = 'Yükleniyor...';

  try {
    // ownerId eşitlik filtresi + createdAt orderBy birlikte composite index isteyeceği için
    // sıralamayı client-side yapıyoruz (kullanıcı başına kayıt sayısı az olduğundan sorun olmaz).
    const snap = await getDocs(query(collection(db, "releases"), where('ownerId', '==', uid)));

    if(snap.empty) {
      myReleasesCache = [];
      list.innerHTML = '<p class="text-mut">Henüz bir yayın göndermedin.</p>';
      return;
    }

    const docs = snap.docs.slice().sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));
    myReleasesCache = docs.map(d => ({ id: d.id, ...d.data() }));

    list.innerHTML = myReleasesCache.map(data => {
      const id = data.id;
      const status = data.status || 'bekliyor';
      const statusBadge = {
        bekliyor: '<span class="badge" style="color:#e3b341; border-color:rgba(227,179,65,.4);">BEKLİYOR</span>',
        onaylandı: '<span class="badge" style="color:#4ade80; border-color:rgba(74,222,128,.4);">ONAYLANDI</span>',
        yayınlandı: '<span class="badge" style="color:#60a5fa; border-color:rgba(96,165,250,.4);">YAYINDA</span>',
        reddedildi: '<span class="badge" style="color:var(--bad); border-color:var(--bad);">REDDEDİLDİ</span>'
      }[status] || '';
      const note = data.adminNote || data.rejectReason || '';
      const dateStr = data.releaseDate ? new Date(data.releaseDate).toLocaleDateString('tr-TR') : '-';

      const resubmitSection = status === 'reddedildi' ? `
          <button class="btn btn-secondary" style="margin-top:8px; font-size:0.75rem; padding:6px 12px;" onclick="window.toggleResubmitForm('${id}')">🔁 Düzelt ve Yeniden Gönder</button>
          <div id="resub-form-${id}" style="display:none; margin-top:10px; padding:12px; background:rgba(255,255,255,0.03); border-radius:10px;">
            <label style="font-size:0.75rem; display:block; margin-bottom:4px;">Şarkı Adı</label>
            <input type="text" id="resub-title-${id}" value="${window.escapeHtml(data.title)}" style="margin-bottom:12px;">
            <label style="font-size:0.75rem; display:block; margin-bottom:4px;">Şarkı Sözleri</label>
            <textarea id="resub-lyrics-${id}" rows="3" style="margin-bottom:12px;">${window.escapeHtml(data.lyrics || '')}</textarea>
            <label style="font-size:0.75rem; display:block; margin-bottom:4px;">Yayınlanacağı Tarih</label>
            <input type="date" id="resub-date-${id}" value="${data.releaseDate || ''}" style="margin-bottom:12px;">
            <label style="font-size:0.75rem; display:block; margin-bottom:4px;">Yeni Kapak Görseli (opsiyonel, boş bırakırsan eskisi kalır - en az 3000x3000px)</label>
            <input type="file" id="resub-cover-${id}" accept="image/*" style="margin-bottom:12px;">
            <label style="font-size:0.75rem; display:block; margin-bottom:4px;">Yeni Müzik Dosyası (opsiyonel, boş bırakırsan eskisi kalır)</label>
            <input type="file" id="resub-audio-${id}" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" style="margin-bottom:12px;">
            <button class="btn btn-primary" style="width:100%; margin-top:6px;" onclick="window.resubmitRelease('${id}')">Yeniden Gönder</button>
          </div>
        ` : '';

      return `<div style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:10px; margin-bottom:10px; display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap;">
          <img src="${data.coverUrl}" alt="" style="width:60px; height:60px; border-radius:8px; object-fit:cover; flex-shrink:0;">
          <div style="flex:1; min-width:200px;">
            <h4 style="color:#fff; margin-bottom:4px;">${window.escapeHtml(data.title)} ${statusBadge}</h4>
            <p style="font-size:0.78rem; margin:0;">📅 Yayın Tarihi: ${dateStr}</p>
            ${note ? `<p style="font-size:0.8rem; color:var(--shn-pink); background:rgba(230,57,70,0.08); padding:8px; border-radius:8px; margin-top:6px;"><strong>Yönetici Notu:</strong> ${window.escapeHtml(note)}</p>` : ''}
            ${resubmitSection}
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = 'Hata: ' + e.message;
  }
}

window.toggleResubmitForm = function(id) {
  const el = document.getElementById(`resub-form-${id}`);
  if(el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

window.resubmitRelease = async function(id) {
  const data = myReleasesCache.find(r => r.id === id);
  if(!data) return;

  const titleEl = document.getElementById(`resub-title-${id}`);
  const lyricsEl = document.getElementById(`resub-lyrics-${id}`);
  const dateEl = document.getElementById(`resub-date-${id}`);
  const coverEl = document.getElementById(`resub-cover-${id}`);
  const audioEl = document.getElementById(`resub-audio-${id}`);

  const title = titleEl.value.trim();
  const date = dateEl.value;
  if(!title || !date) return alert('Şarkı adı ve yayın tarihi zorunlu.');

  const newCoverFile = coverEl.files[0] || null;
  const newAudioFile = audioEl.files[0] || null;

  if(newCoverFile) {
    const coverCheck = window.validateFile(newCoverFile, { maxMB: 5, exts: ['.jpg', '.jpeg', '.png', '.webp'] });
    if(!coverCheck.ok) return alert(coverCheck.message);
    let dims;
    try { dims = await getImageDimensions(newCoverFile); }
    catch(e) { return alert('Kapak görseli okunamadı, lütfen geçerli bir görsel dosyası seç.'); }
    if(dims.width < 3000 || dims.height < 3000) {
      return alert(`Kapak görseli en az 3000x3000px olmalı (yüklediğin görsel: ${dims.width}x${dims.height}px).`);
    }
  }
  if(newAudioFile) {
    const audioCheck = window.validateFile(newAudioFile, { maxMB: 25, exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'] });
    if(!audioCheck.ok) return alert(audioCheck.message);
  }

  const btn = document.querySelector(`#resub-form-${id} .btn-primary`);
  const uid = localStorage.getItem('uid');
  if(btn) { btn.disabled = true; btn.innerText = 'Gönderiliyor...'; }

  try {
    const updates = {
      status: 'bekliyor',
      title,
      lyrics: lyricsEl.value || '',
      releaseDate: date,
      resubmittedAt: serverTimestamp()
    };

    if(newCoverFile) {
      const compressedCover = await window.compressImage(newCoverFile, 1024, 1024, 0.8);
      const cRef = ref(storage, `releases_covers/${uid}/${Date.now()}_${compressedCover.name}`);
      await uploadBytes(cRef, compressedCover);
      updates.coverUrl = await getDownloadURL(cRef);
      if(data.coverUrl) { try { await deleteObject(ref(storage, data.coverUrl)); } catch(e) {} }
    }

    if(newAudioFile) {
      const aRef = ref(storage, `releases_audio/${uid}/${Date.now()}_${newAudioFile.name}`);
      await uploadBytes(aRef, newAudioFile);
      updates.audioUrl = await getDownloadURL(aRef);
      if(data.audioUrl) { try { await deleteObject(ref(storage, data.audioUrl)); } catch(e) {} }
    }

    await updateDoc(doc(db, "releases", id), updates);
    alert('Şarkın tekrar incelemeye gönderildi!');
    window.loadMyReleases();
  } catch(e) {
    alert('Hata: ' + e.message);
  } finally {
    if(btn) { btn.disabled = false; btn.innerText = 'Yeniden Gönder'; }
  }
}
