import { db } from './firebase.js';
import { collection, addDoc, getDocs, getDoc, doc, setDoc, deleteDoc, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from './auth.js';

let currentUser = null;
let userRole = null;

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if(user) {
      currentUser = user;
      userRole = localStorage.getItem('userRole');

      if(userRole === 'admin') {
        document.getElementById('admin-team-panel').style.display = 'block';
        loadTeams();
      } else if(userRole === 'producer') {
        document.getElementById('producer-artists-panel').style.display = 'block';
        loadMyArtists();
      } else {
        document.querySelector('.main-content').innerHTML = '<h2 style="margin:2rem">Yetkiniz Yok</h2>';
      }
    }
  });

  const createBtn = document.getElementById('btn-create-team');
  if(createBtn) createBtn.addEventListener('click', createTeam);
});

async function loadMyArtists() {
  const list = document.getElementById('my-artists-list');
  if(!list) return;
  list.innerHTML = '<p>Yükleniyor...</p>';

  try {
    // teams koleksiyonu members alanında nesne array'i tuttuğu için
    // "kendi üyesi olduğum ekipler" sorgusu client-side filtreleniyor (mevcut admin akışıyla aynı desen).
    const snap = await getDocs(collection(db, "teams"));
    const artistIds = new Set();

    snap.forEach(d => {
      const data = d.data();
      const amMember = data.members && data.members.some(m => m.uid === currentUser.uid);
      if(amMember) {
        data.members.forEach(m => { if(m.role === 'artist') artistIds.add(m.uid); });
      }
    });

    if(artistIds.size === 0) {
      list.innerHTML = '<p class="text-mut">Henüz bir ekipte birlikte çalıştığın sanatçı yok.</p>';
      return;
    }

    list.innerHTML = '';
    for(const aid of artistIds) {
      const uDoc = await getDoc(doc(db, "users", aid));
      if(!uDoc.exists()) continue;
      const u = uDoc.data();

      list.innerHTML += `
        <div class="member-row">
          <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="window.location.href='profile.html?uid=${aid}'">
            <div id="art-av-${aid}"></div>
            <span style="font-family:'Space Mono'; font-size:0.85rem; color:#fff;">${u.name || 'İsimsiz'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <button class="btn btn-ghost btn-sm" style="padding:2px 6px; font-size:0.65rem;" onclick="this.nextElementSibling.classList.remove('hidden'); this.classList.add('hidden')">Maili Göster</button>
            <span class="hidden" style="font-size:0.75rem; color:var(--mut);">${u.email || ''}</span>
          </div>
        </div>
      `;

      window.getUserAvatar(aid).then(url => {
        const el = document.getElementById(`art-av-${aid}`);
        if(el) el.innerHTML = window.renderAvatarHtml(url, 32, u.name || 'User');
      });
    }
  } catch(e) {
    list.innerHTML = `<p style="color:var(--bad)">Hata: ${e.message}</p>`;
  }
}

async function repairTeamChatSync(tId, members) {
  try {
    const memberUids = members.map(m => m.uid);
    const cRef = doc(db, "chats", tId);
    const cSnap = await getDoc(cRef);
    if(!cSnap.exists()) return;

    const parts = cSnap.data().participants || [];
    const missing = memberUids.filter(uid => !parts.includes(uid));
    if(missing.length > 0) {
      await setDoc(cRef, { participants: [...parts, ...missing] }, { merge: true });
    }
  } catch(e) {
    console.error('Grup sohbeti senkron onarımı başarısız:', tId, e);
  }
}

async function loadTeams() {
  const list = document.getElementById('teams-list');
  list.innerHTML = '';

  try {
    const snap = await getDocs(query(collection(db, "teams")));
    if(snap.empty) {
      list.innerHTML = '<p class="text-mut">Henüz kurulmuş bir ekip yok.</p>';
      return;
    }

    for (const docSnap of snap.docs) {
      const d = docSnap.data();
      const tId = docSnap.id;

      // Geçmişte chat senkronu başarısız olmuş (üye eklendi ama grup sohbetine düşmedi) ekipleri sessizce onar
      repairTeamChatSync(tId, d.members || []);

      let memHtml = '';
      if(d.members && d.members.length > 0) {
        for(const m of d.members) {
          memHtml += `
            <div class="member-row">
              <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="window.location.href='profile.html?uid=${m.uid}'">
                <span style="font-family:'Space Mono'; font-size:0.8rem; color:#fff;">${m.name}</span>
                <span class="badge ${m.role==='admin'?'admin':'friend'}">${m.role}</span>
              </div>
              <button class="btn btn-ghost" style="color:var(--bad); padding:5px 10px;" onclick="removeMember('${tId}', '${m.uid}')">Kaldır</button>
            </div>
          `;
        }
      } else {
        memHtml = '<p style="font-size:0.8rem; color:var(--mut);">Henüz üye yok.</p>';
      }

      list.innerHTML += `
        <div class="team-card" id="team-${tId}">
          <div class="team-header">
            <h4 style="color:var(--shn-pink); font-size:1.2rem;">${d.name}</h4>
            <div style="display:flex; gap:10px;">
              <button class="btn btn-secondary" onclick="renameTeam('${tId}', '${d.name}')">İsim Değiştir</button>
              <button class="btn btn-secondary" style="border-color:var(--bad); color:var(--bad);" onclick="deleteTeam('${tId}')">Ekibi Sil</button>
            </div>
          </div>
          <div class="team-members">${memHtml}</div>
          <div class="search-box">
            <input type="text" id="search-${tId}" placeholder="Sistemde isim veya email ara...">
            <button class="btn btn-primary" onclick="searchAndAddUser('${tId}')">Üye Ekle</button>
          </div>
          <div id="search-res-${tId}" style="margin-top:10px;"></div>
        </div>
      `;
    }
  } catch(e) {
    list.innerHTML = `<p style="color:var(--bad)">Hata: ${e.message}</p>`;
  }
}

async function createTeam() {
  const inp = document.getElementById('new-team-name');
  const name = inp.value.trim();
  if(!name) return;

  try {
    const docRef = await addDoc(collection(db, "teams"), {
      name: name,
      ownerId: currentUser.uid,
      ownerName: localStorage.getItem('userName'),
      createdAt: serverTimestamp(),
      members: [{uid: currentUser.uid, name: localStorage.getItem('userName'), role: userRole}]
    });
    
    // Create group chat
    await setDoc(doc(db, "chats", docRef.id), {
      type: 'group',
      name: name,
      teamId: docRef.id,
      participants: [currentUser.uid],
      updatedAt: serverTimestamp()
    });

    inp.value = '';
    loadTeams();
    alert('Ekip ve Grup Sohbeti kuruldu!');
  } catch(e) {
    alert("Hata: " + e.message);
  }
}

window.renameTeam = async function(tId, oldName) {
  const newName = prompt('Yeni ekip ismini girin:', oldName);
  if(!newName || newName === oldName) return;

  try {
    await setDoc(doc(db, "teams", tId), { name: newName }, { merge: true });
    await setDoc(doc(db, "chats", tId), { name: newName }, { merge: true });
    loadTeams();
  } catch(e) {
    alert("Hata: " + e.message);
  }
}

window.deleteTeam = async function(tId) {
  if(!confirm('Bu ekibi ve tüm mesajlarını silmek istediğinize emin misiniz?')) return;
  try {
    await deleteDoc(doc(db, "teams", tId));
    await deleteDoc(doc(db, "chats", tId));
    loadTeams();
  } catch(e) {
    alert("Hata: " + e.message);
  }
}

window.searchAndAddUser = async function(tId) {
  const qStr = document.getElementById(`search-${tId}`).value.trim().toLowerCase();
  const resDiv = document.getElementById(`search-res-${tId}`);
  if(!qStr) return;

  resDiv.innerHTML = 'Aranıyor...';
  try {
    const snap = await getDocs(collection(db, "users"));
    let found = [];
    snap.forEach(d => {
      const u = d.data();
      if((u.name && u.name.toLowerCase().includes(qStr)) || (u.email && u.email.toLowerCase().includes(qStr))) {
        found.push({uid: d.id, ...u});
      }
    });

    if(found.length === 0) {
      resDiv.innerHTML = '<span style="color:var(--mut); font-size:0.8rem;">Kullanıcı bulunamadı.</span>';
      return;
    }

    let html = '<div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; display:flex; flex-direction:column; gap:8px;">';
    for(let u of found) {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.85rem; color:#fff;">${u.name} (${u.role})</span>
          <button class="btn btn-primary" style="padding:4px 8px; font-size:0.6rem;" onclick="addMemberToTeam('${tId}', '${u.uid}', '${u.name.replace(/'/g,"\\'")}', '${u.role}')">Ekle</button>
        </div>
      `;
    }
    html += '</div>';
    resDiv.innerHTML = html;
  } catch(e) {
    resDiv.innerHTML = `<span style="color:var(--bad)">Hata: ${e.message}</span>`;
  }
}

window.addMemberToTeam = async function(tId, uid, name, role) {
  try {
    const tRef = doc(db, "teams", tId);
    const tSnap = await getDoc(tRef);
    let members = tSnap.exists() ? (tSnap.data().members || []) : [];

    if(members.find(m => m.uid === uid)) {
      alert("Bu kullanıcı zaten ekipte.");
      return;
    }

    members.push({uid, name, role});
    await setDoc(tRef, { members: members }, { merge: true });

    // Update chat participants
    const cRef = doc(db, "chats", tId);
    const cSnap = await getDoc(cRef);
    let parts = cSnap.exists() ? (cSnap.data().participants || []) : [];
    if(!parts.includes(uid)) parts.push(uid);
    await setDoc(cRef, { participants: parts }, { merge: true });

    // Send notification to the user
    const tName = (await getDoc(tRef)).data().name;
    await addDoc(collection(db, `notifications/${uid}/user_notifications`), {
      message: `Seni "${tName}" ekibine ekledi!`,
      createdAt: serverTimestamp(),
      type: 'team_add',
      link: 'messages.html'
    });

    document.getElementById(`search-${tId}`).value = '';
    loadTeams();
  } catch(e) {
    alert("Hata: " + e.message);
  }
}

window.removeMember = async function(tId, uid) {
  if(!confirm('Kullanıcıyı ekipten çıkarmak istediğinize emin misiniz?')) return;
  try {
    const tRef = doc(db, "teams", tId);
    const tSnap = await getDoc(tRef);
    let members = tSnap.exists() ? (tSnap.data().members || []) : [];

    members = members.filter(m => m.uid !== uid);
    await setDoc(tRef, { members: members }, { merge: true });

    // Remove from chat
    const cRef = doc(db, "chats", tId);
    const cSnap = await getDoc(cRef);
    let parts = cSnap.exists() ? (cSnap.data().participants || []) : [];
    parts = parts.filter(p => p !== uid);
    await setDoc(cRef, { participants: parts }, { merge: true });

    loadTeams();
  } catch(e) {
    alert("Hata: " + e.message);
  }
}
