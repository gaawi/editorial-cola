// Publica ya lo que toca de la cola («vía app»), con el token de Meta que está
// en Vercel. Es el mismo trabajo que hace GitHub Actions cada 10 minutos, pero
// a demanda: sirve para probar y para cuando algo tiene que salir en el acto.
//
// No escribe en el repositorio (una función de Vercel no puede), así que antes
// de publicar mira lo último que hay en Instagram y en Facebook: si ya hay un
// post con el mismo texto, no lo repite. Abrir el enlace dos veces no duplica.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conSesion, VERSION } from './_puerta.js';
import { publicarInstagram, publicarFacebook } from './_meta.js';

const recorte = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);

async function yaEsta(red, texto, token, igId, paginaId) {
  const ruta = red === 'ig'
    ? `${igId}/media?fields=caption,permalink&limit=10`
    : `${paginaId}/posts?fields=message,permalink_url&limit=10`;
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${ruta}&access_token=${encodeURIComponent(token)}`);
  const d = await r.json().catch(() => ({}));
  const buscado = recorte(texto);
  const hit = (d.data || []).find((x) => recorte(x.caption || x.message) === buscado);
  return hit ? (hit.permalink || hit.permalink_url) : null;
}

export default async function handler(req, res) {
  try { await publicar(req, res); }
  catch (err) { res.status(500).send(JSON.stringify({ ok: false, error: err.message })); }
}

async function publicar(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!(await conSesion(req))) return res.status(401).send('{"ok":false,"error":"sin sesión"}');

  const token = process.env.META_TOKEN, paginaId = process.env.FB_PAGE_ID, igId = process.env.IG_USER_ID;
  const cola = JSON.parse(await readFile(join(process.cwd(), 'datos', 'programado.json'), 'utf8'));
  const ahora = Date.now();
  const hecho = [];
  for (const [clave, e] of Object.entries(cola.posts || {})) {
    for (const r of e.redes || []) {
      if (r.via !== 'meta' || r.estado !== 'en cola' || new Date(r.cuando).getTime() > ahora) continue;
      const fila = { clave, red: r.red };
      try {
        const previo = e.tipo === 'historia' ? null : await yaEsta(r.red, r.texto, token, igId, paginaId);
        if (previo) { fila.estado = 'ya estaba'; fila.url = previo; hecho.push(fila); continue; }
        let res2;
        if (r.red === 'ig') {
          try {
            res2 = await publicarInstagram({ igId, token, texto: r.texto, imagen: r.imagenes, historia: e.tipo === 'historia', colaboradores: r.colaboradores || [] });
          } catch (err) {
            // Si lo que falla es la invitación al colaborador, sale sin ella.
            if (!(r.colaboradores || []).length) throw err;
            res2 = await publicarInstagram({ igId, token, texto: r.texto, imagen: r.imagenes, historia: e.tipo === 'historia' });
            fila.aviso = 'Sin colaborador: ' + err.message;
          }
        } else {
          res2 = await publicarFacebook({ paginaId, token, texto: r.texto, imagen: r.imagenes });
        }
        fila.estado = 'publicado';
        fila.url = res2.enlace;
      } catch (err) {
        fila.estado = 'error';
        fila.error = err.message;
      }
      hecho.push(fila);
    }
  }
  res.send(JSON.stringify({ ok: hecho.every((f) => f.estado !== 'error'), publicados: hecho.length ? hecho : 'nada que toque ahora' }, null, 1));
}
