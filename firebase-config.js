const firebaseConfig = {
  apiKey: "AIzaSyANK0yxqy4xg4BwDEJVX-8TCveISB0khQw",
  authDomain: "dorameiros-e1bdd.firebaseapp.com",
  projectId: "dorameiros-e1bdd",
  storageBucket: "dorameiros-e1bdd.firebasestorage.app",
  messagingSenderId: "1058153533023",
  appId: "1:1058153533023:web:fc3c67ec6c3806208555ea"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.settings({ experimentalForceLongPolling: true, merge: true });
