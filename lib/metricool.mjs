// Publicar a través de Metricool, que ya tiene conectadas las cuentas.
//
// Frente a hablar con Meta directamente: no hace falta app propia, ni App
// Review, ni andar renovando tokens. A cambio, Metricool no publica en el
// acto: todo pasa por su planificador, así que «ahora» es en realidad dentro
// de unos minutos, con autoPublish puesto.
//
// La API pide plan Advanced o Custom. En los planes Free y Starter no está;
// ahí el camino es el MCP de Metricool, no esto.
//
// Documentación: help.metricool.com → «Guía básica para la integración de API».

const API = 'https://app.metricool.com/api';

async function pedir(ruta, { metodo = 'GET', cuerpo, cred } = {}) {
  const url = new URL(API + ruta);
  url.searchParams.set('userId', cred.userId);
  if (cred.blogId) url.searchParams.set('blogId', cred.blogId);

  const res = await fetch(url, {
    method: metodo,
    headers: {
      'X-Mc-Auth': cred.token,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let datos;
  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    datos = { crudo: texto };
  }
  if (!res.ok) {
    throw new Error(
      `Metricool ${res.status}: ${datos.detail || datos.title || datos.crudo || 'sin detalle'}`
    );
  }
  return datos;
}

/** Las marcas que alcanza el token. De aquí sale el blogId. */
export async function marcas(cred) {
  const r = await pedir('/admin/simpleProfiles', { cred: { ...cred, blogId: null } });
  const lista = Array.isArray(r) ? r : r.data || [];
  return lista.map((m) => ({
    blogId: String(m.blogId ?? m.id ?? ''),
    nombre: m.label || m.title || m.name || '(sin nombre)',
    // Qué redes tiene conectadas; los nombres varían según la cuenta, así que
    // se recoge lo que venga sin interpretarlo.
    redes: Object.keys(m.connectedProviders || m.providers || {}),
  }));
}

/**
 * Metricool solo publica imágenes que estén alojadas en sus servidores: hay
 * que pasarle la URL pública antes y quedarse con el mediaId que devuelve.
 */
export async function normalizarImagen(url, cred) {
  const r = await pedir(`/actions/normalize/image/url?url=${encodeURIComponent(url)}`, { cred });
  const id = r.mediaId || r.data?.mediaId || r.id || (typeof r === 'string' ? r : null);
  if (!id) throw new Error(`Metricool no devolvió mediaId para ${url}.`);
  return String(id);
}

/** La hora que se le pide al planificador. Sin desfase: la zona va aparte. */
function cuando(fecha) {
  const d = fecha ? new Date(fecha) : new Date(Date.now() + 5 * 60 * 1000);
  if (Number.isNaN(d.getTime())) throw new Error(`No entiendo la fecha «${fecha}».`);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/**
 * Una entrada por red, no una compartida: así cada una lleva su propio texto,
 * que es justo lo que hace el kit.
 */
export async function programar({ red, texto, mediaId, fecha, zona, borrador, autoPublicar, cred }) {
  const cuerpo = {
    publicationDate: { dateTime: cuando(fecha), timezone: zona || 'Europe/Madrid' },
    text: texto,
    providers: [{ network: red === 'ig' ? 'instagram' : 'facebook' }],
    draft: Boolean(borrador),
    autoPublish: autoPublicar !== false,
  };
  if (mediaId) cuerpo.media = { mediaId };

  const r = await pedir('/v2/scheduler/posts', { metodo: 'POST', cuerpo, cred });
  const id = r.id || r.data?.id || null;
  return {
    id,
    enlace: `https://app.metricool.com/planning?blogId=${cred.blogId}`,
    cuando: cuerpo.publicationDate.dateTime + ' ' + cuerpo.publicationDate.timezone,
  };
}
