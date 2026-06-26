import { auth, db, storage } from './firebase.js';
import { updatePassword, updateEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const viewedUid = new URLSearchParams(window.location.search).get('uid');
let isOwnProfile = true;

async function enterViewOnlyMode(uid) {
  document.getElementById('profile-title').innerText = 'Profil';
  document.getElementById('own-avatar-controls').classList.add('hidden');
  document.getElementById('own-profile-controls').classList.add('hidden');
  document.getElementById('other-user-name').classList.remove('hidden');
  document.getElementById('other-user-actions').classList.remove('hidden');

  try {
    const uDoc = await getDoc(doc(db, "users", uid));
    if(uDoc.exists()) {
      const d = uDoc.data();
      document.getElementById('other-user-name-text').innerText = d.name || 'İsimsiz';
      const roleLabels = { admin: 'Yönetici', producer: 'Prodüktör', artist: 'Sanatçı' };
      document.getElementById('other-user-role-text').innerText = roleLabels[d.role] || '';
      if(d.avatarUrl) document.getElementById('prof-avatar-preview').style.backgroundImage = `url(${d.avatarUrl})`;

      document.getElementById('msg-other-user-btn').onclick = () => {
        window.location.href = `messages.html?openChat=${uid}&name=${encodeURIComponent(d.name || d.email || 'Kullanıcı')}&avatar=${encodeURIComponent(d.avatarUrl || '')}`;
      };
    }
  } catch(e) {
    console.error("Kullanıcı profili yüklenemedi:", e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if(!user) return;
    isOwnProfile = !viewedUid || viewedUid === user.uid;

    if(isOwnProfile) {
      document.getElementById('prof-name').value = localStorage.getItem('userName') || user.email;
      document.getElementById('prof-email').value = user.email;
      const av = localStorage.getItem('userAvatar');
      if(av) document.getElementById('prof-avatar-preview').style.backgroundImage = `url(${av})`;
    } else {
      enterViewOnlyMode(viewedUid);
    }
  });

  const fileInput = document.getElementById('prof-avatar-file');
  const uploadBtn = document.getElementById('upload-avatar-btn');
  const preview = document.getElementById('prof-avatar-preview');

  if(fileInput) {
    fileInput.addEventListener('change', (e) => {
      if(e.target.files && e.target.files[0]) {
        preview.style.backgroundImage = `url(${URL.createObjectURL(e.target.files[0])})`;
        uploadBtn.style.display = 'block';
      }
    });
  }

  if(uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const file = fileInput.files[0];
      if(!file) return;
      const check = window.validateFile(file, { maxMB: 5, exts: ['.jpg', '.jpeg', '.png', '.webp', '.gif'] });
      if(!check.ok) return alert(check.message);
      const uid = localStorage.getItem('uid');
      uploadBtn.innerText = "Yükleniyor...";
      uploadBtn.disabled = true;

      try {
        const compressedFile = await window.compressImage(file, 400, 400, 0.8);
        const fileRef = ref(storage, `avatars/${uid}/${Date.now()}_${compressedFile.name}`);
        await uploadBytes(fileRef, compressedFile);
        const url = await getDownloadURL(fileRef);

        await updateDoc(doc(db, "users", uid), { avatarUrl: url });
        localStorage.setItem('userAvatar', url);
        alert("Profil fotoğrafı güncellendi!");
        uploadBtn.style.display = 'none';
        
        // Update navbar immediately if possible
        const navAvatar = document.getElementById('nav-avatar');
        if(navAvatar) navAvatar.style.backgroundImage = `url(${url})`;

      } catch(e) {
        alert("Hata: " + e.message);
      } finally {
        uploadBtn.innerText = "Fotoğrafı Kaydet";
        uploadBtn.disabled = false;
      }
    });
  }

  const nameBtn = document.getElementById('update-name-btn');
  if(nameBtn) {
    nameBtn.addEventListener('click', async () => {
      const n = document.getElementById('prof-name').value;
      if(!n) return alert("İsim boş olamaz!");
      const uid = localStorage.getItem('uid');
      
      nameBtn.innerText = "Güncelleniyor...";
      nameBtn.disabled = true;
      try {
        await updateDoc(doc(db, "users", uid), { name: n });
        localStorage.setItem('userName', n);
        alert("İsminiz başarıyla güncellendi.");
        
        // Navbar'ı hemen güncelle
        const navU = document.getElementById('nav-username');
        if(navU) navU.innerText = n;
      } catch(error) {
        alert("Hata: " + error.message);
      } finally {
        nameBtn.innerText = "İsmi Güncelle";
        nameBtn.disabled = false;
      }
    });
  }

  const pwdBtn = document.getElementById('update-pwd-btn');
  if(pwdBtn) {
    pwdBtn.addEventListener('click', async () => {
      const p = document.getElementById('prof-new-pwd').value;
      if(p.length < 6) return alert("Şifre en az 6 karakter olmalı!");
      
      pwdBtn.innerText = "Güncelleniyor...";
      pwdBtn.disabled = true;
      try {
        await updatePassword(auth.currentUser, p);
        alert("Şifreniz başarıyla güncellendi.");
        document.getElementById('prof-new-pwd').value = '';
      } catch(e) {
        alert("Hata (Tekrar giriş yapmanız gerekebilir): " + e.message);
      } finally {
        pwdBtn.innerText = "Şifreyi Güncelle";
        pwdBtn.disabled = false;
      }
    });
  }

  const emailBtn = document.getElementById('update-email-btn');
  if(emailBtn) {
    emailBtn.addEventListener('click', async () => {
      const e = document.getElementById('prof-new-email').value;
      if(!e || !e.includes('@')) return alert("Geçerli bir e-posta girin!");
      
      emailBtn.innerText = "Güncelleniyor...";
      emailBtn.disabled = true;
      try {
        await updateEmail(auth.currentUser, e);
        alert("E-posta başarıyla güncellendi.");
        document.getElementById('prof-email').value = e;
        document.getElementById('prof-new-email').value = '';
      } catch(error) {
        alert("Hata (Güvenlik sebebiyle tekrar giriş yapmanız gerekebilir): " + error.message);
      } finally {
        emailBtn.innerText = "E-postayı Güncelle";
        emailBtn.disabled = false;
      }
    });
  }
});

// Stats & Bio
import { getDocs, query, collection, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async () => {
  const ownUid = localStorage.getItem("uid");
  if(!ownUid) return;
  // Görüntülenen profil kendi profilimiz değilse (?uid= ile başka bir kullanıcı geziliyorsa)
  // istatistik ve biyografiyi o kullanıcı için yükle, düzenleme sadece kendi profilimizde açık.
  const targetUid = (viewedUid && viewedUid !== ownUid) ? viewedUid : ownUid;
  const canEdit = targetUid === ownUid;

  // Bio loading
  const uDoc = await getDoc(doc(db, "users", targetUid));
  const bioDisp = document.getElementById("bio-display");
  const bioInput = document.getElementById("bio-input");

  if(uDoc.exists()) {
    const d = uDoc.data();
    if(d.bio) {
      bioDisp.textContent = d.bio;
      bioDisp.classList.remove("empty");
      bioInput.value = d.bio;
    }
  }

  if(!canEdit) {
    document.getElementById("bio-edit-btn").style.display = 'none';
  } else {
    // Bio editing
    document.getElementById("bio-edit-btn").addEventListener("click", () => {
      document.getElementById("bio-editor").classList.remove("hidden");
      bioDisp.classList.add("hidden");
    });

    document.getElementById("bio-cancel").addEventListener("click", () => {
      document.getElementById("bio-editor").classList.add("hidden");
      bioDisp.classList.remove("hidden");
    });

    document.getElementById("bio-save").addEventListener("click", async () => {
      const v = bioInput.value;
      try {
        await updateDoc(doc(db, "users", targetUid), { bio: v });
        bioDisp.textContent = v || "Henüz biyografi eklenmedi.";
        if(v) bioDisp.classList.remove("empty"); else bioDisp.classList.add("empty");
        document.getElementById("bio-editor").classList.add("hidden");
        bioDisp.classList.remove("hidden");
        if(window.showToast) window.showToast("Biyografi güncellendi.");
      } catch(e) {
        alert(e.message);
      }
    });
  }

  // Calculate Stats
  try {
    const demosQ = await getDocs(query(collection(db, "demos"), where("ownerId", "==", targetUid)));
    document.getElementById("ps-demos").innerText = demosQ.size;

    // We don"t have a dedicated votes collection currently, we simulate it or leave as 0
    // In a full implementation, you"d query the notifications or a specific votes collection
    document.getElementById("ps-votes").innerText = "0";
  } catch(e) {
    console.error("Stats error", e);
  }
});

