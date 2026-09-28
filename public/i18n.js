/* Pickup Planner — translations. Hebrew is the default; the top-bar button switches to English.
 * Values are strings or functions of params. Functions that receive HTML get it pre-escaped. */
'use strict';

const LANGS = ['he', 'en'];

const list = (names, and) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} ${and}${names.at(-1)}` : names[0] || '';

const STRINGS = {
  en: {
    langSwitch: 'עברית',
    langSwitchAria: 'החלפה לעברית',
    appName: 'Pickup Planner',
    list: (names) => list(names, 'and '),

    // general
    search: 'Search',
    searching: 'Searching…',
    nothingFound: 'Nothing found. Try adding the city name.',
    kind: { stop: '🚏 stop', address: '🏠 address', place: '📍 place' },
    removeStop: (n) => `Remove stop ${n}`,
    requestFailed: (s) => `Request failed (${s})`,
    now: 'now',
    minAgo: (m) => `${m} min ago`,
    inMin: (m) => `in ${m} min`,
    inHours: (h, m) => `in ${h} h ${m} min`,

    // location
    noGps: 'This device has no GPS access',
    locBlocked: 'Location is blocked on this phone',
    locFailed: 'Could not get your location',
    help: {
      inApp: 'This in-app browser blocks location. Open the link in Safari or Chrome (⋯ menu → Open in browser).',
      iosApp: 'iPhone Settings → Pickup Planner → Location → While Using the App.',
      iosWeb:
        'iPhone Settings → Privacy & Security → Location Services → Safari Websites → While Using the App. ' +
        'Then in Safari tap aA → Website Settings → Location → Allow, and try again.',
      androidApp: 'Android Settings → Apps → Pickup Planner → Permissions → Location → Allow.',
      androidWeb: 'Tap the icon left of the web address → Permissions → Location → Allow. Also check that Location is on in Android Settings.',
      macChrome:
        'Click the icon left of the web address → Location → Allow. Also check System Settings → Privacy & Security → Location Services → Google Chrome.',
      macSafari:
        'Safari → Settings → Websites → Location → set this site to Allow. Also check System Settings → Privacy & Security → Location Services → Safari.',
      other: "Allow location for this site in your browser's settings, then try again.",
    },

    // home
    heroTitle: 'Pick up your friends at the right bus stop',
    heroText:
      "Everyone adds their location. The app finds the stop where they should get off the bus or train so you all meet as early as possible, on the way to where you're going. Riders get bus directions, and each driver gets Waze links. Works anywhere in Israel.",
    yourName: 'Your name',
    iAm: 'I am…',
    roleDriver: '🚗 A driver',
    roleRider: '🚌 Getting picked up',
    whereGoing: 'Where are you all going?',
    destPlaceholder: 'Final destination: address or place',
    changeDest: 'Change destination',
    whenThere: 'What time do you need to be there?',
    stopsOnWay: 'Stops on the way',
    optional: '(optional)',
    addStop: 'Add a stop, e.g. a gas station',
    start: 'Start a pickup plan',
    howTitle: 'How it works',
    how1: "Start a plan with where you're going and when you need to be there, then send the link to your friends (WhatsApp works well).",
    how2: 'Each person opens the link and taps <i>Use my current location</i>. There can be more than one driver.',
    how3: 'Tap <i>Find the best pickup</i>. Everyone sees which car takes them, what time to leave and where to go.',
    enterName: 'Enter your name',
    chooseDest: 'Choose where you are all going',
    timePassed: 'That time has already passed',
    chooseTime: 'Choose what time you need to be there',

    // trip
    loading: 'Loading…',
    startNew: 'Start a new plan',
    shareBtn: 'Share link',
    shareText: (url) => `Join my pickup plan and add your location:\n${url}`,
    linkCopied: 'Link copied',
    planning: 'Checking buses and roads…',
    recalc: '🔄 Recalculate',
    findBest: '✨ Find the best pickup',
    blockNoDriver: 'Waiting for a driver to join.',
    blockNoRiders: 'Share the link so the people you’re picking up can join.',
    blockMissing: (names) => `Waiting for location from: ${names}`,
    joinTitle: 'Join this pickup',
    joinBtn: 'Join',
    yourLocation: 'Your location',
    badgeDriver: 'Driver',
    badgeRider: 'Rider',
    whereFrom: 'Where are you starting from?',
    useGps: '📍 Use my current location',
    findingYou: 'Finding you…',
    searchPlaceholder: '…or search an address, city or stop',
    searchAria: 'Search for a place',
    freeSeats: 'Free seats in your car',
    locBlockedTitle: 'Location is blocked.',
    orSearch: 'Or search for your address below.',
    locSaved: 'Location saved',
    you: '(you)',
    seats: (n) => (n === 1 ? '1 seat' : `${n} seats`),
    noLocYet: 'No location yet',
    ready: 'Ready',
    waiting: 'Waiting',
    removeAria: (name) => `Remove ${name}`,
    confirmRemove: (name) => `Remove ${name} from this trip?`,
    whosComing: 'Who’s coming',
    invite: '+ Invite',
    settings: 'Trip settings',
    beThereBy: 'Be at the destination by',
    asap: 'ASAP',
    noTimeSet: 'No time set: everyone leaves now and arrives as early as possible.',
    goingTo: 'Going to',
    nowhere: 'Nowhere set: just the pickups',
    backToStart: 'Back to the driver’s start',
    priority: 'What matters most?',
    prFastest: 'Fastest',
    prBalanced: 'Balanced',
    prLessDriving: 'Less driving',
    sumBy: (when) => `by ${when}`,
    sumPickupOnly: 'pickup only',
    sumBack: '↩ back',
    sumStops: (n) => (n === 1 ? '1 stop' : `${n} stops`),

    // reminders
    remindMe: '🔔 Remind me when to leave',
    remSet: (times) => `Reminders set for ${times}`,
    remNone: 'Reminders are on. Nothing left to remind you about.',
    remOff: 'Turn off',
    remDenied: 'Notifications are off for Pickup Planner. Turn them on in iPhone Settings → Notifications → Pickup Planner.',
    remUpdated: 'The plan changed, so your reminders were updated.',
    remLeaveSoon: 'Leave in 10 minutes',
    remLeaveNow: 'Time to leave',
    remBus: (mode, line, stop, time) => `${mode} ${line} from ${stop} at ${time}`,
    remDriverSoon: (name) => `${name} arrives in 10 minutes`,
    remBeReady: 'Be ready outside.',
    remFirstPickup: (names, time) => `First pickup: ${names} at ${time}`,
    remDriveTo: (dest, time) => `Drive to ${dest}, arrive ${time}`,
    addCalendar: '📅 Add to calendar (alert 10 min before)',

    // organizer & confirming
    organizer: 'organizer',
    onlyOrganizer: (name) => `Only ${name} (the organizer) can change these.`,
    confirmPlan: '✅ Confirm this plan',
    confirmHint: 'Once confirmed, nobody can recalculate until you unlock it.',
    waitingConfirm: (name) => `Waiting for ${name} to confirm the plan.`,
    confirmedBy: (name, time) => `Plan confirmed by ${name} at ${time}`,
    changedAfterLock: (name) => `Something changed after the plan was confirmed. ${name} can update it.`,
    changedAfterLockOrg: 'Something changed after you confirmed. Unlock and recalculate if needed.',
    unlock: '🔓 Unlock to change the plan',
    unlockConfirm: 'Unlock the plan? Anyone will be able to recalculate it again.',
    planChanged: 'The plan changed since you last looked. Check your times again.',

    // results
    stale: 'Something changed since this plan was made. Tap <b>Recalculate</b>.',
    firstCarLeaves: 'First car leaves',
    driverLeaves: 'Driver leaves',
    everyonePicked: 'Everyone picked up',
    everyoneInCar: 'Everyone in the car',
    atDest: 'At destination',
    atDestGoal: (t) => `At destination (goal ${t})`,
    done: 'Done',
    whichCar: 'Who goes in which car',
    noPickupsStraight: 'No pickups, drive straight there',
    mapAria: 'Map of the routes',
    plannedAt: (t) =>
      `Planned ${t} using Israel Ministry of Transport timetables. Buses can run late, so check live times in Moovit or Google Maps before you go.`,
    homeOf: (name) => `${name}'s location`,

    // driver view
    stopNo: (code) => `stop #${code}`,
    pickUp: (names) => `Pick up ${names}`,
    readyBy: (t) => `, ready by ${t}`,
    navWaze: 'Navigate with Waze',
    stopAt: (name) => `Stop at ${name}`,
    aboutTen: (t) => `About 10 min, leave by ${t}`,
    destination: 'Destination',
    leaveAt: 'Leave at',
    driving: (min) => `${min} min driving`,
    km: (km) => `${km} km`,
    noOne: 'No one to pick up.',
    othersCloser: (several) => (several ? 'The other cars are closer to everyone.' : 'The other car is closer to everyone.'),
    ifLeaveNow: 'Times below are if you leave now.',
    leaveFrom: (place) => `Leave from ${place}`,
    yourLocationLower: 'your location',
    wholeRoute: 'Whole route in Google Maps',
    wazeNote:
      'Waze opens one stop at a time. After each stop, come back here and tap the next one. Drive times include a 20% traffic allowance, but check Waze for live traffic before you leave.',
    eachStop10: ' Each stop on the way allows about 10 minutes.',

    // rider view
    noInstr: 'No instructions.',
    driverArrives: 'Driver arrives',
    stayHome: (driver, place) => `🏠 Stay where you are. <b>${driver}</b> will pick you up at ${place}.`,
    leaveHome: 'Leave home at',
    goToStop: (stop) => `Go to the stop ${stop}`,
    changeAt: (stop) => `Change at ${stop}`,
    take: (ride, time) => `Take ${ride} <span class="t">at ${time}</span>`,
    toward: (h) => `to ${h}`,
    getOff: (stop, time) => `Get off at ${stop} <span class="t">${time}</span>`,
    picksUp: (driver, t) => `<b>${driver}</b> picks you up there at <b>${t}</b>`,
    wait: (m) => `You’ll wait about ${m} min.`,
    busesLate: 'Buses can run late. Check live times in Google Maps or Moovit before you leave.',
    mode: {
      BUS: 'Bus',
      COACH: 'Bus',
      TRAM: 'Light rail',
      SUBWAY: 'Metro',
      RAIL: 'Train',
      FERRY: 'Ferry',
      CABLE_CAR: 'Cable car',
      FUNICULAR: 'Funicular',
      other: 'Transit',
    },

    // alternatives
    otherOptions: 'Other options',
    sameTime: 'same time',
    later: (m) => `${m} min later`,
    earlier: (m) => `${m} min earlier`,
    sameDriving: 'same driving',
    drivingDiff: (d) => `${d > 0 ? '+' : ''}${d} min driving`,
    altNote: 'Change <i>What matters most?</i> in the trip settings to weigh total time against driving.',

    // map
    driverTip: (name) => `${name} (driver)`,
    popupPicks: (driver, names) => `${driver} picks up ${names}`,
    stopTip: (label) => `Stop: ${label}`,

    // first-open permission screen
    permTitle: 'Allow your location',
    permText: "So you don't have to type your address. Only the people in your trip see it.",
    permAllow: '📍 Allow location',
    permSkip: 'Not now',
    permAllowed: 'Location allowed ✓',

    // server errors (by code)
    err: {
      notFound: 'Trip not found (links expire after 3 days)',
      notInIsrael: 'Location must be in Israel',
      badTime: 'That time is not valid',
      tooManyStops: ({ n }) => `At most ${n} stops on the way`,
      tooManyDrivers: ({ n }) => `This trip already has ${n} drivers`,
      tooManyRiders: ({ n }) => `This trip already has ${n} people to pick up`,
      participantNotFound: 'Participant not found',
      needDriver: 'Someone needs to join as a driver.',
      needRider: 'Add at least one person to pick up.',
      waitingFor: ({ names }, t) => `Waiting for location from: ${t('list', names)}`,
      notEnoughSeats: ({ riders, seats }) =>
        `Not enough seats: ${riders} people need a ride but the cars have ${seats} free seat${seats === 1 ? '' : 's'}. Drivers can change their seats under Your location.`,
      timePassed: 'The arrival time has already passed. Choose a later time in Trip settings.',
      noPlan: 'Could not find a drivable plan. Check that everyone is in a reachable place.',
      organizerOnly: 'Only the organizer can do this.',
      organizerStays: 'The organizer can’t be removed.',
      planLocked: 'The plan is confirmed. The organizer can unlock it to recalculate.',
      planStale: 'Recalculate before confirming.',
      noCalendar: 'Nothing to add to the calendar yet.',
    },
    // plan notes (by code)
    note: {
      noTransit: ({ name }) => `No public transit found for ${name} at this time, so a driver will pick them up at their location.`,
      slowBus: ({ names }, t) =>
        `Bus times for ${t('list', names)} were slow to load, so some bus options may be missing. Tap Recalculate to try again.`,
      cantMakeIt: ({ target, earliest }, t, time) =>
        `You can't all get there by ${time(target)}. The earliest everyone can arrive is about ${time(earliest)}. Change the arrival time in Trip settings, or go with this plan.`,
      routeFailed: ({ name }) => `Could not draw ${name}'s driving route.`,
      restDay: ({ kind, names }, t) =>
        `${kind === 'shabbat' ? "It's Shabbat" : "It's a holiday"}, so almost no buses are running. ${t('list', names)} will be picked up at home.`,
    },
  },

  he: {
    langSwitch: 'English',
    langSwitchAria: 'Switch to English',
    appName: 'Pickup Planner',
    list: (names) => list(names, 'ו'),

    search: 'חיפוש',
    searching: 'מחפשים…',
    nothingFound: 'לא נמצא. נסו להוסיף את שם העיר.',
    kind: { stop: '🚏 תחנה', address: '🏠 כתובת', place: '📍 מקום' },
    removeStop: (n) => `הסרת עצירה ${n}`,
    requestFailed: (s) => `הבקשה נכשלה (${s})`,
    now: 'עכשיו',
    minAgo: (m) => `לפני ${m} דק׳`,
    inMin: (m) => `בעוד ${m} דק׳`,
    inHours: (h, m) => `בעוד ${h} ש׳ ${m} דק׳`,

    noGps: 'אין גישה למיקום במכשיר הזה',
    locBlocked: 'הגישה למיקום חסומה בטלפון הזה',
    locFailed: 'לא הצלחנו למצוא את המיקום שלכם',
    help: {
      inApp: 'הדפדפן שבתוך האפליקציה חוסם מיקום. פתחו את הקישור ב-Safari או ב-Chrome (תפריט ⋯ ← פתיחה בדפדפן).',
      iosApp: 'הגדרות האייפון ← Pickup Planner ← מיקום ← בזמן השימוש ביישום.',
      iosWeb:
        'הגדרות האייפון ← פרטיות ואבטחה ← שירותי מיקום ← אתרי Safari ← בזמן השימוש ביישום. ' +
        'אחר כך ב-Safari הקישו על aA ← הגדרות אתר ← מיקום ← אפשר, ונסו שוב.',
      androidApp: 'הגדרות ← אפליקציות ← Pickup Planner ← הרשאות ← מיקום ← אפשר.',
      androidWeb: 'הקישו על הסמל שליד כתובת האתר ← הרשאות ← מיקום ← אפשר. בדקו גם שהמיקום מופעל בהגדרות הטלפון.',
      macChrome: 'לחצו על הסמל שליד כתובת האתר ← מיקום ← אפשר. בדקו גם בהגדרות המערכת ← פרטיות ואבטחה ← שירותי מיקום ← Google Chrome.',
      macSafari: 'Safari ← הגדרות ← אתרים ← מיקום ← הגדירו את האתר הזה ל״אפשר״. בדקו גם בהגדרות המערכת ← פרטיות ואבטחה ← שירותי מיקום ← Safari.',
      other: 'אפשרו גישה למיקום לאתר הזה בהגדרות הדפדפן, ונסו שוב.',
    },

    heroTitle: 'אוספים את החברים בתחנה הנכונה',
    heroText:
      'כל אחד מוסיף את המיקום שלו, והאפליקציה מוצאת באיזו תחנה כדאי לרדת מהאוטובוס או מהרכבת כדי שכולם ייפגשו כמה שיותר מוקדם, בדרך ליעד. מי שצריך איסוף מקבל הוראות נסיעה בתחבורה ציבורית, וכל נהג מקבל קישורים ל-Waze. עובד בכל הארץ.',
    yourName: 'השם שלכם',
    iAm: 'אני…',
    roleDriver: '🚗 נוהג/ת',
    roleRider: '🚌 צריך/ה איסוף',
    whereGoing: 'לאן נוסעים?',
    destPlaceholder: 'יעד סופי: כתובת או מקום',
    changeDest: 'שינוי יעד',
    whenThere: 'באיזו שעה צריך להגיע?',
    stopsOnWay: 'עצירות בדרך',
    optional: '(לא חובה)',
    addStop: 'הוספת עצירה, למשל תחנת דלק',
    start: 'מתחילים לתכנן',
    howTitle: 'איך זה עובד',
    how1: 'יוצרים תכנון עם היעד ושעת ההגעה, ושולחים את הקישור לחברים (למשל בוואטסאפ).',
    how2: 'כל אחד פותח את הקישור ומקיש על <i>המיקום הנוכחי שלי</i>. אפשר שיהיה יותר מנהג אחד.',
    how3: 'מקישים על <i>מציאת האיסוף הכי טוב</i>, וכל אחד רואה באיזה רכב הוא נוסע, מתי לצאת ולאן להגיע.',
    enterName: 'הזינו את השם שלכם',
    chooseDest: 'בחרו לאן נוסעים',
    timePassed: 'השעה הזו כבר עברה',
    chooseTime: 'בחרו באיזו שעה צריך להגיע',

    loading: 'טוען…',
    startNew: 'תכנון חדש',
    shareBtn: 'שיתוף קישור',
    shareText: (url) => `הצטרפו לתכנון האיסוף שלי והוסיפו את המיקום שלכם:\n${url}`,
    linkCopied: 'הקישור הועתק',
    planning: 'בודקים אוטובוסים וכבישים…',
    recalc: '🔄 חישוב מחדש',
    findBest: '✨ מציאת האיסוף הכי טוב',
    blockNoDriver: 'מחכים שנהג יצטרף.',
    blockNoRiders: 'שתפו את הקישור כדי שמי שצריך איסוף יוכל להצטרף.',
    blockMissing: (names) => `מחכים למיקום של: ${names}`,
    joinTitle: 'הצטרפות לאיסוף',
    joinBtn: 'הצטרפות',
    yourLocation: 'המיקום שלכם',
    badgeDriver: 'נהג/ת',
    badgeRider: 'נוסע/ת',
    whereFrom: 'מאיפה יוצאים?',
    useGps: '📍 המיקום הנוכחי שלי',
    findingYou: 'מחפשים את המיקום…',
    searchPlaceholder: '…או חפשו כתובת, עיר או תחנה',
    searchAria: 'חיפוש מקום',
    freeSeats: 'מקומות פנויים ברכב',
    locBlockedTitle: 'הגישה למיקום חסומה.',
    orSearch: 'אפשר גם לחפש את הכתובת למטה.',
    locSaved: 'המיקום נשמר',
    you: '(את/ה)',
    seats: (n) => (n === 1 ? 'מקום אחד' : `${n} מקומות`),
    noLocYet: 'עדיין אין מיקום',
    ready: 'מוכן',
    waiting: 'מחכים',
    removeAria: (name) => `הסרת ${name}`,
    confirmRemove: (name) => `להסיר את ${name} מהנסיעה?`,
    whosComing: 'מי מגיע',
    invite: '+ הזמנה',
    settings: 'הגדרות הנסיעה',
    beThereBy: 'להגיע ליעד עד',
    asap: 'כמה שיותר מהר',
    noTimeSet: 'לא נקבעה שעה: כולם יוצאים עכשיו ומגיעים כמה שיותר מוקדם.',
    goingTo: 'יעד',
    nowhere: 'לא נקבע יעד: רק האיסופים',
    backToStart: 'חזרה לנקודת היציאה של הנהג',
    priority: 'מה הכי חשוב?',
    prFastest: 'הכי מהר',
    prBalanced: 'מאוזן',
    prLessDriving: 'פחות נהיגה',
    sumBy: (when) => `עד ${when}`,
    sumPickupOnly: 'רק איסוף',
    sumBack: '↩ חזרה',
    sumStops: (n) => (n === 1 ? 'עצירה אחת' : `${n} עצירות`),

    remindMe: '🔔 תזכורת כשצריך לצאת',
    remSet: (times) => `נקבעו תזכורות ל-${times}`,
    remNone: 'התזכורות פעילות, אבל לא נשארו זמנים להזכיר.',
    remOff: 'ביטול',
    remDenied: 'ההתראות של Pickup Planner כבויות. אפשר להפעיל אותן בהגדרות ← עדכונים ← Pickup Planner.',
    remUpdated: 'התכנון השתנה, אז התזכורות עודכנו.',
    remLeaveSoon: 'עוד 10 דקות יוצאים',
    remLeaveNow: 'הגיע הזמן לצאת',
    remBus: (mode, line, stop, time) => `${mode} ${line} מהתחנה ${stop} ב-${time}`,
    remDriverSoon: (name) => `${name} מגיע/ה בעוד 10 דקות`,
    remBeReady: 'כדאי להיות מוכנים בחוץ.',
    remFirstPickup: (names, time) => `איסוף ראשון: ${names} ב-${time}`,
    remDriveTo: (dest, time) => `נסיעה ליעד: ${dest}, הגעה ב-${time}`,
    addCalendar: '📅 הוספה ליומן (התראה 10 דקות לפני)',

    organizer: 'מארגן/ת',
    onlyOrganizer: (name) => `רק ${name} (המארגן/ת) יכול/ה לשנות את אלה.`,
    confirmPlan: '✅ אישור התכנון',
    confirmHint: 'אחרי האישור אף אחד לא יכול לחשב מחדש עד שתפתחו אותו.',
    waitingConfirm: (name) => `מחכים ש${name} יאשר/תאשר את התכנון.`,
    confirmedBy: (name, time) => `התכנון אושר ע״י ${name} ב-${time}`,
    changedAfterLock: (name) => `משהו השתנה אחרי שהתכנון אושר. ${name} יכול/ה לעדכן אותו.`,
    changedAfterLockOrg: 'משהו השתנה אחרי שאישרתם. אפשר לפתוח ולחשב מחדש אם צריך.',
    unlock: '🔓 פתיחת התכנון לשינויים',
    unlockConfirm: 'לפתוח את התכנון? כולם יוכלו לחשב אותו מחדש.',
    planChanged: 'התכנון השתנה מאז שהסתכלתם. בדקו שוב את הזמנים שלכם.',

    stale: 'משהו השתנה מאז שהתכנון נעשה. הקישו על <b>חישוב מחדש</b>.',
    firstCarLeaves: 'הרכב הראשון יוצא',
    driverLeaves: 'הנהג יוצא',
    everyonePicked: 'כולם נאספו',
    everyoneInCar: 'כולם ברכב',
    atDest: 'ביעד',
    atDestGoal: (t) => `ביעד (המטרה: ${t})`,
    done: 'סיום',
    whichCar: 'מי נוסע באיזה רכב',
    noPickupsStraight: 'בלי איסופים, ישר ליעד',
    mapAria: 'מפת המסלולים',
    plannedAt: (t) =>
      `תוכנן ב-${t} לפי לוחות הזמנים של משרד התחבורה. אוטובוסים יכולים לאחר, אז כדאי לבדוק זמנים בזמן אמת במוביט או בגוגל מפות לפני היציאה.`,
    homeOf: (name) => `המיקום של ${name}`,

    stopNo: (code) => `תחנה #${code}`,
    pickUp: (names) => `איסוף: ${names}`,
    readyBy: (t) => `, מוכנים ב-${t}`,
    navWaze: 'ניווט ב-Waze',
    stopAt: (name) => `עצירה: ${name}`,
    aboutTen: (t) => `כ-10 דקות, יציאה עד ${t}`,
    destination: 'יעד',
    leaveAt: 'שעת יציאה',
    driving: (min) => `${min} דק׳ נהיגה`,
    km: (km) => `${km} ק״מ`,
    noOne: 'אין את מי לאסוף.',
    othersCloser: (several) => (several ? 'הרכבים האחרים קרובים יותר לכולם.' : 'הרכב השני קרוב יותר לכולם.'),
    ifLeaveNow: 'הזמנים למטה הם אם יוצאים עכשיו.',
    leaveFrom: (place) => `נקודת יציאה: ${place}`,
    yourLocationLower: 'המיקום שלכם',
    wholeRoute: 'כל המסלול בגוגל מפות',
    wazeNote:
      'Waze פותח עצירה אחת בכל פעם. אחרי כל עצירה, חזרו לכאן והקישו על הבאה. זמני הנסיעה כוללים תוספת של 20% לפקקים, אבל כדאי לבדוק את מצב התנועה ב-Waze לפני היציאה.',
    eachStop10: ' כל עצירה בדרך מחושבת כ-10 דקות.',

    noInstr: 'אין הוראות.',
    driverArrives: 'הנהג מגיע',
    stayHome: (driver, place) => `🏠 נשארים במקום (${place}). <b>${driver}</b> בדרך לאסוף אתכם.`,
    leaveHome: 'יוצאים מהבית',
    goToStop: (stop) => `הולכים לתחנה ${stop}`,
    changeAt: (stop) => `מחליפים בתחנה ${stop}`,
    take: (ride, time) => `עולים על ${ride} <span class="t">ב-${time}</span>`,
    toward: (h) => `לכיוון ${h}`,
    getOff: (stop, time) => `יורדים בתחנה ${stop} <span class="t">${time}</span>`,
    picksUp: (driver, t) => `<b>${driver}</b> אוסף/ת אתכם שם ב-<b>${t}</b>`,
    wait: (m) => `תחכו בערך ${m} דק׳.`,
    busesLate: 'אוטובוסים יכולים לאחר. בדקו זמנים בזמן אמת בגוגל מפות או במוביט לפני שיוצאים.',
    mode: {
      BUS: 'אוטובוס',
      COACH: 'אוטובוס',
      TRAM: 'רכבת קלה',
      SUBWAY: 'מטרו',
      RAIL: 'רכבת',
      FERRY: 'מעבורת',
      CABLE_CAR: 'רכבל',
      FUNICULAR: 'פוניקולר',
      other: 'תחבורה ציבורית',
    },

    otherOptions: 'אפשרויות נוספות',
    sameTime: 'אותו זמן',
    later: (m) => `מאוחר ב-${m} דק׳`,
    earlier: (m) => `מוקדם ב-${m} דק׳`,
    sameDriving: 'אותה נהיגה',
    drivingDiff: (d) => `${d > 0 ? '+' : ''}${d} דק׳ נהיגה`,
    altNote: 'אפשר לשנות את <i>מה הכי חשוב?</i> בהגדרות הנסיעה, כדי לאזן בין הזמן הכולל לבין הנהיגה.',

    driverTip: (name) => `${name} (נהג/ת)`,
    popupPicks: (driver, names) => `${driver} אוסף/ת את ${names}`,
    stopTip: (label) => `עצירה: ${label}`,

    permTitle: 'אישור גישה למיקום',
    permText: 'כדי שלא תצטרכו להקליד כתובת. רק מי שבנסיעה רואה את המיקום.',
    permAllow: '📍 אישור מיקום',
    permSkip: 'לא עכשיו',
    permAllowed: 'המיקום אושר ✓',

    err: {
      notFound: 'הנסיעה לא נמצאה (קישורים פגים אחרי 3 ימים)',
      notInIsrael: 'המיקום צריך להיות בישראל',
      badTime: 'השעה לא תקינה',
      tooManyStops: ({ n }) => `אפשר עד ${n} עצירות בדרך`,
      tooManyDrivers: ({ n }) => `בנסיעה כבר יש ${n} נהגים`,
      tooManyRiders: ({ n }) => `בנסיעה כבר יש ${n} אנשים לאסוף`,
      participantNotFound: 'המשתתף לא נמצא',
      needDriver: 'מישהו צריך להצטרף כנהג.',
      needRider: 'צריך לפחות אדם אחד לאסוף.',
      waitingFor: ({ names }, t) => `מחכים למיקום של: ${t('list', names)}`,
      notEnoughSeats: ({ riders, seats }) =>
        `אין מספיק מקומות: ${riders} אנשים צריכים איסוף, וברכבים יש ${seats} מקומות פנויים. נהגים יכולים לשנות את מספר המקומות תחת ״המיקום שלכם״.`,
      timePassed: 'שעת ההגעה כבר עברה. בחרו שעה מאוחרת יותר בהגדרות הנסיעה.',
      noPlan: 'לא נמצא תכנון אפשרי. בדקו שכולם נמצאים במקום שאפשר להגיע אליו ברכב.',
      organizerOnly: 'רק המארגן/ת יכול/ה לעשות את זה.',
      organizerStays: 'אי אפשר להסיר את המארגן/ת.',
      planLocked: 'התכנון אושר. המארגן/ת יכול/ה לפתוח אותו כדי לחשב מחדש.',
      planStale: 'צריך לחשב מחדש לפני האישור.',
      noCalendar: 'עדיין אין מה להוסיף ליומן.',
    },
    note: {
      noTransit: ({ name }) => `לא נמצאה תחבורה ציבורית עבור ${name} בשעה הזו, אז האיסוף יהיה מהמיקום של ${name}.`,
      slowBus: ({ names }, t) =>
        `זמני האוטובוסים של ${t('list', names)} נטענו לאט, אז ייתכן שחסרות אפשרויות. הקישו על ״חישוב מחדש״ כדי לנסות שוב.`,
      cantMakeIt: ({ target, earliest }, t, time) =>
        `אי אפשר שכולם יגיעו עד ${time(target)}. הכי מוקדם שכולם יכולים להגיע הוא בערך ${time(earliest)}. אפשר לשנות את שעת ההגעה בהגדרות הנסיעה, או להמשיך עם התכנון הזה.`,
      routeFailed: ({ name }) => `לא הצלחנו לצייר את מסלול הנסיעה של ${name}.`,
      restDay: ({ kind, names }, t) =>
        `${kind === 'shabbat' ? 'בשבת' : 'בחג'} כמעט אין תחבורה ציבורית, אז האיסוף של ${t('list', names)} יהיה מהבית.`,
    },
  },
};

let lang = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('pp:lang'));
    return LANGS.includes(saved) ? saved : 'he';
  } catch {
    return 'he';
  }
})();

/** Look up a string ("a.b" for nested keys); call it with args when it's a function. */
function t(key, ...args) {
  const get = (dict) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
  const v = get(STRINGS[lang]) ?? get(STRINGS.en);
  if (v == null) return key;
  return typeof v === 'function' ? v(...args) : v;
}

/** True when `key` has a translation (so callers can fall back to the server's English text). */
function hasT(key) {
  return key.split('.').reduce((o, k) => (o == null ? o : o[k]), STRINGS.en) != null;
}

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
}

function setLang(next) {
  lang = next;
  try {
    localStorage.setItem('pp:lang', JSON.stringify(next));
  } catch {
    /* private mode */
  }
  applyLang();
}

applyLang();
