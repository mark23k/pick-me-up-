# Pickup Planner 🚗🚌

Find the best place to pick up friends anywhere in Israel. Each person adds their location on their own phone. The app works out:

- **For each rider:** which bus or train to take, where to board, **which stop to get off at**, and when to leave home.
- **For the driver:** when to leave, the order of pickups, and a **Waze link** for each stop and for the final destination.

It supports one driver and up to 6 riders. With several riders it chooses both the pickup order and each person's stop. Two riders may be sent to the same interchange so they're collected together.

## Run it

```bash
npm start          # http://localhost:3000   (Node 20+, no dependencies)
npm test           # unit tests for the planning engine
```

On phones, GPS only works over **HTTPS**. To try it on a real phone, deploy it (see below) or use a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

## How the planning works

1. **Transit options.** For each rider it fetches up to 5 bus/train itineraries toward the driver and toward the destination. The data comes from [Transitous](https://transitous.org), which uses the Israel Ministry of Transport's official GTFS timetables.
2. **Pickup candidates.** Every stop the rider passes where getting off is allowed becomes a possible pickup point, and the timetable says exactly when they'd be there. Their own location is a candidate too, for "the driver comes to you".
3. **Pruning.** Candidates are narrowed to about 24 per rider, chosen to be promising and at least 300 m apart.
4. **Drive times.** A single [OSRM](https://project-osrm.org) matrix call gets the drive time between every pair of points. A 20% traffic allowance is added.
5. **Optimisation.** It tries every pickup order. For each order, dynamic programming keeps the best trade-offs between arrival time and driving time, and minimises `final arrival + λ × driving`. λ comes from *What matters most?*: Fastest, Balanced or Less driving.
6. **Timeline.** The driver leaves so they reach the first stop just as it's ready. If a rider would wait more than 8 minutes, the app looks for a later bus (an arrive-by search) so they can leave home later.

## Project layout

```
server/
  index.js      HTTP server, JSON API, static files (no framework)
  planner.js    the planning engine (pure logic + orchestration)
  providers.js  Transitous / OSRM / Nominatim clients
  store.js      trip storage (JSON file; trips expire after 3 days)
public/         the phone app (PWA): index.html, app.js, styles.css, sw.js, manifest
test/           node:test unit tests
```

### API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/trips` | create trip `{name, role}` → `{trip, participantId}` |
| GET | `/api/trips/:id` | read trip (+ plan) |
| PATCH | `/api/trips/:id` | `{departAfter, priority, destination}` |
| POST | `/api/trips/:id/participants` | join `{name, role}` |
| PATCH / DELETE | `/api/trips/:id/participants/:pid` | set `{place, name, role}` / remove |
| POST | `/api/trips/:id/plan` | compute the plan |
| GET | `/api/geocode?q=` · `/api/reverse?lat=&lon=` | search places / GPS → address |

## iPhone & Samsung

The app is a **Progressive Web App**. Open the link in Safari (iPhone) or Chrome (Samsung) and choose **Add to Home Screen**, and it runs full-screen like a native app. To publish to the App Store and Google Play later, wrap `public/` with [Capacitor](https://capacitorjs.com). The code can stay the same; native GPS and push notifications ("time to leave!") can be added as plugins.

## Deploying

This is a single Node process with no build step. It runs on Render, Railway, Fly.io or any VPS. Set `PORT`, and optionally `DATA_FILE`.
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
