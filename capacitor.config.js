// Native iPhone / Android shells (Capacitor). The apps load the hosted server,
// so API calls, /t/<id> share links and updates work exactly like the web app.
//
//   npx cap sync                                  -> live site (Netlify)
//   APP_URL=http://localhost:3000 npx cap sync    -> server on this Mac (simulator/emulator only)
const APP_URL = process.env.APP_URL || 'https://pickup-planner.netlify.app';

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
