/* Pickup Planner — client. Text comes from i18n.js via t(). */
'use strict';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $share = document.getElementById('shareBtn');
const $lang = document.getElementById('langBtn');

// ---------- utils ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '—');
const minutesBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
const dayKey = (d) =>
  new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jerusalem' }).format(d);
/** "18:00", or "Fri 3 Oct 18:00" when it isn't today. */
const fmtWhen = (iso) => (!iso ? '—' : dayKey(new Date(iso)) === dayKey(new Date()) ? fmtTime(iso) : `${dayKey(new Date(iso))} ${fmtTime(iso)}`);
// <input type="datetime-local"> works in the phone's local time
const toLocalInput = (iso) => (iso ? new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

function relative(iso) {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (m <= 0) return m > -2 ? t('now') : t('minAgo', -m);
  if (m < 60) return t('inMin', m);
  return t('inHours', Math.floor(m / 60), m % 60);
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

/** Server errors and plan notes come with a code; show them in the viewer's language. */
const errorText = (data, status) =>
  data.code && hasT(`err.${data.code}`) ? t(`err.${data.code}`, data.params || {}, t) : data.error || t('requestFailed', status);
const noteText = (n) =>
  typeof n === 'string' ? n : hasT(`note.${n.code}`) ? t(`note.${n.code}`, n.params || {}, t, fmtWhen) : n.text;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(data, res.status));
  return data;
}

function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('noGps')));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => {
        const err = new Error(e.code === 1 ? t('locBlocked') : t('locFailed'));
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
  if (/FBAN|FBAV|Instagram|Line\//.test(ua)) return t('help.inApp');
  if (/iPhone|iPad|iPod/.test(ua)) return native ? t('help.iosApp') : t('help.iosWeb');
  if (/Android/.test(ua)) return native ? t('help.androidApp') : t('help.androidWeb');
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints < 2) {
    // iPads also report "Macintosh"
    return /Chrome\//.test(ua) ? t('help.macChrome') : t('help.macSafari');
  }
  return t('help.other');
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

// ---------- language ----------

function renderChrome() {
  document.title = t('appName');
  $share.textContent = t('shareBtn');
  $lang.textContent = t('langSwitch');
  $lang.setAttribute('aria-label', t('langSwitchAria'));
}

$lang.addEventListener('click', () => {
  setLang(lang === 'he' ? 'en' : 'he');
  renderChrome();
  // redraw whatever is on screen in the new language
  if (state.trip) renderTrip();
  else if (document.getElementById('permAllow')) askPermissionsFirst(route);
  else renderHome();
});

// ---------- home ----------

const MAX_STOPS = 3;

/** Search box + results list for choosing a place (wired up by bindSearch). */
const pickerHtml = (prefix, placeholder) => `
  <form id="${prefix}Form" class="row">
    <input id="${prefix}Input" class="grow" type="search" placeholder="${esc(placeholder)}" dir="auto" autocomplete="off" aria-label="${esc(placeholder)}">
    <button class="btn ghost">${t('search')}</button>
  </form>
  <ul id="${prefix}Results" class="results-list" hidden></ul>`;

const stopItems = (stops) =>
  stops
    .map(
      (p, i) => `<li><span class="dot">${i + 1}</span><span class="grow" dir="auto">${esc(p.label)}</span>
        <button type="button" class="btn danger-text" data-stop-remove="${i}" aria-label="${esc(t('removeStop', i + 1))}">✕</button></li>`,
    )
    .join('');

// kept across language switches so nothing typed is lost
const homeDraft = { dest: null, stops: [], arrive: '', role: 'driver' };

function renderHome() {
  const draft = homeDraft;
  $app.innerHTML = `
    <section class="card hero">
      <h1>${t('heroTitle')}</h1>
      <p>${t('heroText')}</p>
      <label for="name">${t('yourName')}</label>
      <input id="name" type="text" autocomplete="given-name" maxlength="40" dir="auto" value="${esc(storage.get('pp:name', ''))}">
      <label id="roleLabel">${t('iAm')}</label>
      <div class="seg" role="group" aria-labelledby="roleLabel" id="roleSeg">
        <button type="button" data-role="driver" aria-pressed="${draft.role === 'driver'}">${t('roleDriver')}</button>
        <button type="button" data-role="rider" aria-pressed="${draft.role === 'rider'}">${t('roleRider')}</button>
      </div>
      <label for="homeDestInput">${t('whereGoing')}</label>
      <p id="homeDestChosen" class="small chosen" dir="auto" hidden></p>
      ${pickerHtml('homeDest', t('destPlaceholder'))}
      <label for="homeArrive">${t('whenThere')}</label>
      <input id="homeArrive" type="datetime-local" value="${esc(draft.arrive)}" min="${toLocalInput(new Date().toISOString())}">
      <label for="homeStopInput">${t('stopsOnWay')} <span class="muted">${t('optional')}</span></label>
      <ol id="homeStops" class="stop-list"></ol>
      <div id="homeStopPicker">${pickerHtml('homeStop', t('addStop'))}</div>
      <button id="startBtn" class="btn big block" style="margin-top:18px">${t('start')}</button>
    </section>
    <section class="card small muted">
      <b>${t('howTitle')}</b>
      <ol style="padding-inline-start:18px;margin:8px 0 0">
        <li>${t('how1')}</li>
        <li>${t('how2')}</li>
        <li>${t('how3')}</li>
      </ol>
    </section>`;
  const $ = (id) => document.getElementById(id);
  const showDraft = () => {
    $('homeDestChosen').hidden = !draft.dest;
    $('homeDestChosen').textContent = draft.dest ? `🏁 ${draft.dest.label}` : '';
    $('homeDestInput').placeholder = draft.dest ? t('changeDest') : t('destPlaceholder');
    $('homeStops').innerHTML = stopItems(draft.stops);
    $('homeStopPicker').hidden = draft.stops.length >= MAX_STOPS;
    $('homeStops').querySelectorAll('[data-stop-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        draft.stops.splice(Number(b.dataset.stopRemove), 1);
        showDraft();
      }),
    );
  };
  showDraft();
  const seg = $('roleSeg');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    draft.role = b.dataset.role;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('name').addEventListener('input', (e) => storage.set('pp:name', e.target.value.trim()));
  $('homeArrive').addEventListener('input', (e) => (draft.arrive = e.target.value));
  bindSearch($('homeDestForm'), $('homeDestInput'), $('homeDestResults'), (place) => {
    draft.dest = place;
    $('homeDestInput').value = '';
    showDraft();
  });
  bindSearch($('homeStopForm'), $('homeStopInput'), $('homeStopResults'), (place) => {
    draft.stops.push(place);
    $('homeStopInput').value = '';
    showDraft();
  });
  $('startBtn').addEventListener('click', async () => {
    const name = $('name').value.trim();
    if (!name) {
      toast(t('enterName'));
      return $('name').focus();
    }
    if (!draft.dest) {
      toast(t('chooseDest'));
      return $('homeDestInput').focus();
    }
    const arriveBy = fromLocalInput($('homeArrive').value);
    if (!arriveBy || Date.parse(arriveBy) < Date.now() + 10 * 60000) {
      toast(arriveBy ? t('timePassed') : t('chooseTime'));
      return $('homeArrive').focus();
    }
    storage.set('pp:name', name);
    try {
      const { trip, participantId } = await api('POST', '/api/trips', {
        name,
        role: draft.role,
        destination: draft.dest,
        stops: draft.stops,
        arriveBy,
      });
      Object.assign(homeDraft, { dest: null, stops: [], arrive: '' });
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
    $app.innerHTML = `<div class="card row"><div class="spinner"></div> ${t('loading')}</div>`;
  }
  try {
    state.trip = (await api('GET', `/api/trips/${id}`)).trip;
  } catch (e) {
    $app.innerHTML = `<div class="banner error">${esc(e.message)}</div><a class="btn" href="/">${t('startNew')}</a>`;
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
  if (navigator.share) {
    try {
      // One plain-text item with the link on its own line. Passing title/url separately makes
      // iOS hand WhatsApp a binary "bplist00…" blob instead of a tappable link.
      await navigator.share({ text: t('shareText', url) });
      return;
    } catch {
      /* cancelled */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('linkCopied'));
  } catch {
    window.open(`https://wa.me/?text=${encodeURIComponent(t('shareText', url))}`, '_blank');
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
        ${state.busy ? `<span class="spinner"></span> ${t('planning')}` : trip.plan ? t('recalc') : t('findBest')}
      </button>
      ${!canPlan ? `<p class="small muted" style="text-align:center">${esc(planBlocker())}</p>` : ''}
    </section>
    <div id="results">${trip.plan ? resultsHtml(trip.plan) : ''}</div>`;
  window.scrollTo(0, scrollY);
  bindTrip();
  if (trip.plan) drawMap(trip.plan);
}

function planBlocker() {
  const tr = state.trip;
  if (!driverP()) return t('blockNoDriver');
  if (!tr.participants.some((p) => p.role === 'rider')) return t('blockNoRiders');
  const missing = tr.participants.filter((p) => !p.place).map((p) => p.name);
  return t('blockMissing', t('list', missing));
}

function joinCard() {
  return `
    <section class="card">
      <h2>${t('joinTitle')}</h2>
      <form id="joinForm">
        <label for="joinName">${t('yourName')}</label>
        <input id="joinName" type="text" required maxlength="40" dir="auto" value="${esc(storage.get('pp:name', ''))}">
        <label id="joinRoleLabel">${t('iAm')}</label>
        <div class="seg" role="group" aria-labelledby="joinRoleLabel" id="joinRole">
          <button type="button" data-role="rider" aria-pressed="true">${t('roleRider')}</button>
          <button type="button" data-role="driver" aria-pressed="false">${t('roleDriver')}</button>
        </div>
        <button class="btn block" style="margin-top:14px">${t('joinBtn')}</button>
      </form>
    </section>`;
}

function myLocationCard(me) {
  return `
    <section class="card">
      <div class="row">
        <h2 class="grow" style="margin:0">${t('yourLocation')}</h2>
        <span class="badge ${me.role === 'driver' ? 'warn' : ''}">${me.role === 'driver' ? t('badgeDriver') : t('badgeRider')}</span>
      </div>
      <p class="small muted" style="margin:6px 0 10px" dir="auto">${me.place ? '📍 ' + esc(me.place.label) : t('whereFrom')}</p>
      <button id="gpsBtn" class="btn block">${t('useGps')}</button>
      <div id="gpsHelp" class="banner error small" style="margin-top:10px" hidden></div>
      <form id="searchForm" class="row" style="margin-top:10px">
        <input id="searchInput" class="grow" type="search" placeholder="${esc(t('searchPlaceholder'))}" dir="auto" autocomplete="off" aria-label="${esc(t('searchAria'))}">
        <button class="btn ghost">${t('search')}</button>
      </form>
      <ul id="searchResults" class="results-list" hidden></ul>
      ${
        me.role === 'driver'
          ? `<label id="seatsLabel">${t('freeSeats')}</label>
             <div class="seg" role="group" aria-labelledby="seatsLabel" id="seatSeg">
               ${[1, 2, 3, 4, 5, 6].map((n) => `<button type="button" data-seats="${n}" aria-pressed="${(me.seats || 4) === n}">${n}</button>`).join('')}
             </div>`
          : ''
      }
    </section>`;
}

function peopleCard() {
  const tr = state.trip;
  const items = tr.participants
    .map(
      (p) => `
      <li>
        <div class="avatar ${p.role}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div class="person-main">
          <div><span dir="auto">${esc(p.name)}</span>${p.id === state.me ? ` <span class="muted small">${t('you')}</span>` : ''}${
            p.role === 'driver' ? ` <span class="muted small">· ${t('seats', p.seats || 4)}</span>` : ''
          }</div>
          <div class="where" dir="auto">${p.place ? esc(p.place.label) : t('noLocYet')}</div>
        </div>
        <span class="badge ${p.place ? 'ok' : 'warn'}">${p.role === 'driver' ? '🚗 ' : '🚌 '}${p.place ? t('ready') : t('waiting')}</span>
        ${p.id !== state.me ? `<button class="btn danger-text" data-remove="${esc(p.id)}" aria-label="${esc(t('removeAria', p.name))}">✕</button>` : ''}
      </li>`,
    )
    .join('');
  return `
    <section class="card">
      <div class="row"><h2 class="grow" style="margin:0">${t('whosComing')}</h2>
        <button class="btn ghost small" id="inviteBtn">${t('invite')}</button></div>
      <ul class="people">${items}</ul>
    </section>`;
}

function settingsCard() {
  const tr = state.trip;
  const d = tr.destination || { type: 'driverStart' };
  const pr = tr.priority || 'balanced';
  return `
    <details class="card" id="settings" ${storage.get('pp:settingsOpen', false) ? 'open' : ''}>
      <summary>${t('settings')} <span class="small muted" style="margin-inline-start:auto;margin-inline-end:8px" dir="auto">${esc(settingsSummary())}</span></summary>
      <label for="arriveBy">${t('beThereBy')}</label>
      <div class="row">
        <input id="arriveBy" class="grow" type="datetime-local" value="${toLocalInput(tr.arriveBy)}" min="${toLocalInput(new Date().toISOString())}">
        <button class="btn ghost small" id="asapBtn">${t('asap')}</button>
      </div>
      ${tr.arriveBy ? '' : `<p class="small muted" style="margin:6px 0 0">${t('noTimeSet')}</p>`}
      <label for="destInput">${t('goingTo')}</label>
      <p class="small chosen" dir="auto">${d.type === 'custom' && d.place ? '🏁 ' + esc(d.place.label) : d.type === 'none' ? t('nowhere') : t('backToStart')}</p>
      ${pickerHtml('dest', t('changeDest'))}
      <label for="stopInput">${t('stopsOnWay')}</label>
      <ol class="stop-list" id="tripStops">${stopItems(tr.stops || [])}</ol>
      ${(tr.stops || []).length < MAX_STOPS ? pickerHtml('stop', t('addStop')) : ''}
      <label id="prLabel">${t('priority')}</label>
      <div class="seg" role="group" aria-labelledby="prLabel" id="prSeg">
        <button type="button" data-pr="fastest" aria-pressed="${pr === 'fastest'}">${t('prFastest')}</button>
        <button type="button" data-pr="balanced" aria-pressed="${pr === 'balanced'}">${t('prBalanced')}</button>
        <button type="button" data-pr="lessDriving" aria-pressed="${pr === 'lessDriving'}">${t('prLessDriving')}</button>
      </div>
    </details>`;
}

function settingsSummary() {
  const tr = state.trip;
  const when = tr.arriveBy ? t('sumBy', fmtWhen(tr.arriveBy)) : t('asap');
  const d = tr.destination || {};
  const dest = d.type === 'custom' && d.place ? `🏁 ${d.place.label.split(',')[0]}` : d.type === 'none' ? t('sumPickupOnly') : t('sumBack');
  const n = (tr.stops || []).length;
  return `${when} · ${dest}${n ? ` · ${t('sumStops', n)}` : ''}`;
}

// ---------- results ----------

const planDrivers = (plan) => plan.drivers || [plan.driver]; // older plans had a single driver
const stopName = (s) => (s.home ? t('homeOf', s.riders[0]) : s.name);

function resultsHtml(plan) {
  const me = state.me;
  const drivers = planDrivers(plan);
  const people = [
    ...drivers.map((d) => ({ id: d.participantId, name: d.name, role: 'driver' })),
    ...plan.riders.map((r) => ({ id: r.participantId, name: r.name, role: 'rider' })),
  ];
  const cars = drivers.filter((d) => d.stops.length);
  if (!state.tab || !people.some((p) => p.id === state.tab)) state.tab = people.some((p) => p.id === me) ? me : people[0].id;
  const sel = people.find((p) => p.id === state.tab);
  const s = plan.summary;
  return `
    ${plan.stale ? `<div class="banner warn">${t('stale')}</div>` : ''}
    ${plan.notes.map((n) => `<div class="banner warn">${esc(noteText(n))}</div>`).join('')}
    <div class="summary">
      <div><b>${fmtTime(s.driverLeaveAt)}</b><span>${cars.length > 1 ? t('firstCarLeaves') : t('driverLeaves')}</span></div>
      <div><b>${fmtTime(s.lastPickupAt)}</b><span>${cars.length > 1 ? t('everyonePicked') : t('everyoneInCar')}</span></div>
      <div><b>${fmtTime(s.finalArrival)}</b><span>${
        drivers.some((d) => d.destination) ? (plan.arriveBy ? t('atDestGoal', fmtTime(plan.arriveBy)) : t('atDest')) : t('done')
      }</span></div>
    </div>
    ${
      drivers.length > 1
        ? `<section class="card cars"><h2>${t('whichCar')}</h2>${drivers
            .map(
              (d) => `<div class="car-row"><b dir="auto">🚗 ${esc(d.name)}</b><span dir="auto">${
                d.stops.length ? esc(t('list', d.stops.flatMap((x) => x.riders))) : `<span class="muted">${t('noPickupsStraight')}</span>`
              }</span></div>`,
            )
            .join('')}</section>`
        : ''
    }
    <div class="tabs" role="tablist">
      ${people
        .map(
          (p) =>
            `<button role="tab" data-tab="${esc(p.id)}" aria-selected="${p.id === sel.id}">${p.role === 'driver' ? '🚗' : '🚌'} <span dir="auto">${esc(p.name)}</span>${p.id === me ? ` ${t('you')}` : ''}</button>`,
        )
        .join('')}
    </div>
    <section class="card">
      ${sel.role === 'driver' ? driverView(drivers.find((d) => d.participantId === sel.id), plan) : riderView(plan.riders.find((r) => r.participantId === sel.id), plan)}
      <div id="map" dir="ltr" role="img" aria-label="${esc(t('mapAria'))}"></div>
    </section>
    ${alternativesHtml(plan)}
    <p class="small muted" style="text-align:center">${t('plannedAt', fmtTime(plan.computedAt))}</p>`;
}

const wazeBtn = (url) => `<div class="actions"><a class="btn waze small" href="${esc(url)}" target="_blank" rel="noopener">${t('navWaze')}</a></div>`;

function driverView(d, plan) {
  const stops = d.stops
    .map(
      (s, i) => `
      <li>
        <span class="dot">${i + 1}</span>
        <div><span class="t">${fmtTime(s.eta)}</span> <b dir="auto">${esc(stopName(s))}</b>${s.stopCode ? ` <span class="small muted">${t('stopNo', esc(s.stopCode))}</span>` : ''}</div>
        <div class="detail">${esc(t('pickUp', t('list', s.riders)))}${minutesBetween(s.eta, s.pickupAt) > 3 ? t('readyBy', fmtTime(s.pickupAt)) : ''}</div>
        ${wazeBtn(s.wazeUrl)}
      </li>`,
    )
    .join('');
  const waypoints = (d.waypoints || [])
    .map(
      (w) => `<li><span class="dot">📍</span>
        <div><span class="t">${fmtTime(w.eta)}</span> ${t('stopAt', `<b dir="auto">${esc(w.label)}</b>`)}</div>
        ${w.leaveAt ? `<div class="detail">${t('aboutTen', fmtTime(w.leaveAt))}</div>` : ''}
        ${wazeBtn(w.wazeUrl)}</li>`,
    )
    .join('');
  const dest = d.destination
    ? `<li><span class="dot">🏁</span>
         <div><span class="t">${fmtTime(d.destination.eta)}</span> <b dir="auto">${esc(d.destination.label || t('destination'))}</b></div>
         ${wazeBtn(d.destination.wazeUrl)}</li>`
    : '';
  const driveMin = d.driveMinutes ?? plan.summary.driveMinutes;
  return `
    ${
      d.stops.length
        ? `<div class="leave"><span>${t('leaveAt')}</span><span class="count">${relative(d.leaveAt)}</span></div>
           <div class="leave"><span class="when">${fmtTime(d.leaveAt)}</span>
             <span class="count">${t('driving', driveMin)}${d.route ? ` · ${t('km', d.route.km)}` : ''}</span></div>`
        : `<p>🙌 <b>${t('noOne')}</b> ${t('othersCloser', planDrivers(plan).filter((x) => x.stops.length).length > 1)} ${
            d.destination || waypoints ? t('ifLeaveNow') : ''
          }</p>`
    }
    <ol class="timeline">
      <li><span class="dot">🚗</span><div><span class="t">${fmtTime(d.leaveAt)}</span> ${t('leaveFrom', `<span dir="auto">${esc(d.origin.label || t('yourLocationLower'))}</span>`)}</div></li>
      ${stops}${waypoints}${dest}
    </ol>
    ${d.googleMapsUrl ? `<a class="btn ghost block" href="${esc(d.googleMapsUrl)}" target="_blank" rel="noopener">${t('wholeRoute')}</a>` : ''}
    <p class="small muted">${t('wazeNote')}${waypoints ? t('eachStop10') : ''}</p>`;
}

/** Opens the Moovit app on the route home → pickup stop (Moovit's documented deep link). */
const moovitAppUrl = (r) =>
  `moovit://directions?${new URLSearchParams({
    orig_lat: r.origin.lat,
    orig_lon: r.origin.lon,
    orig_name: r.origin.label || '',
    dest_lat: r.pickup.lat,
    dest_lon: r.pickup.lon,
    dest_name: r.pickup.name,
    auto_run: 'true',
    partner_id: 'PickupPlanner',
  })}`;

const modeKey = (mode) => (/RAIL|SUBURBAN|LONG_DISTANCE/.test(mode || '') ? 'RAIL' : mode);
const modeName = (mode) => (hasT(`mode.${modeKey(mode)}`) ? t(`mode.${modeKey(mode)}`) : t('mode.other'));
const modeIcon = (mode) => ({ RAIL: '🚆', TRAM: '🚊', SUBWAY: '🚇', FERRY: '⛴️' })[modeKey(mode)] || '🚌';

function riderView(r, plan) {
  if (!r) return `<p>${t('noInstr')}</p>`;
  const p = r.pickup;
  const driverName = esc(r.driverName || plan.driver.name);
  if (r.mode === 'home') {
    return `
      <div class="leave"><span>${t('driverArrives')}</span><span class="count">${relative(p.driverEta)}</span></div>
      <div class="leave"><span class="when">${fmtTime(p.driverEta)}</span></div>
      <p>${t('stayHome', `<span dir="auto">${driverName}</span>`, `<span dir="auto">${esc(p.name)}</span>`)}</p>`;
  }
  const rides = r.steps.filter((s) => s.type === 'ride');
  const stop = (name, c) => `<b dir="auto">${esc(name)}</b>${c ? ` <span class="muted">#${esc(c)}</span>` : ''}`;
  const rideName = (s) =>
    `${modeName(s.mode)} ${s.line ? `<span class="line-no">${esc(s.line)}</span>` : s.routeName ? `<span dir="auto">${esc(s.routeName)}</span>` : ''}${
      s.headsign ? ` <span class="muted">${t('toward', `<span dir="auto">${esc(s.headsign)}</span>`)}</span>` : ''
    }`;
  const items = rides
    .map(
      (s, i) => `
      <li><span class="dot">${i === 0 ? '🚏' : '🔁'}</span>
        <div>${i === 0 ? t('goToStop', stop(s.from, s.fromCode)) : t('changeAt', stop(s.from, s.fromCode))}</div></li>
      <li class="ride"><span class="dot">${modeIcon(s.mode)}</span>
        <div>${t('take', rideName(s), fmtTime(s.departAt))}</div></li>
      <li><span class="dot">🛑</span>
        <div class="${i === rides.length - 1 ? 'getoff' : ''}">${t('getOff', stop(s.to, s.toCode), fmtTime(s.arriveAt))}</div></li>`,
    )
    .join('');
  return `
    <div class="leave"><span>${t('leaveHome')}</span><span class="count">${relative(r.leaveAt)}</span></div>
    <div class="leave"><span class="when">${fmtTime(r.leaveAt)}</span></div>
    <ol class="timeline">
      ${items}
      <li><span class="dot">🚗</span><div>${t('picksUp', `<span dir="auto">${driverName}</span>`, fmtTime(p.meetAt))}</div>
        ${r.waitMinutes >= 5 ? `<div class="detail">${t('wait', r.waitMinutes)}</div>` : ''}</li>
    </ol>
    <div class="row">
      ${r.mapsUrl ? `<a class="btn ghost grow" href="${esc(r.mapsUrl)}" target="_blank" rel="noopener">Google Maps</a>` : ''}
      ${r.moovitUrl ? `<a class="btn ghost grow" href="${esc(r.moovitUrl)}" data-app-url="${esc(moovitAppUrl(r))}" target="_blank" rel="noopener">Moovit</a>` : ''}
    </div>
    <p class="small muted">${t('busesLate')}</p>`;
}

function alternativesHtml(plan) {
  if (!plan.alternatives.length) return '';
  const several = planDrivers(plan).length > 1;
  const rows = plan.alternatives
    .map((a) => {
      const diff = a.extraMinutes === 0 ? t('sameTime') : a.extraMinutes > 0 ? t('later', a.extraMinutes) : t('earlier', -a.extraMinutes);
      const driveDiff = a.driveMinutes - plan.summary.driveMinutes;
      const place = (p) => (p.home ? t('homeOf', p.rider) : p.place);
      return `<div class="alt"><div dir="auto">${a.pickups
        .map((p) => `${esc(p.rider)}: ${esc(place(p))}${several && p.driver ? ` <span class="muted">(${esc(p.driver)})</span>` : ''}`)
        .join('<br>')}</div>
        <div class="muted" style="text-align:end;white-space:nowrap">${diff}<br>${driveDiff === 0 ? t('sameDriving') : t('drivingDiff', driveDiff)}</div></div>`;
    })
    .join('');
  return `<details class="card"><summary>${t('otherOptions')}</summary><div style="margin-top:8px">${rows}</div>
    <p class="small muted">${t('altNote')}</p></details>`;
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
  const carColors = ['#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9'];
  for (const r of plan.riders) {
    for (const g of r.geometry) {
      add(L.polyline(g.coords, { color: brand, weight: g.mode === 'walk' ? 3 : 5, dashArray: g.mode === 'walk' ? '4 8' : null, opacity: 0.9 }), g.coords);
    }
    add(L.circleMarker([r.origin.lat, r.origin.lon], { radius: 6, color: brand, fillOpacity: 1 }).bindTooltip(esc(r.name)), [[r.origin.lat, r.origin.lon]]);
  }
  planDrivers(plan).forEach((d, i) => {
    const color = carColors[i % carColors.length];
    if (d.route) add(L.polyline(d.route.coordinates, { color, weight: 5, opacity: 0.85 }), d.route.coordinates);
    add(L.circleMarker([d.origin.lat, d.origin.lon], { radius: 7, color, fillOpacity: 1 }).bindTooltip(esc(t('driverTip', d.name))), [[d.origin.lat, d.origin.lon]]);
    d.stops.forEach((s, j) =>
      add(
        L.marker([s.lat, s.lon]).bindPopup(`<b>${j + 1}. ${esc(stopName(s))}</b><br>${fmtTime(s.eta)} · ${esc(t('popupPicks', d.name, t('list', s.riders)))}`),
        [[s.lat, s.lon]],
      ),
    );
  });
  const first = planDrivers(plan)[0];
  for (const w of first.waypoints || []) {
    add(L.circleMarker([w.lat, w.lon], { radius: 7, color: '#334155', fillOpacity: 1 }).bindTooltip(esc(t('stopTip', w.label))), [[w.lat, w.lon]]);
  }
  if (first.destination) {
    const p = first.destination;
    add(L.circleMarker([p.lat, p.lon], { radius: 8, color: '#111827', fillOpacity: 1 }).bindTooltip(`🏁 ${esc(p.label || t('destination'))}`), [[p.lat, p.lon]]);
  }
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
      toast(t('locSaved'));
    } catch (err) {
      toast(err.message);
    }
  };
  q('gpsBtn')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> ${t('findingYou')}`;
    try {
      const pos = await getGps();
      const { label } = await api('GET', `/api/reverse?lat=${pos.lat}&lon=${pos.lon}`);
      await setMyPlace({ ...pos, label });
    } catch (err) {
      const help = q('gpsHelp');
      if (err.denied && help) {
        help.innerHTML = `<strong>${t('locBlockedTitle')}</strong> ${esc(locationHelp())}<br>${t('orSearch')}`;
        help.hidden = false;
      } else {
        toast(err.message, 4000);
      }
      b.disabled = false;
      b.textContent = t('useGps');
    }
  });
  bindSearch(q('searchForm'), q('searchInput'), q('searchResults'), setMyPlace);

  // people
  q('inviteBtn')?.addEventListener('click', () => $share.click());
  $app.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = trip.participants.find((x) => x.id === b.dataset.remove);
      if (!p || !confirm(t('confirmRemove', p.name))) return;
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
  q('arriveBy')?.addEventListener('change', (e) => patch({ arriveBy: fromLocalInput(e.target.value) }));
  q('asapBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    patch({ arriveBy: null, departAfter: null });
  });
  bindSearch(q('destForm'), q('destInput'), q('destResults'), (place) => patch({ destination: { type: 'custom', place } }));
  bindSearch(q('stopForm'), q('stopInput'), q('stopResults'), (place) => patch({ stops: [...(trip.stops || []), place] }));
  q('tripStops')?.querySelectorAll('[data-stop-remove]').forEach((b) =>
    b.addEventListener('click', () => patch({ stops: (trip.stops || []).filter((_, i) => i !== Number(b.dataset.stopRemove)) })),
  );
  q('seatSeg')?.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      state.trip = (await api('PATCH', `/api/trips/${trip.id}/participants/${state.me}`, { seats: Number(b.dataset.seats) })).trip;
      renderTrip();
    } catch (err) {
      toast(err.message);
    }
  });
  // app links: try the installed app, fall back to the website if nothing opened
  $app.querySelectorAll('[data-app-url]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const fallback = setTimeout(() => {
        if (!document.hidden) window.open(a.href, '_blank', 'noopener');
      }, 1500);
      document.addEventListener('visibilitychange', () => document.hidden && clearTimeout(fallback), { once: true });
      location.href = a.dataset.appUrl;
    }),
  );
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
    list.innerHTML = `<li><button disabled><span class="spinner"></span> ${t('searching')}</button></li>`;
    try {
      const { results } = await api('GET', `/api/geocode?q=${encodeURIComponent(text)}`);
      if (!results.length) {
        list.innerHTML = `<li><button disabled>${t('nothingFound')}</button></li>`;
        return;
      }
      list.innerHTML = results
        .map(
          (r, i) =>
            `<li><button type="button" data-i="${i}"><span class="kind">${t(`kind.${r.type}`)}</span><span dir="auto">${esc(r.label)}</span></button></li>`,
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
      <h1>${t('permTitle')}</h1>
      <p>${t('permText')}</p>
      <button id="permAllow" class="btn block big">${t('permAllow')}</button>
      <button id="permSkip" class="btn ghost block" style="margin-top:10px">${t('permSkip')}</button>
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
      toast(t('permAllowed'));
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
renderChrome();
askPermissionsFirst(route);
