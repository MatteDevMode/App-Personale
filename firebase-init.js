(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyDlqjzEw6MSwIsGnOqzQrVlgC59A3e0OIc",
    authDomain: "app-personale-2e33d.firebaseapp.com",
    projectId: "app-personale-2e33d",
    storageBucket: "app-personale-2e33d.firebasestorage.app",
    messagingSenderId: "216599239391",
    appId: "1:216599239391:web:c214c34ce78b7130f7a76a"
  };

  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK non caricato: controlla i tag <script> in index.html');
    return;
  }

  firebase.initializeApp(firebaseConfig);
  window.auth = firebase.auth();
  window.db = firebase.firestore();
})();
