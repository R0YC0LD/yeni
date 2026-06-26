import { auth, db } from './firebase.js';
import { createUserWithEmailAndPassword, onAuthStateChanged, signOut, signInWithEmailAndPassword, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Check if we are on login page
const isLoginPage = window.location.pathname.includes('login.html');

export { auth };

export function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (!user.emailVerified) {
        if (isLoginPage) {
          const lBox = document.getElementById('login-box');
          const vBox = document.getElementById('verify-box');
          if(lBox) lBox.style.display = 'none';
          if(vBox) vBox.style.display = 'block';
        } else {
          window.location.href = 'login.html';
        }
        return;
      }

      // Fetch user role
      const userDoc = await getDoc(doc(db, "users", user.uid));
      let role = 'artist'; // default
      let name = user.email.split('@')[0];
      let avatar = '';
      
      let isApproved = false;
      
      if (userDoc.exists()) {
        role = userDoc.data().role || 'artist';
        name = userDoc.data().name || name;
        avatar = userDoc.data().avatarUrl || '';
        isApproved = userDoc.data().isApproved === true;
      } else {
        // Create user doc if missing
        try {
          await setDoc(doc(db, "users", user.uid), { email: user.email, name, role, avatarUrl: '', isApproved: false });
        } catch(err) {
          console.error("Error creating user doc:", err);
          alert("Kullanıcı profiliniz oluşturulurken bir hata oluştu: " + err.message);
        }
      }

      // Admin her zaman onaylıdır
      if (role === 'admin') isApproved = true;

      if (!isApproved) {
        if (!window.location.pathname.includes('wait.html')) {
          window.location.href = 'wait.html';
        }
        return;
      }

      localStorage.setItem('userRole', role);
      localStorage.setItem('userName', name);
      localStorage.setItem('userAvatar', avatar);
      localStorage.setItem('uid', user.uid);

      if (isLoginPage) {
        window.location.href = 'dashboard.html';
      } else {
        // Setup UI permissions based on role
        applyPermissions(role);
      }
    } else {
      localStorage.clear();
      if (!isLoginPage) {
        window.location.href = 'login.html';
      }
    }
  });
}

function applyPermissions(role) {
  // Show allowed links (they are hidden by default to prevent flicker)
  const elements = document.querySelectorAll('[data-role]');
  elements.forEach(el => {
    const allowedRoles = el.getAttribute('data-role').split(',');
    if (allowedRoles.includes(role) || allowedRoles.includes('all')) {
      if (el.tagName.toLowerCase() === 'a') {
        el.style.display = 'flex'; // sidebar links use flex
      } else {
        el.style.display = 'block';
      }
    } else {
      el.style.display = 'none';
    }
  });

  const userName = localStorage.getItem('userName') || 'Kullanıcı';
  const userAvatar = localStorage.getItem('userAvatar') || '';

  const userNameDisplay = document.getElementById('user-name-display');
  if(userNameDisplay) {
    userNameDisplay.innerText = userName;
  }
  
  const navUsername = document.getElementById('nav-username');
  if(navUsername) {
    navUsername.innerText = userName;
  }

  // Render avatars if window.renderAvatarHtml is ready (from app.js)
  setTimeout(() => {
    if(window.renderAvatarHtml) {
      const sbAv = document.querySelector('.user-profile .avatar');
      if(sbAv) sbAv.outerHTML = window.renderAvatarHtml(userAvatar, 40, userName);

      const navAv = document.getElementById('nav-avatar');
      if(navAv) {
         // Keep the id so it doesn't break CSS if any, actually renderAvatarHtml doesn't add ID.
         const html = window.renderAvatarHtml(userAvatar, 35, userName);
         navAv.outerHTML = html.replace('class="avatar"', 'id="nav-avatar" class="avatar"');
      }
    }
  }, 100);
}

// Firebase'in ham İngilizce/teknik hata mesajları yerine kullanıcıya anlaşılır Türkçe mesaj göster
export function getFriendlyAuthError(error) {
  const map = {
    'auth/invalid-email': 'Geçersiz e-posta adresi girdiniz.',
    'auth/user-not-found': 'Bu e-posta ile kayıtlı bir hesap bulunamadı.',
    'auth/wrong-password': 'Şifre hatalı.',
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/email-already-in-use': 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı deneyin.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Lütfen birazdan tekrar deneyin.',
    'auth/network-request-failed': 'Bağlantı hatası. İnternet bağlantınızı kontrol edin.',
  };
  return map[error.code] || 'Bir hata oluştu, lütfen tekrar deneyin.';
}

export async function registerUser(email, pass) {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  try {
    let name = email.split('@')[0];
    await setDoc(doc(db, "users", cred.user.uid), { email: email, name: name, role: 'artist', avatarUrl: '', isApproved: false });
  } catch(e) {
    console.error("Firestore user creation failed:", e);
  }
  await sendEmailVerification(cred.user);
  // signOut yapmıyoruz ki verify-box'ta kalabilsin
}

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  return signOut(auth);
}

// Global logout hook
window.logoutUser = () => {
  logout();
};
