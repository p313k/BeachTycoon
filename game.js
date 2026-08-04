const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- Größe ans iPad anpassen ---
function resize() {
  const vv = window.visualViewport;
  const width = vv ? vv.width : window.innerWidth;
  const height = vv ? vv.height : window.innerHeight;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
}
window.addEventListener('resize', resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
  window.visualViewport.addEventListener('scroll', resize);
}
resize();

// --- Cookie-Speicher fürs Spiel (kein Server, alles lokal) ---
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

// --- Grundeinstellungen ---
const SAVE_KEY = 'beachTycoonSave';
const START_LOUNGER_COUNT = 4; // so klein fängt ein neuer Strand an
const MAX_LOUNGER_COUNT = 24; // mehr passt nicht an den Strand
const LOUNGER_COST_BASE = 120; // Preis für die erste zusätzliche Liege
const LOUNGER_COST_GROWTH = 1.2; // jede weitere Liege wird teurer
const DAY_DURATION_MS = 30 * 60 * 1000; // eine Season = ein Tag = 30 echte Minuten (Zeitraffer)
const BASE_BOOKING_PRICE = 12; // eine Liege für den ganzen Tag buchen
const TRASH_CHANCE = 0.25; // Chance, dass eine Liege nach dem Tag Müll hinterlässt
const STAFF_COST = 600; // Personal kümmert sich automatisch um alle Liegen

const UPGRADES = {
  schirm: { name: 'Sonnenschirm', icon: '☂️', cost: 80, bonus: 8 },
  tisch: { name: 'Beistelltisch', icon: '🪑', cost: 50, bonus: 5 },
  windschutz: { name: 'Windschutz', icon: '🪟', cost: 110, bonus: 7 },
  handtuch: { name: 'Handtuch-Service', icon: '🧺', cost: 130, bonus: 9 },
  doppel: { name: 'Doppelliege', icon: '🛏️', cost: 200, bonus: 14 },
};
const UPGRADE_KEYS = Object.keys(UPGRADES);

// Eine Strand-Season geht von Juni bis August
const SEASON_MONTHS = [
  { name: 'Juni', days: 30 },
  { name: 'Juli', days: 31 },
  { name: 'August', days: 31 },
];
const SEASON_LENGTH = SEASON_MONTHS.reduce((sum, m) => sum + m.days, 0); // 92 Tage

function getDateLabel(dayOfSeason) {
  let remaining = dayOfSeason;
  for (const m of SEASON_MONTHS) {
    if (remaining <= m.days) return `${remaining}. ${m.name}`;
    remaining -= m.days;
  }
  return `${dayOfSeason}. August`;
}

function isLastDayOfSeason() {
  return state.day >= SEASON_LENGTH;
}

function emptyUpgrade() {
  const u = {};
  UPGRADE_KEYS.forEach((k) => (u[k] = false));
  return u;
}

function defaultUpgrades(count) {
  return Array.from({ length: count }, () => emptyUpgrade());
}

// Alte Spielstände kennen nur einen Teil der Ausbauten – fehlende Schlüssel auffüllen
function normalizeUpgrades(list) {
  if (!Array.isArray(list) || list.length === 0) return defaultUpgrades(START_LOUNGER_COUNT);
  return list.slice(0, MAX_LOUNGER_COUNT).map((saved) => {
    const u = emptyUpgrade();
    UPGRADE_KEYS.forEach((k) => (u[k] = saved && saved[k] === true));
    return u;
  });
}

function loadState() {
  try {
    const raw = getCookie(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        money: parsed.money || 0,
        day: parsed.day || 1,
        season: parsed.season || 1,
        seasonStartMoney: parsed.seasonStartMoney || 0,
        dayStartTime: parsed.dayStartTime || Date.now(),
        staffed: parsed.staffed === true,
        loungerUpgrades: normalizeUpgrades(parsed.loungerUpgrades),
      };
    }
  } catch (e) {}
  return {
    money: 0,
    day: 1,
    season: 1,
    seasonStartMoney: 0,
    dayStartTime: Date.now(),
    staffed: false,
    loungerUpgrades: defaultUpgrades(START_LOUNGER_COUNT),
  };
}

const state = loadState();
let popups = []; // fliegende "+N€" Texte
let dayEnded = false;
let dayEarningsBase = state.money; // Geldstand zu Beginn des Tages, um "heute verdient" zu zeigen
let selectedLounger = null; // Index der Liege, deren Ausbau-Panel offen ist

function saveState() {
  setCookie(
    SAVE_KEY,
    JSON.stringify({
      money: state.money,
      day: state.day,
      season: state.season,
      seasonStartMoney: state.seasonStartMoney,
      dayStartTime: state.dayStartTime,
      staffed: state.staffed,
      loungerUpgrades: state.loungerUpgrades,
    }),
    365
  );
}

function addPopup(x, y, text) {
  popups.push({ x, y, text, life: 1 });
}

function loungerPrice(i) {
  const u = state.loungerUpgrades[i];
  let price = BASE_BOOKING_PRICE;
  UPGRADE_KEYS.forEach((k) => {
    if (u[k]) price += UPGRADES[k].bonus;
  });
  return price;
}

// --- Liegen: der Strand fängt klein an und wird dazugekauft ---
function makeLounger() {
  return {
    waiting: false,
    booked: false,
    dirty: false,
    nextSpawn: performance.now() + randomDelay(5000, 60000),
  };
}

const loungers = Array.from({ length: state.loungerUpgrades.length }, makeLounger);

function nextLoungerCost() {
  const extra = loungers.length - START_LOUNGER_COUNT;
  return Math.round(LOUNGER_COST_BASE * Math.pow(LOUNGER_COST_GROWTH, Math.max(0, extra)));
}

function beachIsFull() {
  return loungers.length >= MAX_LOUNGER_COUNT;
}

function buyLounger() {
  if (beachIsFull()) return;
  const cost = nextLoungerCost();
  if (state.money < cost) return;
  state.money -= cost;
  state.loungerUpgrades.push(emptyUpgrade());
  loungers.push(makeLounger());
  const slot = getLoungerRect(loungers.length - 1);
  addPopup(slot.x + slot.w / 2, slot.y - 10, '🛏️ neu!');
  saveState();
}

// --- Tag/Season-Fortschritt ---
function dayProgress() {
  return Math.min(1, Math.max(0, (Date.now() - state.dayStartTime) / DAY_DURATION_MS));
}

function checkDayEnd() {
  if (!dayEnded && dayProgress() >= 1) {
    dayEnded = true;
  }
}

function startNextDay() {
  if (isLastDayOfSeason()) {
    state.season += 1;
    state.day = 1;
    state.seasonStartMoney = state.money;
  } else {
    state.day += 1;
  }
  state.dayStartTime = Date.now();
  dayEarningsBase = state.money;
  dayEnded = false;
  selectedLounger = null;
  loungers.forEach((l) => {
    if (l.booked) {
      l.booked = false;
      l.dirty = Math.random() < TRASH_CHANCE;
    }
    l.waiting = false;
    l.nextSpawn = performance.now() + randomDelay(5000, 60000);
  });
  saveState();
}

function getClockLabel() {
  const totalMinutes = 8 * 60 + dayProgress() * 12 * 60; // 08:00 bis 20:00
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getSkyColor() {
  const p = dayProgress();
  const stops = [
    { p: 0, c: [255, 198, 150] }, // Morgendämmerung
    { p: 0.5, c: [126, 200, 227] }, // heller Mittag
    { p: 1, c: [255, 150, 130] }, // Abendrot
  ];
  let a = stops[0];
  let b = stops[1];
  if (p > 0.5) {
    a = stops[1];
    b = stops[2];
  }
  const span = b.p - a.p;
  const t = span === 0 ? 0 : (p - a.p) / span;
  const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * t);
  const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * t);
  const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// --- Layout ---
function getTopBarRect() {
  return { x: 0, y: 0, w: canvas.width, h: 64 };
}

function getShopRect() {
  // Platz für Steuerkreuz + Knöpfe, aber auf großen Bildschirmen nicht ausufernd
  const h = Math.max(150, Math.min(canvas.height * 0.26, 210));
  return { x: 0, y: canvas.height - h, w: canvas.width, h };
}

// Das Steuerkreuz sitzt links in der Leiste, alles andere rechts daneben
function getDpadSize() {
  const shop = getShopRect();
  return Math.min(56, (shop.h - 20) / 3);
}

function getShopContentRect() {
  const shop = getShopRect();
  const left = shop.x + getDpadSize() * 3 + 20;
  return { x: left, y: shop.y, w: shop.w - left, h: shop.h };
}

// Das Raster wächst mit der Zahl der Liegen mit und bleibt dabei möglichst quadratisch
function getGrid() {
  const shop = getShopRect();
  const top = 82; // etwas Luft, damit die Sonnenschirme der ersten Reihe Platz haben
  const zoneH = shop.y - top;
  const count = Math.max(1, loungers.length);
  let cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt((count * canvas.width) / zoneH))));
  const rows = Math.ceil(count / cols);
  cols = Math.ceil(count / rows); // Reihen gleichmäßig füllen (4 Liegen -> 2x2 statt 3+1)
  return { top, zoneH, cols, rows, count };
}

function getLoungerRect(index) {
  const { top, zoneH, cols, rows, count } = getGrid();
  const cw = canvas.width / cols;
  const rh = zoneH / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const size = Math.min(cw, rh) * 0.68;
  // angebrochene letzte Reihe mittig setzen
  const inRow = Math.min(cols, count - row * cols);
  const rowOffset = ((cols - inRow) * cw) / 2;
  return {
    x: rowOffset + col * cw + cw / 2 - size / 2,
    y: top + row * rh + rh / 2 - size / 2,
    w: size,
    h: size,
  };
}

function getResetButtonRect() {
  return { x: canvas.width - 132, y: 18, w: 120, h: 28 };
}

function getPersonalButtonRect() {
  const area = getShopContentRect();
  const pad = 10;
  return { x: area.x, y: area.y + pad, w: area.w * 0.3, h: area.h - pad * 2 };
}

function getBuyLoungerButtonRect() {
  const area = getShopContentRect();
  const pad = 10;
  const personal = getPersonalButtonRect();
  return { x: personal.x + personal.w + pad, y: area.y + pad, w: area.w * 0.3, h: area.h - pad * 2 };
}

// Ausbau-Panel: 3x2 Kacheln (5 Ausbauten + Fertig-Knopf), belegt die ganze Shop-Leiste
const PANEL_CELLS = [...UPGRADE_KEYS, 'close'];

function getUpgradeButtonRect(which) {
  const area = getShopContentRect();
  const pad = 8;
  const cols = 3;
  const rows = 2;
  const index = Math.max(0, PANEL_CELLS.indexOf(which));
  const cw = (area.w - pad * cols) / cols;
  const ch = (area.h - pad * (rows + 1)) / rows;
  return {
    x: area.x + (index % cols) * (cw + pad),
    y: area.y + pad + Math.floor(index / cols) * (ch + pad),
    w: cw,
    h: ch,
  };
}

function getNextDayButtonRect() {
  return { x: canvas.width / 2 - 170, y: canvas.height / 2 + 30, w: 340, h: 50 };
}

// --- Spielfigur: läuft dorthin, wo man hintippt ---
const player = {
  x: canvas.width / 2,
  y: (getTopBarRect().h + getShopRect().y) / 2,
  targetX: canvas.width / 2,
  targetY: (getTopBarRect().h + getShopRect().y) / 2,
  speed: 260, // Pixel pro Sekunde
};

// --- Tastatur (W/A/S/D oder Pfeiltasten) ---
const pressedKeys = new Set();
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (MOVE_KEYS.includes(key)) e.preventDefault();
  pressedKeys.add(key);
});
window.addEventListener('keyup', (e) => {
  pressedKeys.delete(e.key.toLowerCase());
});

function keyboardDirection() {
  let dx = 0;
  let dy = 0;
  if (pressedKeys.has('w') || pressedKeys.has('arrowup')) dy -= 1;
  if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) dy += 1;
  if (pressedKeys.has('a') || pressedKeys.has('arrowleft')) dx -= 1;
  if (pressedKeys.has('d') || pressedKeys.has('arrowright')) dx += 1;
  return { dx, dy };
}

// --- Steuerkreuz (Touch) unten links ---
let dpadDirection = null; // { key, dx, dy } oder null
let dpadPointerId = null;

function getDpadRects() {
  const shop = getShopRect();
  const size = getDpadSize();
  const gap = 2;
  const cx = 10 + size * 1.5;
  const cy = shop.y + shop.h / 2;
  return {
    up: { key: 'up', dx: 0, dy: -1, symbol: '▲', x: cx - size / 2, y: cy - size - gap, w: size, h: size },
    down: { key: 'down', dx: 0, dy: 1, symbol: '▼', x: cx - size / 2, y: cy + gap, w: size, h: size },
    left: { key: 'left', dx: -1, dy: 0, symbol: '◀', x: cx - size - gap, y: cy - size / 2, w: size, h: size },
    right: { key: 'right', dx: 1, dy: 0, symbol: '▶', x: cx + gap, y: cy - size / 2, w: size, h: size },
  };
}

function hitDpad(px, py) {
  const rects = getDpadRects();
  for (const key of Object.keys(rects)) {
    if (pointInRect(px, py, rects[key])) return rects[key];
  }
  return null;
}

function releaseDpad(e) {
  if (e.pointerId === dpadPointerId) {
    dpadDirection = null;
    dpadPointerId = null;
  }
}
canvas.addEventListener('pointerup', releaseDpad);
canvas.addEventListener('pointercancel', releaseDpad);
canvas.addEventListener('pointerleave', releaseDpad);

function getInputDirection() {
  let dx = 0;
  let dy = 0;
  const kb = keyboardDirection();
  dx += kb.dx;
  dy += kb.dy;
  if (dpadDirection) {
    dx += dpadDirection.dx;
    dy += dpadDirection.dy;
  }
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
  }
  return { dx, dy };
}

function updatePlayer(dt) {
  const step = player.speed * (dt / 1000);
  const { dx, dy } = getInputDirection();
  const top = getTopBarRect();
  const shop = getShopRect();

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    player.x = Math.min(Math.max(player.x + (dx / len) * step, 20), canvas.width - 20);
    player.y = Math.min(Math.max(player.y + (dy / len) * step, top.h + 10), shop.y - 20);
    player.targetX = player.x;
    player.targetY = player.y;
    return;
  }

  const tx = player.targetX - player.x;
  const ty = player.targetY - player.y;
  const dist = Math.hypot(tx, ty);
  if (dist <= step || dist === 0) {
    player.x = player.targetX;
    player.y = player.targetY;
  } else {
    player.x += (tx / dist) * step;
    player.y += (ty / dist) * step;
  }
}

// Läuft die Figur nah genug an eine Liege mit wartendem Kunden, wird der Tag gebucht
function checkInNearbyCustomers() {
  if (state.staffed) return; // Personal kümmert sich automatisch, kein manuelles Einchecken nötig
  loungers.forEach((l, i) => {
    if (!l.waiting) return;
    const slot = getLoungerRect(i);
    const cx = slot.x + slot.w / 2;
    const cy = slot.y + slot.h / 2;
    const radius = Math.max(slot.w, slot.h) * 0.8;
    if (Math.hypot(player.x - cx, player.y - cy) <= radius) {
      const price = loungerPrice(i);
      state.money += price;
      l.waiting = false;
      l.booked = true;
      addPopup(cx, slot.y - 10, `+${price}€`);
      saveState();
    }
  });
}

// Läuft die Figur nah genug an eine eingemüllte Liege, wird sie sauber gemacht
function cleanNearbyLoungers() {
  if (state.staffed) return;
  loungers.forEach((l, i) => {
    if (!l.dirty) return;
    const slot = getLoungerRect(i);
    const cx = slot.x + slot.w / 2;
    const cy = slot.y + slot.h / 2;
    const radius = Math.max(slot.w, slot.h) * 0.8;
    if (Math.hypot(player.x - cx, player.y - cy) <= radius) {
      l.dirty = false;
      l.nextSpawn = performance.now() + randomDelay(5000, 60000);
      addPopup(cx, slot.y - 10, '🧹 sauber!');
    }
  });
}

// --- Liegen-Personal: eine sichtbare Person, die von Liege zu Liege läuft ---
const liegeStaff = { x: null, y: null, targetIndex: null, speed: 180 };

function findLoungerNeedingAttention() {
  for (let i = 0; i < loungers.length; i++) {
    if (loungers[i].waiting || loungers[i].dirty) return i;
  }
  return -1;
}

function updateLiegeStaff(dt) {
  if (liegeStaff.x === null) {
    const first = getLoungerRect(0);
    liegeStaff.x = first.x + first.w / 2;
    liegeStaff.y = first.y + first.h / 2;
  }

  const targetStillValid =
    liegeStaff.targetIndex !== null &&
    (loungers[liegeStaff.targetIndex].waiting || loungers[liegeStaff.targetIndex].dirty);

  if (!targetStillValid) {
    const found = findLoungerNeedingAttention();
    liegeStaff.targetIndex = found === -1 ? null : found;
  }

  if (liegeStaff.targetIndex === null) return;

  const slot = getLoungerRect(liegeStaff.targetIndex);
  const tx = slot.x + slot.w / 2;
  const ty = slot.y + slot.h / 2;
  const dx = tx - liegeStaff.x;
  const dy = ty - liegeStaff.y;
  const dist = Math.hypot(dx, dy);
  const step = liegeStaff.speed * (dt / 1000);

  if (dist <= step || dist === 0) {
    liegeStaff.x = tx;
    liegeStaff.y = ty;
    const i = liegeStaff.targetIndex;
    const l = loungers[i];
    if (l.waiting) {
      const price = loungerPrice(i);
      state.money += price;
      l.waiting = false;
      l.booked = true;
      addPopup(tx, slot.y - 10, `+${price}€`);
      saveState();
    } else if (l.dirty) {
      l.dirty = false;
      l.nextSpawn = performance.now() + randomDelay(5000, 60000);
      addPopup(tx, slot.y - 10, '🧹');
    }
    liegeStaff.targetIndex = null;
  } else {
    liegeStaff.x += (dx / dist) * step;
    liegeStaff.y += (dy / dist) * step;
  }
}

// --- Neu starten ---
function resetGame() {
  if (!window.confirm('Wirklich neu starten? Der ganze Spielstand geht verloren!')) return;
  state.money = 0;
  state.day = 1;
  state.season = 1;
  state.seasonStartMoney = 0;
  state.dayStartTime = Date.now();
  state.staffed = false;
  state.loungerUpgrades = defaultUpgrades(START_LOUNGER_COUNT);
  saveState();
  location.reload();
}

function buyUpgrade(index, kind) {
  const u = state.loungerUpgrades[index];
  if (u[kind]) return;
  const cost = UPGRADES[kind].cost;
  if (state.money < cost) return;
  state.money -= cost;
  u[kind] = true;
  saveState();
}

function buyStaff() {
  if (state.staffed) return;
  if (state.money < STAFF_COST) return;
  state.money -= STAFF_COST;
  state.staffed = true;
  saveState();
}

// --- Eingabe ---
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  // Tagesabrechnung: Button für nächsten Tag
  if (dayEnded) {
    if (pointInRect(px, py, getNextDayButtonRect())) {
      startNextDay();
    }
    return;
  }

  // Neu-starten-Button
  if (pointInRect(px, py, getResetButtonRect())) {
    resetGame();
    return;
  }

  // Ausbau-Panel für die ausgewählte Liege belegt die ganze Shop-Leiste
  if (selectedLounger !== null) {
    if (pointInRect(px, py, getUpgradeButtonRect('close'))) {
      selectedLounger = null;
      return;
    }
    for (const kind of UPGRADE_KEYS) {
      if (pointInRect(px, py, getUpgradeButtonRect(kind))) {
        buyUpgrade(selectedLounger, kind);
        return;
      }
    }
  } else {
    // Personal-Button
    if (pointInRect(px, py, getPersonalButtonRect())) {
      buyStaff();
      return;
    }

    // Neue Liege kaufen
    if (pointInRect(px, py, getBuyLoungerButtonRect())) {
      buyLounger();
      return;
    }
  }

  // Steuerkreuz
  const dpadHit = hitDpad(px, py);
  if (dpadHit) {
    dpadDirection = dpadHit;
    dpadPointerId = e.pointerId;
    return;
  }

  // Freie Liege antippen: Ausbau-Panel öffnen (Figur läuft trotzdem hin)
  for (let i = 0; i < loungers.length; i++) {
    const l = loungers[i];
    const slot = getLoungerRect(i);
    if (pointInRect(px, py, slot) && !l.booked && !l.dirty && !l.waiting) {
      selectedLounger = selectedLounger === i ? null : i;
      const top = getTopBarRect();
      const shop = getShopRect();
      player.targetX = Math.min(Math.max(px, 20), canvas.width - 20);
      player.targetY = Math.min(Math.max(py, top.h + 10), shop.y - 20);
      return;
    }
  }

  selectedLounger = null;

  // Sonst: Figur zum angetippten Ort auf dem Strand laufen lassen
  const top = getTopBarRect();
  const shop = getShopRect();
  player.targetX = Math.min(Math.max(px, 20), canvas.width - 20);
  player.targetY = Math.min(Math.max(py, top.h + 10), shop.y - 20);
});

// --- Spielschleife ---
let lastFrame = performance.now();

function update(now) {
  const dt = now - lastFrame;
  lastFrame = now;

  checkDayEnd();

  if (!dayEnded) {
    // Kunden kommen von selbst zu sauberen, freien Liegen (nicht zu eingemüllten oder gebuchten)
    for (const l of loungers) {
      if (!l.booked && !l.dirty && !l.waiting && now >= l.nextSpawn) l.waiting = true;
    }

    updatePlayer(dt);
    checkInNearbyCustomers();
    cleanNearbyLoungers();
    if (state.staffed) updateLiegeStaff(dt);
  }

  popups = popups.filter((p) => {
    p.y -= dt * 0.03;
    p.life -= dt / 800;
    return p.life > 0;
  });
}

function draw() {
  // Strand
  ctx.fillStyle = '#f2d29b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Himmel im Zeitraffer (Morgen -> Mittag -> Abend)
  const top = getTopBarRect();
  ctx.fillStyle = getSkyColor();
  ctx.fillRect(top.x, top.y, top.w, top.h);

  const sunX = 40 + dayProgress() * (canvas.width - 80);
  ctx.font = '26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('☀️', sunX, top.h / 2 + 10);

  // Kopfzeile: Datum links, Geld rechts vor dem Reset-Knopf, Uhr in die Lücke dazwischen
  ctx.fillStyle = '#1a2a3a';
  const dateText = `Season ${state.season} · ${getDateLabel(state.day)}`;
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(dateText, 12, top.h / 2 + 6);
  const dateEnd = 12 + ctx.measureText(dateText).width;

  const moneyText = `💰 ${state.money}€`;
  ctx.font = 'bold 22px sans-serif';
  const moneyRight = getResetButtonRect().x - 14;
  ctx.textAlign = 'right';
  ctx.fillText(moneyText, moneyRight, top.h / 2 + 7);
  const moneyLeft = moneyRight - ctx.measureText(moneyText).width;

  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`🕗 ${getClockLabel()}`, (dateEnd + moneyLeft) / 2, top.h / 2 + 6);

  // Liegen (10 Stück)
  loungers.forEach((l, i) => {
    const slot = getLoungerRect(i);
    const u = state.loungerUpgrades[i];
    ctx.fillStyle = l.dirty ? '#8a7455' : '#e8b04b';
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 8);
    ctx.fill();

    if (selectedLounger === i) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(slot.x - 3, slot.y - 3, slot.w + 6, slot.h + 6, 10);
      ctx.stroke();
    }

    const cx = slot.x + slot.w / 2;

    // Ausbauten anzeigen: Schirm über der Liege, der Rest als kleine Leiste am unteren Rand
    if (u.schirm) {
      ctx.font = `${Math.max(16, slot.w * 0.4)}px sans-serif`;
      ctx.fillText('☂️', cx, slot.y - 6);
    }
    const extras = UPGRADE_KEYS.filter((k) => k !== 'schirm' && u[k]);
    if (extras.length > 0) {
      const iconSize = Math.max(9, Math.min(slot.w * 0.22, slot.w / (extras.length + 0.5)));
      ctx.font = `${iconSize}px sans-serif`;
      const startX = cx - ((extras.length - 1) * iconSize) / 2;
      extras.forEach((k, n) => {
        ctx.fillText(UPGRADES[k].icon, startX + n * iconSize, slot.y + slot.h - 4);
      });
    }

    if (l.dirty) {
      ctx.font = `${Math.max(14, slot.w * 0.35)}px sans-serif`;
      ctx.fillText('🗑️', cx, slot.y + slot.h / 2 + 8);
    } else if (l.booked) {
      ctx.font = `${Math.max(16, slot.w * 0.4)}px sans-serif`;
      ctx.fillText('😎', cx, slot.y + slot.h / 2 + 8);
    } else if (l.waiting) {
      ctx.font = `${Math.max(14, slot.w * 0.32)}px sans-serif`;
      ctx.fillText('🧍', cx, slot.y + slot.h / 2 + 4);
      ctx.fillStyle = '#1a2a3a';
      ctx.font = `bold ${Math.max(10, slot.w * 0.13)}px sans-serif`;
      ctx.fillText(`Buchen: ${loungerPrice(i)}€`, cx, slot.y + slot.h + 16);
    }
  });

  // Liegen-Personal (eine Person, läuft sichtbar herum)
  if (state.staffed && liegeStaff.x !== null) {
    ctx.beginPath();
    ctx.ellipse(liegeStaff.x, liegeStaff.y + 14, 14, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fill();
    ctx.font = '30px sans-serif';
    ctx.fillText('👷', liegeStaff.x, liegeStaff.y + 8);
  }

  // Popups
  popups.forEach((p) => {
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.font = 'bold 20px sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = '#12324a';
    ctx.fillText(p.text, p.x, p.y);
    ctx.globalAlpha = 1;
  });

  // Spielfigur
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + 16, 16, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fill();
  ctx.font = '34px sans-serif';
  ctx.fillText('🧑', player.x, player.y + 10);

  // Shop-Leiste
  const shop = getShopRect();
  ctx.fillStyle = '#12324a';
  ctx.fillRect(shop.x, shop.y, shop.w, shop.h);

  // Steuerkreuz (links in der Leiste, damit es keine Liegen verdeckt)
  Object.values(getDpadRects()).forEach((r) => {
    const active = dpadDirection && dpadDirection.key === r.key;
    ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.fillStyle = '#12324a';
    ctx.font = `bold ${Math.max(14, r.h * 0.4)}px sans-serif`;
    ctx.fillText(r.symbol, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.15);
  });

  if (selectedLounger !== null) {
    // Ausbau-Panel für die gewählte Liege
    const u = state.loungerUpgrades[selectedLounger];

    UPGRADE_KEYS.forEach((kind) => {
      const btn = getUpgradeButtonRect(kind);
      const owned = u[kind];
      const affordable = state.money >= UPGRADES[kind].cost;
      ctx.fillStyle = owned ? '#2f5d3a' : affordable ? '#1c3d54' : '#16293a';
      ctx.beginPath();
      ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 10);
      ctx.fill();
      ctx.fillStyle = owned || affordable ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
      ctx.font = `bold ${Math.max(12, btn.w * 0.075)}px sans-serif`;
      ctx.fillText(`${UPGRADES[kind].icon} ${UPGRADES[kind].name}`, btn.x + btn.w / 2, btn.y + btn.h * 0.44);
      ctx.font = `${Math.max(10, btn.w * 0.065)}px sans-serif`;
      ctx.fillText(
        owned ? `✓ +${UPGRADES[kind].bonus}€/Buchung` : `${UPGRADES[kind].cost}€ · +${UPGRADES[kind].bonus}€/Buchung`,
        btn.x + btn.w / 2,
        btn.y + btn.h * 0.75
      );
    });

    const closeBtn = getUpgradeButtonRect('close');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.roundRect(closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(12, closeBtn.w * 0.075)}px sans-serif`;
    ctx.fillText(`Liege ${selectedLounger + 1}`, closeBtn.x + closeBtn.w / 2, closeBtn.y + closeBtn.h * 0.44);
    ctx.font = `${Math.max(10, closeBtn.w * 0.065)}px sans-serif`;
    ctx.fillText(
      `✕ Fertig · ${loungerPrice(selectedLounger)}€/Tag`,
      closeBtn.x + closeBtn.w / 2,
      closeBtn.y + closeBtn.h * 0.75
    );
  } else {
    // Personal-Button
    const personalBtn = getPersonalButtonRect();
    ctx.fillStyle = state.staffed ? '#2f5d3a' : '#1c3d54';
    ctx.beginPath();
    ctx.roundRect(personalBtn.x, personalBtn.y, personalBtn.w, personalBtn.h, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(12, personalBtn.w * 0.1)}px sans-serif`;
    ctx.fillText('👷 Personal', personalBtn.x + personalBtn.w / 2, personalBtn.y + personalBtn.h * 0.42);
    ctx.font = `${Math.max(11, personalBtn.w * 0.09)}px sans-serif`;
    ctx.fillText(
      state.staffed ? '✓ aktiv' : `${STAFF_COST}€`,
      personalBtn.x + personalBtn.w / 2,
      personalBtn.y + personalBtn.h * 0.72
    );

    // Neue Liege kaufen
    const buyBtn = getBuyLoungerButtonRect();
    const full = beachIsFull();
    const cost = nextLoungerCost();
    const affordable = !full && state.money >= cost;
    ctx.fillStyle = full ? '#2f5d3a' : affordable ? '#1c3d54' : '#16293a';
    ctx.beginPath();
    ctx.roundRect(buyBtn.x, buyBtn.y, buyBtn.w, buyBtn.h, 10);
    ctx.fill();
    ctx.fillStyle = full || affordable ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
    ctx.font = `bold ${Math.max(12, buyBtn.w * 0.1)}px sans-serif`;
    ctx.fillText('🛏️ Neue Liege', buyBtn.x + buyBtn.w / 2, buyBtn.y + buyBtn.h * 0.42);
    ctx.font = `${Math.max(11, buyBtn.w * 0.09)}px sans-serif`;
    ctx.fillText(
      full ? '✓ Strand voll' : `${cost}€ (${loungers.length}/${MAX_LOUNGER_COUNT})`,
      buyBtn.x + buyBtn.w / 2,
      buyBtn.y + buyBtn.h * 0.72
    );

    // Hinweis in den Rest der Leiste rechts neben den Knöpfen
    const hintLeft = buyBtn.x + buyBtn.w + 12;
    const hintW = shop.x + shop.w - 12 - hintLeft;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = `${Math.max(11, Math.min(15, hintW * 0.075))}px sans-serif`;
    ctx.fillText('Tippe eine freie Liege an,', hintLeft + hintW / 2, shop.y + shop.h / 2 - 4);
    ctx.fillText('um sie auszubauen', hintLeft + hintW / 2, shop.y + shop.h / 2 + 18);
  }

  // Neu-starten-Button
  const resetBtn = getResetButtonRect();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath();
  ctx.roundRect(resetBtn.x, resetBtn.y, resetBtn.w, resetBtn.h, 8);
  ctx.fill();
  ctx.fillStyle = '#1a2a3a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🔄 Neu starten', resetBtn.x + resetBtn.w / 2, resetBtn.y + resetBtn.h / 2 + 5);

  // Tagesabrechnung (oder Season-Ende, wenn August vorbei ist)
  if (dayEnded) {
    const seasonOver = isLastDayOfSeason();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(
      seasonOver ? `🏖️ Season ${state.season} beendet!` : `🌅 ${getDateLabel(state.day)} beendet!`,
      canvas.width / 2,
      canvas.height / 2 - 40
    );
    ctx.font = '22px sans-serif';
    ctx.fillText(`Heute verdient: ${state.money - dayEarningsBase}€`, canvas.width / 2, canvas.height / 2);
    ctx.fillText(
      seasonOver ? `Diese Season verdient: ${state.money - state.seasonStartMoney}€` : `Gesamt: ${state.money}€`,
      canvas.width / 2,
      canvas.height / 2 + 30
    );

    const nextBtn = getNextDayButtonRect();
    ctx.fillStyle = '#2f5d3a';
    ctx.beginPath();
    ctx.roundRect(nextBtn.x, nextBtn.y, nextBtn.w, nextBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${seasonOver ? 17 : 20}px sans-serif`;
    ctx.fillText(
      seasonOver ? '▶ Neue Season starten (Juni)' : '▶ Nächsten Tag starten',
      nextBtn.x + nextBtn.w / 2,
      nextBtn.y + nextBtn.h / 2 + 7
    );
  }
}

function loop(now) {
  update(now);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
