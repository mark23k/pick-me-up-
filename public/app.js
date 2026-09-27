/* Pickup Planner — client */
'use strict';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $share = document.getElementById('shareBtn');

// ---------- utils ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '—');
const minutesBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

function relative(iso) {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (m <= 0) return m > -2 ? 'now' : `${-m} min ago`;
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${m % 60} min`;
}

function toast(msg, ms = 2600) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), ms);
}

const storage = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};
const myIdFor = (tripId) => storage.get('pp:me', {})[tripId] || null;
function rememberMe(tripId, pid) {
  const all = storage.get('pp:me', {});
  all[tripId] = pid;
  storage.set('pp:me', all);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device has no GPS access'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => {
        const err = new Error(e.code === 1 ? 'Location is blocked on this phone' : 'Could not get your location');
        err.denied = e.code === 1;
        reject(err);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/** Step-by-step fix for a blocked location, for the device the user is on. */
function locationHelp() {
  const ua = navigator.userAgent;
  const native = window.Capacitor?.isNativePlatform?.();
  if (/FBAN|FBAV|Instagram|Line\//.test(ua)) {
    return 'This in-app browser blocks location. Open the link in Safari or Chrome (⋯ menu → Open in browser).';
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    return native
      ? 'iPhone Settings → Pickup Planner → Location → While Using the App.'
      : 'iPhone Settings → Privacy & Security → Location Services → Safari Websites → While Using the App. ' +
          'Then in Safari tap aA → Website Settings → Location → Allow, and try again.';
  }
  if (/Android/.test(ua)) {
    return native
      ? 'Android Settings → Apps → Pickup Planner → Permissions → Location → Allow.'
      : 'Tap the icon left of the web address → Permissions → Location → Allow. Also check that Location is on in Android Settings.';
  }
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints < 2) {  // iPads also report "Macintosh"
    return /Chrome\//.test(ua)
      ? 'Click the icon left of the web address → Location → Allow. Also check System Settings → Privacy & Security → Location Services → Google Chrome.'
      : 'Safari → Settings → Websites → Location → set this site to Allow. Also check System Settings → Privacy & Security → Location Services → Safari.';
  }
  return "Allow location for this site in your browser's settings, then try again.";
}

// ---------- state ----------

const state = {
  trip: null,
  me: null, // participant id on this device
  tab: null, // selected result tab (participant id)
  busy: false,
  error: null,
};

const meP = () => state.trip?.participants.find((p) => p.id === state.me) || null;
const driverP = () => state.trip?.participants.find((p) => p.role === 'driver') || null;

// ---------- routing ----------

function route() {
  const m = location.pathname.match(/^\/t\/([\w-]+)/);
  if (m) return openTrip(m[1]);
  state.trip = null;
  $share.hidden = true;
  renderHome();
}
window.addEventListener('popstate', route);

// ---------- home ----------

function renderHome() {
  $app.innerHTML = `
    <section class="card hero">
      <h1>Pick up your friends at the right bus stop</h1>
      <p>Everyone adds their location. The app finds the stop where they should get off the bus or train so you all meet as early as possible. Riders get bus directions, and the driver gets Waze links. Works anywhere in Israel.</p>
      <form id="startForm">
        <label for="name">Your name</label>
        <input id="name" type="text" autocomplete="given-name" required maxlength="40" value="${esc(storage.get('pp:name', ''))}">
        <label id="roleLabel">I am…</label>
        <div class="seg" role="group" aria-labelledby="roleLabel" id="roleSeg">
          <button type="button" data-role="driver" aria-pressed="true">🚗 The driver</button>
          <button type="button" data-role="rider" aria-pressed="false">🚌 Getting picked up</button>
        </div>
        <button class="btn big block" style="margin-top:18px">Start a pickup plan</button>
      </form>
    </section>
    <section class="card small muted">
      <b>How it works</b>
      <ol style="padding-inline-start:18px;margin:8px 0 0">
        <li>Start a plan and send the link to your friends (WhatsApp works well).</li>
        <li>Each person opens the link and taps <i>Use my location</i>.</li>
        <li>Tap <i>Find the best pickup</i>. Everyone sees what time to leave and where to go.</li>
      </ol>
    </section>`;
  let role = 'driver';
  const seg = document.getElementById('roleSeg');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    role = b.dataset.role;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  document.getElementById('startForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value.trim();
    storage.set('pp:name', name);
    try {
      const { trip, participantId } = await api('POST', '/api/trips', { name, role });
      rememberMe(trip.id, participantId);
      history.pushState(null, '', `/t/${trip.id}`);
      route();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ---------- trip ----------

let pollTimer = null;

async function openTrip(id) {
  state.me = myIdFor(id);
  $share.hidden = false;
  if (!state.trip || state.trip.id !== id) {
    $app.innerHTML = `<div class="card row"><div class="spinner"></div> Loading…</div>`;
  }
  try {
    state.trip = (await api('GET', `/api/trips/${id}`)).trip;
  } catch (e) {
    $app.innerHTML = `<div class="banner error">${esc(e.message)}</div><a class="btn" href="/">Start a new plan</a>`;
    return;
  }
  if (state.me && !meP()) state.me = null; // removed from the trip
  renderTrip();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 5000);
}

async function poll() {
  if (document.hidden || !state.trip || state.busy) return;
  if (document.activeElement && document.activeElement.matches('input')) return; // don't disturb typing
  try {
    const { trip } = await api('GET', `/api/trips/${state.trip.id}`);
    if (trip.updatedAt !== state.trip.updatedAt) {
      state.trip = trip;
      renderTrip();
    }
  } catch {
    /* offline — try again next tick */
  }
}

$share.addEventListener('click', async () => {
  const url = location.origin + `/t/${state.trip.id}`;
  const text = `Join my pickup plan. Open the link and add your location: ${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Pickup Planner', text: 'Join my pickup plan and add your location', url });
      return;
    } catch {
      /* cancelled */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }
});

function renderTrip() {
  const trip = state.trip;
  const me = meP();
  const riders = trip.participants.filter((p) => p.role === 'rider');
  const missing = trip.participants.filter((p) => !p.place);
  const canPlan = driverP() && riders.length && !missing.length;

  const scrollY = window.scrollY;
  $app.innerHTML = `
    ${me ? '' : joinCard()}
    ${me ? myLocationCard(me) : ''}
    ${peopleCard()}
    ${settingsCard()}
    <section class="stack" style="margin-bottom:14px">
      ${state.error ? `<div class="banner error">${esc(state.error)}</div>` : ''}
      <button id="planBtn" class="btn big block" ${canPlan && !state.busy ? '' : 'disabled'}>
        ${state.busy ? '<span class="spinner"></span> Checking buses and roads…' : trip.plan ? '🔄 Recalculate' : '✨ Find the best pickup'}
      </button>
      ${!canPlan ? `<p class="small muted" style="text-align:center">${esc(planBlocker())}</p>` : ''}
    </section>
    <div id="results">${trip.plan ? resultsHtml(trip.plan) : ''}</div>`;
  window.scrollTo(0, scrollY);
  bindTrip();
  if (trip.plan) drawMap(trip.plan);
}

function planBlocker() {
  const t = state.trip;
  if (!driverP()) return 'Waiting for a driver to join.';
  if (!t.participants.some((p) => p.role === 'rider')) return 'Share the link so the people you’re picking up can join.';
  const missing = t.participants.filter((p) => !p.place).map((p) => p.name);
  return `Waiting for location from: ${missing.join(', ')}`;
}

function joinCard() {
  const hasDriver = Boolean(driverP());
  return `
    <section class="card">
      <h2>Join this pickup</h2>
      <form id="joinForm">
        <label for="joinName">Your name</label>
        <input id="joinName" type="text" required maxlength="40" value="${esc(storage.get('pp:name', ''))}">
        <label id="joinRoleLabel">I am…</label>
        <div class="seg" role="group" aria-labelledby="joinRoleLabel" id="joinRole">
          <button type="button" data-role="rider" aria-pressed="true">🚌 Getting picked up</button>
          <button type="button" data-role="driver" aria-pressed="false" ${hasDriver ? 'disabled title="There is already a driver"' : ''}>🚗 The driver</button>
        </div>
        <button class="btn block" style="margin-top:14px">Join</button>
      </form>
    </section>`;
}

function myLocationCard(me) {
  return `
    <section class="card">
      <div class="row">
        <h2 class="grow" style="margin:0">Your location</h2>
        <span class="badge ${me.role === 'driver' ? 'warn' : ''}">${me.role === 'driver' ? 'Driver' : 'Rider'}</span>
      </div>
      <p class="small muted" style="margin:6px 0 10px" dir="auto">${me.place ? '📍 ' + esc(me.place.label) : 'Where are you starting from?'}</p>
      <button id="gpsBtn" class="btn block">📍 Use my current location</button>
      <div id="gpsHelp" class="banner error small" style="margin-top:10px" hidden></div>
      <form id="searchForm" class="row" style="margin-top:10px">
        <input id="searchInput" class="grow" type="search" placeholder="…or search an address, city or stop" dir="auto" autocomplete="off" aria-label="Search for a place">
        <button class="btn ghost">Search</button>
      </form>
      <ul id="searchResults" class="results-list" hidden></ul>
    </section>`;
}

function peopleCard() {
  const t = state.trip;
  const items = t.participants
    .map(
      (p) => `
      <li>
        <div class="avatar ${p.role}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div class="person-main">
          <div>${esc(p.name)}${p.id === state.me ? ' <span class="muted small">(you)</span>' : ''}</div>
          <div class="where" dir="auto">${p.place ? esc(p.place.label) : 'No location yet'}</div>
        </div>
        <span class="badge ${p.place ? 'ok' : 'warn'}">${p.role === 'driver' ? '🚗 ' : '🚌 '}${p.place ? 'Ready' : 'Waiting'}</span>
        ${p.id !== state.me ? `<button class="btn danger-text" data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </li>`,
    )
    .join('');
  return `
    <section class="card">
      <div class="row"><h2 class="grow" style="margin:0">Who’s coming</h2>
        <button class="btn ghost small" id="inviteBtn">+ Invite</button></div>
      <ul class="people">${items}</ul>
    </section>`;
}

function settingsCard() {
  const t = state.trip;
  const d = t.destination || { type: 'driverStart' };
  const local = t.departAfter
    ? new Date(Date.parse(t.departAfter) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  const pr = t.priority || 'balanced';
  return `
    <details class="card" id="settings" ${storage.get('pp:settingsOpen', false) ? 'open' : ''}>
      <summary>Trip settings <span class="small muted" style="margin-inline-start:auto;margin-inline-end:8px">${esc(settingsSummary())}</span></summary>
      <label for="when">Earliest time to leave</label>
      <div class="row">
        <input id="when" class="grow" type="datetime-local" value="${local}">
        <button class="btn ghost small" id="nowBtn">Now</button>
      </div>
      <label id="destLabel">After the pickup, go to…</label>
      <div class="seg" role="group" aria-labelledby="destLabel" id="destSeg">
        <button type="button" data-dest="driverStart" aria-pressed="${d.type === 'driverStart'}">Driver’s start</button>
        <button type="button" data-dest="custom" aria-pressed="${d.type === 'custom'}">Somewhere else</button>
        <button type="button" data-dest="none" aria-pressed="${d.type === 'none'}">Just pick up</button>
      </div>
      ${
        d.type === 'custom'
          ? `<p class="small" dir="auto" style="margin:8px 0">${d.place ? '🏁 ' + esc(d.place.label) : 'Search for the destination:'}</p>
             <form id="destForm" class="row"><input id="destInput" class="grow" type="search" placeholder="Destination address" dir="auto" aria-label="Destination">
             <button class="btn ghost">Search</button></form>
             <ul id="destResults" class="results-list" hidden></ul>`
          : ''
      }
      <label id="prLabel">What matters most?</label>
      <div class="seg" role="group" aria-labelledby="prLabel" id="prSeg">
        <button type="button" data-pr="fastest" aria-pressed="${pr === 'fastest'}">Fastest</button>
        <button type="button" data-pr="balanced" aria-pressed="${pr === 'balanced'}">Balanced</button>
        <button type="button" data-pr="lessDriving" aria-pressed="${pr === 'lessDriving'}">Less driving</button>
      </div>
    </details>`;
}

function settingsSummary() {
  const t = state.trip;
  const when = t.departAfter ? fmtTime(t.departAfter) : 'now';
  const dest = { driverStart: '↩ back', custom: '🏁 custom', none: 'pickup only' }[t.destination?.type || 'driverStart'];
  return `${when} · ${dest}`;
}

// ---------- results ----------

function resultsHtml(plan) {
  const me = state.me;
  const people = [
    { id: plan.driver.participantId, name: plan.driver.name, role: 'driver' },
    ...plan.riders.map((r) => ({ id: r.participantId, name: r.name, role: 'rider' })),
  ];
  if (!state.tab || !people.some((p) => p.id === state.tab)) state.tab = people.some((p) => p.id === me) ? me : people[0].id;
  const sel = people.find((p) => p.id === state.tab);
  const s = plan.summary;
  return `
    ${plan.stale ? `<div class="banner warn">Something changed since this plan was made. Tap <b>Recalculate</b>.</div>` : ''}
    ${plan.notes.map((n) => `<div class="banner warn">${esc(n)}</div>`).join('')}
    <div class="summary">
      <div><b>${fmtTime(s.driverLeaveAt)}</b><span>Driver leaves</span></div>
      <div><b>${fmtTime(s.lastPickupAt)}</b><span>Everyone in the car</span></div>
      <div><b>${fmtTime(s.finalArrival)}</b><span>${plan.driver.destination ? 'At destination' : 'Done'}</span></div>
    </div>
    <div class="tabs" role="tablist">
      ${people
        .map(
          (p) =>
            `<button role="tab" data-tab="${esc(p.id)}" aria-selected="${p.id === sel.id}">${p.role === 'driver' ? '🚗' : '🚌'} ${esc(p.name)}${p.id === me ? ' (you)' : ''}</button>`,
        )
        .join('')}
    </div>
    <section class="card">
      ${sel.role === 'driver' ? driverView(plan) : riderView(plan.riders.find((r) => r.participantId === sel.id), plan)}
      <div id="map" role="img" aria-label="Map of the routes"></div>
    </section>
    ${alternativesHtml(plan)}
    <p class="small muted" style="text-align:center">Planned ${fmtTime(plan.computedAt)} using Israel Ministry of Transport timetables. Buses can run late, so check live times in Moovit or Google Maps before you go.</p>`;
}

function driverView(plan) {
  const d = plan.driver;
  const stops = d.stops
    .map(
      (s, i) => `
      <li>
        <span class="dot">${i + 1}</span>
        <div><span class="t">${fmtTime(s.eta)}</span> <b dir="auto">${esc(s.name)}</b>${s.stopCode ? ` <span class="small muted">stop #${esc(s.stopCode)}</span>` : ''}</div>
        <div class="detail">Pick up ${esc(s.riders.join(' & '))}${minutesBetween(s.eta, s.pickupAt) > 3 ? `, ready by ${fmtTime(s.pickupAt)}` : ''}</div>
        <div class="actions"><a class="btn waze small" href="${esc(s.wazeUrl)}" target="_blank" rel="noopener">Navigate with Waze</a></div>
      </li>`,
    )
    .join('');
  const dest = d.destination
    ? `<li><span class="dot">🏁</span>
         <div><span class="t">${fmtTime(d.destination.eta)}</span> <b dir="auto">${esc(d.destination.label || 'Destination')}</b></div>
         <div class="actions"><a class="btn waze small" href="${esc(d.destination.wazeUrl)}" target="_blank" rel="noopener">Navigate with Waze</a></div></li>`
    : '';
  return `
    <div class="leave"><span>Leave at</span><span class="count">${relative(d.leaveAt)}</span></div>
    <div class="leave"><span class="when">${fmtTime(d.leaveAt)}</span>
      <span class="count">${plan.summary.driveMinutes} min driving${d.route ? ` · ${d.route.km} km` : ''}</span></div>
    <ol class="timeline">
      <li><span class="dot">🚗</span><div><span class="t">${fmtTime(d.leaveAt)}</span> Leave from <span dir="auto">${esc(d.origin.label || 'your location')}</span></div></li>
      ${stops}${dest}
    </ol>
    <a class="btn ghost block" href="${esc(d.googleMapsUrl)}" target="_blank" rel="noopener">Whole route in Google Maps</a>
    <p class="small muted">Waze opens one stop at a time. After each pickup, come back here and tap the next stop. Drive times include a 20% traffic allowance, but check Waze for live traffic before you leave.</p>`;
}

function riderView(r, plan) {
  if (!r) return '<p>No instructions.</p>';
  const p = r.pickup;
  if (r.mode === 'home') {
    return `
      <div class="leave"><span>Driver arrives</span><span class="count">${relative(p.driverEta)}</span></div>
      <div class="leave"><span class="when">${fmtTime(p.driverEta)}</span></div>
      <p>🏠 Stay where you are. <b>${esc(plan.driver.name)}</b> will pick you up at <span dir="auto">${esc(p.name)}</span>.</p>`;
  }
  const steps = r.steps
    .map((s) => {
      if (s.type === 'walk') {
        return `<li><span class="dot">🚶</span><div><span class="t">${fmtTime(s.departAt)}</span> Walk ${s.minutes} min to <b dir="auto">${esc(s.to)}</b></div>
          <div class="detail">${s.meters} m</div></li>`;
      }
      const icon = { Bus: '🚌', Train: '🚆', 'Light rail': '🚊', Metro: '🚇' }[s.modeLabel] || '🚌';
      const last = s === r.steps.filter((x) => x.type === 'ride').at(-1);
      return `<li class="ride"><span class="dot">${icon}</span>
        <div><span class="t">${fmtTime(s.departAt)}</span> ${esc(s.modeLabel)} ${s.line ? `<span class="line-no">${esc(s.line)}</span>` : ''}
          ${s.headsign ? `<span class="detail"> to <span dir="auto">${esc(s.headsign)}</span></span>` : ''}</div>
        <div class="detail">Board at <span dir="auto">${esc(s.from)}</span>${s.fromCode ? ` (#${esc(s.fromCode)})` : ''}${!s.line && s.routeName ? ` · <span dir="auto">${esc(s.routeName)}</span>` : ''}${s.agency ? ` · ${esc(s.agency)}` : ''}</div>
        <div class="${last ? 'getoff' : 'detail'}">${last ? '🛑 <b>Get off</b>' : 'Get off'} at <b dir="auto">${esc(s.to)}</b>${s.toCode ? ` (#${esc(s.toCode)})` : ''} at <b>${fmtTime(s.arriveAt)}</b> · ${s.stops} stop${s.stops === 1 ? '' : 's'}</div>
      </li>`;
    })
    .join('');
  return `
    <div class="leave"><span>Leave at</span><span class="count">${relative(r.leaveAt)}</span></div>
    <div class="leave"><span class="when">${fmtTime(r.leaveAt)}</span>
      <span class="count">${minutesBetween(r.leaveAt, r.arriveAt)} min on the way</span></div>
    <ol class="timeline">
      ${steps}
      <li><span class="dot">🚗</span><div><span class="t">${fmtTime(p.meetAt)}</span> <b>${esc(plan.driver.name)}</b> picks you up at <b dir="auto">${esc(p.name)}</b></div>
        <div class="detail">${r.waitMinutes >= 2 ? `You’ll wait about ${r.waitMinutes} min.` : 'The driver should arrive about when you do.'}</div></li>
    </ol>
    <a class="btn ghost block" href="${esc(r.mapsUrl)}" target="_blank" rel="noopener">Check live times in Google Maps</a>`;
}

function alternativesHtml(plan) {
  if (!plan.alternatives.length) return '';
  const rows = plan.alternatives
    .map((a) => {
      const diff = a.extraMinutes === 0 ? 'same time' : a.extraMinutes > 0 ? `${a.extraMinutes} min later` : `${-a.extraMinutes} min earlier`;
      const driveDiff = a.driveMinutes - plan.summary.driveMinutes;
      return `<div class="alt"><div dir="auto">${a.pickups.map((p) => `${esc(p.rider)}: ${esc(p.place)}`).join('<br>')}</div>
        <div class="muted" style="text-align:end;white-space:nowrap">${diff}<br>${driveDiff === 0 ? 'same driving' : `${driveDiff > 0 ? '+' : ''}${driveDiff} min driving`}</div></div>`;
    })
    .join('');
  return `<details class="card"><summary>Other options</summary><div style="margin-top:8px">${rows}</div>
    <p class="small muted">Change <i>What matters most?</i> in the trip settings to weigh total time against driving.</p></details>`;
}

// ---------- map ----------

let map = null;
function drawMap(plan) {
  const el = document.getElementById('map');
  if (!el || !window.L) return;
  if (map) map.remove();
  map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  const bounds = [];
  const add = (layer, pts) => {
    layer.addTo(map);
    bounds.push(...pts);
  };
  const css = getComputedStyle(document.documentElement);
  const brand = css.getPropertyValue('--brand').trim() || '#0f766e';
  const d = plan.driver;
  if (d.route) add(L.polyline(d.route.coordinates, { color: '#f59e0b', weight: 5, opacity: 0.85 }), d.route.coordinates);
  for (const r of plan.riders) {
    for (const g of r.geometry) {
      add(L.polyline(g.coords, { color: brand, weight: g.mode === 'walk' ? 3 : 5, dashArray: g.mode === 'walk' ? '4 8' : null, opacity: 0.9 }), g.coords);
    }
    add(L.circleMarker([r.origin.lat, r.origin.lon], { radius: 6, color: brand, fillOpacity: 1 }).bindTooltip(r.name), [[r.origin.lat, r.origin.lon]]);
  }
  add(L.circleMarker([d.origin.lat, d.origin.lon], { radius: 7, color: '#b45309', fillOpacity: 1 }).bindTooltip(`${d.name} (driver)`), [[d.origin.lat, d.origin.lon]]);
  d.stops.forEach((s, i) =>
    add(L.marker([s.lat, s.lon]).bindPopup(`<b>${i + 1}. ${esc(s.name)}</b><br>${fmtTime(s.eta)} · ${esc(s.riders.join(', '))}`), [[s.lat, s.lon]]),
  );
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
}

// ---------- events ----------

function bindTrip() {
  const trip = state.trip;
  const q = (id) => document.getElementById(id);

  // join
  const joinForm = q('joinForm');
  if (joinForm) {
    let role = 'rider';
    q('joinRole').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      role = b.dataset.role;
      q('joinRole').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    joinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = q('joinName').value.trim();
      storage.set('pp:name', name);
      try {
        const res = await api('POST', `/api/trips/${trip.id}/participants`, { name, role });
        rememberMe(trip.id, res.participantId);
        state.me = res.participantId;
        state.trip = res.trip;
        renderTrip();
        q('gpsBtn')?.focus();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // my location
  const setMyPlace = async (place) => {
    try {
      state.trip = (await api('PATCH', `/api/trips/${trip.id}/participants/${state.me}`, { place })).trip;
      renderTrip();
      toast('Location saved');
    } catch (err) {
      toast(err.message);
    }
  };
  q('gpsBtn')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span> Finding you…';
    try {
      const pos = await getGps();
      const { label } = await api('GET', `/api/reverse?lat=${pos.lat}&lon=${pos.lon}`);
      await setMyPlace({ ...pos, label });
    } catch (err) {
      const help = q('gpsHelp');
      if (err.denied && help) {
        help.innerHTML = `<strong>Location is blocked.</strong> ${esc(locationHelp())}<br>Or search for your address below.`;
        help.hidden = false;
      } else {
        toast(err.message, 4000);
      }
      b.disabled = false;
      b.textContent = '📍 Use my current location';
    }
  });
  bindSearch(q('searchForm'), q('searchInput'), q('searchResults'), setMyPlace);

  // people
  q('inviteBtn')?.addEventListener('click', () => $share.click());
  $app.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = trip.participants.find((x) => x.id === b.dataset.remove);
      if (!p || !confirm(`Remove ${p.name} from this trip?`)) return;
      state.trip = (await api('DELETE', `/api/trips/${trip.id}/participants/${p.id}`)).trip;
      renderTrip();
    }),
  );

  // settings
  const patch = async (body) => {
    try {
      state.trip = (await api('PATCH', `/api/trips/${trip.id}`, body)).trip;
      renderTrip();
    } catch (err) {
      toast(err.message);
    }
  };
  q('settings')?.addEventListener('toggle', (e) => storage.set('pp:settingsOpen', e.target.open));
  q('when')?.addEventListener('change', (e) => patch({ departAfter: e.target.value ? new Date(e.target.value).toISOString() : null }));
  q('nowBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    patch({ departAfter: null });
  });
  q('destSeg')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dest === 'custom') {
      // show the search box; only saved once a place is chosen
      state.trip = { ...trip, destination: { type: 'custom', place: trip.destination?.place || null } };
      renderTrip();
      q('destInput')?.focus();
    } else patch({ destination: { type: b.dataset.dest } });
  });
  bindSearch(q('destForm'), q('destInput'), q('destResults'), (place) => patch({ destination: { type: 'custom', place } }));
  q('prSeg')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) patch({ priority: b.dataset.pr });
  });

  // plan
  q('planBtn')?.addEventListener('click', async () => {
    state.busy = true;
    state.error = null;
    renderTrip();
    try {
      state.trip = (await api('POST', `/api/trips/${trip.id}/plan`)).trip;
      state.tab = null;
      state.busy = false;
      renderTrip();
      document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      state.busy = false;
      state.error = err.message;
      renderTrip();
    }
  });

  // result tabs
  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      renderTrip();
    }),
  );
}

function bindSearch(form, input, list, onPick) {
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text.length < 2) return;
    list.hidden = false;
    list.innerHTML = '<li><button disabled><span class="spinner"></span> Searching…</button></li>';
    try {
      const { results } = await api('GET', `/api/geocode?q=${encodeURIComponent(text)}`);
      if (!results.length) {
        list.innerHTML = '<li><button disabled>Nothing found. Try adding the city name.</button></li>';
        return;
      }
      list.innerHTML = results
        .map(
          (r, i) =>
            `<li><button type="button" data-i="${i}"><span class="kind">${{ stop: '🚏 stop', address: '🏠 address', place: '📍 place' }[r.type]}</span><span dir="auto">${esc(r.label)}</span></button></li>`,
        )
        .join('');
      list.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => {
          list.hidden = true;
          input.blur();
          onPick(results[Number(b.dataset.i)]);
        }),
      );
    } catch (err) {
      list.innerHTML = `<li><button disabled>${esc(err.message)}</button></li>`;
    }
  });
}

// ---------- permissions ----------

/** 'granted' | 'prompt' | 'denied' | 'unknown' (no Permissions API, e.g. older iPhones) */
async function locationPermission() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

/**
 * On first open, ask for location with a clear explanation before anything else.
 * Browsers only show their permission popup after a tap, so this screen provides it.
 */
async function askPermissionsFirst(next) {
  const isPhone = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  if (!isPhone || !navigator.geolocation || storage.get('pp:permAsked', false)) return next();
  // Already allowed, or already blocked (only the user can undo that): go straight in.
  if (['granted', 'denied'].includes(await locationPermission())) return next();

  $share.hidden = true;
  $app.innerHTML = `
    <section class="card hero perm">
      <div class="perm-icon" aria-hidden="true">📍</div>
      <h1>Allow your location</h1>
      <p>So you don't have to type your address. Only the people in your trip see it.</p>
      <button id="permAllow" class="btn block big">📍 Allow location</button>
      <button id="permSkip" class="btn ghost block" style="margin-top:10px">Not now</button>
    </section>`;

  const done = () => {
    storage.set('pp:permAsked', true);
    next();
  };
  document.getElementById('permSkip').addEventListener('click', done);
  document.getElementById('permAllow').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await getGps();
      toast('Location allowed ✓');
    } catch {
      /* whatever they answered, carry on; "Use my location" explains how to unblock */
    }
    done();
  });
}

// ---------- boot ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
askPermissionsFirst(route);
