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

// --- Die Sachen, die man kaufen kann ---
const ITEM_TYPES = [
  { id: 'liege', name: 'Liegestuhl', cost: 10, tapIncome: 1, staffCost: 300, staffIncome: 1, color: '#e8b04b' },
  { id: 'schirm', name: 'Sonnenschirm', cost: 25, tapIncome: 2, staffCost: 600, staffIncome: 2, color: '#e05c5c' },
  { id: 'eisstand', name: 'Eisstand', cost: 60, tapIncome: 4, staffCost: 1200, staffIncome: 4, color: '#7ec8e3' },
  { id: 'getraenke', name: 'Getränkebude', cost: 120, tapIncome: 7, staffCost: 2500, staffIncome: 7, color: '#5cb85c' },
  { id: 'snackbar', name: 'Snackbar', cost: 250, tapIncome: 12, staffCost: 5000, staffIncome: 12, color: '#f0a500' },
  { id: 'pool', name: 'Pool', cost: 500, tapIncome: 20, staffCost: 10000, staffIncome: 20, color: '#2e86ab' },
];

const SAVE_KEY = 'beachTycoonSave';
const STAFF_TICK_MS = 2000;

function loadState() {
  try {
    const raw = getCookie(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        money: parsed.money || 0,
        owned: parsed.owned || {},
        staffed: parsed.staffed || {},
      };
    }
  } catch (e) {}
  // Neues Spiel: man hat schon einen Liegestuhl zum Loslegen
  return { money: 0, owned: { liege: 1 }, staffed: {} };
}

const state = loadState();
let popups = []; // fliegende "+N€" Texte
let won = state.won === true;

function saveState() {
  setCookie(SAVE_KEY, JSON.stringify({ money: state.money, owned: state.owned, staffed: state.staffed }), 365);
}

function isOwned(id) {
  return (state.owned[id] || 0) > 0;
}

function isStaffed(id) {
  return state.staffed[id] === true;
}

function countUnlocked() {
  return ITEM_TYPES.filter((item) => isOwned(item.id) && isStaffed(item.id)).length;
}

function addPopup(x, y, text) {
  popups.push({ x, y, text, life: 1 });
}

function checkWin() {
  if (!won && countUnlocked() === ITEM_TYPES.length) {
    won = true;
    saveState();
  }
}

// Liegen werden extra behandelt (siehe unten) - alle anderen Stände laufen wie bisher
const STAND_TYPES = ITEM_TYPES.filter((item) => item.id !== 'liege');

// --- Kunden: kommen von selbst, man tippt sie an um Geld abzuholen ---
const customers = {}; // id -> { waiting, nextSpawn }

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

function ensureCustomerTimer(id, now) {
  if (!customers[id]) {
    customers[id] = { waiting: false, nextSpawn: now + randomDelay(1000, 4000) };
  }
}

STAND_TYPES.forEach((item) => {
  if (isOwned(item.id) && !isStaffed(item.id)) ensureCustomerTimer(item.id, performance.now());
});

// --- Liegen: es gibt gleich mehrere, manche werden nach Benutzung eingemüllt ---
const LOUNGER_COUNT = 10;
const loungers = Array.from({ length: LOUNGER_COUNT }, () => ({
  waiting: false,
  dirty: false,
  nextSpawn: performance.now() + randomDelay(1000, 4000),
}));

// --- Layout ---
function getShopRect() {
  const h = canvas.height * 0.34;
  return { x: 0, y: canvas.height - h, w: canvas.width, h };
}

function getShopButtonRect(index) {
  const shop = getShopRect();
  const cols = 3;
  const rows = 2;
  const bw = shop.w / cols;
  const bh = shop.h / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const pad = 6;
  return { x: shop.x + col * bw + pad, y: shop.y + row * bh + pad, w: bw - pad * 2, h: bh - pad * 2 };
}

function getLoungerRect(index) {
  const shop = getShopRect();
  const top = 50;
  const zoneH = (shop.y - top) * 0.42;
  const cols = 5;
  const rows = 2;
  const cw = canvas.width / cols;
  const rh = zoneH / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const size = Math.min(cw, rh) * 0.62;
  return {
    x: col * cw + cw / 2 - size / 2,
    y: top + row * rh + rh / 2 - size / 2,
    w: size,
    h: size,
  };
}

function getStandSlotRect(index) {
  const shop = getShopRect();
  const loungerZoneH = (shop.y - 50) * 0.42;
  const top = 50 + loungerZoneH;
  const zoneH = shop.y - top;
  const cols = STAND_TYPES.length;
  const cw = canvas.width / cols;
  const size = Math.min(cw, zoneH) * 0.55;
  return {
    x: index * cw + cw / 2 - size / 2,
    y: top + zoneH / 2 - size / 2,
    w: size,
    h: size,
  };
}

// --- Spielfigur: läuft dorthin, wo man hintippt ---
const player = {
  x: canvas.width / 2,
  y: getShopRect().y / 2,
  targetX: canvas.width / 2,
  targetY: getShopRect().y / 2,
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
  const size = 56;
  const gap = 6;
  const cx = 20 + size + gap;
  const cy = shop.y - 20 - size - gap;
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

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    const shop = getShopRect();
    player.x = Math.min(Math.max(player.x + (dx / len) * step, 20), canvas.width - 20);
    player.y = Math.min(Math.max(player.y + (dy / len) * step, 50), shop.y - 20);
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

// Läuft die Figur nah genug an einen Stand mit wartendem Kunden, wird automatisch kassiert
function collectNearbyCustomers() {
  STAND_TYPES.forEach((item, i) => {
    if (!isOwned(item.id) || isStaffed(item.id)) return;
    const c = customers[item.id];
    if (!c || !c.waiting) return;
    const slot = getStandSlotRect(i);
    const cx = slot.x + slot.w / 2;
    const cy = slot.y + slot.h / 2;
    const radius = Math.max(slot.w, slot.h) * 0.8;
    if (Math.hypot(player.x - cx, player.y - cy) <= radius) {
      state.money += item.tapIncome;
      c.waiting = false;
      c.nextSpawn = performance.now() + randomDelay(1000, 9000);
      addPopup(cx, slot.y - 10, `+${item.tapIncome}€`);
      saveState();
    }
  });
}

const LIEGE = ITEM_TYPES.find((item) => item.id === 'liege');
const TRASH_CHANCE = 0.25;

// Läuft die Figur nah genug an eine Liege mit wartendem Kunden, wird kassiert (manchmal bleibt Müll zurück)
function collectNearbyLoungers() {
  if (isStaffed('liege')) return; // Personal kümmert sich automatisch, kein manuelles Abholen nötig
  loungers.forEach((l, i) => {
    if (!l.waiting) return;
    const slot = getLoungerRect(i);
    const cx = slot.x + slot.w / 2;
    const cy = slot.y + slot.h / 2;
    const radius = Math.max(slot.w, slot.h) * 0.8;
    if (Math.hypot(player.x - cx, player.y - cy) <= radius) {
      state.money += LIEGE.tapIncome;
      l.waiting = false;
      addPopup(cx, slot.y - 10, `+${LIEGE.tapIncome}€`);
      if (Math.random() < TRASH_CHANCE) {
        l.dirty = true;
      } else {
        l.nextSpawn = performance.now() + randomDelay(1000, 9000);
      }
      saveState();
    }
  });
}

// Läuft die Figur nah genug an eine eingemüllte Liege, wird sie sauber gemacht
function cleanNearbyLoungers() {
  if (isStaffed('liege')) return;
  loungers.forEach((l, i) => {
    if (!l.dirty) return;
    const slot = getLoungerRect(i);
    const cx = slot.x + slot.w / 2;
    const cy = slot.y + slot.h / 2;
    const radius = Math.max(slot.w, slot.h) * 0.8;
    if (Math.hypot(player.x - cx, player.y - cy) <= radius) {
      l.dirty = false;
      l.nextSpawn = performance.now() + randomDelay(1000, 9000);
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
    const l = loungers[liegeStaff.targetIndex];
    if (l.waiting) {
      state.money += LIEGE.staffIncome;
      l.waiting = false;
      addPopup(tx, slot.y - 10, `+${LIEGE.staffIncome}€`);
      saveState();
    } else if (l.dirty) {
      l.dirty = false;
      addPopup(tx, slot.y - 10, '🧹');
    }
    l.nextSpawn = performance.now() + randomDelay(1000, 9000);
    liegeStaff.targetIndex = null;
  } else {
    liegeStaff.x += (dx / dist) * step;
    liegeStaff.y += (dy / dist) * step;
  }
}

// --- Neu starten ---
function getResetButtonRect() {
  return { x: canvas.width - 132, y: 36, w: 120, h: 28 };
}

function resetGame() {
  if (!window.confirm('Wirklich neu starten? Der ganze Spielstand geht verloren!')) return;
  // Direkt im laufenden Zustand zurücksetzen, damit ein Spiel-Tick vor dem
  // Neuladen nicht wieder den alten Stand ins Cookie zurückschreibt.
  state.money = 0;
  state.owned = { liege: 1 };
  state.staffed = {};
  saveState();
  location.reload();
}

// --- Eingabe ---
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  // Shop-Buttons
  for (let i = 0; i < ITEM_TYPES.length; i++) {
    const item = ITEM_TYPES[i];
    const btn = getShopButtonRect(i);
    if (pointInRect(px, py, btn)) {
      handleShopTap(item, btn);
      return;
    }
  }

  // Neu-starten-Button
  if (pointInRect(px, py, getResetButtonRect())) {
    resetGame();
    return;
  }

  // Gewinn-Overlay wegtippen
  if (won === true) {
    won = 'dismissed';
    return;
  }

  // Steuerkreuz
  const dpadHit = hitDpad(px, py);
  if (dpadHit) {
    dpadDirection = dpadHit;
    dpadPointerId = e.pointerId;
    return;
  }

  // Sonst: Figur zum angetippten Ort auf dem Strand laufen lassen
  const shop = getShopRect();
  player.targetX = Math.min(Math.max(px, 20), canvas.width - 20);
  player.targetY = Math.min(Math.max(py, 50), shop.y - 20);
});

function handleShopTap(item) {
  if (!isOwned(item.id)) {
    if (state.money >= item.cost) {
      state.money -= item.cost;
      state.owned[item.id] = 1;
      ensureCustomerTimer(item.id, performance.now());
      saveState();
    }
  } else if (!isStaffed(item.id)) {
    if (state.money >= item.staffCost) {
      state.money -= item.staffCost;
      state.staffed[item.id] = true;
      saveState();
      checkWin();
    }
  }
}

// --- Spielschleife ---
let lastStaffTick = performance.now();
let lastFrame = performance.now();

function update(now) {
  const dt = now - lastFrame;
  lastFrame = now;

  if (now - lastStaffTick >= STAFF_TICK_MS) {
    lastStaffTick = now;
    let earned = false;
    for (const item of STAND_TYPES) {
      if (isOwned(item.id) && isStaffed(item.id)) {
        state.money += item.staffIncome;
        earned = true;
      }
    }
    if (earned) saveState();
  }

  // Kunden kommen von selbst zu unbesetzten Ständen
  for (const item of STAND_TYPES) {
    if (isOwned(item.id) && !isStaffed(item.id)) {
      ensureCustomerTimer(item.id, now);
      const c = customers[item.id];
      if (!c.waiting && now >= c.nextSpawn) c.waiting = true;
    }
  }

  // Kunden kommen von selbst zu sauberen, freien Liegen (nicht zu eingemüllten)
  for (const l of loungers) {
    if (!l.dirty && !l.waiting && now >= l.nextSpawn) l.waiting = true;
  }

  updatePlayer(dt);
  collectNearbyCustomers();
  collectNearbyLoungers();
  cleanNearbyLoungers();
  if (isStaffed('liege')) updateLiegeStaff(dt);

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
  ctx.fillStyle = '#2e86ab';
  ctx.fillRect(0, 0, canvas.width, 40);

  // Liegen (10 Stück)
  loungers.forEach((l, i) => {
    const slot = getLoungerRect(i);
    ctx.fillStyle = l.dirty ? '#8a7455' : LIEGE.color;
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 8);
    ctx.fill();

    const cx = slot.x + slot.w / 2;
    const cy = slot.y - 12;
    if (l.dirty) {
      ctx.font = `${Math.max(14, slot.w * 0.35)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🗑️', cx, cy);
    } else if (l.waiting) {
      ctx.font = `${Math.max(14, slot.w * 0.35)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🧍', cx, cy);
    }
  });

  // Liegen-Personal (eine Person, läuft sichtbar herum)
  if (isStaffed('liege') && liegeStaff.x !== null) {
    ctx.textAlign = 'center';
    ctx.beginPath();
    ctx.ellipse(liegeStaff.x, liegeStaff.y + 14, 14, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fill();
    ctx.font = '30px sans-serif';
    ctx.fillText('👷', liegeStaff.x, liegeStaff.y + 8);
  }

  // Andere Stände
  STAND_TYPES.forEach((item, i) => {
    if (!isOwned(item.id)) return;
    const slot = getStandSlotRect(i);
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 10);
    ctx.fill();
    ctx.fillStyle = '#1a2a3a';
    ctx.font = `${Math.max(12, slot.w * 0.14)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(item.name, slot.x + slot.w / 2, slot.y + slot.h + 18);
    if (isStaffed(item.id)) {
      ctx.font = `${Math.max(14, slot.w * 0.2)}px sans-serif`;
      ctx.fillText('👤', slot.x + slot.w / 2, slot.y + slot.h / 2 + 6);
    } else {
      const c = customers[item.id];
      const cx = slot.x + slot.w / 2;
      const cy = slot.y - 14;
      if (c && c.waiting) {
        ctx.font = `${Math.max(16, slot.w * 0.24)}px sans-serif`;
        ctx.fillText('🧍💰', cx, cy);
        ctx.fillStyle = '#1a2a3a';
        ctx.font = `${Math.max(10, slot.w * 0.1)}px sans-serif`;
        ctx.fillText('Abholen!', cx, cy + 16);
      } else {
        ctx.fillStyle = 'rgba(26, 42, 58, 0.5)';
        ctx.font = `${Math.max(10, slot.w * 0.1)}px sans-serif`;
        ctx.fillText('wartet auf Kunden…', cx, cy + 10);
      }
    }
  });

  // Popups
  ctx.textAlign = 'center';
  popups.forEach((p) => {
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(p.text, p.x, p.y);
    ctx.globalAlpha = 1;
  });

  // Spielfigur
  ctx.textAlign = 'center';
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + 16, 16, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fill();
  ctx.font = '34px sans-serif';
  ctx.fillText('🧑', player.x, player.y + 10);

  // Steuerkreuz
  const dpadRects = getDpadRects();
  Object.values(dpadRects).forEach((r) => {
    const active = dpadDirection && dpadDirection.key === r.key;
    ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.fillStyle = '#1a2a3a';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(r.symbol, r.x + r.w / 2, r.y + r.h / 2 + 8);
  });

  // Shop-Leiste
  const shop = getShopRect();
  ctx.fillStyle = '#12324a';
  ctx.fillRect(shop.x, shop.y, shop.w, shop.h);

  ITEM_TYPES.forEach((item, i) => {
    const btn = getShopButtonRect(i);
    const owned = isOwned(item.id);
    const staffed = isStaffed(item.id);

    ctx.fillStyle = staffed ? '#2f5d3a' : owned ? '#2a4a63' : '#1c3d54';
    ctx.beginPath();
    ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 10);
    ctx.fill();

    ctx.fillStyle = item.color;
    const iconSize = btn.h * 0.28;
    ctx.beginPath();
    ctx.roundRect(btn.x + btn.w / 2 - iconSize / 2, btn.y + 8, iconSize, iconSize, 6);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(11, btn.w * 0.09)}px sans-serif`;
    ctx.fillText(item.name, btn.x + btn.w / 2, btn.y + btn.h * 0.62);

    ctx.font = `${Math.max(11, btn.w * 0.085)}px sans-serif`;
    let label;
    if (staffed) label = '✓ Personal';
    else if (owned) label = `Personal: ${item.staffCost}€`;
    else label = `Kaufen: ${item.cost}€`;
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h * 0.85);
  });

  // HUD
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1a2a3a';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`💰 ${state.money}€`, 12, 28);

  ctx.textAlign = 'right';
  ctx.fillText(`${countUnlocked()}/${ITEM_TYPES.length} freigeschaltet`, canvas.width - 12, 28);

  // Neu-starten-Button
  const resetBtn = getResetButtonRect();
  ctx.fillStyle = 'rgba(26, 42, 58, 0.55)';
  ctx.beginPath();
  ctx.roundRect(resetBtn.x, resetBtn.y, resetBtn.w, resetBtn.h, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🔄 Neu starten', resetBtn.x + resetBtn.w / 2, resetBtn.y + resetBtn.h / 2 + 5);

  // Gewinn-Overlay
  if (won === true) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('🏆 Perfekter Beach Club!', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '20px sans-serif';
    ctx.fillText('Tippe oben, um weiterzuspielen', canvas.width / 2, canvas.height / 2 + 20);
  }
}

function loop(now) {
  update(now);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
