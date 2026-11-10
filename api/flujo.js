// El circuito de un post, guardado en el repositorio (flujo.json):
//
//   idea ──Aprobar──▶ aprobado ──(Claude lo termina)──▶ preparado
//        ──Confirmar publicación──▶ confirmado: entra en datos/programado.json
//        y la cola de GitHub Actions lo publica a su hora.
//
// GET  /api/flujo                → { flujo, login }
// POST /api/flujo {clave, accion, nota?, edicion?}
//   aprobar · descartar · recuperar · cambios · editar · confirmar · quitar
//
// Nada sale sin «confirmar», y «confirmar» solo vale sobre algo preparado.
import { conSesion } from './_puerta.js';
import { credencial, leerJSON, cambiarJSON } from './_gh.js';

const VACIO = { _ayuda: 'Lo escribe la app (api/flujo.js). fase: aprobado · preparado · confirmado · descartado · cambios.', posts: {} };
const VACIO_COLA = { posts: {} };
const ACCIONES = ['aprobar', 'descartar', 'recuperar', 'cambios', 'editar', 'confirmar', 'quitar'];

// La hora se escribe en hora de Nueva York («2026-11-17T18:00») y aquí se
// pasa a un instante de verdad, con su cambio de horario.
function deNuevaYork(local) {
  const supuesto = new Date(local.slice(0, 16) + ':00Z');
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(supuesto).map((x) => [x.type, x.value]));
  const comoNY = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute);
  return new Date(supuesto.getTime() - (comoNY - supuesto.getTime())).toISOString();
}

function limpiaEdicion(e = {}) {
  const out = {};
  for (const k of ['ig', 'fb']) if (typeof e[k] === 'string') out[k] = e[k].slice(0, 2200 * 30);
  if (typeof e.cuando === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.cuando)) out.cuando = e.cuando;
  if (e.cuando === null) out.cuando = null;
  const raw = (u) => typeof u === 'string' && /^https:\/\/(raw\.githubusercontent\.com|creartbox-archive\.b-cdn\.net|creartbox\.nyc)\//.test(u);
  if (Array.isArray(e.fotos)) out.fotos = e.fotos.filter(raw).slice(0, 10);
  if (e.fondo === null || raw(e.fondo)) out.fondo = e.fondo;
  if (typeof e.historia === 'boolean') out.historia = e.historia;
  return out;
}

export default async function handler(req, res) {
  try {
    if (!(await conSesion(req))) return res.status(401).json({ error: 'Sin sesión.', entrar: true });
    const yo = credencial(req);
    if (!yo) return res.status(401).json({ error: 'Entra otra vez para poder guardar desde aquí.', entrar: true });

    if (req.method === 'GET') {
      const { datos } = await leerJSON(yo.token, 'flujo.json', VACIO);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ flujo: datos, login: yo.login });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Solo GET o POST.' });

    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { clave, accion } = b;
    if (typeof clave !== 'string' || !/^[a-z]{2}\/[\w-]+$/.test(clave)) return res.status(400).json({ error: 'Clave no válida.' });
    if (!ACCIONES.includes(accion)) return res.status(400).json({ error: 'Acción no válida.' });
    const ahora = new Date().toISOString();
    const nota = typeof b.nota === 'string' ? b.nota.slice(0, 2000) : '';

    // Confirmar y quitar tocan también la cola.
    if (accion === 'confirmar' || accion === 'quitar') {
      const { datos: flujo } = await leerJSON(yo.token, 'flujo.json', VACIO);
      const f = flujo.posts[clave];
      let cola;
      if (accion === 'confirmar') {
        if (!f || f.fase !== 'preparado' || !f.preparado) return res.status(409).json({ error: 'Todavía no está preparado: no se puede confirmar.' });
        const pasado = Object.values(f.preparado).flatMap((e) => e.redes).find((r) => new Date(r.cuando) < new Date());
        if (pasado) return res.status(409).json({ error: 'La hora preparada ya pasó. Cambia la fecha y vuelve a confirmar.' });
        cola = await cambiarJSON(yo.token, 'datos/programado.json', VACIO_COLA, (d) => {
          for (const [k, e] of Object.entries(f.preparado)) {
            d.posts[k] = { ...e, redes: e.redes.map((r) => ({ ...r, estado: 'en cola', via: 'meta' })) };
          }
          d.actualizado = ahora;
        }, `Confirmado desde la app: ${clave}`);
      } else {
        let bloqueo = '';
        cola = await cambiarJSON(yo.token, 'datos/programado.json', VACIO_COLA, (d) => {
          const claves = Object.keys(d.posts).filter((k) => k === clave || k.startsWith(clave + '#'));
          if (!claves.length) { bloqueo = 'No está en la cola.'; return false; }
          if (claves.some((k) => d.posts[k].redes.some((r) => r.estado !== 'en cola'))) {
            bloqueo = 'Ya ha salido (o está saliendo) en alguna red: desde aquí no se quita.'; return false;
          }
          for (const k of claves) delete d.posts[k];
          d.actualizado = ahora;
        }, `Quitado de la cola desde la app: ${clave}`);
        if (bloqueo) return res.status(409).json({ error: bloqueo });
      }
      const nuevo = await cambiarJSON(yo.token, 'flujo.json', VACIO, (d) => {
        const g = d.posts[clave] || (d.posts[clave] = { historial: [] });
        g.fase = accion === 'confirmar' ? 'confirmado' : 'preparado';
        (g.historial ||= []).push({ accion, quien: yo.login, fecha: ahora });
      }, `${accion === 'confirmar' ? 'Confirmado' : 'Vuelve a preparado'}: ${clave}`);
      const propias = Object.fromEntries(Object.entries(cola.posts).filter(([k]) => k === clave || k.startsWith(clave + '#')));
      return res.status(200).json({ ok: true, post: nuevo.posts[clave], cola: propias });
    }

    const nuevo = await cambiarJSON(yo.token, 'flujo.json', VACIO, (d) => {
      const g = d.posts[clave] || (d.posts[clave] = { historial: [] });
      if (g.fase === 'confirmado' && accion !== 'editar') throw Object.assign(new Error('Está confirmado: quítalo de la cola antes.'), { codigo: 409 });
      if (accion === 'aprobar') g.fase = 'aprobado';
      if (accion === 'descartar') g.fase = 'descartado';
      if (accion === 'recuperar') delete g.fase;
      if (accion === 'cambios') { g.fase = 'cambios'; g.nota = nota; }
      if (accion === 'editar') {
        if (g.fase === 'confirmado') throw Object.assign(new Error('Está confirmado: quítalo de la cola para editarlo.'), { codigo: 409 });
        const ed = limpiaEdicion(b.edicion);
        g.edicion = { ...(g.edicion || {}), ...ed };
        for (const k of Object.keys(g.edicion)) if (g.edicion[k] === null) delete g.edicion[k];
        // Si ya estaba preparado: el texto y la hora se cambian ahí mismo;
        // una foto nueva obliga a volver a montarlo, y vuelve a «aprobado».
        if (g.fase === 'preparado' && g.preparado) {
          if (ed.fotos || 'fondo' in ed) { g.fase = 'aprobado'; delete g.preparado; }
          else {
            for (const e of Object.values(g.preparado)) for (const r of e.redes) {
              if (e.tipo !== 'historia' && ed[r.red] !== undefined) r.texto = ed[r.red];
            }
            if (ed.cuando) {
              const base = Math.min(...Object.values(g.preparado).flatMap((e) => e.redes).map((r) => new Date(r.cuando).getTime()));
              const nueva = new Date(deNuevaYork(ed.cuando)).getTime();
              for (const e of Object.values(g.preparado)) for (const r of e.redes) {
                r.cuando = new Date(new Date(r.cuando).getTime() - base + nueva).toISOString();
              }
            }
          }
        }
      }
      if (accion !== 'cambios' && accion !== 'editar') delete g.nota;
      (g.historial ||= []).push({ accion, quien: yo.login, fecha: ahora, ...(nota ? { nota } : {}) });
    }, `App: ${accion} ${clave}`);
    return res.status(200).json({ ok: true, post: nuevo.posts[clave] });
  } catch (e) {
    return res.status(e.codigo || 500).json({ error: e.message || 'Error al guardar.' });
  }
}
