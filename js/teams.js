import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from './auth.js';

let currentUser = null;
let userRole = null;

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if(user) {
      currentUser = user;
      userRole = localStorage.getItem('userRole');
      if(userRole !== 'admin') {
        document.querySelector('.main-content').innerHTML = '<h2 style="margin:2rem">Yetkiniz Yok</h2>';
        return;
      }
      loadTeams();
    }
  });

  document.getElementById('btn-create-team').addEventListener('click', createTeam);
});

async function loadTeams() {
  const list = document.getElementById('teams-list');
  list.innerHTML = '';
  
  try {
    let q;
    if(userRole === 'admin') {
      q = query(collection(db, "teams"));
    } else {
      q = query(collection(db, "teams"), where("ownerId", "==", currentUser.uid));
    }

    const snap = await getDocs(q);
    if(snap.empty) {
      list.innerHTML = '<p class="text-mut">Henüz kurduğunuz bir ekip yok.</p>';
      return;
    }

    for (const docSnap of snap.docs) {
      const d = docSnap.data();
      const tId = docSnap.id;
      
      let memHtml = '';
      if(d.members && d.members.length > 0) {
        for(const m of d.members) {
          memHtml += `
            <div class="member-row">
              <div style="display:flex; align-items:center; gap:10px;">
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
    const snap = await getDocs(query(collection(db, "teams")));
    let members = [];
    snap.forEach(s => { if(s.id === tId) members = s.data().members || []; });
    
    if(members.find(m => m.uid === uid)) {
      alert("Bu kullanıcı zaten ekipte.");
      return;
    }

    members.push({uid, name, role});
    await setDoc(tRef, { members: members }, { merge: true });

    // Update chat participants
    const cRef = doc(db, "chats", tId);
    const cSnap = await getDocs(query(collection(db, "chats")));
    let parts = [];
    cSnap.forEach(s => { if(s.id === tId) parts = s.data().participants || []; });
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
    const snap = await getDocs(query(collection(db, "teams")));
    let members = [];
    snap.forEach(s => { if(s.id === tId) members = s.data().members || []; });
    
    members = members.filter(m => m.uid !== uid);
    await setDoc(tRef, { members: members }, { merge: true });

    // Remove from chat
    const cRef = doc(db, "chats", tId);
    const cSnap = await getDocs(query(collection(db, "chats")));
    let parts = [];
    cSnap.forEach(s => { if(s.id === tId) parts = s.data().participants || []; });
    parts = parts.filter(p => p !== uid);
    await setDoc(cRef, { participants: parts }, { merge: true });

    loadTeams();
  } catch(e) {
    alert("Hata: " + e.message);
  }
}
