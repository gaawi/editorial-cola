// Comprueba que las variables de Meta que hay en Vercel sirven: con el token
// de la Página pregunta a Meta por la Página y por su Instagram, y lo enseña.
// No publica nada.

import { conSesion, VERSION } from './_puerta.js';
import { credenciales, variables, MARCAS } from './_cuentas.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!(await conSesion(req))) return res.status(401).send(JSON.stringify({ ok: false, error: 'not signed in' }));

  // ?resumen=1: solo qué marcas tienen sus variables puestas (para la entrada
  // de la app). No llama a Meta ni enseña ningún valor.
  if ((req.query || {}).resumen) {
    return res.send(JSON.stringify(Object.fromEntries(Object.keys(MARCAS).map((m) =>
      [m, Object.values(variables(m)).every((k) => process.env[k])]))));
  }
  // ?marca=adar mira las de Festival ADAR; sin ella, las de CreArtBox.
  const marca = MARCAS[(req.query || {}).marca] ? req.query.marca : 'creartbox';
  const { token, paginaId: pagina, igId: ig } = credenciales(marca);
  const falta = Object.values(variables(marca)).filter((k) => !process.env[k]);
  if (falta.length) return res.send(JSON.stringify({ ok: false, faltan: falta }, null, 1));

  // ?publicado=ig|fb: what is already published, with its live counters
  // (likes, comments, shares), for the «Published» feed. ?despues= pages on.
  if ((req.query || {}).publicado) {
    try { return res.send(JSON.stringify(await publicado(req.query.publicado, { token, pagina, ig, despues: req.query.despues }))); }
    catch (e) { return res.status(502).send(JSON.stringify({ ok: false, error: e.message })); }
  }

  const g = async (ruta, campos) => {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${ruta}?fields=${campos}&access_token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    if (d.error) throw new Error(d.error.message);
    return d;
  };
  try {
    const p = await g(pagina, 'name,fan_count,instagram_business_account{id,username,followers_count}');
    const i = await g(ig, 'username,followers_count,media_count');
    res.send(JSON.stringify({
      ok: true,
      marca: MARCAS[marca].nombre,
      pagina: { nombre: p.name, seguidores: p.fan_count, id: pagina },
      instagram: { usuario: '@' + i.username, id: ig, seguidores: i.followers_count, publicaciones: i.media_count },
      coinciden: p.instagram_business_account ? p.instagram_business_account.id === ig : false,
    }, null, 1));
  } catch (e) {
    res.send(JSON.stringify({ ok: false, error: e.message }, null, 1));
  }
}

async function graph(ruta, params, token) {
  const q = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${ruta}?${q}`);
  const d = await r.json().catch(() => ({}));
  if (d.error) throw new Error(d.error.message);
  return d;
}

async function publicado(red, { token, pagina, ig, despues }) {
  const limite = 12;
  if (red === 'fb') {
    const d = await graph(`${pagina}/posts`, {
      fields: 'id,message,created_time,permalink_url,full_picture,attachments{media_type,media,subattachments.limit(10){media}},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
      limit: String(limite), ...(despues ? { after: despues } : {}),
    }, token);
    return { ok: true, despues: d.paging?.next ? d.paging.cursors?.after : null, posts: (d.data || []).map((x) => {
      const a = x.attachments?.data?.[0];
      const sub = a?.subattachments?.data?.map((s) => s.media?.image?.src).filter(Boolean) || [];
      return { id: x.id, url: x.permalink_url, hora: x.created_time, texto: x.message || '',
        imagenes: sub.length ? sub : [a?.media?.image?.src || x.full_picture].filter(Boolean),
        video: a?.media_type === 'video', likes: x.reactions?.summary?.total_count || 0,
        comentarios: x.comments?.summary?.total_count || 0, compartidos: x.shares?.count || 0 };
    }) };
  }
  const d = await graph(`${ig}/media`, {
    fields: 'id,caption,permalink,timestamp,media_type,media_product_type,media_url,thumbnail_url,like_count,comments_count,children{media_type,media_url,thumbnail_url}',
    limit: String(limite), ...(despues ? { after: despues } : {}),
  }, token);
  const posts = await Promise.all((d.data || []).map(async (m) => {
    // Shares and saves only come from insights, one call per post.
    let compartidos = null, guardados = null;
    try {
      const i = await graph(`${m.id}/insights`, { metric: 'shares,saved' }, token);
      for (const x of i.data || []) {
        const v = x.values?.[0]?.value ?? x.total_value?.value ?? 0;
        if (x.name === 'shares') compartidos = v; else guardados = v;
      }
    } catch { /* older posts have no insights */ }
    const hijos = m.children?.data || [];
    const img = (x) => (x.media_type === 'VIDEO' ? x.thumbnail_url : x.media_url);
    return { id: m.id, url: m.permalink, hora: m.timestamp, texto: m.caption || '',
      tipo: m.media_product_type === 'REELS' ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carrusel' : m.media_type === 'VIDEO' ? 'video' : 'imagen',
      imagenes: (hijos.length ? hijos.map(img) : [img(m)]).filter(Boolean),
      likes: m.like_count || 0, comentarios: m.comments_count || 0, compartidos, guardados };
  }));
  return { ok: true, despues: d.paging?.next ? d.paging.cursors?.after : null, posts };
}
