// Lo que la app escribe en el repositorio, desde el servidor.
//
// Al entrar con GitHub, /api/callback deja el token en una cookie cifrada
// (AES-256-GCM con una clave sacada de GITHUB_CLIENT_SECRET) y HttpOnly: el
// navegador la lleva pero no la puede leer. Así lo decidido se guarda en el
// repositorio y se ve igual en el iPhone y en el ordenador.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const REPO = process.env.GITHUB_REPO || 'gaawi/editorial-cola';
export const RAMA = 'main';

function clave() {
  return createHash('sha256').update('cola-gh:' + (process.env.GITHUB_CLIENT_SECRET || '')).digest();
}

export function sellar(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), datos]).toString('base64url');
}

export function abrirSello(txt) {
  try {
    const b = Buffer.from(txt, 'base64url');
    const d = createDecipheriv('aes-256-gcm', clave(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}

/** { token, login } de la cookie, o null si no hay o no vale. */
export function credencial(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)cola_gh=([^;]+)/);
  if (!m) return null;
  const c = abrirSello(decodeURIComponent(m[1]));
  return c && c.token ? c : null;
}

async function gh(token, ruta, opciones = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'editorial-cola',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return r;
}

/** Lee un JSON del repositorio: { datos, sha }. Si no existe, datos = vacio. */
export async function leerJSON(token, ruta, vacio) {
  const r = await gh(token, `/contents/${ruta}?ref=${RAMA}`);
  if (r.status === 404) return { datos: vacio, sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status} al leer ${ruta}`);
  const j = await r.json();
  return { datos: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}

/** Escribe un archivo (texto o Buffer). Devuelve true, o 'choque' si el sha ya no vale. */
export async function escribir(token, ruta, contenido, sha, mensaje) {
  const b64 = Buffer.isBuffer(contenido) ? contenido.toString('base64') : Buffer.from(contenido, 'utf8').toString('base64');
  const r = await gh(token, `/contents/${ruta}`, {
    method: 'PUT',
    body: JSON.stringify({ message: mensaje, content: b64, branch: RAMA, ...(sha ? { sha } : {}) }),
  });
  if (r.status === 409 || r.status === 422) return 'choque';
  if (!r.ok) throw new Error(`GitHub ${r.status} al escribir ${ruta}`);
  return true;
}

/**
 * Leer, cambiar y escribir, con reintento si otro (la cola de las 10 en
 * punto, el otro dispositivo) escribió a la vez. `cambiar` recibe los datos y
 * los modifica; si devuelve false, no se escribe nada.
 */
export async function cambiarJSON(token, ruta, vacio, cambiar, mensaje) {
  for (let i = 0; i < 4; i++) {
    const { datos, sha } = await leerJSON(token, ruta, vacio);
    const r = await cambiar(datos);
    if (r === false) return datos;
    const hecho = await escribir(token, ruta, JSON.stringify(datos, null, 1) + '\n', sha, mensaje);
    if (hecho === true) return datos;
  }
  throw new Error('Otro guardado se cruzó cuatro veces seguidas. Inténtalo otra vez.');
}

export const RAW = `https://raw.githubusercontent.com/${REPO}/${RAMA}/`;
