const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Cookie-Speicher fürs Spiel (kein Server, alles lokal) ---
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// Testet, ob das Speichern klappt: Geld-Zähler, der über Seiten-Neuladen bestehen bleibt
let geld = parseInt(getCookie('geld'), 10) || 0;

function speichern() {
  setCookie('geld', geld, 365);
}

canvas.addEventListener('pointerdown', () => {
  geld += 1;
  speichern();
  draw();
});

function draw() {
  ctx.fillStyle = '#f2d29b'; // Sand
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#2e86ab'; // Meer
  ctx.fillRect(0, 0, canvas.width, canvas.height * 0.3);

  ctx.fillStyle = '#1a2a3a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('Hallo Beach Tycoon!', canvas.width / 2, canvas.height * 0.55);

  ctx.font = '28px sans-serif';
  ctx.fillText(`Geld: ${geld} €`, canvas.width / 2, canvas.height * 0.65);

  ctx.font = '18px sans-serif';
  ctx.fillText('Tippe irgendwo hin, um Geld zu verdienen', canvas.width / 2, canvas.height * 0.72);
}

draw();
