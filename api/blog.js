// Publica en festivaladar.com un artículo del blog que estaba en borrador.
//
// POST /api/blog { slug, accion: 'publicar' }
//
// Cambia `status: draft` por `status: publish` (y la fecha por la de hoy) en
// gaawi/adar, src/content/blog/es/<slug>.md. La rama main de ese repositorio
// es la web, así que en un par de minutos el artículo está en línea. Solo
// publica: despublicar se hace a mano, que deshacer lo publicado se pregunta.

import { conSesion } from './_puerta.js';
import { credencial, cambiarTexto } from './_gh.js';

const WEB = 'gaawi/adar';

export default async function handler(req, res) {
  try {
    if (!(await conSesion(req))) return res.status(401).json({ error: 'Sin sesión.', entrar: true });
    const yo = credencial(req);
    if (!yo) return res.status(401).json({ error: 'Entra otra vez para poder guardar desde aquí.', entrar: true });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST.' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(b.slug || '');
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Artículo no válido.' });
    if (b.accion !== 'publicar') return res.status(400).json({ error: 'Acción no válida.' });

    const hoy = new Date().toISOString();
    let estaba = '';
    await cambiarTexto(yo.token, WEB, `src/content/blog/es/${slug}.md`, (t) => {
      const m = t.match(/^---\n([\s\S]*?)\n---/);
      if (!m) throw new Error('El artículo no tiene cabecera.');
      estaba = (m[1].match(/^status:\s*"?(\w+)"?/m) || [])[1] || '';
      if (estaba === 'publish') return false;
      const cab = m[1]
        .replace(/^status:.*$/m, 'status: publish')
        .replace(/^date:.*$/m, `date: "${hoy}"`);
      return t.replace(m[1], cab);
    }, `Blog: publicado «${slug}» desde la app (${yo.login})`);
    return res.status(200).json({ ok: true, slug, yaEstaba: estaba === 'publish', url: `https://festivaladar.com/es/blog/${slug}/` });
  } catch (e) {
    return res.status(e.codigo || 500).json({ error: e.message || 'No se pudo publicar.' });
  }
}
