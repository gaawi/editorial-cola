// Trae una foto de otra web para subirla desde la app: el navegador no puede
// leerla por CORS. Devuelve la imagen tal cual; la app la reduce y la sube.
// GET /api/traer?url=https://…
import { conSesion } from './_puerta.js';

const MAX = 4 * 1024 * 1024; // lo que deja devolver Vercel

function privada(host) {
  return /^(localhost|.*\.local|.*\.internal)$/i.test(host)
    || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');
}

export default async function handler(req, res) {
  try {
    if (!(await conSesion(req))) return res.status(401).json({ error: 'Sin sesión.', entrar: true });
    const u = new URL(String(req.query.url || ''));
    if (u.protocol !== 'https:' || privada(u.hostname)) return res.status(400).json({ error: 'Esa dirección no vale.' });
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (editorial-cola)' }, redirect: 'follow' });
    if (!r.ok) return res.status(502).json({ error: `La web respondió ${r.status}.` });
    const tipo = r.headers.get('content-type') || '';
    if (!/^image\//.test(tipo)) return res.status(400).json({ error: 'Esa dirección no es una imagen.' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) return res.status(413).json({ error: 'La imagen pesa más de 4 MB. Descárgala y súbela desde el móvil.' });
    res.setHeader('Content-Type', tipo);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo traer esa imagen.' });
  }
}
