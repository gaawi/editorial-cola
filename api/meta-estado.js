// Comprueba que las variables de Meta que hay en Vercel sirven: con el token
// de la Página pregunta a Meta por la Página y por su Instagram, y lo enseña.
// No publica nada.

import { conSesion, VERSION } from './_puerta.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!(await conSesion(req))) return res.status(401).send(JSON.stringify({ ok: false, error: 'sin sesión' }));

  const token = process.env.META_TOKEN;
  const pagina = process.env.FB_PAGE_ID;
  const ig = process.env.IG_USER_ID;
  const falta = ['META_TOKEN', 'FB_PAGE_ID', 'IG_USER_ID'].filter((k) => !process.env[k]);
  if (falta.length) return res.send(JSON.stringify({ ok: false, faltan: falta }, null, 1));

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
      pagina: { nombre: p.name, seguidores: p.fan_count },
      instagram: { usuario: '@' + i.username, seguidores: i.followers_count, publicaciones: i.media_count },
      coinciden: p.instagram_business_account ? p.instagram_business_account.id === ig : false,
    }, null, 1));
  } catch (e) {
    res.send(JSON.stringify({ ok: false, error: e.message }, null, 1));
  }
}
