// firebase-config.js
// Plain data module - no SDK import here. firebase-sync.js lazy-loads the
// real Firebase SDK from the CDN only when sync is actually used, so this
// file just needs to export the config object and the on/off switch.

export const firebaseConfig = {
  apiKey: "AIzaSyDS4tcL7bUs93v3Lqd6e3ylMndzLJK2vNE",
  authDomain: "ai-engineer-os-7cd8b.firebaseapp.com",
  projectId: "ai-engineer-os-7cd8b",
  storageBucket: "ai-engineer-os-7cd8b.firebasestorage.app",
  messagingSenderId: "879291740719",
  appId: "1:879291740719:web:f4e55e096ca86d584e4cda"
};

export const firebaseEnabled = true;
