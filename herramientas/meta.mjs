#!/usr/bin/env node
// Para que Claude hable con Meta desde la sesión, sin ver el token: el entorno
// en la nube añade «Authorization: Bearer …» a lo que va a graph.facebook.com.
// Si hay META_TOKEN en el entorno (GitHub Actions, uso local), se usa ese.
//
//   node herramientas/meta.mjs estado
//   node herramientas/meta.mjs buscar "A throwback to Tokyo"
//   node herramientas/meta.mjs borrar "A throwback to Tokyo" --si
//   node herramientas/meta.mjs stats [n]          los últimos n posts de Instagram

import { graph } from '../lib/meta.mjs';

// Los IDs no son secretos: la Página CreArtBox y su Instagram @creartboxnyc.
export const FB_PAGE_ID = process.env.FB_PAGE_ID || '473145069546753';
export const IG_USER_ID = process.env.IG_USER_ID || '17841404259739766';
const token = process.env.META_TOKEN || undefined;
const g = (ruta, params = {}, metodo = 'GET') => graph(ruta, { params, token, metodo });
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

const [orden, arg, ...resto] = process.argv.slice(2);

async function buscar(q) {
  q = norm(q);
  const ig = (await g(`/${IG_USER_ID}/media`, { fields: 'id,caption,permalink,timestamp', limit: 25 })).data || [];
  const fb = (await g(`/${FB_PAGE_ID}/posts`, { fields: 'id,message,permalink_url,created_time', limit: 25 })).data || [];
  return [
    ...ig.filter((m) => norm(m.caption).startsWith(q)).map((m) => ({ red: 'ig', id: m.id, url: m.permalink, fecha: m.timestamp })),
    ...fb.filter((m) => norm(m.message).startsWith(q)).map((m) => ({ red: 'fb', id: m.id, url: m.permalink_url, fecha: m.created_time })),
  ];
}

if (orden === 'estado') {
  const p = await g(`/${FB_PAGE_ID}`, { fields: 'name,fan_count' });
  const i = await g(`/${IG_USER_ID}`, { fields: 'username,followers_count,media_count' });
  console.log(`Página «${p.name}» (${p.fan_count} seguidores) · Instagram @${i.username} (${i.followers_count} seguidores, ${i.media_count} posts)`);
} else if (orden === 'buscar') {
  console.log(JSON.stringify(await buscar(arg), null, 1));
} else if (orden === 'borrar') {
  const hits = await buscar(arg);
  if (!resto.includes('--si')) { console.log('Borraría (añade --si):', JSON.stringify(hits, null, 1)); process.exit(0); }
  for (const h of hits) {
    try { await g(`/${h.id}`, {}, 'DELETE'); console.log(`✓ borrado ${h.red} ${h.url}`); }
    catch (e) { console.log(`✗ ${h.red} ${h.url}: ${e.message}`); }
  }
} else if (orden === 'stats') {
  const n = Number(arg) || 10;
  const media = (await g(`/${IG_USER_ID}/media`, { fields: 'id,caption,permalink,timestamp,like_count,comments_count,media_type', limit: n })).data || [];
  for (const m of media) {
    let ins = {};
    try {
      const r = await g(`/${m.id}/insights`, { metric: 'reach,views,saved,shares' });
      for (const x of r.data || []) ins[x.name] = x.values?.[0]?.value ?? x.total_value?.value;
    } catch {}
    console.log([m.timestamp.slice(0, 10), String(m.caption || '').split('\n')[0].slice(0, 45), `alcance ${ins.reach ?? '?'}`, `vistas ${ins.views ?? '?'}`, `♥ ${m.like_count}`, `💬 ${m.comments_count}`, `guardados ${ins.saved ?? '?'}`, `compartidos ${ins.shares ?? '?'}`].join(' · '));
  }
} else {
  console.log('Órdenes: estado · buscar "texto" · borrar "texto" [--si] · stats [n]');
}
