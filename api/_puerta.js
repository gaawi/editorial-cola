// La misma comprobación que middleware.js, para las funciones de /api, que la
// puerta deja pasar sin mirar: aquí sí hace falta haber entrado.

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function conSesion(req) {
  const secret = process.env.GITHUB_CLIENT_SECRET;
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)cola_preview=([^;]+)/);
  const valor = m ? decodeURIComponent(m[1]) : '';
  const dot = valor.lastIndexOf('.');
  if (!secret || dot < 1) return false;
  const exp = valor.slice(0, dot);
  const firma = valor.slice(dot + 1);
  if (!/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(firma) || Number(exp) < Date.now()) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperada = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('preview:' + exp)));
  const dada = hexToBytes(firma);
  if (dada.length !== esperada.length) return false;
  let diff = 0;
  for (let i = 0; i < dada.length; i++) diff |= dada[i] ^ esperada[i];
  return diff === 0;
}

export const VERSION = process.env.META_API_VERSION || 'v26.0';
// El ID de la app de Meta no es secreto: va en la URL que ve el navegador.
export const APP_ID = process.env.META_APP_ID || '2088120061814589';
// La configuración de «Facebook Login for Business» («Editorial publicar»): diez
// permisos de publicar, leer, estadísticas y comentarios. Tampoco es secreta.
export const CONFIG_ID = process.env.META_CONFIG_ID || '1395133849081561';

export function urlVuelta(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/api/meta-vuelta`;
}
