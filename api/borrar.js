// Borra un post ya publicado, en Instagram y en Facebook, buscándolo por el
// principio de su texto entre los últimos 25 de cada red.
//
// Dos pasos, porque no se puede deshacer:
//   /api/borrar?q=A throwback to Tokyo            → enseña qué borraría
//   /api/borrar?q=A throwback to Tokyo&confirmar=si → lo borra
//
// Facebook deja borrar por la API los posts de la Página. Instagram puede no
// dejarlo (depende de la versión de la API y del tipo de post): si se niega,
// se dice y hay que borrarlo a mano desde la app de Instagram.

import { conSesion, VERSION } from './_puerta.js';

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!(await conSesion(req))) return res.status(401).send('{"ok":false,"error":"sin sesión"}');
    const q = norm(req.query && req.query.q);
    if (q.length < 12) return res.status(400).send('{"ok":false,"error":"pon en ?q= al menos 12 letras del principio del texto"}');
    const confirmar = req.query.confirmar === 'si';
    const token = process.env.META_TOKEN, paginaId = process.env.FB_PAGE_ID, igId = process.env.IG_USER_ID;
    const api = (ruta, metodo = 'GET') => fetch(`https://graph.facebook.com/${VERSION}/${ruta}${ruta.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { method: metodo })
      .then((r) => r.json()).then((d) => { if (d.error) throw new Error(d.error.message); return d; });

    const ig = (await api(`${igId}/media?fields=id,caption,permalink,timestamp&limit=25`)).data || [];
    const fb = (await api(`${paginaId}/posts?fields=id,message,permalink_url,created_time&limit=25`)).data || [];
    const encontrados = [
      ...ig.filter((m) => norm(m.caption).startsWith(q)).map((m) => ({ red: 'ig', id: m.id, url: m.permalink, fecha: m.timestamp, texto: String(m.caption).slice(0, 80) })),
      ...fb.filter((m) => norm(m.message).startsWith(q)).map((m) => ({ red: 'fb', id: m.id, url: m.permalink_url, fecha: m.created_time, texto: String(m.message).slice(0, 80) })),
    ];
    if (!confirmar) return res.send(JSON.stringify({ ok: true, borraria: encontrados, siguiente: encontrados.length ? 'añade &confirmar=si a la dirección para borrarlo' : 'no encuentro nada con ese texto' }, null, 1));

    for (const e of encontrados) {
      try { await api(e.id, 'DELETE'); e.estado = 'borrado'; }
      catch (err) { e.estado = 'no se pudo'; e.error = err.message; }
    }
    res.send(JSON.stringify({ ok: encontrados.every((e) => e.estado === 'borrado'), resultado: encontrados }, null, 1));
  } catch (err) {
    res.status(500).send(JSON.stringify({ ok: false, error: err.message }));
  }
}
