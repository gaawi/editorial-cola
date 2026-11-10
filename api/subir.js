// Subir una foto desde la app: llega en JPEG (la app ya la ha reducido a
// 2048 px) y se guarda en imagenes/subidas/, que es pública y sirve a Meta.
// POST {datos: base64} → { url }
import { conSesion } from './_puerta.js';
import { credencial, escribir, RAW } from './_gh.js';
import { randomBytes } from 'node:crypto';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST.' });
    if (!(await conSesion(req))) return res.status(401).json({ error: 'Sin sesión.', entrar: true });
    const yo = credencial(req);
    if (!yo) return res.status(401).json({ error: 'Entra otra vez para poder subir fotos.', entrar: true });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const buf = Buffer.from(String(b.datos || ''), 'base64');
    // Solo JPEG: empieza por FF D8 FF.
    if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return res.status(400).json({ error: 'Eso no es una foto JPEG.' });
    }
    if (buf.length > 3.5 * 1024 * 1024) return res.status(413).json({ error: 'La foto pesa demasiado.' });
    const sello = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const ruta = `imagenes/subidas/${sello}-${randomBytes(3).toString('hex')}.jpg`;
    await escribir(yo.token, ruta, buf, null, `Foto subida desde la app (${yo.login})`);
    return res.status(200).json({ url: RAW + ruta });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'No se pudo subir.' });
  }
}
