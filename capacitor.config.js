// Native iPhone / Android shells (Capacitor). The apps load the hosted server,
// so API calls, /t/<id> share links and updates work exactly like the web app.
//
//   APP_URL=https://your-host.example npx cap sync
//
// Without APP_URL the apps point at a server on this Mac (simulator/emulator only).
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

/** @type {import('@capacitor/cli').CapacitorConfig} */
module.exports = {
  appId: 'com.pickupplanner.app',
  appName: 'Pickup Planner',
  webDir: 'public',
  server: {
    url: APP_URL,
    cleartext: APP_URL.startsWith('http://'),
  },
  ios: { contentInset: 'never' },
  android: {},
};
