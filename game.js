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
  { id: 'liege', name: 'Liegestuhl', cost: 10, tapIncome: 1, staffCost: 50, staffIncome: 1, color: '#e8b04b' },
  { id: 'schirm', name: 'Sonnenschirm', cost: 25, tapIncome: 2, staffCost: 100, staffIncome: 2, color: '#e05c5c' },
  { id: 'eisstand', name: 'Eisstand', cost: 60, tapIncome: 4, staffCost: 200, staffIncome: 4, color: '#7ec8e3' },
  { id: 'getraenke', name: 'Getränkebude', cost: 120, tapIncome: 7, staffCost: 400, staffIncome: 7, color: '#5cb85c' },
  { id: 'snackbar', name: 'Snackbar', cost: 250, tapIncome: 12, staffCost: 800, staffIncome: 12, color: '#f0a500' },
  { id: 'pool', name: 'Pool', cost: 500, tapIncome: 20, staffCost: 1500, staffIncome: 20, color: '#2e86ab' },
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

ITEM_TYPES.forEach((item) => {
  if (isOwned(item.id) && !isStaffed(item.id)) ensureCustomerTimer(item.id, performance.now());
});

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

function getBeachSlotRect(index) {
  const shop = getShopRect();
  const beachH = shop.y;
  const cols = 3;
  const rows = 2;
  const sw = canvas.width / cols;
  const sh = (beachH - 60) / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const size = Math.min(sw, sh) * 0.6;
  return {
    x: col * sw + sw / 2 - size / 2,
    y: 60 + row * sh + sh / 2 - size / 2,
    w: size,
    h: size,
  };
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

  // Strand-Slots antippen: Geld nur abholen, wenn ein Kunde da ist
  for (let i = 0; i < ITEM_TYPES.length; i++) {
    const item = ITEM_TYPES[i];
    if (!isOwned(item.id) || isStaffed(item.id)) continue;
    const slot = getBeachSlotRect(i);
    if (pointInRect(px, py, slot)) {
      const c = customers[item.id];
      if (c && c.waiting) {
        state.money += item.tapIncome;
        c.waiting = false;
        c.nextSpawn = performance.now() + randomDelay(1000, 9000);
        addPopup(slot.x + slot.w / 2, slot.y, `+${item.tapIncome}€`);
        saveState();
      }
      return;
    }
  }

  // Gewinn-Overlay wegtippen
  if (won && py < canvas.height * 0.5) {
    won = 'dismissed';
  }
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
    for (const item of ITEM_TYPES) {
      if (isOwned(item.id) && isStaffed(item.id)) {
        state.money += item.staffIncome;
        earned = true;
      }
    }
    if (earned) saveState();
  }

  // Kunden kommen von selbst zu unbesetzten Ständen
  for (const item of ITEM_TYPES) {
    if (isOwned(item.id) && !isStaffed(item.id)) {
      ensureCustomerTimer(item.id, now);
      const c = customers[item.id];
      if (!c.waiting && now >= c.nextSpawn) c.waiting = true;
    }
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
  ctx.fillStyle = '#2e86ab';
  ctx.fillRect(0, 0, canvas.width, 40);

  // Aufgestellte Sachen
  ITEM_TYPES.forEach((item, i) => {
    if (!isOwned(item.id)) return;
    const slot = getBeachSlotRect(i);
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
