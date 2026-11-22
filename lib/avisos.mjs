// Avisos al móvil (notificaciones push de la app instalada).
//
// No hacen falta secretos nuevos: las claves VAPID y la llave que cifra las
// suscripciones se derivan de META_TOKEN, que ya está en Vercel (la app) y en
// GitHub (el publicador). Si un día cambia el token, cambian las claves y la
// app vuelve a pedir permiso sola al abrirse.
//
// Las suscripciones viven en datos/avisos.json, cifradas: el repositorio es
// público y una suscripción no debe leerse.
//
// api/_avisos.js es una copia de este archivo: si cambia uno, el otro.

import webpush from 'web-push';
import { createHash, createECDH, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const derivar = (que, env) => createHash('sha256').update(`editorial-cola:${que}:${env.META_TOKEN}`).digest();

/** Las claves VAPID ({ publica, privada } en base64url), o null sin META_TOKEN. */
export function claves(env = process.env) {
  if (!env.META_TOKEN) return null;
  const privada = derivar('vapid', env);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privada);
  return { publica: b64u(ecdh.getPublicKey()), privada: b64u(privada) };
}

export function sellar(obj, env = process.env) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', derivar('avisos', env), iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return b64u(Buffer.concat([iv, datos, c.getAuthTag()]));
}

export function abrir(txt, env = process.env) {
  try {
    const b = Buffer.from(txt, 'base64url');
    const d = createDecipheriv('aes-256-gcm', derivar('avisos', env), b.subarray(0, 12));
    d.setAuthTag(b.subarray(b.length - 16));
    return JSON.parse(Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8'));
  } catch { return null; }
}

/** Un identificador corto de la suscripción (para sustituirla o borrarla). */
export const idDe = (sub) => createHash('sha256').update(String(sub.endpoint)).digest('hex').slice(0, 16);

/**
 * Manda un aviso a todas las suscripciones de `lista` (datos/avisos.json →
 * suscripciones). Devuelve los id que ya no valen (el móvil la borró).
 */
export async function avisar(lista, { titulo, texto = '', url = '/' }, env = process.env) {
  const k = claves(env);
  if (!k || !lista || !lista.length) return { enviados: 0, muertos: [] };
  const opciones = { vapidDetails: { subject: 'https://editorial-cola.vercel.app', publicKey: k.publica, privateKey: k.privada }, TTL: 6 * 3600 };
  const muertos = [];
  let enviados = 0;
  for (const s of lista) {
    const sub = abrir(s.sello, env);
    if (!sub) { muertos.push(s.id); continue; }
    try {
      await webpush.sendNotification(sub, JSON.stringify({ titulo, texto, url }), opciones);
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410 || e.statusCode === 403) muertos.push(s.id);
    }
  }
  return { enviados, muertos };
}
