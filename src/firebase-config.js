// Fill in your Firebase project values.
// Firebase Console → Project Settings → Your apps → SDK setup and configuration
//
// Firestore security rules for production:
//   match /users/{uid} {
//     allow read, write: if request.auth.uid == uid;
//   }
export const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyBOScsu08tzv6zvNvXngTrvXBPsQgTkUK8',
  authDomain:        'schuldashboard.firebaseapp.com',
  projectId:         'schuldashboard',
  storageBucket:     'schuldashboard.firebasestorage.app',
  messagingSenderId: '224280096308',
  appId:             '1:224280096308:web:c715906b6bd712cf9fa461',
};
