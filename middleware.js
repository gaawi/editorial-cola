// Edge Middleware de Vercel: la puerta de la app.
//
// El repositorio es privado, pero una web desplegada es pública si no se
// cierra: sin esto, cualquiera con la URL leería los borradores. Solo deja
// pasar a quien tenga la cookie `cola_preview`, que crea /api/callback al
// entrar con GitHub, y solo si la cuenta puede escribir en el repositorio o
// está en COLA_LOGINS.
// La cookie va firmada con HMAC-SHA256 usando GITHUB_CLIENT_SECRET, así que
// no se puede falsificar desde el navegador.
//
// Si no hay sesión, redirige al panel en vez de mostrar un error.

export const config = {
  // Todo menos la puerta y el relevo de OAuth. Los datos también: son los
  // borradores, y es justo lo que no puede quedar abierto.
  matcher: ['/', '/index.html', '/app.js', '/motor.js', '/estilo.css', '/datos/:path*', '/aprobaciones.json'],
};

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Comparación en tiempo constante, para no filtrar información por el tiempo.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function isValid(cookieValue, secret) {
  if (!cookieValue || !secret) return false;
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 1) return false;
  const exp = cookieValue.slice(0, dot);
  const sigHex = cookieValue.slice(dot + 1);
  if (!/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sigHex)) return false;
  if (Number(exp) < Date.now()) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('preview:' + exp))
  );
  return timingSafeEqual(expected, hexToBytes(sigHex));
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)cola_preview=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : '';

  if (await isValid(value, process.env.GITHUB_CLIENT_SECRET)) {
    return; // sesión válida: sigue hasta la página estática
  }

  // Sin sesión: a la puerta.
  return Response.redirect(new URL('/entrar.html', url), 302);
}
