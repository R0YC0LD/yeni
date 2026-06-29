import { auth, db, storage } from './firebase.js';
import { collection, getDocs, doc, deleteDoc, updateDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

let allReleases = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (localStorage.getItem('userRole') !== 'admin') {
        document.querySelector('.main-content').innerHTML = '<h2 style="margin:2rem">Yetkiniz Yok</h2>';
        return;
      }
      loadReleases();
    }
  });

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderList();
    });
  });

  const dlAllBtn = document.getElementById('download-all-btn');
  if (dlAllBtn) dlAllBtn.addEventListener('click', downloadAll);
});

async function loadReleases() {
  const list = document.getElementById('admin-rel-list');
  list.innerHTML = 'Yükleniyor...';
  try {
    // Yayın tarihi gelmiş onaylı şarkıları "yayınlandı" durumuna geçirme kontrolü zaten
    // auth.js -> initAuth içinde admin girişinde tetikleniyor; burada da bekleyip
    // panelin ilk açılışta en güncel durumu göstermesini sağlıyoruz (zaten yayınlanmış
    // kayıtlar için sorgu eşleşmediğinden tekrar çalışması zararsız).
    if (window.checkAndPublishDueReleases) await window.checkAndPublishDueReleases();

    // Statüye göre filtreyi client-side yapıyoruz: tüm yayınları bir kerede çekip
    // sekmelere göre burada ayırıyoruz (eşitlik filtresi + orderBy farklı alanlarda
    // composite index isteyeceğinden bundan kaçınıyoruz).
    const snap = await getDocs(query(collection(db, "releases"), orderBy('createdAt', 'desc')));
    allReleases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    renderDecisionLog();
  } catch (e) {
    list.innerHTML = 'Hata: ' + e.message;
  }
}

function renderList() {
  const list = document.getElementById('admin-rel-list');
  const filtered = currentFilter === 'all' ? allReleases : allReleases.filter(r => (r.status || 'bekliyor') === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = '<p class="text-mut">Bu filtrede yayın yok.</p>';
    return;
  }

  list.innerHTML = filtered.map(renderCard).join('');

  filtered.forEach(data => {
    const lyricsBtn = document.getElementById(`lyrics-btn-${data.id}`);
    if (lyricsBtn) {
      lyricsBtn.addEventListener('click', () => {
        const box = document.getElementById(`lyrics-box-${data.id}`);
        if (box) box.style.display = box.style.display === 'block' ? 'none' : 'block';
      });
    }
  });
}

function renderCard(data) {
  const id = data.id;
  const status = data.status || 'bekliyor';
  const statusBadge = {
    bekliyor: '<span class="badge" style="color:#e3b341; border-color:rgba(227,179,65,.4);">BEKLİYOR</span>',
    onaylandı: '<span class="badge" style="color:#4ade80; border-color:rgba(74,222,128,.4);">ONAYLANDI</span>',
    yayınlandı: '<span class="badge" style="color:#60a5fa; border-color:rgba(96,165,250,.4);">YAYINDA</span>',
    reddedildi: '<span class="badge" style="color:var(--bad); border-color:var(--bad);">REDDEDİLDİ</span>'
  }[status] || '';
  const explicitBadge = data.isExplicit ? '<span class="badge" style="color:var(--bad); border-color:var(--bad); margin-left:4px;">EXPLICIT</span>' : '';
  const dateStr = data.releaseDate ? new Date(data.releaseDate).toLocaleDateString('tr-TR') : '-';
  const note = data.adminNote || data.rejectReason || '';
  const lyricsHtml = data.lyrics ? window.escapeHtml(data.lyrics) : '<em>Söz eklenmemiş.</em>';

  return `
    <div class="rel-card">
      <div class="rel-top">
        <img class="rel-cover" src="${data.coverUrl}" alt="">
        <div class="rel-info">
          <h4 style="color:#fff;">${window.escapeHtml(data.title)} ${statusBadge}${explicitBadge}</h4>
          <p style="font-size:0.8rem; margin:4px 0 0;">👤 Sanatçı: <a href="profile.html?uid=${encodeURIComponent(data.ownerId || '')}">${window.escapeHtml(data.artistName)}</a></p>
          <p style="font-size:0.8rem; margin:4px 0 0;">📅 Yayın Tarihi: ${dateStr}</p>
          ${note ? `<p style="font-size:0.78rem; color:var(--shn-pink); margin-top:6px;"><strong>Önceki Not:</strong> ${window.escapeHtml(note)}</p>` : ''}
          <audio controls src="${data.audioUrl}" style="width:100%; margin-top:10px; height:36px;"></audio>
          <button id="lyrics-btn-${id}" class="btn btn-ghost" style="margin-top:8px; padding:4px 10px; font-size:0.7rem;">📝 Sözleri Göster/Gizle</button>
          <div id="lyrics-box-${id}" class="lyrics-box">${lyricsHtml}</div>
        </div>
      </div>

      <textarea id="note-${id}" class="note-box" placeholder="Sanatçıya not (opsiyonel): örn. 'Güzel ama mixi biraz daha yükseltirsen daha iyi olur.'">${window.escapeHtml(note)}</textarea>

      <div class="rel-actions">
        <button class="btn btn-ghost" style="color:#4ade80;" onclick="window.approveRelease('${id}')">✅ Onayla</button>
        <button class="btn btn-ghost" style="color:var(--bad);" onclick="window.rejectRelease('${id}')">❌ Reddet</button>
        <button class="btn btn-secondary" onclick="window.downloadOneRelease('${id}', event)">⬇️ İndir (ZIP)</button>
        <button class="btn btn-ghost" style="color:var(--bad); margin-left:auto;" onclick="window.deleteReleaseAdmin('${id}')">🗑️ Sil</button>
      </div>
    </div>
  `;
}

function renderDecisionLog() {
  const list = document.getElementById('decision-log-list');
  if (!list) return;

  // Genel aktivite günlüğü (activity_log) 24 saatten eski kayıtları otomatik siliyor,
  // bu yüzden kalıcı bir karar geçmişi için onun yerine releases dokümanlarındaki
  // reviewedAt alanını kullanıyoruz (zaten elimizdeki allReleases'ten, ekstra okuma yapmadan).
  const decided = allReleases
    .filter(r => r.reviewedAt)
    .sort((a, b) => (b.reviewedAt?.seconds || 0) - (a.reviewedAt?.seconds || 0));

  if (decided.length === 0) {
    list.innerHTML = '<p class="text-mut">Henüz bir karar verilmedi.</p>';
    return;
  }

  const statusLabel = {
    onaylandı: '<span style="color:#4ade80;">✅ Onaylandı</span>',
    yayınlandı: '<span style="color:#60a5fa;">📡 Yayınlandı</span>',
    reddedildi: '<span style="color:var(--bad);">❌ Reddedildi</span>'
  };

  list.innerHTML = decided.slice(0, 50).map(data => {
    const dateStr = data.reviewedAt?.seconds ? new Date(data.reviewedAt.seconds * 1000).toLocaleString('tr-TR') : '-';
    const note = data.adminNote || data.rejectReason || '';

    return `<div style="font-size:0.8rem; padding:0.6rem 0; border-bottom:1px solid var(--line);">
        <strong style="color:#fff;">${window.escapeHtml(data.reviewedBy || 'Yönetici')}</strong>
        → ${statusLabel[data.status] || window.escapeHtml(data.status)} →
        <span style="color:var(--shn-pink);">${window.escapeHtml(data.title)}</span>
        <span style="color:var(--mut);">(${window.escapeHtml(data.artistName)})</span>
        ${note ? `<br><span style="color:var(--mut); font-size:0.75rem;">Not: ${window.escapeHtml(note)}</span>` : ''}
        <span style="color:var(--mut); float:right;">${dateStr}</span>
      </div>`;
  }).join('');
}

function getNoteValue(id) {
  const el = document.getElementById(`note-${id}`);
  return el ? el.value.trim() : '';
}

window.approveRelease = async function(id) {
  const data = allReleases.find(r => r.id === id);
  if (!data) return;
  const note = getNoteValue(id);
  try {
    await updateDoc(doc(db, "releases", id), {
      status: 'onaylandı',
      adminNote: note,
      reviewedAt: serverTimestamp(),
      reviewedBy: localStorage.getItem('userName') || ''
    });
    window.sendNotification(data.ownerId, `"${data.title}" adlı şarkın onaylandı ve yayına hazırlanıyor!${note ? ' Not: ' + note : ''}`, 'release_approved', 'releases.html');
    window.logActivity('Release onayladı', data.title);
    data.status = 'onaylandı';
    data.adminNote = note;
    data.reviewedAt = { seconds: Math.floor(Date.now() / 1000) };
    data.reviewedBy = localStorage.getItem('userName') || '';
    renderList();
    renderDecisionLog();
    if (window.showToast) window.showToast('Yayın onaylandı.');
  } catch (e) {
    alert('Hata: ' + e.message);
  }
};

window.rejectRelease = async function(id) {
  const data = allReleases.find(r => r.id === id);
  if (!data) return;
  if (!confirm('Bu yayını reddetmek istediğine emin misin?')) return;
  const note = getNoteValue(id);
  try {
    await updateDoc(doc(db, "releases", id), {
      status: 'reddedildi',
      adminNote: note,
      reviewedAt: serverTimestamp(),
      reviewedBy: localStorage.getItem('userName') || ''
    });
    window.sendNotification(data.ownerId, `"${data.title}" adlı şarkın reddedildi.${note ? ' Sebep: ' + note : ''}`, 'release_rejected', 'releases.html');
    window.logActivity('Release reddetti', data.title);
    data.status = 'reddedildi';
    data.adminNote = note;
    data.reviewedAt = { seconds: Math.floor(Date.now() / 1000) };
    data.reviewedBy = localStorage.getItem('userName') || '';
    renderList();
    renderDecisionLog();
    if (window.showToast) window.showToast('Yayın reddedildi.');
  } catch (e) {
    alert('Hata: ' + e.message);
  }
};

window.deleteReleaseAdmin = async function(id) {
  if (!confirm('Bu yayını silmek istediğinize emin misiniz? (Dosyalar da silinecek)')) return;
  try {
    const data = allReleases.find(r => r.id === id);
    if (data) {
      if (data.coverUrl) { try { await deleteObject(ref(storage, data.coverUrl)); } catch (err) {} }
      if (data.audioUrl) { try { await deleteObject(ref(storage, data.audioUrl)); } catch (err) {} }
      window.logActivity('Release sildi', data.title);
    }
    await deleteDoc(doc(db, "releases", id));
    allReleases = allReleases.filter(r => r.id !== id);
    renderList();
    renderDecisionLog();
  } catch (e) {
    alert('Hata: ' + e.message);
  }
};

// ---------- ZIP İndirme (parça.txt + kapak.jpg + ses dosyası) ----------

function sanitizeName(str) {
  const clean = String(str || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return clean || 'parca';
}

function extFromUrl(url, fallback) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const m = path.match(/\.([a-zA-Z0-9]{2,5})$/);
    return m ? m[1].toLowerCase() : fallback;
  } catch (e) {
    return fallback;
  }
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.blob();
}

async function addReleaseToZip(zip, data) {
  // Aynı sanatçı+parça adıyla birden fazla gönderim olursa klasör adları çakışıp
  // JSZip'te birbirinin üzerine yazabileceğinden, klasör adının sonuna kısa bir
  // benzersiz kimlik ekliyoruz.
  const idSuffix = (data.id || '').slice(-6);
  const folderName = sanitizeName(`${data.artistName || 'Sanatci'} - ${data.title || 'Parca'}`) + (idSuffix ? ` [${idSuffix}]` : '');
  const folder = zip.folder(folderName);

  const txtContent = `Sanatçı: ${data.artistName || ''}\nParça Adı: ${data.title || ''}\n\nŞarkı Sözleri:\n${data.lyrics || '(Söz eklenmemiş)'}`;
  folder.file('parça.txt', txtContent);

  const result = { audio: false, cover: false };

  try {
    const audioExt = extFromUrl(data.audioUrl, 'mp3');
    const audioBlob = await fetchBlob(data.audioUrl);
    folder.file(`parça.${audioExt}`, audioBlob);
    result.audio = true;
  } catch (e) {
    console.error('Ses dosyası indirilemedi:', data.title, e);
  }

  try {
    const coverBlob = await fetchBlob(data.coverUrl);
    folder.file('kapak.jpg', coverBlob);
    result.cover = true;
  } catch (e) {
    console.error('Kapak indirilemedi:', data.title, e);
  }

  return result;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

window.downloadOneRelease = async function(id, evt) {
  const data = allReleases.find(r => r.id === id);
  if (!data) return;

  const btn = evt ? evt.currentTarget : null;
  const originalText = btn ? btn.innerText : '';
  if (btn) { btn.disabled = true; btn.innerText = 'Hazırlanıyor...'; }

  try {
    const zip = new JSZip();
    const result = await addReleaseToZip(zip, data);
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(blob, `${sanitizeName(data.title)}.zip`);
    if (!result.audio || !result.cover) {
      alert('Uyarı: Bazı dosyalar zip içine eklenemedi (ses veya kapak indirilemedi).');
    }
  } catch (e) {
    alert('İndirme hatası: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = originalText || '⬇️ İndir (ZIP)'; }
  }
};

async function downloadAll() {
  const filtered = currentFilter === 'all' ? allReleases : allReleases.filter(r => (r.status || 'bekliyor') === currentFilter);
  if (filtered.length === 0) { alert('İndirilecek yayın yok.'); return; }

  const btn = document.getElementById('download-all-btn');
  const originalText = btn.innerText;
  btn.disabled = true;

  try {
    const zip = new JSZip();
    const failures = [];
    let done = 0;

    for (const data of filtered) {
      done++;
      btn.innerText = `Hazırlanıyor (${done}/${filtered.length})...`;
      const result = await addReleaseToZip(zip, data);
      if (!result.audio || !result.cover) failures.push(data.title);
    }

    btn.innerText = 'Zip oluşturuluyor...';
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(blob, `MuzikHan_Releases_${new Date().toISOString().slice(0, 10)}.zip`);

    if (failures.length) {
      alert('Bazı dosyalar indirilemedi: ' + failures.join(', '));
    }
  } catch (e) {
    alert('Toplu indirme hatası: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}
