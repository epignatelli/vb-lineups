importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyBNxICoyaaRscb2-wHBwU52dxlNOQIRRdk',
  authDomain:        'roots-kqotc.firebaseapp.com',
  projectId:         'roots-kqotc',
  storageBucket:     'roots-kqotc.firebasestorage.app',
  messagingSenderId: '1026148896358',
  appId:             '1:1026148896358:web:a8b5067a7b353b93ade7a7',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Roots', {
    body:  n.body  || '',
    icon:  '/apps/vb-sessions/icons/icon-192.png',
    badge: '/apps/vb-sessions/icons/icon-72.png',
    data:  payload.data || {},
  });
});
