#!/usr/bin/env node
// Trae todo lo publicado en una cuenta (Instagram y Facebook) y lo deja en
// datos/historico-<marca>.json, con una miniatura de 320×320 por post de
// Instagram en datos/miniaturas/. La app lo enseña en «Publicado» y en el
// calendario; el check lo lee para no repetirse y ver qué funcionó.
//
// Lo ejecuta la Action «Historial» (necesita los secretos de la marca).
//   node herramientas/historico.mjs adar
//
// Las historias: la API solo da las que están vivas (últimas 24 h). Se
// guardan las que haya; las antiguas no se pueden leer por la API.

import { writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from '../lib/meta.mjs';
import { credenciales, MARCAS } from '../lib/cuentas.mjs';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const marca = process.argv[2] || 'adar';
if (!MARCAS[marca]) throw new Error(`Marca desconocida: ${marca}`);
const { token, paginaId, igId } = credenciales(marca);
if (!token || !paginaId || !igId) { console.log(`Faltan los secretos de ${MARCAS[marca].nombre}.`); process.exit(1); }

/** Todas las páginas de una lista de la Graph API. */
async function todo(ruta, params) {
  const fuera = [];
  let d = await graph(ruta, { params: { ...params, limit: 50 }, token });
  for (;;) {
    fuera.push(...(d.data || []));
    const sig = d.paging && d.paging.next;
    if (!sig) break;
    const r = await fetch(sig);
    d = await r.json();
    if (d.error) throw new Error(d.error.message);
  }
  return fuera;
}

const TIPOS = { IMAGE: 'imagen', VIDEO: 'vídeo', CAROUSEL_ALBUM: 'carrusel' };
const dia = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
const tema = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 140);

const cuenta = await graph(`/${igId}`, { params: { fields: 'username,followers_count,media_count' }, token });
const media = await todo(`/${igId}/media`, {
  fields: 'id,caption,permalink,timestamp,media_type,media_product_type,media_url,thumbnail_url,like_count,comments_count',
});
console.log(`Instagram @${cuenta.username}: ${media.length} publicaciones.`);

// Alcance y vistas: no todas las publicaciones los dan (las muy antiguas o
// las de antes de pasar a cuenta profesional fallan). Se intenta y ya.
async function numeros(m) {
  try {
    const d = await graph(`/${m.id}/insights`, { params: { metric: 'reach,views' }, token });
    const v = Object.fromEntries((d.data || []).map((x) => [x.name, x.values?.[0]?.value ?? x.total_value?.value ?? 0]));
    return [v.reach || 0, v.views || 0];
  } catch { return [0, 0]; }
}

await mkdir(join(AQUI, 'datos', 'miniaturas'), { recursive: true });
const posts = [];
const textos = {};
for (const m of media) {
  const fecha = dia(m.timestamp);
  const [alcance, vistas] = await numeros(m);
  const tipo = m.media_product_type === 'REELS' ? 'reel' : (TIPOS[m.media_type] || m.media_type.toLowerCase());
  posts.push([fecha, m.permalink, tipo, m.like_count || 0, alcance, vistas, tema(m.caption)]);
  textos[m.permalink] = { texto: m.caption || '', comentarios: m.comments_count || 0, hora: m.timestamp };
  // La miniatura, con el mismo nombre que usa la app.
  const code = m.permalink.replace(/\/$/, '').split('/').pop();
  const f = join(AQUI, 'datos', 'miniaturas', `${fecha.replace(/-/g, '')}-${code}.jpg`);
  try { await access(f); continue; } catch {}
  const src = m.thumbnail_url || m.media_url;
  if (!src) continue;
  try {
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    const tmp = f + '.orig';
    await writeFile(tmp, buf);
    execFileSync('convert', [tmp, '-resize', '320x320^', '-gravity', 'center', '-extent', '320x320', '-quality', '78', f]);
    execFileSync('rm', [tmp]);
  } catch (e) { console.log(`  sin miniatura ${m.permalink}: ${e.message}`); }
}

let historias = [];
try {
  historias = (await todo(`/${igId}/stories`, { fields: 'id,permalink,timestamp,media_type' }))
    .map((s) => [dia(s.timestamp), s.permalink, s.media_type]);
} catch (e) { console.log('Historias: ' + e.message); }

const pagina = await graph(`/${paginaId}`, { params: { fields: 'name,fan_count,followers_count' }, token });
let facebook = [];
try {
  facebook = (await todo(`/${paginaId}/posts`, { fields: 'id,message,permalink_url,created_time,full_picture' }))
    .map((p) => ({ fecha: dia(p.created_time), url: p.permalink_url, texto: p.message || '', imagen: p.full_picture || '' }));
} catch (e) { console.log('Facebook: ' + e.message); }
console.log(`Facebook «${pagina.name}»: ${facebook.length} publicaciones. Historias vivas: ${historias.length}.`);

posts.sort((a, b) => b[0].localeCompare(a[0]));
await writeFile(join(AQUI, 'datos', `historico-${marca}.json`), JSON.stringify({
  _ayuda: 'Lo ya publicado, sacado de la Graph API con herramientas/historico.mjs. posts: Instagram (columnas abajo); textos: el pie entero de cada uno; facebook: los posts de la Página; historias: solo las vivas al sacarlo.',
  cuenta: cuenta.username,
  seguidores: { instagram: cuenta.followers_count, facebook: pagina.followers_count ?? pagina.fan_count },
  pagina: pagina.name,
  obtenido: new Date().toISOString().slice(0, 10),
  columnas: ['fecha', 'url', 'tipo', 'likes', 'alcance', 'vistas', 'tema'],
  posts,
  textos,
  historias,
  facebook,
}, null, 1) + '\n');
console.log(`Guardado datos/historico-${marca}.json`);
