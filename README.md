# Pickup Planner 🚗🚌

Find the best place to pick up friends anywhere in Israel. Whoever starts the group enters where everyone is going, what time they need to be there, and up to 3 stops on the way (about 10 minutes each). Each person then adds their location on their own phone. The app works out:

- **Which car takes whom:** up to 4 drivers, each with a set number of free seats. Riders are split so everyone arrives as early as possible without a lot of extra driving.
- **For each rider:** when to leave home, which stop to go to, which bus or train to take and **which stop to get off at**, with links to Google Maps and Moovit.
- **For each driver:** when to leave so they arrive on time, the order of pickups, then the stops and the destination, with a **Waze link** for each.

Pickup spots lean toward where the group is heading, so no one is sent the opposite way unless it's really faster. There can be up to 6 riders. Two riders may be sent to the same interchange so they're collected together.

**Organizer & confirming.** Whoever creates the trip is the organizer: only they change the destination, time and stops, remove people, and **confirm** the plan. A confirmed plan is locked until they unlock it; later changes show a warning instead of silently changing everyone's instructions. Each phone proves who it is with a secret key (`X-Key`) it gets when it creates or joins.

**Reminders.** In the iPhone/Android app, "🔔 Remind me when to leave" schedules notifications on the phone 10 minutes before and at leave time, and updates them when the plan changes. On the website, "📅 Add to calendar" downloads an invite (`/api/trips/:id/calendar/:pid.ics`) with a 10-minute alert.

**Shabbat & holidays** (Hebrew calendar) get one clear note when buses aren't running. Timetable and address lookups are cached for 10 minutes to stay within the free services' limits.

The app is in **Hebrew by default** (right-to-left), with a button in the top bar to switch to English. All text lives in `public/i18n.js`. Server errors and plan notes carry a `code` + `params` that the app translates, with English as the fallback.

## Run it

```bash
npm start          # http://localhost:3000   (Node 22+, no runtime dependencies)
npm test           # unit tests for the planning engine
```

On phones, GPS only works over **HTTPS**. To try it on a real phone, deploy it (see below) or use a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

## How the planning works

1. **Transit options.** For each rider it fetches up to 5 bus/train itineraries toward the driver and toward the destination. The data comes from [Transitous](https://transitous.org), which uses the Israel Ministry of Transport's official GTFS timetables.
2. **Pickup candidates.** Every stop the rider passes where getting off is allowed becomes a possible pickup point, and the timetable says exactly when they'd be there. Their own location is a candidate too, for "the driver comes to you".
3. **Pruning.** Candidates are narrowed to about 24 per rider, chosen to be promising and at least 300 m apart.
4. **Drive times.** A single [OSRM](https://project-osrm.org) matrix call gets the drive time between every pair of points. A 20% traffic allowance is added.
5. **Optimisation.** Each car's route is: pickups, then the stops in order, then the destination. For every driver and every group of riders that fits in their car, it tries every pickup order. Dynamic programming keeps the best trade-offs between arrival time and driving. It then chooses the split of riders between cars that minimises `average rider arrival + λ × extra driving + 0.25 × rider minutes on transit`. The last term stops riders being sent on long bus rides to reach a car that could have come to them. λ comes from *What matters most?*: Fastest, Balanced or Less driving.
6. **Timeline.** With an arrival time, planning starts early enough for the longest drive, and each car's timeline is then moved later so it arrives right on time (retrying once from an earlier start if a car would be late). The driver leaves so they reach the first stop just as it's ready. If a rider would wait more than 8 minutes, the app looks for a later bus (an arrive-by search) so they can leave home later.

## Project layout

```
server/
  api.js        JSON API routes (shared by both hosts)
  index.js      Node HTTP server: API + static files (no framework)
  planner.js    the planning engine (pure logic + orchestration)
  providers.js  Transitous / OSRM / Nominatim clients
  calendar.js   .ics invite for one person's part of the plan
  store.js      trip storage: JSON file, or Netlify Blobs (trips expire after 3 days)
netlify/        Netlify Function wrapping server/api.js
public/         the phone app (PWA): index.html, app.js, i18n.js (Hebrew/English), styles.css, sw.js, manifest
test/           node:test unit tests
```

### API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/trips` | create trip `{name, role, destination, stops, arriveBy}` → `{trip, participantId}` |
| GET | `/api/trips/:id` | read trip (+ plan) |
| PATCH | `/api/trips/:id` | `{arriveBy, priority, destination, stops}` |
| POST | `/api/trips/:id/participants` | join `{name, role}` |
| PATCH / DELETE | `/api/trips/:id/participants/:pid` | set `{place, name, role, seats}` / remove |
| POST | `/api/trips/:id/plan` | compute the plan (refused while confirmed) |
| POST | `/api/trips/:id/confirm` · `/unlock` | organizer locks / unlocks the plan |
| GET | `/api/trips/:id/calendar/:pid.ics?lang=` | calendar invite for one person |
| GET | `/api/geocode?q=` · `/api/reverse?lat=&lon=` | search places / GPS → address |

## iPhone & Android apps

`ios/` and `android/` are native [Capacitor](https://capacitorjs.com) apps. They load the hosted server, so API calls, share links and updates behave exactly like the web app. Update the server and every installed app picks up the change without a new store release.

```bash
npm install                                   # Capacitor tooling (dev only; the server itself has no deps)
npx cap sync                                  # apps load https://pickup-planner.netlify.app
npm run ios                                   # opens Xcode    → pick a device → ▶ Run
npm run android                               # opens Android Studio → ▶ Run
```

To test against a local server instead, run `APP_URL=http://localhost:3000 npx cap sync` while `npm start` is running (iOS simulator). For the Android emulator, also run `adb reverse tcp:3000 tcp:3000`. Real phones need a public HTTPS `APP_URL`.

- App id: `com.pickupplanner.app`. Change it in `capacitor.config.js` before the first store upload.
- Icons and splash screens are generated from `assets/icon.png` with `npx @capacitor/assets generate --ios --android`.
- Publishing needs an Apple Developer account ($99/yr) for the App Store and a Google Play Console account ($25 once).

The web version still works as a PWA: open the link and choose **Add to Home Screen**.

## Deploying

**Netlify.** `netlify.toml` serves `public/` as the site and runs the API as a Netlify Function (`netlify/functions/api.mjs`). Trips are stored in Netlify Blobs. No build step is needed.

```bash
npx netlify-cli login
npx netlify-cli deploy --create-site pickup-planner --prod   # first time
npx netlify-cli deploy --prod                                # later deploys
npx netlify-cli dev                                          # run the Netlify version locally (:8888)
```

Or connect the GitHub repo in the Netlify dashboard so every push deploys.

**Any Node host.** `npm start` is a single process with no build step. It runs on Render, Railway, Fly.io or any VPS. Set `PORT`, and optionally `DATA_FILE`.

Both run the same routes (`server/api.js`).
The free public services it uses have fair-use limits. For real traffic, self-host them or point the env vars at your own instances:

| Env var | Default | Self-host option |
|---|---|---|
| `TRANSIT_URL` | api.transitous.org | [MOTIS](https://github.com/motis-project/motis) + Israel GTFS (`gtfs.mot.gov.il`) |
| `OSRM_URL` | router.project-osrm.org | OSRM with `israel-and-palestine-latest.osm.pbf` |
| `NOMINATIM_URL` | nominatim.openstreetmap.org | Nominatim, or a paid geocoder |

## Known limits / next steps

- Drive times don't include live traffic. There is a flat 20% allowance, and Waze shows live traffic once the driver is navigating. Next step: a traffic-aware matrix API (Google Distance Matrix or HERE).
- Transit times are scheduled times, not live bus positions. Next step: SIRI real-time data from MOT.
- Waze deep links take one destination, so the driver taps each stop in turn. Google Maps gets the full multi-stop route.
- There are no buses on Shabbat. The app detects this and falls back to picking riders up at their location.
- Trip links act as the password: anyone with the link can edit the trip. Add sign-in if that matters.
- UI is English (stop names show in Hebrew). A Hebrew/RTL UI is a natural next step.
