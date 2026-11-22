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
import { credencial, leerJSON, cambiarJSON, cambiarTexto } from './_gh.js';
import { marcaDe } from './_cuentas.js';

const VACIO = { _ayuda: 'Lo escribe la app (api/flujo.js). fase: aprobado · preparado · confirmado · luego (más adelante) · descartado (archivo) · cambios.', posts: {} };
const VACIO_COLA = { posts: {} };
const ACCIONES = ['aprobar', 'descartar', 'luego', 'sugerir', 'recuperar', 'cambios', 'editar', 'confirmar', 'quitar', 'blogAprobar', 'blogDescartar', 'blogRecuperar'];

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
  for (const k of ['texto', 'ig', 'fb']) if (typeof e[k] === 'string') out[k] = e[k].slice(0, 2200 * 30);
  if (typeof e.cuando === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.cuando)) out.cuando = e.cuando;
  if (e.cuando === null) out.cuando = null;
  const raw = (u) => typeof u === 'string' && /^https:\/\/(raw\.githubusercontent\.com|creartbox-archive\.b-cdn\.net|creartbox\.nyc)\//.test(u);
  if (Array.isArray(e.fotos)) out.fotos = e.fotos.filter(raw).slice(0, 10);
  if (e.fondo === null || raw(e.fondo)) out.fondo = e.fondo;
  if (typeof e.historia === 'boolean') out.historia = e.historia;
  if (e.recorte === 'cortar' || e.recorte === 'entera' || e.recorte === null) out.recorte = e.recorte;
  if (e.encuadre === null) out.encuadre = null;
  else if (e.encuadre && typeof e.encuadre === 'object') {
    const n = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
    out.encuadre = { x: n(e.encuadre.x, 0, 1, 0.5), y: n(e.encuadre.y, 0, 1, 0.5), zoom: n(e.encuadre.zoom, 1, 3, 1) };
  }
  return out;
}

export default async function handler(req, res) {
  try {
    if (!(await conSesion(req))) return res.status(401).json({ error: 'Not signed in.', entrar: true });
    const yo = credencial(req);
    if (!yo) return res.status(401).json({ error: 'Sign in again to save from here.', entrar: true });

    if (req.method === 'GET') {
      const { datos } = await leerJSON(yo.token, 'flujo.json', VACIO);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ flujo: datos, login: yo.login });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Only GET or POST.' });

    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { clave, accion } = b;
    // Marcar un mes como terminado (todo programado), o desmarcarlo.
    if (accion === 'mes') {
      // Cada marca cierra sus meses: los de ADAR van como «adar:AAAA-MM».
      const mes = String(b.mes || '');
      if (!/^(adar:)?\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Invalid month.' });
      const nuevo = await cambiarJSON(yo.token, 'flujo.json', VACIO, (d) => {
        (d.meses ||= {})[mes] = { terminado: !!b.terminado, quien: yo.login, fecha: new Date().toISOString() };
      }, `App: ${b.terminado ? 'mes terminado' : 'mes abierto'} ${mes}`);
      return res.status(200).json({ ok: true, meses: nuevo.meses });
    }
    // Publicar en festivaladar.com un artículo del blog que estaba en
    // borrador: status publish y la fecha de hoy, en gaawi/adar (main es la
    // web). Va aquí y no en su propio archivo porque Vercel Hobby admite
    // 12 funciones. Solo publica; despublicar se hace a mano.
    if (accion === 'blogPublicar') {
      const slug = String(b.slug || '');
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid article.' });
      const hoy = new Date().toISOString();
      let estaba = '';
      await cambiarTexto(yo.token, 'gaawi/adar', `src/content/blog/es/${slug}.md`, (t) => {
        const m = t.match(/^---\n([\s\S]*?)\n---/);
        if (!m) throw new Error('The article has no front matter.');
        estaba = (m[1].match(/^status:\s*"?(\w+)"?/m) || [])[1] || '';
        if (estaba === 'publish') return false;
        return t.replace(m[1], m[1].replace(/^status:.*$/m, 'status: publish').replace(/^date:.*$/m, `date: "${hoy}"`));
      }, `Blog: publicado «${slug}» desde la app (${yo.login})`);
      return res.status(200).json({ ok: true, slug, yaEstaba: estaba === 'publish', url: `https://festivaladar.com/es/blog/${slug}/` });
    }
    // Una idea nueva no tiene clave todavía: va a una lista aparte.
    if (accion === 'idea') {
      const texto = typeof b.nota === 'string' ? b.nota.trim().slice(0, 4000) : '';
      if (!texto) return res.status(400).json({ error: 'Write the idea.' });
      const nuevo = await cambiarJSON(yo.token, 'flujo.json', VACIO, (d) => {
        const marca = b.marca === 'adar' ? 'adar' : 'creartbox';
        (d.ideas ||= []).push({ texto, marca, quien: yo.login, fecha: new Date().toISOString(), hecha: false });
      }, 'App: idea nueva');
      return res.status(200).json({ ok: true, ideas: nuevo.ideas });
    }
    if (typeof clave !== 'string' || !/^[a-z]{2}\/[\w-]+$/.test(clave)) return res.status(400).json({ error: 'Invalid key.' });
    if (!ACCIONES.includes(accion)) return res.status(400).json({ error: 'Invalid action.' });
    const ahora = new Date().toISOString();
    const nota = typeof b.nota === 'string' ? b.nota.slice(0, 2000) : '';

    // Confirmar y quitar tocan también la cola.
    if (accion === 'confirmar' || accion === 'quitar') {
      const { datos: flujo } = await leerJSON(yo.token, 'flujo.json', VACIO);
      const f = flujo.posts[clave];
      let cola;
      if (accion === 'confirmar') {
        if (!f || f.fase !== 'preparado' || !f.preparado) return res.status(409).json({ error: 'Not ready yet: it cannot be confirmed.' });
        // `red`: se puede aprobar por partes (ig, fb, story). Sin `red`, todo.
        const red = ['ig', 'fb', 'story'].includes(b.red) ? b.red : null;
        const toca = (k, r) => !red || (red === 'story' ? k.includes('#') : !k.includes('#') && r.red === red);
        const elegidas = Object.entries(f.preparado).flatMap(([k, e]) => e.redes.filter((r) => toca(k, r)));
        if (!elegidas.length) return res.status(409).json({ error: 'Nothing is ready for that network.' });
        const pasado = elegidas.find((r) => new Date(r.cuando) < new Date());
        if (pasado) return res.status(409).json({ error: 'The scheduled time has passed. Change the date and confirm again.' });
        cola = await cambiarJSON(yo.token, 'datos/programado.json', VACIO_COLA, (d) => {
          for (const [k, e] of Object.entries(f.preparado)) {
            const nuevas = e.redes.filter((r) => toca(k, r)).map((r) => ({ ...r, estado: 'en cola', via: 'meta' }));
            if (!nuevas.length) continue;
            const ya = d.posts[k] ? d.posts[k].redes.filter((r) => !nuevas.some((n) => n.red === r.red)) : [];
            // La marca dice por qué cuenta sale (lib/cuentas.mjs).
            d.posts[k] = { ...e, marca: marcaDe(clave, e.marca ? e : { marca: b.marca }), redes: [...ya, ...nuevas] };
          }
          d.actualizado = ahora;
        }, `Confirmado desde la app: ${clave}${red ? ` (${red})` : ''}`);
        // ¿Queda algo sin aprobar? Entonces sigue en «preparado».
        const todas = Object.entries(f.preparado).flatMap(([k, e]) => e.redes.map((r) => [k, r]));
        f._completo = todas.every(([k, r]) => (cola.posts[k]?.redes || []).some((x) => x.red === r.red && x.estado));
      } else {
        let bloqueo = '';
        cola = await cambiarJSON(yo.token, 'datos/programado.json', VACIO_COLA, (d) => {
          const claves = Object.keys(d.posts).filter((k) => k === clave || k.startsWith(clave + '#'));
          if (!claves.length) { bloqueo = 'It is not in the queue.'; return false; }
          if (claves.some((k) => d.posts[k].redes.some((r) => r.estado !== 'en cola'))) {
            bloqueo = 'It already went out (or is going out) on a network: it cannot be removed from here.'; return false;
          }
          for (const k of claves) delete d.posts[k];
          d.actualizado = ahora;
        }, `Quitado de la cola desde la app: ${clave}`);
        if (bloqueo) return res.status(409).json({ error: bloqueo });
      }
      const nuevo = await cambiarJSON(yo.token, 'flujo.json', VACIO, (d) => {
        const g = d.posts[clave] || (d.posts[clave] = { historial: [] });
        g.fase = accion === 'confirmar' ? (f._completo ? 'confirmado' : 'preparado') : 'preparado';
        (g.historial ||= []).push({ accion, quien: yo.login, fecha: ahora, ...(b.red ? { red: b.red } : {}) });
      }, `${accion === 'confirmar' ? 'Confirmado' : 'Vuelve a preparado'}: ${clave}`);
      const propias = Object.fromEntries(Object.entries(cola.posts).filter(([k]) => k === clave || k.startsWith(clave + '#')));
      return res.status(200).json({ ok: true, post: nuevo.posts[clave], cola: propias });
    }

    const nuevo = await cambiarJSON(yo.token, 'flujo.json', VACIO, (d) => {
      const g = d.posts[clave] || (d.posts[clave] = { historial: [] });
      if (accion === 'sugerir') {
        if (!nota.trim()) throw Object.assign(new Error('Write the suggestion.'), { codigo: 400 });
        (g.sugerencias ||= []).push({ texto: nota.trim(), quien: yo.login, fecha: ahora, hecha: false });
        (g.historial ||= []).push({ accion, quien: yo.login, fecha: ahora });
        return;
      }
      // Los artículos del blog van aparte de las redes: `faseBlog`. Aprobado
      // quiere decir que Claude lo publica en la web (el día de su post de
      // redes, o en el siguiente check si no tiene).
      if (accion.startsWith('blog')) {
        if (accion === 'blogAprobar') g.faseBlog = 'aprobado';
        else if (accion === 'blogDescartar') g.faseBlog = 'descartado';
        else delete g.faseBlog;
        (g.historial ||= []).push({ accion, quien: yo.login, fecha: ahora });
        return;
      }
      if (g.fase === 'confirmado' && accion !== 'editar') throw Object.assign(new Error('It is confirmed: remove it from the queue first.'), { codigo: 409 });
      if (accion === 'aprobar') g.fase = 'aprobado';
      if (accion === 'descartar') g.fase = 'descartado';
      if (accion === 'luego') g.fase = 'luego';
      if (accion === 'recuperar') delete g.fase;
      if (accion === 'cambios') { g.fase = 'cambios'; g.nota = nota; }
      if (accion === 'editar') {
        if (g.fase === 'confirmado') throw Object.assign(new Error('It is confirmed: remove it from the queue to edit it.'), { codigo: 409 });
        const ed = limpiaEdicion(b.edicion);
        g.edicion = { ...(g.edicion || {}), ...ed };
        for (const k of Object.keys(g.edicion)) if (g.edicion[k] === null) delete g.edicion[k];
        // Si ya estaba preparado: el texto y la hora se cambian ahí mismo;
        // una foto nueva obliga a volver a montarlo, y vuelve a «aprobado».
        if (g.fase === 'preparado' && g.preparado) {
          if (ed.fotos || 'fondo' in ed || 'encuadre' in ed || 'recorte' in ed) { g.fase = 'aprobado'; delete g.preparado; }
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
    return res.status(e.codigo || 500).json({ error: e.message || 'Error saving.' });
  }
}
