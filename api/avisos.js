// Avisos al móvil: alta, baja y prueba.
//
// GET  /api/avisos                         → { publica }: la clave para suscribirse
// POST /api/avisos { accion: 'alta', sub, dispositivo }
// POST /api/avisos { accion: 'baja', endpoint }
// POST /api/avisos { accion: 'prueba' }    → manda un aviso a todos los aparatos

import { conSesion } from './_puerta.js';
import { credencial, cambiarJSON, leerJSON } from './_gh.js';
import { claves, sellar, avisar, idDe } from './_avisos.js';

const VACIO = { _ayuda: 'Suscripciones a los avisos de la app, cifradas. Las escribe api/avisos.js.', suscripciones: [] };

export default async function handler(req, res) {
  try {
    if (!(await conSesion(req))) return res.status(401).json({ error: 'Sin sesión.', entrar: true });
    const k = claves();
    if (req.method === 'GET') return res.status(200).json({ publica: k ? k.publica : null });
    const yo = credencial(req);
    if (!yo) return res.status(401).json({ error: 'Entra otra vez para poder guardar desde aquí.', entrar: true });
    if (!k) return res.status(500).json({ error: 'Falta META_TOKEN en Vercel.' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (b.accion === 'alta') {
      const sub = b.sub;
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return res.status(400).json({ error: 'Suscripción no válida.' });
      const id = idDe(sub);
      const dispositivo = String(b.dispositivo || '').slice(0, 80);
      const d = await cambiarJSON(yo.token, 'datos/avisos.json', VACIO, (x) => {
        x.suscripciones = (x.suscripciones || []).filter((s) => s.id !== id);
        x.suscripciones.push({ id, quien: yo.login, dispositivo, alta: new Date().toISOString(), sello: sellar({ endpoint: sub.endpoint, keys: sub.keys }) });
      }, 'Avisos: aparato nuevo');
      await avisar(d.suscripciones.filter((s) => s.id === id), { titulo: 'Avisos activados', texto: 'Te avisaré cuando haya algo para confirmar y cuando salga cada publicación.' });
      return res.status(200).json({ ok: true, id });
    }
    if (b.accion === 'baja') {
      const id = idDe({ endpoint: String(b.endpoint || '') });
      await cambiarJSON(yo.token, 'datos/avisos.json', VACIO, (x) => {
        const antes = (x.suscripciones || []).length;
        x.suscripciones = (x.suscripciones || []).filter((s) => s.id !== id);
        if (x.suscripciones.length === antes) return false;
      }, 'Avisos: aparato fuera');
      return res.status(200).json({ ok: true });
    }
    if (b.accion === 'prueba') {
      const { datos } = await leerJSON(yo.token, 'datos/avisos.json', VACIO);
      const r = await avisar(datos.suscripciones, { titulo: 'Prueba', texto: 'Si lees esto, los avisos funcionan. 👍' });
      return res.status(200).json({ ok: true, ...r });
    }
    return res.status(400).json({ error: 'Acción no válida.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error con los avisos.' });
  }
}
