// Calendar invite (.ics) for one person's part of a plan, with a reminder 10 minutes
// before they need to leave. Works on any phone: iPhone Safari offers "Add to Calendar".

const TEXT = {
  he: {
    riderTitle: '🚌 יציאה לאיסוף',
    homeTitle: (driver) => `🚗 ${driver} אוסף/ת אתכם`,
    driverTitle: '🚗 יציאה לאיסוף',
    goTo: (stop) => `הולכים לתחנה ${stop}`,
    take: (mode, line, time) => `עולים על ${mode} ${line} ב-${time}`,
    getOff: (stop, time) => `יורדים בתחנה ${stop} (${time})`,
    pickedUp: (driver, time) => `${driver} אוסף/ת אתכם ב-${time}`,
    beReady: (place) => `להיות מוכנים ב${place}`,
    pickup: (names, place, time) => `${time} איסוף ${names}: ${place}`,
    stop: (label, time) => `${time} עצירה: ${label}`,
    arrive: (label, time) => `${time} הגעה: ${label}`,
    alarm: 'עוד 10 דקות צריך לצאת',
    homeAlarm: 'האיסוף בעוד 10 דקות',
    homeOf: (name) => `המיקום של ${name}`,
    bus: 'אוטובוס',
    train: 'רכבת',
  },
  en: {
    riderTitle: '🚌 Leave for your pickup',
    homeTitle: (driver) => `🚗 ${driver} picks you up`,
    driverTitle: '🚗 Leave for the pickups',
    goTo: (stop) => `Go to the stop ${stop}`,
    take: (mode, line, time) => `Take ${mode} ${line} at ${time}`,
    getOff: (stop, time) => `Get off at ${stop} (${time})`,
    pickedUp: (driver, time) => `${driver} picks you up at ${time}`,
    beReady: (place) => `Be ready at ${place}`,
    pickup: (names, place, time) => `${time} pick up ${names}: ${place}`,
    stop: (label, time) => `${time} stop: ${label}`,
    arrive: (label, time) => `${time} arrive: ${label}`,
    alarm: 'Time to leave in 10 minutes',
    homeAlarm: 'Your pickup is in 10 minutes',
    homeOf: (name) => `${name}'s location`,
    bus: 'bus',
    train: 'train',
  },
};

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const hhmm = (iso) => clock.format(new Date(iso));
const icsTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** Lines longer than 75 bytes are folded (UTF-8 aware, so Hebrew isn't cut mid-letter). */
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * @returns {{ics: string, filename: string} | null} null when this person has nothing to do in the plan
 */
function buildIcs(trip, pid, lang, origin) {
  const L = TEXT[lang] || TEXT.he;
  const plan = trip.plan;
  if (!plan) return null;
  const drivers = plan.drivers || [plan.driver];
  const link = `${origin}/t/${trip.id}`;
  let ev = null;

  const rider = plan.riders.find((r) => r.participantId === pid);
  const driver = drivers.find((d) => d.participantId === pid);
  if (rider?.mode === 'transit') {
    const rides = rider.steps.filter((s) => s.type === 'ride');
    const lines = rides.flatMap((s, i) => [
      ...(i === 0 ? [L.goTo(s.from)] : []),
      L.take(/RAIL/.test(s.mode || '') ? L.train : L.bus, s.line || s.routeName || '', hhmm(s.departAt)),
      L.getOff(s.to, hhmm(s.arriveAt)),
    ]);
    lines.push(L.pickedUp(rider.driverName, hhmm(rider.pickup.meetAt)));
    ev = { start: rider.leaveAt, end: rider.pickup.meetAt, title: L.riderTitle, location: rides[0]?.from, lines, alarm: L.alarm };
  } else if (rider?.mode === 'home') {
    ev = {
      start: new Date(Date.parse(rider.pickup.driverEta) - 10 * 60e3).toISOString(),
      end: rider.pickup.driverEta,
      title: L.homeTitle(rider.driverName),
      location: rider.pickup.name,
      lines: [L.beReady(rider.pickup.name), L.pickedUp(rider.driverName, hhmm(rider.pickup.driverEta))],
      alarm: L.homeAlarm,
    };
  } else if (driver && (driver.stops.length || driver.destination)) {
    const lines = [
      ...driver.stops.map((s) => L.pickup(s.riders.join(', '), s.home ? L.homeOf(s.riders[0]) : s.name, hhmm(s.eta))),
      ...(driver.waypoints || []).map((w) => L.stop(w.label, hhmm(w.eta))),
      ...(driver.destination ? [L.arrive(driver.destination.label, hhmm(driver.destination.eta))] : []),
    ];
    const end = driver.destination?.eta || driver.lastPickupAt || driver.leaveAt;
    ev = { start: driver.leaveAt, end, title: L.driverTitle, location: driver.origin.label, lines, alarm: L.alarm };
  }
  if (!ev) return null;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pickup Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${trip.id}-${pid}@pickup-planner`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(ev.start)}`,
    `DTEND:${icsTime(Date.parse(ev.end) > Date.parse(ev.start) ? ev.end : new Date(Date.parse(ev.start) + 15 * 60e3).toISOString())}`,
    `SUMMARY:${escapeText(ev.title)}`,
    `DESCRIPTION:${escapeText([...ev.lines, '', link].join('\n'))}`,
    ...(ev.location ? [`LOCATION:${escapeText(ev.location)}`] : []),
    `URL:${link}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(ev.alarm)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n');
  return { ics: `${ics}\r\n`, filename: 'pickup.ics' };
}

module.exports = { buildIcs };
