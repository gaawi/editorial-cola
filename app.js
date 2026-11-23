/* La app de aprobar. Solo hace tres cosas: enseñar la ficha como se verá en
 * cada red, dejar decidir, y guardar esa decisión en el repositorio.
 *
 * El dibujo no se inventa nada: lo hace motor.js, que es el motor del kit de
 * ADAR traído tal cual, así que la imagen de la vista previa es la misma que
 * se publica. Los pies tampoco: vienen ya compuestos en datos/posts.json por
 * el mismo código que usa publicar.mjs.
 */
import { crearMotor, TAMANOS } from './motor.js';

// Line icons (Flaticon "uicons" style), drawn inline so they stay sharp and
// take the text color. No emoji in the interface.
const ICO = {
  campana: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  doc: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4M9 12h6M9 15.5h6"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  pausa: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>',
  globo: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  corazon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
};
// Queue states are stored in Spanish in datos/programado.json; shown in English.
const ESTADO_COLA = { 'en cola': 'queued', publicado: 'published', pausado: 'paused', atrasado: 'late', error: 'error' };

const $ = (s) => document.querySelector(s);
const RAMA = 'main';
const ARCHIVO = 'aprobaciones.json';

const ESTADOS = {
  listo: 'Ready to publish',
  cambios: 'Needs changes',
  espera: 'On hold',
  borrador: 'Draft',
  idea: 'Idea',
  descartado: 'Archived',
  sin: 'Unmarked',
};

let DATOS = null;
let MARCA = 'creartbox';
let CUENTAS = null;
let MOTOR = null;
let APROB = { posts: {} };
let PROGRAMADO = { posts: {} };
let shaAprob = null;
let actual = null;
let filtro = 'ahora';
let vista = 'cuentas'; // la entrada: elegir la cuenta
let MES = null; // 'AAAA-MM' cuando se trabaja en un mes
const HOY = new Date().toISOString().slice(0, 10);
const DIA = 86400000;
let HISTORICO = null;


// ── Avisos ─────────────────────────────────────────────────────────────
let avisoTope;
function aviso(texto, mal) {
  const a = $('#aviso');
  a.textContent = texto;
  a.classList.toggle('mal', !!mal);
  a.hidden = false;
  clearTimeout(avisoTope);
  avisoTope = setTimeout(() => { a.hidden = true; }, mal ? 6000 : 2600);
}

// ── Estado de una ficha ────────────────────────────────────────────────
// Manda lo que se haya decidido aquí; si no hay nada, lo que traía el panel.
function estadoDe(p) {
  const mio = APROB.posts[p.clave];
  if (mio && mio.estado) return { estado: mio.estado, nota: mio.nota || '', volver: mio.volver || null, mio: true, fecha: mio.fecha };
  const h = p.heredado || {};
  return { estado: h.estado || 'sin', nota: h.nota || '', mio: false };
}
function yaPublicado(p) {
  const h = (p.heredado && p.heredado.publicado) || {};
  return ['ig', 'fb'].filter((r) => h[r]);
}

// ── Lista ──────────────────────────────────────────────────────────────
/**
 * La fila de circulitos, como la de la app. Llevan la foto de la ficha y no
 * la historia dibujada: es lo que Instagram enseña ahí, y dibujar doce
 * lienzos de 1080×1920 para unos círculos de 62 px no lo justifica. La
 * historia entera se dibuja al tocarlos.
 */
function pintarHistorias(posts, donde = '#historias') {
  const cont = $(donde);
  cont.innerHTML = posts
    .map((p) => {
      const visto = estadoDe(p).estado === 'listo' || estadoDe(p).estado === 'descartado';
      const sola = p.formato === 'historia';
      return `<button data-clave="${p.clave}"${sola ? ' class="solo-historia"' : ''}>
        <span class="aro${visto ? ' vista' : ''}"><img src="${p.image || ''}" alt="" loading="lazy"></span>
        <small>${sola ? '· ' : ''}${escapar(p.title)}</small>
      </button>`;
    })
    .join('');
}

async function abrirHistoria(clave) {
  const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === clave);
  if (!p) return;
  const v = $('#visor');
  $('#visor-hueco').innerHTML = '<p class="vacio" style="color:#777">Rendering…</p>';
  $('#visor-pie').innerHTML = '<p class="aviso-suave">Comments go through the chat.</p>';
  v.hidden = false;
  try {
    $('#visor-hueco').replaceChildren(await pintarHistoria(p));
  } catch (e) {
    $('#visor-hueco').innerHTML = `<p class="vacio" style="color:#777">Couldn't render</p>`;
  }
}

/**
 * En qué apartado va cada ficha. Es un orden, no una etiqueta: lo publicado
 * manda sobre lo programado, y lo programado sobre lo que sigue siendo una
 * idea. Así una ficha no puede estar en dos sitios.
 */
function grupoDe(p) {
  if (p.publicadoEn || Object.keys(estadoDe(p).publicado || {}).length) return 'publicado';
  const e = (PROGRAMADO.posts || {})[p.clave];
  // Una ficha en cola cuya hora ya pasó salió sola: Metricool no avisa a
  // nadie, así que se deduce del reloj. Es deducción, no confirmación: si
  // falló la publicación, esto diría que salió igual.
  if (e) return yaSalio(e) ? 'publicado' : 'programado';
  const fase = faseDe(p);
  if (fase === 'aprobado' || fase === 'preparado' || fase === 'confirmado') return 'confirmar';
  return 'idea';
}

/** ¿Ha salido ya? Si la copia de Metricool trae el estado, manda el estado;
 *  si no, se deduce del reloj como antes. */
function yaSalio(e) {
  // «pausado»: lo paré yo en el repaso; no ha salido y está esperando.
  return e.redes.every((r) => (r.estado ? !['en cola', 'pausado'].includes(r.estado) : new Date(r.cuando) < new Date()));
}

/** Las de un apartado, ordenadas por fecha. */
/** El mes en que sale (o saldría) una ficha: cola, preparado o su fecha. */
function mesDe(p) {
  const cola = (PROGRAMADO.posts || {})[p.clave];
  if (cola && cola.redes[0]) return aLocalNY(cola.redes[0].cuando).slice(0, 7);
  const prep = faseDe(p) === 'preparado' && preparadoDe(p);
  if (prep && prep.redes[0]) return aLocalNY(prep.redes[0].cuando).slice(0, 7);
  return String(p.publicaEl || p.date || '').slice(0, 7);
}

function fichasDe(grupo) {
  return DATOS.marcas[MARCA].posts
    .filter((p) => grupoDe(p) === grupo)
    .filter((p) => !MES || mesDe(p) === MES)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Las historias van arriba, en círculos; los posts, debajo. */
function reparte(fichas) {
  return {
    historias: fichas.filter((p) => p.formato === 'historia'),
    posts: fichas.filter((p) => p.formato !== 'historia'),
  };
}

/**
 * Las tarjetas, una detrás de otra y con un rótulo cada vez que cambia el
 * mes: se ven todos los meses seguidos, sin tener que salir y entrar en otro.
 */
function pintarPorMeses(cont, fichas, extra = []) {
  mazo(cont, [...fichas.map((p) => ({ nodo: tarjeta(p), mes: mesDe(p), etiqueta: nombreMes(mesDe(p) || HOY.slice(0, 7)) })), ...extra]);
}

// ── Flashcards ──────────────────────────────────────────────────────────
// Every review view shows one card at a time: swipe sideways (or use the
// arrows, or ← → on a keyboard) to move. The position is kept per view, so
// after approving a card the next one is right there.
const POS_MAZO = {};
function mazo(cont, items) {
  cont.classList.add('mazo');
  cont.innerHTML = '';
  items.forEach((it, i) => {
    const s = document.createElement('div');
    s.className = 'slide';
    s.dataset.i = i;
    if (it.mes) s.dataset.mes = it.mes;
    s.dataset.etiqueta = it.etiqueta || '';
    s.appendChild(it.nodo);
    cont.appendChild(s);
  });
  // The bar on top: where you are, and the arrows.
  let barra = cont.previousElementSibling;
  if (!barra || !barra.classList.contains('mazo-barra')) {
    barra = document.createElement('div');
    barra.className = 'mazo-barra';
    barra.innerHTML = `<button class="mazo-paso" data-d="-1" aria-label="Previous card"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <span class="mazo-donde"><b></b><small></small></span>
      <span class="mazo-extra">
        <button class="mazo-boton" data-accion="filtro" aria-label="Show archive"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="5" rx="1.5"/><path d="M5.5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg></button>
        <button class="mazo-boton" data-accion="nueva" aria-label="Suggest a new idea"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      </span>
      <button class="mazo-paso" data-d="1" aria-label="Next card"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      <i class="mazo-progreso"><i></i></i>`;
    cont.parentNode.insertBefore(barra, cont);
    barra.addEventListener('click', (e) => {
      const b = e.target.closest('.mazo-paso');
      if (b) irACarta(cont, posMazo(cont) + Number(b.dataset.d));
      const x = e.target.closest('.mazo-boton');
      if (!x) return;
      // Full-screen cards on the phone have no room for the filters and the
      // new-idea box: they live behind these two buttons.
      if (x.dataset.accion === 'nueva') {
        const caja = $('#idea-nueva');
        caja.classList.toggle('abierta');
        if (caja.classList.contains('abierta')) caja.querySelector('textarea')?.focus();
      } else if (vista === 'blog') {
        filtroBlog = filtroBlog === 'publish' ? 'draft' : 'publish'; pintarBlog();
      } else {
        filtro = filtro === 'archivo' ? 'ahora' : 'archivo';
        $('#filtros').querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c.dataset.filtro === filtro));
        pintarLista();
      }
    });
    let tic = null;
    cont.addEventListener('scroll', () => {
      cancelAnimationFrame(tic);
      tic = requestAnimationFrame(() => pintarBarraMazo(cont));
    }, { passive: true });
  }
  barra.hidden = items.length === 0 && vista === 'confirmar';
  const clave = cont.id + ':' + vista + ':' + MARCA;
  cont.dataset.clave = clave;
  const ir = Math.min(POS_MAZO[clave] || 0, Math.max(0, items.length - 1));
  requestAnimationFrame(() => { cont.scrollLeft = ir * cont.clientWidth; pintarBarraMazo(cont); });
}
const posMazo = (cont) => Math.round(cont.scrollLeft / Math.max(1, cont.clientWidth));
function pintarBarraMazo(cont) {
  const barra = cont.previousElementSibling;
  const n = cont.children.length;
  const i = Math.min(posMazo(cont), n - 1);
  POS_MAZO[cont.dataset.clave] = i;
  if (!barra || !n) return;
  barra.querySelector('b').textContent = `${i + 1} / ${n}`;
  barra.querySelector('small').textContent = cont.children[i]?.dataset.etiqueta || '';
  barra.querySelector('.mazo-progreso i').style.width = `${((i + 1) / n) * 100}%`;
  barra.querySelector('[data-d="-1"]').disabled = i <= 0;
  barra.querySelector('[data-d="1"]').disabled = i >= n - 1;
  const fil = barra.querySelector('[data-accion="filtro"]');
  fil.hidden = vista === 'confirmar';
  fil.classList.toggle('on', vista === 'blog' ? filtroBlog === 'publish' : filtro === 'archivo');
  fil.setAttribute('aria-label', vista === 'blog' ? (filtroBlog === 'publish' ? 'Show drafts' : 'Show published') : (filtro === 'archivo' ? 'Back to ideas' : 'Show archive'));
  barra.querySelector('[data-accion="nueva"]').hidden = vista !== 'ideas';
  // The next and previous cards get drawn ahead of time.
  for (const j of [i, i + 1, i - 1]) dibujarTarjeta(cont.children[j]?.querySelector('.tarjeta'));
}
function irACarta(cont, i) {
  const n = cont.children.length;
  if (!n) return;
  i = Math.max(0, Math.min(n - 1, i));
  cont.scrollTo({ left: i * cont.clientWidth, behavior: 'smooth' });
  // Back to the top of the card if you had scrolled down reading it.
  const arriba = cont.getBoundingClientRect().top + window.scrollY - (($('.barra')?.offsetHeight || 0) + 70);
  if (window.scrollY > arriba) window.scrollTo({ top: Math.max(0, arriba), behavior: 'smooth' });
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]') || actual) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const cont = [...document.querySelectorAll('.mazo')].find((c) => c.offsetParent !== null);
  if (cont) { e.preventDefault(); irACarta(cont, posMazo(cont) + (e.key === 'ArrowRight' ? 1 : -1)); }
});

function pintarLista() {
  const cont = $('#fichas');
  cont.innerHTML = '';
  // Ideas: lo que no está publicado ni en cola. «Ahora» deja además fuera lo
  // descartado y lo que todavía no toca; «Todas» lo enseña entero.
  // Ideas: todas juntas, por fecha. Archivo: lo descartado, que se guarda
  // por si vuelve a servir.
  const posts = fichasDe('idea').filter((p) => !p.esBlog).filter((p) => {
    const fase = faseDe(p);
    // Lo que ya pasó su fecha se archiva solo, con una nota que lo dice.
    const caducada = !fase && p.ventana && HOY > p.ventana.hasta;
    const archivada = fase === 'descartado' || caducada || (!fase && estadoDe(p).estado === 'descartado');
    return filtro === 'archivo' ? archivada : !archivada;
  });
  $('#vacio').textContent = filtro === 'archivo' ? 'The archive is empty.' : 'Nothing here.';
  $('#vacio').hidden = posts.length > 0;
  $('#idea-nueva').hidden = filtro === 'archivo';
  pintarIdeasPedidas();
  // En Ideas no hay fila de circulitos: todo va al muro, también lo que es
  // solo una historia, que lleva su sello y se ve en 9:16. Se decide igual.
  $('#historias').hidden = true;
  // Las ideas para el blog: los borradores de la web, después de los meses,
  // en el mismo mazo.
  const blog = ideasDeBlog(filtro === 'archivo');
  const cartasBlog = blog.map((a) => {
    const t = document.createElement('template');
    t.innerHTML = tarjetaBlog(a).trim();
    return { nodo: t.content.firstElementChild, mes: 'blog', etiqueta: filtro === 'archivo' ? 'Archived blog post' : 'Blog idea' };
  });
  pintarPorMeses(cont, posts.sort((a, b) => (mesDe(a) || '').localeCompare(mesDe(b) || '') || a.date.localeCompare(b.date)), cartasBlog);
  if (posts.length || blog.length) $('#vacio').hidden = true;
  observarLienzos();
}

/** Los borradores del blog que esperan decisión (o los descartados, en el archivo). */
function ideasDeBlog(archivo) {
  return DATOS.marcas[MARCA].posts
    .filter((a) => a.esBlog && a.estadoWeb !== 'publish')
    .filter((a) => archivo ? flujoDe(a).faseBlog === 'descartado' : flujoDe(a).faseBlog !== 'descartado')
    .sort((a, b) => {
      // Primero los que acompañan a un post de redes, por la fecha de ese post.
      const pa = postsDeArticulo(a)[0], pb = postsDeArticulo(b)[0];
      return (pa ? 0 : 1) - (pb ? 0 : 1) || String(pa?.publicaEl || pa?.date || a.date).localeCompare(String(pb?.publicaEl || pb?.date || b.date));
    });
}

/**
 * El sello de «ya está en cola». Dice el día, la hora de Nueva York y en qué
 * redes, y lleva al calendario de Metricool para cambiarlo o quitarlo.
 */
function selloProgramado(p) {
  const e = (PROGRAMADO.posts || {})[p.clave];
  if (!e) return '';
  const cuando = new Date(e.redes[0].cuando);
  const dia = cuando.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'America/New_York' });
  const hora = cuando.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  // En una línea y corto: esto va en la cabecera de la ficha, al lado del
  // concierto y de los días que quedan, y no puede comérselos.
  const redes = e.redes.map((r) => (r.red === 'ig' ? 'IG' : 'FB') + (r.estado === 'error' ? ' failed' : r.estado === 'pausado' ? ' paused' : '')).join('+');
  const salio = yaSalio(e);
  const que = salio ? 'out' : (e.tipo === 'historia' ? 'story' : 'queued');
  // Si ya salió, el sello lleva al post (Instagram primero); si está en cola
  // por Metricool, a su calendario; si va por la app, a ningún sitio de fuera.
  const conUrl = e.redes.find((r) => r.red === 'ig' && r.url) || e.redes.find((r) => r.url);
  const porMetricool = e.redes.some((r) => r.via !== 'meta');
  const destino = conUrl ? conUrl.url : (porMetricool ? PROGRAMADO.calendario : '');
  const titulo = conUrl ? 'Opens the published post.'
    : porMetricool ? 'Scheduled in Metricool. To change or remove it, go there.'
    : 'In the app queue: goes out automatically on time.';
  const marca = `class="sello en-cola${salio ? ' salido' : ''}" title="${titulo}"`;
  return destino
    ? `<a ${marca} href="${destino}" target="_blank" rel="noopener">${que} ${dia} ${hora} ${redes} ↗</a>`
    : `<span ${marca}>${que} ${dia} ${hora} ${redes}</span>`;
}

/**
 * Lo que está en cola. Aquí no se decide nada: la ficha ya está mandada a
 * Metricool y aprobarla o descartarla desde aquí no la pararía, solo daría
 * una falsa sensación de control. Se ve, y para cambiarla se va a Metricool.
 */
function pintarPublicadas() {
  const cont = $('#fichas-pub');
  cont.innerHTML = '';
  const fichas = fichasDe('publicado').sort((a, b) => b.date.localeCompare(a.date));
  const { historias, posts: muro } = reparte(fichas);
  $('#historias-pub').hidden = !historias.length;
  pintarHistorias(historias, '#historias-pub');
  for (const p of muro) cont.appendChild(tarjeta(p, { sinDecidir: true }));
  observarLienzos();
  return fichas.length;
}

function pintarProgramado() {
  const cont = $('#fichas-prog');
  cont.innerHTML = '';
  const fichas = fichasDe('programado').sort((a, b) => {
    const ca = PROGRAMADO.posts[a.clave].redes[0].cuando;
    const cb = PROGRAMADO.posts[b.clave].redes[0].cuando;
    return ca.localeCompare(cb);
  });
  const todas = DATOS.marcas[MARCA].posts.filter((p) => grupoDe(p) === 'programado');
  const n = todas.reduce((t, p) => t + PROGRAMADO.posts[p.clave].redes.length, 0);
  $('#resumen-programado').innerHTML = todas.length
    ? `${n} posts queued, from ${todas.length} cards. They go out automatically on time; to stop one,
       use "Remove from queue" on it.`
    : 'Nothing in queue.';

  const { historias, posts: muro } = reparte(fichas);
  $('#historias-prog').hidden = !historias.length;
  pintarHistorias(historias, '#historias-prog');
  for (const p of muro) cont.appendChild(tarjeta(p, { sinDecidir: true }));
  observarLienzos();
}

/** Los enlaces a lo ya publicado, uno por red, encima del post. */
function enlacesPublicados(p) {
  const e = (PROGRAMADO.posts || {})[p.clave];
  const urls = (e ? e.redes : []).filter((r) => r.url);
  if (!urls.length && p.publicadoEn && p.publicadoEn.url) urls.push({ red: 'ig', url: p.publicadoEn.url });
  if (!urls.length) return '';
  return `<div class="enlaces-pub">${urls.map((r) =>
    `<a href="${r.url}" target="_blank" rel="noopener">View on ${r.red === 'ig' ? 'Instagram' : 'Facebook'} ↗</a>`).join('')}</div>`;
}

/** Un post del muro: como se verá, con la decisión debajo. */
function tarjeta(p, opciones = {}) {
  const e = estadoDe(p);
  const c = p.concierto ? conciertoDe(p.concierto) : null;
  const pub = yaPublicado(p);

  const art = document.createElement('article');
  art.className = 'tarjeta' + (p.formato === 'historia' ? ' solo-historia' : '');
  art.dataset.clave = p.clave;
  art.innerHTML = `
    <div class="cabecera-ficha">
      ${p.formato === 'historia' ? '<span class="sello solo-hist">Story only</span>' : ''}
      ${c ? `<span class="cuando-ficha">${escapar(c.nombre)}</span>` : ''}
      ${cuandoTexto(p) && grupoDe(p) === 'idea'
        ? `<span class="cuando-ficha tenue">${cuandoTexto(p)}</span>` : ''}
      ${p.publicadoEn
        ? `<a class="sello publicado" href="${p.publicadoEn.url}" target="_blank" rel="noopener">published ${p.publicadoEn.fecha} ↗</a>`
        : pub.length ? `<span class="sello publicado">already on ${pub.join('+')}</span>` : ''}
      ${selloProgramado(p)}
      <span class="crece"></span>
    </div>
    ${enlacesPublicados(p)}
    <div class="hueco-ig"><div class="espera-lienzo">…</div></div>
    ${p.falta ? `<p class="falta-material">Missing: ${escapar(p.falta)}</p>` : ''}
    ${e.nota && !faseDe(p) ? `<p class="nota-puesta">“${escapar(e.nota)}”</p>` : ''}
    ${!faseDe(p) && p.ventana && HOY > p.ventana.hasta && grupoDe(p) === 'idea'
      ? `<p class="porque archivo-nota"><b>Archived automatically:</b> its window ran until ${p.ventana.hasta.split('-').slice(1).join('/')} and has passed.</p>`
      : p.porque && grupoDe(p) !== 'publicado' ? `<p class="porque"><b>Why:</b> ${escapar(p.porque)}</p>` : ''}
    ${articuloDe(p)}
    <div class="acciones-flujo">${accionesFlujo(p)}</div>
    ${cajaSugerir(p)}
    ${grupoDe(p) === 'idea' ? '' : '<button class="abrir">See on Facebook and as a story ›</button>'}`;

  art.querySelector('.abrir')?.addEventListener('click', () => abrir(p));
  return art;
}

/**
 * Dibujar doce posts a la vez atasca el móvil, así que cada uno se dibuja
 * cuando se asoma por la pantalla y no antes.
 */
let vigia = null;
/** Draws a card's preview once (when it comes into view, or is next in the deck). */
async function dibujarTarjeta(t) {
  if (!t || t.dataset.dibujada) return;
  t.dataset.dibujada = '1';
  vigia?.unobserve(t);
  const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === t.dataset.clave);
  const hueco = t.querySelector('.hueco-ig');
  if (!p || !hueco) return;
  try {
    hueco.replaceChildren(await (p.formato === 'historia' ? pintarHistoria(p) : pintarInstagram(p)));
  } catch (err) {
    hueco.innerHTML = `<div class="espera-lienzo">Couldn't render</div>`;
  }
}

function observarLienzos() {
  vigia?.disconnect();
  vigia = new IntersectionObserver(async (entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      vigia.unobserve(en.target);
      if (en.target.dataset.dibujada) continue;
      en.target.dataset.dibujada = '1';
      const clave = en.target.dataset.clave;
      const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === clave);
      const hueco = en.target.querySelector('.hueco-ig');
      try {
        hueco.replaceChildren(await (p.formato === 'historia' ? pintarHistoria(p) : pintarInstagram(p)));
      } catch (err) {
        hueco.innerHTML = `<div class="espera-lienzo">Couldn't render</div>`;
      }
    }
  }, { rootMargin: '600px 100%' });
  document.querySelectorAll('.tarjeta').forEach((t) => vigia.observe(t));
}


/**
 * Cuándo volver a enseñar algo pospuesto.
 *
 * No es «dentro de una semana» a ciegas: depende de qué sea el post y de
 * cuándo es su concierto. Si su momento aún no ha llegado, vuelve cuando
 * empiece. Si ya estamos dentro, vuelve en unos días, sin pasarse del final.
 * Si el momento ya pasó, no vuelve: pedirlo sería mentir.
 */
function cuandoVolver(p) {
  const v = p.ventana;
  if (!v) return sumaDias(HOY, 7);
  if (HOY < v.desde) return v.desde;
  if (HOY > v.hasta) return null;
  const en4 = sumaDias(HOY, 4);
  return en4 > v.hasta ? v.hasta : en4;
}
function sumaDias(fecha, n) {
  return new Date(new Date(fecha + 'T12:00:00Z').getTime() + n * DIA).toISOString().slice(0, 10);
}
function enVentana(p) {
  return !p.ventana || (HOY >= p.ventana.desde && HOY <= p.ventana.hasta);
}
/** Un pospuesto está dormido hasta su fecha. */
function dormido(p) {
  const e = estadoDe(p);
  return e.estado === 'espera' && (!e.volver || HOY < e.volver);
}
/** Para decirlo en la tarjeta sin que parezca una fecha de caducidad. */
function cuandoTexto(p) {
  const v = p.ventana;
  if (!v) return '';
  if (HOY < v.desde) return `its window opens ${v.desde}`;
  if (HOY > v.hasta) return `its window closed ${v.hasta}`;
  const quedan = Math.round((new Date(v.hasta + 'T12:00:00Z') - new Date(HOY + 'T12:00:00Z')) / DIA);
  return quedan <= 0 ? 'last day' : `${quedan} day${quedan === 1 ? '' : 's'} left`;
}

function conciertoDe(id) {
  return (DATOS.marcas[MARCA].etiquetas.conciertos || []).find((c) => c.id === id) || null;
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * El pie, cortado donde lo corta la app y con lo que cada una colorea.
 * En Facebook el enlace se pulsa y sale en azul; en Instagram no se pulsa y
 * sale en texto plano, que es justo el motivo de mandarlo a la bio.
 */

// El pie, plegado como en la red: Instagram enseña dos líneas (contando el
// nombre de la cuenta) y Facebook cinco, con «… más» al final. Tocando el
// texto se despliega. Se corta por líneas de verdad, midiendo, y no por
// caracteres, porque es lo que hacen ellas: un salto de línea gasta una.
const PIES = new WeakMap();

function pintarPie(texto, lineas, claseMas, etiqueta, enlaces) {
  return `<span class="pie-texto plegable" data-lineas="${lineas}" data-mas="${claseMas}" data-etiqueta="${escapar(etiqueta)}"${enlaces ? ' data-enlaces="1"' : ''} data-texto="${escapar(texto)}">${tintar(texto, enlaces)}</span>`;
}

// Por la altura del bloque: las líneas en blanco también gastan una y no
// tienen rectángulo propio.
function lineasDe(el) {
  const caja = el.parentElement, cs = getComputedStyle(caja);
  const alto = caja.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return Math.round(alto / parseFloat(cs.lineHeight));
}

// El 20 de noviembre pidió leer el texto entero de golpe, sin «… más». El
// plegado queda aquí por si un día lo quiere otra vez: basta con ponerlo a true.
const PLEGAR = false;

function plegar(el) {
  if (!PLEGAR) return;
  if (!el.isConnected || el.dataset.abierto || el.getClientRects().length === 0) return;
  const texto = el.dataset.texto;
  const max = Number(el.dataset.lineas);
  const enlaces = !!el.dataset.enlaces;
  const ancho = el.parentElement.clientWidth;
  if (PIES.get(el) === ancho) return;
  PIES.set(el, ancho);
  const pon = (n) => {
    el.innerHTML = n >= texto.length
      ? tintar(texto, enlaces)
      : tintar(texto.slice(0, n).replace(/\s+$/, ''), enlaces) + `<span class="${el.dataset.mas}">… ${el.dataset.etiqueta}</span>`;
  };
  pon(texto.length);
  if (lineasDe(el) <= max) { el.classList.remove('cortado'); return; }
  // La mayor parte que cabe con el «… más» detrás.
  let lo = 0, hi = texto.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    pon(mid);
    if (lineasDe(el) <= max) lo = mid; else hi = mid - 1;
  }
  // Al final de una palabra, como la red.
  const esp = texto.slice(0, lo + 1).search(/\s\S*$/);
  pon(esp > lo * 0.6 ? esp : lo);
  el.classList.add('cortado');
}

const vigiaPies = new ResizeObserver((entradas) => {
  for (const en of entradas) en.target.querySelectorAll(':scope > .plegable, :scope .plegable').forEach(plegar);
});
new MutationObserver((cambios) => {
  for (const c of cambios) for (const n of c.addedNodes) {
    if (n.nodeType !== 1) continue;
    const pies = n.matches?.('.plegable') ? [n] : n.querySelectorAll('.plegable');
    for (const pie of pies) { vigiaPies.observe(pie.parentElement); plegar(pie); }
  }
}).observe(document.body, { childList: true, subtree: true });

// Tocar en cualquier parte del texto lo abre: «más» solo es un blanco de nada.
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('.plegable.cortado');
  if (!el) return;
  el.dataset.abierto = '1';
  el.classList.remove('cortado');
  el.innerHTML = tintar(el.dataset.texto, !!el.dataset.enlaces);
});

/** Colorea etiquetas y enlaces, que es lo único que pinta cada red. */
function tintar(texto, enlaces) {
  let html = escapar(texto).replace(/#[\p{L}\p{N}_]+/gu, (m) => `<span class="eti">${m}</span>`);
  if (enlaces) html = html.replace(/https?:\/\/[^\s<]+/g, (m) => `<a>${m}</a>`);
  return html;
}


// Iconos de trazo, no emoji: el emoji cambia de dibujo en cada sistema y
// rompía el parecido justo en la fila que más se mira.
const ICONOS = {
  corazon: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.7-7.5-10a4.3 4.3 0 0 1 7.5-2.8A4.3 4.3 0 0 1 19.5 10c0 5.3-7.5 10.5-7.5 10.5z"/></svg>',
  comentar: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5.2A8.5 8.5 0 1 1 21 11.5z"/></svg>',
  enviar: '<svg viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  guardar: '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z"/></svg>',
  pulgar: '<svg viewBox="0 0 24 24"><path d="M7 22V11l5-9a2.2 2.2 0 0 1 2 3l-1 5h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 22z"/><path d="M7 11H3v11h4"/></svg>',
  compartir: '<svg viewBox="0 0 24 24"><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/></svg>',
};

// ── Vistas previas ─────────────────────────────────────────────────────
async function lienzo(post, slide, idx, total, fmt) {
  const c = document.createElement('canvas');
  // Cada formato puede llevar su estilo: una historia a veces pide velo.
  await MOTOR.dibujar(c, post, slide, idx, total, fmt, (post.estilos && post.estilos[fmt]) || post.estilo || 'cinta');
  return c;
}

/**
 * Una foto que se publica tal cual, sin pasar por el motor. Hay posts que no
 * quieren diseño: las cinco de Kuopio son las de la web y lo que cuentan lo
 * cuentan ellas. Se recorta a 4:5 con CSS, que es lo que hace Instagram.
 */
function fotoSuelta(url, entera = false, enc = null) {
  const img = new Image();
  img.className = 'foto-suelta';
  if (enc && !entera) img.style.objectPosition = `${(enc.x ?? 0.5) * 100}% ${(enc.y ?? 0.5) * 100}%`;
  // Entera: el carrusel toma la proporción de la primera, como Instagram.
  if (entera) {
    img.classList.add('entera');
    img.addEventListener('load', () => {
      const carrete = img.closest('.ig-carrete');
      if (carrete && !carrete.style.getPropertyValue('--prop')) {
        carrete.style.setProperty('--prop', `${img.naturalWidth} / ${img.naturalHeight}`);
      }
    }, { once: true });
  }
  img.loading = 'lazy';
  img.src = url;
  img.alt = '';
  return img;
}

/** Las imágenes de un post: sus fotos si las trae, y si no, sus lienzos. */
function piezasDe(p) {
  if (p.fotos && p.fotos.length) return { fotos: p.fotos, n: p.fotos.length };
  const esCarrusel = p.slides.length > 1 && p.kind !== 'entrevista';
  const base = esCarrusel ? p.slides : [p.slides[0]];
  // `fotosExtra`: la portada dibujada y, detrás, fotos tal cual (ya en 4:5).
  const extra = p.fotosExtra || [];
  return { slides: base, extra, n: base.length + extra.length };
}

/**
 * Quién va de colaborador: lo que hay en la cola o lo preparado manda; si no,
 * lo que trae la ficha. Instagram pone «y 2 más»; aquí van los nombres, que
 * es lo que hay que comprobar antes de aprobar.
 */
function colaboradoresDe(p) {
  const ig = (e) => e && e.redes.find((r) => r.red === 'ig');
  const enCola = ig((PROGRAMADO.posts || {})[p.clave]);
  if (enCola && enCola.colaboradores) return enCola.colaboradores;
  const prep = ig(faseDe(p) === 'preparado' ? preparadoDe(p) : null);
  if (prep && prep.colaboradores) return prep.colaboradores;
  return p.colaboradores || [];
}

function conColaboradores(p) {
  const c = colaboradoresDe(p);
  if (!c.length) return CUENTAS.ig;
  const todos = [CUENTAS.ig, ...c.map((x) => `<b class="ig-colab">${escapar(x)}</b>`)];
  return todos.slice(0, -1).join(', ') + ' <span class="ig-y">and</span> ' + todos.at(-1);
}

async function pintarInstagram(p) {
  const piezas = piezasDe(p);
  const slides = piezas.fotos || [...piezas.slides, ...(piezas.extra || [])];
  const caja = document.createElement('div');
  caja.className = 'ig';
  caja.innerHTML = `
    <div class="ig-cab">
      <img class="ig-av" src="${CUENTAS.avatar}" alt="">
      <span class="ig-usuario">${conColaboradores(p)}</span>
      <span class="ig-mas">•••</span>
    </div>
    <div class="ig-carrete"><div class="tira"></div>${slides.length > 1 ? `
      <span class="ig-cuenta">1/${slides.length}</span>
      <button class="paso atras" aria-label="Previous">‹</button>
      <button class="paso alante" aria-label="Next">›</button>` : ''}</div>
    ${slides.length > 1 ? `<div class="ig-puntos">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    <div class="ig-acciones">${ICONOS.corazon}${ICONOS.comentar}${ICONOS.enviar}<span class="guardar">${ICONOS.guardar}</span></div>
    <div class="ig-pie"><b>${CUENTAS.ig}</b>${pintarPie(p.pies.ig.texto, 2, 'mas', 'more', false)}</div>
    <div class="ig-hora">Just now</div>`;

  const tira = caja.querySelector('.tira');
  for (let i = 0; i < slides.length; i++) {
    tira.appendChild(piezas.fotos
      ? fotoSuelta(piezas.fotos[i], p.fotosEnteras, p.encuadre)
      : i >= piezas.slides.length
        ? fotoSuelta(slides[i], true)
        : await lienzo(p, slides[i], i, slides.length, 'ig'));
  }

  // Los puntos y el contador siguen al dedo, como en la app.
  if (slides.length > 1) {
    const puntos = caja.querySelectorAll('.ig-puntos i');
    const cuenta = caja.querySelector('.ig-cuenta');
    // Con ratón no se puede arrastrar la tira, así que van flechas. En el
    // móvil estorban poco y en el escritorio son la única manera de pasar.
    const mover = (d) => tira.scrollBy({ left: d * tira.clientWidth, behavior: 'smooth' });
    caja.querySelector('.atras').addEventListener('click', () => mover(-1));
    caja.querySelector('.alante').addEventListener('click', () => mover(1));
    const marcarFlechas = (i) => {
      caja.querySelector('.atras').disabled = i === 0;
      caja.querySelector('.alante').disabled = i >= slides.length - 1;
    };
    marcarFlechas(0);
    tira.addEventListener('scroll', () => {
      const i = Math.round(tira.scrollLeft / tira.clientWidth);
      puntos.forEach((d, j) => d.classList.toggle('on', j === i));
      if (cuenta) cuenta.textContent = `${i + 1}/${slides.length}`;
      marcarFlechas(i);
    }, { passive: true });
  }
  return caja;
}

/**
 * La imagen ya hecha para una red, si el post está preparado o en la cola.
 * Es lo que va a salir, así que manda sobre cualquier otra cosa: antes la
 * historia y Facebook enseñaban la de Instagram recortada.
 */
function imagenHecha(p, red) {
  const fuentes = [PROGRAMADO.posts || {}, faseDe(p) === 'preparado' ? flujoDe(p).preparado || {} : {}];
  for (const f of fuentes) {
    const e = red === 'story' ? f[p.clave + '#historia'] : f[p.clave];
    const r = e && e.redes.find((x) => x.red === (red === 'story' ? 'ig' : red));
    if (r && r.imagenes && r.imagenes.length) return r.imagenes[0];
  }
  return null;
}

async function pintarFacebook(p) {
  const caja = document.createElement('div');
  caja.className = 'fb';
  caja.innerHTML = `
    <div class="fb-cab">
      <img class="fb-av" src="${CUENTAS.avatar}" alt="">
      <span>
        <div class="fb-nombre">${CUENTAS.fb}</div>
        <div class="fb-meta">Just now · ${ICO.globo}</div>
      </span>
    </div>
    <div class="fb-texto">${pintarPie(p.pies.fb.texto, 5, 'mas', 'See more', true)}</div>
    <div class="fb-acciones">
      <span>${ICONOS.pulgar} Like</span>
      <span>${ICONOS.comentar} Comment</span>
      <span>${ICONOS.compartir} Share</span>
    </div>`;
  const hechaFb = imagenHecha(p, 'fb');
  caja.insertBefore(
    hechaFb ? fotoSuelta(hechaFb, true)
      : p.fotos && p.fotos.length ? fotoSuelta(p.fotos[0], p.fotosEnteras) : await lienzo(p, p.slides[0], 0, 1, 'fb'),
    caja.querySelector('.fb-acciones')
  );
  return caja;
}

async function pintarHistoria(p) {
  const caja = document.createElement('div');
  caja.className = 'story';
  caja.innerHTML = `
    <div class="barrita"><i></i></div>
    <div class="quien">
      <img src="${CUENTAS.avatar}" alt="">
      <span>${CUENTAS.ig}</span>
      <small>now</small>
    </div>
    <div class="responder"><span>Send message</span>${ICONOS.corazon}${ICONOS.enviar}</div>`;
  const hechaSt = imagenHecha(p, 'story');
  caja.insertBefore(
    hechaSt ? fotoSuelta(hechaSt)
      : p.fotos && p.fotos.length && !p.fotosEnteras ? fotoSuelta(p.fotos[0]) : await lienzo(p, p.slides[0], 0, 1, 'story'),
    caja.firstElementChild
  );
  return caja;
}

const PINTORES = { ig: pintarInstagram, fb: pintarFacebook, story: pintarHistoria };

// En el ordenador cabe todo a la vez: Instagram, Facebook y la historia,
// una al lado de otra, sin pestañas que ir tocando.
const ESCRITORIO = window.matchMedia('(min-width: 1000px)');
ESCRITORIO.addEventListener('change', () => {
  if (actual) pintarPrevia(document.querySelector('.red.activo').dataset.red);
});

async function pintarTodas() {
  const esc = $('#escenario');
  esc.classList.add('triple');
  const yo = actual;
  const cols = [['ig', 'Instagram'], ['fb', 'Facebook'], ['story', 'Story']].map(([red, nombre]) => {
    const col = document.createElement('div');
    col.className = `col-previa col-${red}`;
    col.innerHTML = `<h4>${nombre}</h4><div class="hueco-previa"><p class="vacio">Rendering…</p></div>`;
    return [red, col];
  });
  esc.replaceChildren(...cols.map(([, c]) => c));
  // Una detrás de otra: tres lienzos a la vez se pisan las fuentes.
  for (const [red, col] of cols) {
    if (actual !== yo) return;
    const hueco = col.querySelector('.hueco-previa');
    try {
      hueco.replaceChildren(await PINTORES[red](yo));
    } catch (e) {
      hueco.innerHTML = `<p class="vacio">Couldn't render: ${escapar(e.message)}</p>`;
    }
    col.insertAdjacentHTML('beforeend', aprobarRed(yo, red));
  }
}

/** Debajo de cada vista: aprobar esa red, o cuándo sale si ya está aprobada. */
function aprobarRed(p, red) {
  const NOMBRE = { ig: 'Instagram', fb: 'Facebook', story: 'the story' };
  const esDeRed = (k, r) => (red === 'story' ? k.includes('#') || p.formato === 'historia' : !k.includes('#') && r.red === red);
  const enCola = Object.entries(PROGRAMADO.posts || {})
    .filter(([k]) => k === p.clave || k.startsWith(p.clave + '#'))
    .flatMap(([k, e]) => e.redes.filter((r) => esDeRed(k, r)));
  if (enCola.length) {
    const r = enCola[0];
    if (r.estado === 'pausado') return `<p class="fl-red-pausa">${ICO.pausa}Paused: ${escapar(r.pausa || 'I paused it during the check, I will ask you in the chat')}</p>`;
    const txt = r.estado === 'publicado' ? `${ICO.check}Published` : `${ICO.check}Approved · goes out ${horaNY(r.cuando)}`;
    return `<p class="fl-red-ok">${txt}</p>`;
  }
  if (faseDe(p) !== 'preparado') return '';
  const prep = Object.entries(flujoDe(p).preparado || {}).flatMap(([k, e]) => e.redes.filter((r) => esDeRed(k, r)));
  if (!prep.length) return '<p class="fl-red-no">Not posting here.</p>';
  return `<div class="fl-red"><span>Goes out ${horaNY(prep[0].cuando)}</span>
    <button class="fl fl-si" data-accion="confirmar" data-red="${red}" data-clave="${p.clave}">Approve ${NOMBRE[red]}</button></div>`;
}

async function pintarPrevia(red) {
  // Siempre las tres vistas, en scroll: sin pestañas (lo pidió así).
  return pintarTodas();
  const esc = $('#escenario');
  esc.classList.remove('triple');
  esc.innerHTML = '<p class="vacio">Rendering…</p>';
  try {
    const nodo = await PINTORES[red](actual);
    esc.innerHTML = '';
    esc.appendChild(nodo);
  } catch (e) {
    esc.innerHTML = `<p class="vacio">Couldn't render: ${escapar(e.message)}</p>`;
  }
}

// ── Navegación ─────────────────────────────────────────────────────────
function abrir(p) {
  actual = p;
  $('#lista').classList.remove('activa');
  $('#detalle').classList.add('activa');
  $('#atras').hidden = false;
  $('#marca').hidden = true;
  document.body.classList.add('en-detalle');
  // An open post scrolls normally (the full-screen card mode locks scrolling).
  document.body.classList.remove('modo-tarjeta');
  $('#titulo').textContent = p.title;
  pintarEstadoActual();
  pintarProgramar();
  const red = document.querySelector('.red.activo').dataset.red;
  pintarPrevia(red);
  window.scrollTo(0, 0);
}

function volver() {
  actual = null;
  $('#detalle').classList.remove('activa');
  $('#lista').classList.add('activa');
  $('#atras').hidden = true;
  $('#marca').hidden = vista === 'cuentas';
  document.body.classList.remove('en-detalle');
  $('#titulo').textContent = 'Marble';
  mostrarVista();
}

// ── Dónde está en la cola (solo lectura) ─────────────────────────────
//
// La app es para revisar: no programa ni quita nada. Se programa desde el
// chat, que escribe en datos/programado.json; lo marcado «vía app» lo publica
// GitHub Actions (herramientas/publicar-cola.mjs) directamente en Instagram y
// Facebook, y lo «vía Metricool» sale por allí. Aquí solo se enseña el estado.
const RED_LARGA = { ig: 'Instagram', fb: 'Facebook' };

function pintarProgramar() {
  const caja = $('#programar');
  const e = (PROGRAMADO.posts || {})[actual.clave];
  if (!e) { caja.hidden = true; caja.innerHTML = ''; return; }
  caja.hidden = false;
  caja.innerHTML = `<h3>${e.tipo === 'historia' ? 'Story' : 'Post'} in queue</h3>` + e.redes.map((r) => {
    const cuando = new Date(r.cuando).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
    const est = ESTADO_COLA[r.estado] || r.estado || (new Date(r.cuando) < new Date() ? 'out' : 'queued');
    const mal = r.estado === 'error' || r.estado === 'atrasado';
    return `<div class="linea-red">${RED_LARGA[r.red]} · ${cuando} (NY) · <b class="${mal ? 'mal' : ''}">${est}</b> · ${r.via === 'meta' ? 'via app' : 'via Metricool'}`
      + (r.url ? ` · <a href="${r.url}" target="_blank" rel="noopener">view ↗</a>` : '')
      + (r.error ? `<br><span class="mal">${escapar(r.error)}</span>` : '') + '</div>';
  }).join('');
}

function pintarEstadoActual() {
  const e = estadoDe(actual);
  const d = $('#estado-actual');
  const FASES = { aprobado: 'Approved, being prepared', preparado: 'Ready, needs confirming', confirmado: 'Confirmed',
    descartado: 'In the archive', cambios: 'Changes requested', luego: 'For later' };
  const fase = faseDe(actual);
  const porque = actual.porque ? `<p class="porque">${escapar(actual.porque)}</p>` : '';
  if (fase) { d.innerHTML = `Status: <b>${FASES[fase]}</b>${porque}`; $('#acciones-detalle').innerHTML = accionesFlujo(actual) + cajaSugerir(actual); return; }
  d.innerHTML = `Status: <b>${ESTADOS[e.estado] || e.estado}</b>` +
    (e.nota ? ` · ${escapar(e.nota)}` : '') +
    (e.mio ? '' : ' <span style="color:var(--tenue)">(from the old panel)</span>') + porque;
  $('#acciones-detalle').innerHTML = accionesFlujo(actual) + cajaSugerir(actual);
}

// ── La rejilla de lo ya publicado ──────────────────────────────────────
// Cada cuenta tiene el suyo: CreArtBox en historico-ig.json (de Metricool) y
// ADAR en historico-adar.json (de la Graph API, herramientas/historico.mjs).
const HISTORICOS = {};
const ARCHIVO_HISTORICO = { creartbox: 'datos/historico-ig.json', adar: 'datos/historico-adar.json' };
async function cargarHistorico() {
  if (!HISTORICOS[MARCA]) {
    try {
      const r = await fetch(ARCHIVO_HISTORICO[MARCA], { cache: 'no-store' });
      HISTORICOS[MARCA] = r.ok ? await r.json() : { posts: [] };
    } catch { HISTORICOS[MARCA] = { posts: [] }; }
  }
  HISTORICO = HISTORICOS[MARCA];
  return HISTORICO;
}

async function pintarPublicado() {
  await cargarHistorico();
  const p = HISTORICO.posts || [];
  const conFoto = p.filter((r) => r[1]);
  $('#resumen-publicado').textContent =
    `${p.length} posts on @${HISTORICO.cuenta || ''}, from ${p[p.length - 1]?.[0] || ''} to ${p[0]?.[0] || ''}. ` +
    'To avoid repeating yourself: tap one to see the text, the numbers and the link.';
  $('#rejilla').innerHTML = conFoto
    .map((r) => {
      const [fecha, url, , likes, alcance] = r;
      const code = url.replace(/\/$/, '').split('/').pop();
      return `<button data-url="${url}">
        <img src="datos/miniaturas/${fecha.replace(/-/g, '')}-${code}.jpg" alt="" loading="lazy"
             onerror="this.style.visibility='hidden'">
        <span class="num">${ICO.corazon}${likes} · ${alcance}</span>
      </button>`;
    })
    .join('');
}

function abrirPublicada(url) {
  const r = (HISTORICO.posts || []).find((x) => x[1] === url);
  if (!r) return;
  const [fecha, enlace, tipo, likes, alcance, vistas, tema] = r;
  const code = enlace.replace(/\/$/, '').split('/').pop();
  $('#hoja-img').src = `datos/miniaturas/${fecha.replace(/-/g, '')}-${code}.jpg`;
  $('#hoja-datos').innerHTML = `
    <div class="cuando">${fecha} · ${tipo}</div>
    <div class="tema">${escapar(tema)}</div>
    <div class="cifras">
      <span><b>${likes}</b><span>likes</span></span>
      <span><b>${alcance}</b><span>reach</span></span>
      <span><b>${vistas || '—'}</b><span>views</span></span>
    </div>
    <a href="${enlace}" target="_blank" rel="noopener">Open in Instagram ↗</a>`;
  $('#hoja').hidden = false;
}

// ── El circuito: aprobar → preparado → confirmar ──────────────────────
// Lo decidido vive en el repositorio (flujo.json), no en el navegador: se
// lee y se escribe por /api/flujo, y se ve igual en el iPhone y en el
// ordenador. Hace falta haber entrado con GitHub una vez en cada aparato.
let FLUJO = { posts: {} };
let PUEDE_GUARDAR = false;
let LOGIN = '';

/** Arriba: «Entrar» si no hay sesión para guardar; si la hay, quién es (tocando, salir). */
function pintarSesion() {
  const b = $('#sesion');
  b.hidden = false;
  const fila = $('#mas-sesion');
  fila.querySelector('span').textContent = PUEDE_GUARDAR ? `Sign out${LOGIN ? ` (@${LOGIN})` : ''}` : 'Sign in with GitHub';
  fila.href = PUEDE_GUARDAR ? '/api/auth?salir=1' : '/entrar.html';
  fila.classList.toggle('peligro', PUEDE_GUARDAR);
  if (PUEDE_GUARDAR) {
    // Un círculo con la inicial, como la foto de perfil de una app.
    b.textContent = (LOGIN || '?').slice(0, 1).toUpperCase();
    b.classList.add('avatar');
    b.href = '/api/auth?salir=1';
    b.classList.remove('sin');
    b.title = 'Sign out on this device';
  } else {
    b.textContent = 'Sign in';
    b.href = '/entrar.html';
    b.classList.add('sin');
    b.classList.remove('avatar');
    b.title = 'Sign in with GitHub to approve';
  }
}
$('#mas-sesion').addEventListener('click', (e) => {
  if (PUEDE_GUARDAR && !confirm(`Sign out of Marble on this device${LOGIN ? ` (@${LOGIN})` : ''}?`)) e.preventDefault();
});
$('#sesion').addEventListener('click', (e) => {
  if (PUEDE_GUARDAR && !confirm(`Sign out of Marble on this device${LOGIN ? ` (@${LOGIN})` : ''}?`)) e.preventDefault();
});

async function cargarFlujo() {
  try {
    const r = await fetch('/api/flujo', { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.flujo) { FLUJO = j.flujo; PUEDE_GUARDAR = true; LOGIN = j.login || ''; }
    else if (j.entrar) $('#entrar-aviso').hidden = false;
  } catch {}
  pintarSesion();
  if (!FLUJO.posts) FLUJO.posts = {};
  aplicarEdiciones();
}

function flujoDe(p) { return FLUJO.posts[p.clave] || {}; }
function faseDe(p) { return flujoDe(p).fase || ''; }

/** Lo preparado para la cola, la entrada del post (no la de la historia). */
function preparadoDe(p) {
  const f = flujoDe(p);
  return f.preparado ? f.preparado[p.clave] || Object.values(f.preparado)[0] : null;
}

/**
 * Lo editado manda sobre la ficha: textos, fotos y fondo. Y si ya está
 * preparado, se enseña lo preparado, que es exactamente lo que saldrá.
 */
function aplicarEdiciones() {
  for (const m of Object.values(DATOS.marcas || {})) {
    for (const p of m.posts || []) {
      if (!p._orig) p._orig = { ig: p.pies.ig.texto, fb: p.pies.fb.texto, image: p.image, fotos: p.fotos, fotosEnteras: p.fotosEnteras, encuadre: p.encuadre };
      const o = p._orig;
      p.pies.ig.texto = o.ig; p.pies.fb.texto = o.fb; p.image = o.image; p.fotos = o.fotos; p.fotosEnteras = o.fotosEnteras; p.encuadre = o.encuadre;
      const f = FLUJO.posts[p.clave];
      if (!f) continue;
      const ed = f.edicion || {};
      // En la fase de idea hay un solo texto: la idea. Lo adapto yo a cada red
      // al prepararlo; mientras, se enseña igual en todas.
      if (ed.texto != null) { p.pies.ig.texto = ed.texto; p.pies.fb.texto = ed.texto; }
      if (ed.ig != null) p.pies.ig.texto = ed.ig;
      if (ed.fb != null) p.pies.fb.texto = ed.fb;
      if (ed.fondo) p.image = ed.fondo;
      if (ed.fotos && ed.fotos.length) { p.fotos = ed.fotos; p.fotosEnteras = ed.recorte !== 'cortar'; }
      if (ed.encuadre) p.encuadre = ed.encuadre;
      // Si ya está en la cola, el carrusel que se enseña es el que va a salir.
      const cola = (PROGRAMADO.posts || {})[p.clave];
      const igCola = cola && cola.redes.find((r) => r.red === 'ig' && r.estado === 'en cola');
      if (igCola && igCola.imagenes && igCola.imagenes.length) { p.fotos = igCola.imagenes; p.fotosEnteras = true; }
      const prep = f.fase === 'preparado' && preparadoDe(p);
      if (prep) {
        for (const r of prep.redes) if (r.texto != null) p.pies[r.red].texto = r.texto;
        const ig = prep.redes.find((r) => r.red === 'ig');
        if (ig && ig.imagenes && ig.imagenes.length) { p.fotos = ig.imagenes; p.fotosEnteras = true; }
      }
    }
  }
}

function horaNY(iso, conDia = true) {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/New_York' });
  const hora = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  return conDia ? `${dia}, ${hora}` : hora;
}

/** Los botones de cada fase. */
function accionesFlujo(p) {
  if (grupoDe(p) === 'publicado') return '';
  const f = flujoDe(p);
  const b = (accion, texto, clase = '') => `<button class="fl ${clase}" data-accion="${accion}" data-clave="${p.clave}">${texto}</button>`;
  const enCola = (PROGRAMADO.posts || {})[p.clave];
  if (enCola && enCola.redes.every((r) => r.estado === 'en cola')) {
    return `<div class="fl-fila"><span class="fl-dice">Confirmed · goes out ${horaNY(enCola.redes[0].cuando)}</span>${b('quitar', 'Remove from queue', 'fl-suave')}</div>`;
  }
  if (enCola) return '';
  switch (f.fase) {
    case 'aprobado':
      return `<div class="fl-fila"><span class="fl-dice">${ICO.check}Approved · I'm preparing it</span>${b('editar', 'Edit')}${b('recuperar', 'Undo', 'fl-suave')}</div>`;
    case 'preparado': {
      const prep = Object.values(f.preparado || {}).flatMap((e) => e.redes.map((r) => ({ ...r, tipo: e.tipo })));
      const primera = prep.map((r) => r.cuando).sort()[0];
      const donde = [...new Set(prep.map((r) => r.tipo === 'historia' ? 'story' : r.red === 'ig' ? 'Instagram' : 'Facebook'))].join(' + ');
      return `<div class="fl-prep">Goes out <b>${primera ? horaNY(primera) : '—'}</b> · ${donde}</div>
        <div class="fl-fila">${b('confirmar', 'Approve all', 'fl-si')}${b('editar', 'Edit')}${b('cambios', 'Changes')}</div>`;
    }
    case 'descartado':
      return `<div class="fl-fila"><span class="fl-dice">In the archive</span>${b('recuperar', 'Restore', 'fl-suave')}</div>`;
    default:
      return `${f.fase === 'cambios' && f.nota ? `<p class="fl-nota">Changes requested: “${escapar(f.nota)}”</p>` : ''}
        <div class="fl-fila">${b('aprobar', 'Approve', 'fl-si')}${b('editar', 'Edit')}</div>
        <div class="fl-fila fl-segunda">${b('descartar', 'Archive', 'fl-suave')}</div>`;
  }
}

/** El campo de sugerir cambios, con lo ya sugerido encima. */
function cajaSugerir(p) {
  if (grupoDe(p) === 'publicado') return '';
  const sug = flujoDe(p).sugerencias || [];
  const lista = sug.map((x) => `<li class="${x.hecha ? 'hecha' : ''}"><span class="tarea">${escapar(x.texto)}</span>${x.hecha
    ? `<small>${x.respuesta ? escapar(/^hech/i.test(x.respuesta) ? x.respuesta : 'Done: ' + x.respuesta) : 'Done'}</small>` : '<small>Pending: I will do it in the next check</small>'}</li>`).join('');
  return `<div class="sugerir">${lista ? `<ul>${lista}</ul>` : ''}
    <form class="sugerir-form" data-clave="${p.clave}">
      <textarea rows="1" placeholder="Suggest a change…"></textarea>
      <button type="submit">Send</button>
    </form></div>`;
}

/** Las ideas que él ha pedido y todavía no están hechas, encima del muro. */
function pintarIdeasPedidas() {
  const deEsta = (FLUJO.ideas || []).filter((x) => (x.marca || 'creartbox') === MARCA);
  const pend = deEsta.filter((x) => !x.hecha);
  const hechas = deEsta.filter((x) => x.hecha).slice(-2);
  $('#ideas-pedidas').innerHTML = [...pend.map((x) => `<li>${escapar(x.texto)}<small>Pending: I will prepare it in the next check</small></li>`),
    ...hechas.map((x) => `<li class="hecha"><span class="tarea">${escapar(x.texto)}</span><small>${x.respuesta ? escapar(/^hech/i.test(x.respuesta) ? x.respuesta : 'Done: ' + x.respuesta) : 'Done'}</small></li>`)].join('');
}

$('#idea-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (!PUEDE_GUARDAR) { aviso('Sign in with GitHub first (once on this device).'); setTimeout(() => { location.href = '/entrar.html'; }, 900); return; }
  const t = ev.target.querySelector('textarea');
  const texto = t.value.trim();
  if (!texto) { aviso('Write the idea first.'); t.focus(); return; }
  const b = ev.target.querySelector('button');
  if (b.disabled) return;
  b.disabled = true; b.textContent = 'Sending…';
  try {
    const r = await fetch('/api/flujo', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'idea', nota: texto, marca: MARCA }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    FLUJO.ideas = j.ideas;
    t.value = ''; t.style.height = '';
    pintarIdeasPedidas();
    t.blur();
    aviso(`Noted. I'll prepare it in the next "check".`);
  } catch (e) { aviso(e.message, true); }
  b.disabled = false; b.textContent = 'Send';
});

// En el iPhone, tocar «Enviar» con el teclado abierto cierra primero el
// teclado, la página se mueve y el toque cae fuera del botón: no pasaba nada.
// Se envía al apoyar el dedo, sin dejar que el campo pierda el foco.
document.addEventListener('pointerdown', (ev) => {
  const b = ev.target.closest('.sugerir-form button[type="submit"]');
  if (!b || b.disabled) return;
  ev.preventDefault();
  b.form.requestSubmit(b);
});

document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('.sugerir-form[data-clave]');
  if (!f) return;
  ev.preventDefault();
  if (f.dataset.enviando) return;
  if (!PUEDE_GUARDAR) { aviso('Sign in with GitHub first (once on this device).'); setTimeout(() => { location.href = '/entrar.html'; }, 900); return; }
  const t = f.querySelector('textarea');
  const texto = t.value.trim();
  if (!texto) { aviso('Write what to change first.'); t.focus(); return; }
  const b = f.querySelector('button');
  f.dataset.enviando = '1'; b.disabled = true; b.textContent = 'Sending…';
  try {
    await llamarFlujo(f.dataset.clave, 'sugerir', { nota: texto });
    t.blur();
    aviso(`Noted. I'll change it in the next "check".`);
    repintar();
  } catch (e) {
    aviso(e.message, true);
    delete f.dataset.enviando; b.disabled = false; b.textContent = 'Send';
  }
});
// El campo crece con lo que se escribe.
document.addEventListener('input', (ev) => {
  if (!ev.target.matches('.sugerir textarea')) return;
  ev.target.style.height = 'auto';
  ev.target.style.height = ev.target.scrollHeight + 'px';
});

async function llamarFlujo(clave, accion, extra = {}) {
  const r = await fetch('/api/flujo', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave, accion, marca: MARCA, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.entrar) $('#entrar-aviso').hidden = false;
    throw new Error(j.error || `Error ${r.status}`);
  }
  FLUJO.posts[clave] = j.post;
  if (j.cola) {
    for (const k of Object.keys(PROGRAMADO.posts)) if (k === clave || k.startsWith(clave + '#')) delete PROGRAMADO.posts[k];
    Object.assign(PROGRAMADO.posts, j.cola);
  }
  aplicarEdiciones();
  return j;
}

const DICHO = {
  aprobar: `Approved. I'll prepare it and let you know when it's ready to confirm.`,
  descartar: 'Archived. You can find it in Ideas › Archive.',
  luego: 'Parked. You can find it in Ideas › Later.',
  recuperar: 'Back in ideas.',
  cambios: `Noted. I'll make the change and send it back to confirm.`,
  editar: 'Saved.',
  confirmar: 'Approved: goes out automatically on time.',
  blogAprobar: `Approved for blog. I'll publish it on the website.`,
  blogDescartar: 'Off the blog. You can find it in Ideas › Archive.',
  blogRecuperar: 'Back in blog ideas.',
  quitar: 'Removed from queue. Back in "To confirm".',
};

/** Repinta lo que se esté viendo, sin perder el sitio. */
function repintar() {
  const y = window.scrollY;
  pintarCuentaConfirmar();
  if (actual) { pintarEstadoActual(); pintarProgramar(); pintarPrevia(document.querySelector('.red.activo').dataset.red); }
  else mostrarVista();
  requestAnimationFrame(() => window.scrollTo(0, y));
}

async function hacer(clave, accion, extra) {
  try {
    await llamarFlujo(clave, accion, extra);
    aviso(DICHO[accion]);
    repintar();
  } catch (e) {
    aviso(e.message, true);
  }
}

// Un solo toque: lo pidió así. Con `data-red` se aprueba solo esa red.
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('.fl[data-accion]');
  if (!b) return;
  ev.preventDefault();
  const { clave, accion, red } = b.dataset;
  if (!PUEDE_GUARDAR) {
    aviso('Sign in with GitHub first (once on this device).');
    setTimeout(() => { location.href = '/entrar.html'; }, 900);
    return;
  }
  const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === clave);
  if (accion === 'editar') return abrirEditor(p, 'editar');
  if (accion === 'cambios') return abrirEditor(p, 'cambios');
  b.disabled = true;
  hacer(clave, accion, red ? { red } : undefined);
});

function pintarCuentaConfirmar() {
  const n = DATOS.marcas[MARCA].posts.filter((p) => faseDe(p) === 'preparado' && grupoDe(p) === 'confirmar').length;
  $('#cuenta-confirmar').textContent = n ? String(n) : '';
}

function pintarConfirmar() {
  const cont = $('#fichas-conf');
  cont.innerHTML = '';
  const fichas = fichasDe('confirmar').sort((a, b) => {
    const pa = faseDe(a) === 'preparado' ? 0 : 1, pb = faseDe(b) === 'preparado' ? 0 : 1;
    return (mesDe(a) || '').localeCompare(mesDe(b) || '') || pa - pb || a.date.localeCompare(b.date);
  });
  const listos = fichas.filter((p) => faseDe(p) === 'preparado').length;
  $('#resumen-confirmar').textContent = fichas.length
    ? `${listos === 1 ? '1 ready' : `${listos} ready`} to confirm${fichas.length - listos ? ` · ${fichas.length - listos === 1 ? '1 approved' : `${fichas.length - listos} approved`} that I'm preparing` : ''}. Nothing goes out until you approve it.`
    : 'Nothing pending. What you approve in Ideas will show up here once it is ready.';
  $('#historias-conf').hidden = true;
  pintarPorMeses(cont, fichas);
  observarLienzos();
}

// ── El editor ─────────────────────────────────────────────────────────
let editando = null;
let fotosEditor = [];

function aLocalNY(iso) {
  const d = new Date(iso);
  const x = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((q) => [q.type, q.value]));
  return `${x.year}-${x.month}-${x.day}T${x.hour}:${x.minute}`;
}

function pintarFotosEditor() {
  $('#ed-fotos').innerHTML = fotosEditor.length
    ? fotosEditor.map((u, i) => `<span class="ed-foto"><img src="${u}" alt=""><button type="button" data-quitar="${i}" aria-label="Remove">×</button></span>`).join('')
    : '<small>No photos uploaded: the card photo is used.</small>';
  $('#ed-modo').hidden = !fotosEditor.length;
  pintarEncuadre();
}

// ── El encuadre: qué parte de la foto se ve ───────────────────────────
// Se arrastra la foto dentro de un marco 4:5, como en Instagram. «x» e «y»
// van de 0 a 1 (el motor los usa igual); «zoom» solo en el fondo del diseño.
let encuadre = { x: 0.5, y: 0.5, zoom: 1 };

function pintarEncuadre() {
  const modo = document.querySelector('#ed-modo input:checked').value;
  const recorte = document.querySelector('#ed-recorte input:checked').value;
  $('#ed-recorte').hidden = !fotosEditor.length || modo !== 'fotos';
  const ve = fotosEditor.length && (modo === 'fondo' || recorte === 'cortar');
  $('#ed-encuadre').hidden = !ve;
  $('#ed-zoom-campo').hidden = modo !== 'fondo';
  if (!ve) return;
  const img = $('#ed-marco-img');
  if (img.getAttribute('src') !== fotosEditor[0]) img.src = fotosEditor[0];
  const z = modo === 'fondo' ? encuadre.zoom : 1;
  img.style.objectPosition = `${encuadre.x * 100}% ${encuadre.y * 100}%`;
  img.style.transformOrigin = `${encuadre.x * 100}% ${encuadre.y * 100}%`;
  img.style.transform = `scale(${z})`;
  $('#ed-zoom').value = encuadre.zoom;
}

document.querySelectorAll('#ed-modo input, #ed-recorte input').forEach((i) => i.addEventListener('change', pintarEncuadre));
$('#ed-zoom').addEventListener('input', (e) => { encuadre.zoom = Number(e.target.value); pintarEncuadre(); });
$('#ed-centrar').addEventListener('click', () => { encuadre = { x: 0.5, y: 0.5, zoom: 1 }; pintarEncuadre(); });
(() => {
  const marco = $('#ed-marco');
  let ini = null;
  const lim = (v) => Math.min(1, Math.max(0, v));
  marco.addEventListener('pointerdown', (e) => {
    ini = { px: e.clientX, py: e.clientY, x: encuadre.x, y: encuadre.y };
    marco.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  marco.addEventListener('pointermove', (e) => {
    if (!ini) return;
    const r = marco.getBoundingClientRect();
    // Arrastrar a la derecha enseña lo que hay a la izquierda, como con el dedo.
    encuadre.x = lim(ini.x - (e.clientX - ini.px) / r.width);
    encuadre.y = lim(ini.y - (e.clientY - ini.py) / r.height);
    pintarEncuadre();
  });
  const fin = () => { ini = null; };
  marco.addEventListener('pointerup', fin);
  marco.addEventListener('pointercancel', fin);
})();

function abrirEditor(p, modo) {
  editando = { p, modo };
  const f = flujoDe(p);
  const ed = f.edicion || {};
  const notaSolo = modo === 'cambios';
  $('#editor-titulo').textContent = notaSolo ? 'Request changes' : f.fase === 'preparado' ? 'Edit the prepared post' : 'Edit the idea';
  $('#editor-ayuda').textContent = notaSolo
    ? `Tell me what to change. I'll fix it and it goes back to "To confirm".`
    : f.fase === 'preparado'
      ? 'Already prepared: the text for each network and the time change right away. A new photo means I rebuild it.'
      : 'This is the idea: a single text. Once you approve it, I adapt it for Instagram, Facebook and whatever else is needed.';
  $('#editor-campos').hidden = notaSolo;
  $('#editor-nota-campo').hidden = !notaSolo;
  $('#ed-nota').value = notaSolo ? (f.nota || '') : '';
  // Idea: un solo texto. Preparado: uno por red, que es lo que va a salir.
  const porRed = f.fase === 'preparado';
  $('#campo-texto').hidden = porRed;
  $('#campo-ig').hidden = !porRed;
  $('#campo-fb').hidden = !porRed;
  // La hora solo se toca en lo preparado: en una idea la decido yo al prepararla.
  $('#campo-cuando').hidden = !porRed;
  $('#ed-texto').value = ed.texto != null ? ed.texto : p.pies.ig.texto;
  $('#ed-ig').value = p.pies.ig.texto;
  $('#ed-fb').value = p.pies.fb.texto;
  const prep = preparadoDe(p);
  const cuando = ed.cuando || (prep ? aLocalNY(prep.redes[0].cuando) : '');
  $('#ed-cuando').value = cuando;
  fotosEditor = ed.fotos && ed.fotos.length ? [...ed.fotos] : ed.fondo ? [ed.fondo] : [];
  document.querySelector(`#ed-modo input[value="${ed.fotos && ed.fotos.length ? 'fotos' : 'fondo'}"]`).checked = true;
  document.querySelector(`#ed-recorte input[value="${ed.recorte === 'cortar' ? 'cortar' : 'entera'}"]`).checked = true;
  encuadre = { x: 0.5, y: 0.5, zoom: 1, ...(ed.encuadre || {}) };
  pintarFotosEditor();
  $('#editor').hidden = false;
  (notaSolo ? $('#ed-nota') : $('#ed-ig')).focus({ preventScroll: true });
}

function cerrarEditor() { $('#editor').hidden = true; editando = null; }
$('#ed-cancelar').addEventListener('click', cerrarEditor);
$('#editor').addEventListener('click', (e) => { if (e.target.id === 'editor') cerrarEditor(); });
$('#ed-fotos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quitar]');
  if (!b) return;
  fotosEditor.splice(Number(b.dataset.quitar), 1);
  pintarFotosEditor();
});

/** Reduce la foto a 2048 px y la pasa a JPEG antes de subirla. */
async function aJPEG(archivo) {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function subirArchivo(a) {
  const r = await fetch('/api/subir', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datos: await aJPEG(a) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  fotosEditor.push(j.url);
  pintarFotosEditor();
}

// Una foto de la web: el servidor la trae (el navegador no puede, por CORS),
// aquí se reduce y se pasa a JPEG, y se sube como cualquier otra.
$('#ed-url-ok').addEventListener('click', async () => {
  const url = $('#ed-url').value.trim();
  if (!/^https:\/\//.test(url)) return aviso('Paste a URL that starts with https://', true);
  aviso('Fetching the photo…');
  try {
    const r = await fetch('/api/traer?url=' + encodeURIComponent(url), { credentials: 'same-origin' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Error ${r.status}`); }
    await subirArchivo(await r.blob());
    $('#ed-url').value = '';
    aviso('Photo added. Now tap Save.');
  } catch (err) { aviso(`Failed: ${err.message}`, true); }
});

$('#ed-archivo').addEventListener('change', async (e) => {
  const archivos = [...e.target.files];
  e.target.value = '';
  for (const a of archivos) {
    aviso(`Uploading ${a.name}…`);
    try {
      const r = await fetch('/api/subir', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datos: await aJPEG(a) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      fotosEditor.push(j.url);
      pintarFotosEditor();
    } catch (err) { aviso(`Upload failed: ${err.message}`, true); return; }
  }
  aviso('Photos uploaded. Now tap Save.');
});

$('#editor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editando) return;
  const { p, modo } = editando;
  const boton = $('#ed-guardar');
  boton.disabled = true;
  try {
    if (modo === 'cambios') {
      await llamarFlujo(p.clave, 'cambios', { nota: $('#ed-nota').value.trim() });
      aviso(DICHO.cambios);
    } else {
      const f = flujoDe(p), ed = f.edicion || {};
      const edicion = {};
      if (f.fase === 'preparado') {
        const ig = $('#ed-ig').value, fb = $('#ed-fb').value;
        if (ig !== p.pies.ig.texto || ed.ig != null) edicion.ig = ig;
        if (fb !== p.pies.fb.texto || ed.fb != null) edicion.fb = fb;
      } else {
        const t = $('#ed-texto').value;
        if (t !== p.pies.ig.texto || ed.texto != null) edicion.texto = t;
      }
      if (f.fase === 'preparado' && $('#ed-cuando').value) edicion.cuando = $('#ed-cuando').value;
      const modoFoto = document.querySelector('#ed-modo input:checked').value;
      const antes = JSON.stringify([ed.fotos || [], ed.fondo || null]);
      const ahora = fotosEditor.length
        ? (modoFoto === 'fotos' ? [fotosEditor, null] : [[], fotosEditor[0]])
        : [[], null];
      if (JSON.stringify(ahora) !== antes) { edicion.fotos = ahora[0]; edicion.fondo = ahora[1]; }
      if (fotosEditor.length) {
        const recorte = modoFoto === 'fotos' ? document.querySelector('#ed-recorte input:checked').value : null;
        if (recorte !== (ed.recorte || null)) edicion.recorte = recorte;
        const enc = { x: +encuadre.x.toFixed(3), y: +encuadre.y.toFixed(3), zoom: modoFoto === 'fondo' ? +encuadre.zoom.toFixed(2) : 1 };
        const neutro = enc.x === 0.5 && enc.y === 0.5 && enc.zoom === 1;
        if (JSON.stringify(neutro ? null : enc) !== JSON.stringify(ed.encuadre || null)) edicion.encuadre = neutro ? null : enc;
      }
      await llamarFlujo(p.clave, 'editar', { edicion });
      aviso(DICHO.editar);
    }
    cerrarEditor();
    repintar();
  } catch (err) {
    aviso(err.message, true);
  } finally {
    boton.disabled = false;
  }
});

// ── Arranque ───────────────────────────────────────────────────────────
async function arrancar() {
  DATOS = await (await fetch('datos/posts.json', { cache: 'no-store' })).json();
  // Lo que ya está en cola en Metricool. Sin esto, el muro enseñaba como
  // pendiente algo que iba a salir solo esa tarde, y se podía descartar sin
  // enterarse de que ya estaba mandado.
  try {
    const r = await fetch('datos/programado.json', { cache: 'no-store' });
    if (r.ok) PROGRAMADO = await r.json();
  } catch {}
  // Lo ya decidido: del propio sitio, que es lo último desplegado.
  try {
    const r = await fetch(ARCHIVO + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) APROB = await r.json();
  } catch {}
  if (!APROB.posts) APROB.posts = {};
  textosDeMetricool();
  await cargarFlujo();

  const pedida = location.hash.slice(1);
  cambiarMarca(DATOS.marcas[pedida] ? pedida : MARCA);
  if (DATOS.marcas[pedida]) {
    vista = 'ideas';
    document.querySelectorAll('.pest').forEach((x) => x.classList.toggle('activo', x.dataset.vista === vista));
  }
  pintarCuentaConfirmar();
  mostrarVista();
}

/** El texto que cuenta es el que está en Metricool: si allí se cambió a mano,
 *  la app enseña ese y no el de la ficha. */
function textosDeMetricool() {
  for (const m of Object.values(DATOS.marcas || {})) {
    for (const p of m.posts || []) {
      const e = (PROGRAMADO.posts || {})[p.clave];
      if (!e || !p.pies) continue;
      for (const r of e.redes) if (r.texto && p.pies[r.red]) p.pies[r.red].texto = r.texto;
    }
  }
}

function cambiarMarca(m) {
  MARCA = m;
  MOTOR = crearMotor(DATOS.marcas[MARCA].marca);
  CUENTAS = DATOS.marcas[MARCA].cuentas;
  $('#marca-nombre').textContent = DATOS.marcas[MARCA].marca.org;
  $('#marca-avatar').src = CUENTAS.avatar;
  $('#mas-avatar').src = CUENTAS.avatar;
  $('#mas-cuenta').textContent = DATOS.marcas[MARCA].marca.org;
  document.body.dataset.marca = MARCA;
  // El blog es de la web de ADAR: CreArtBox no tiene.
  $('#pest-blog').hidden = !DATOS.marcas[MARCA].posts.some((p) => p.esBlog);
  if (vista === 'blog' && $('#pest-blog').hidden) vista = 'ideas';
  if (DATOS.marcas[MARCA].posts[0]?._orig) pintarCuentaConfirmar();
}

// ── El blog de la web ─────────────────────────────────────────────────
// Los artículos de festivaladar.com/es/blog: los borradores, para leerlos y
// publicarlos con un botón, y los publicados. Cada uno dice qué posts de
// redes llevan a él, y cada post de redes, a qué artículo lleva.
let filtroBlog = 'draft';

/** Markdown sencillo de los artículos: titulares, negritas, cursivas, listas y citas. */
function markdownSimple(md) {
  const enLinea = (t) => escapar(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return String(md || '').replace(/<[^>]+>/g, '').split(/\n{2,}/).map((b) => {
    const t = b.trim();
    if (!t) return '';
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) return `<h4>${enLinea(h[2])}</h4>`;
    if (/^[-*]\s/m.test(t) && t.split('\n').every((l) => /^[-*]\s/.test(l.trim()))) {
      return `<ul>${t.split('\n').map((l) => `<li>${enLinea(l.trim().replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (t.startsWith('>')) return `<blockquote>${enLinea(t.replace(/^>\s?/gm, ''))}</blockquote>`;
    return `<p>${enLinea(t).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

/** En la tarjeta de un post de redes: el artículo del blog al que lleva. */
function articuloDe(p) {
  if (p.esBlog) return '';
  const igual = (x, y) => x && y && x.replace(/\/$/, '') === y.replace(/\/$/, '');
  const a = DATOS.marcas[MARCA].posts.find((x) => x.esBlog && (x.slug === p.blog || igual(x.url, p.url)));
  if (!a) return '';
  return `<p class="articulo-blog">${ICO.doc}Blog article: <b>${escapar(a.title)}</b> · ${a.estadoWeb === 'publish' ? 'published' : 'draft, goes live on the website with this post'}</p>`;
}

/** Los posts de redes que mandan a un artículo (su enlace es el del artículo). */
function postsDeArticulo(a) {
  const igual = (x, y) => x && y && x.replace(/\/$/, '') === y.replace(/\/$/, '');
  return DATOS.marcas[MARCA].posts.filter((p) => !p.esBlog && (p.blog === a.slug || igual(p.url, a.url)));
}

/** Un artículo del blog: foto, estado, entradilla, sus posts de redes, el texto entero y los botones. */
function tarjetaBlog(a) {
  const posts = postsDeArticulo(a);
  const publicado = a.estadoWeb === 'publish';
  const fase = flujoDe(a).faseBlog;
  const btn = (accion, texto, clase = '') => `<button class="fl ${clase}" data-accion="${accion}" data-clave="${escapar(a.clave)}">${texto}</button>`;
  const cuando = posts.find((p) => p.publicaEl)?.publicaEl;
  let acciones;
  if (publicado) acciones = `<a class="fl" href="${escapar(a.url)}" target="_blank" rel="noopener">View on website ↗</a>`;
  else if (fase === 'aprobado') acciones = `<span class="fl-dice">${ICO.check}Approved for blog · goes live on the website ${cuando ? `on ${cuando.split('-').slice(1).join('/')}, with its post` : 'in the next check'}</span>
      ${btn('blogRecuperar', 'Undo', 'fl-suave')}<button class="fl blog-publicar">Publish now</button>`;
  else if (fase === 'descartado') acciones = btn('blogRecuperar', 'Restore', 'fl-suave');
  else acciones = `${btn('blogAprobar', 'Approve for blog', 'fl-si')}${btn('blogDescartar', 'Archive', 'fl-suave')}`;
  return `<article class="blog-art" data-slug="${escapar(a.slug)}">
    ${a.image ? `<img class="blog-foto" src="${escapar(a.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    <div class="blog-cuerpo">
      <p class="blog-estado ${publicado ? 'pub' : 'borr'}">${ICO.doc}Blog · ${publicado ? 'published on the website' : 'draft'}</p>
      <h3>${escapar(a.title)}</h3>
      ${a.excerpt ? `<p class="blog-entradilla">${escapar(a.excerpt)}</p>` : ''}
      <p class="blog-redes">${posts.length
        ? 'With its social post: ' + posts.map((p) => `<button class="blog-post" data-clave="${escapar(p.clave)}">${escapar(p.title)} · ${escapar(p.publicaEl || p.date || '')}</button>`).join(' ')
        : '<span class="tenue">No social post: if you approve it, I will suggest one.</span>'}</p>
      <details class="blog-texto"><summary>Read the full article</summary>${markdownSimple(a.cuerpo)}</details>
      <div class="blog-acciones">${acciones}</div>
      ${publicado ? '' : cajaSugerir(a)}
    </div>
  </article>`;
}

function pintarBlog() {
  const todos = DATOS.marcas[MARCA].posts.filter((p) => p.esBlog);
  const borr = todos.filter((a) => a.estadoWeb !== 'publish');
  const lista = (filtroBlog === 'publish' ? todos.filter((a) => a.estadoWeb === 'publish') : borr)
    .sort((a, b) => {
      // Primero los que tienen un post de redes esperando, por su fecha.
      const fa = postsDeArticulo(a)[0], fb = postsDeArticulo(b)[0];
      return (fa ? 0 : 1) - (fb ? 0 : 1) || String(fa?.date || a.date).localeCompare(String(fb?.date || b.date));
    });
  $('#resumen-blog').textContent = `${todos.length - borr.length} published on festivaladar.com · ${borr.length} drafts. ` +
    'A draft goes live on the website when you tap "Publish to website", or on the day the social post announcing it goes out.';
  $('#filtros-blog').querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c.dataset.filtro === filtroBlog));
  mazo($('#lista-blog'), lista.map((a) => {
    const t = document.createElement('template');
    t.innerHTML = tarjetaBlog(a).trim();
    return { nodo: t.content.firstElementChild, etiqueta: a.estadoWeb === 'publish' ? 'Published article' : 'Draft' };
  }));
  if (!lista.length) $('#lista-blog').innerHTML = '<p class="vacio">Nothing here.</p>';
}

$('#filtros-blog').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  filtroBlog = b.dataset.filtro;
  pintarBlog();
});
for (const donde of ['#lista-blog', '#fichas']) $(donde).addEventListener('click', async (e) => {
  const post = e.target.closest('.blog-post');
  if (post) {
    const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === post.dataset.clave);
    if (p) abrir(p);
    return;
  }
  const btn = e.target.closest('.blog-publicar');
  if (!btn) return;
  e.stopPropagation();
  const art = btn.closest('.blog-art');
  const a = DATOS.marcas[MARCA].posts.find((x) => x.esBlog && x.slug === art.dataset.slug);
  if (!PUEDE_GUARDAR) { aviso('Sign in with GitHub first (once on this device).'); return; }
  if (!confirm(`Publish "${a.title}" on festivaladar.com now?`)) return;
  btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const r = await fetch('/api/flujo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: a.slug, accion: 'blogPublicar' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    a.estadoWeb = 'publish';
    aviso('Published. It will be on festivaladar.com in a couple of minutes.');
    repintar();
  } catch (err) { btn.disabled = false; btn.textContent = 'Publish to website'; aviso(err.message, true); }
});

// ── La entrada: elegir la cuenta ──────────────────────────────────────
// Lo primero es decir de qué cuenta se habla, para no aprobar lo de una
// pensando en la otra. Arriba queda siempre la cuenta elegida; tocándola se
// vuelve aquí. #adar o #creartbox en la dirección entran directos.
let CONECTADAS = null; // { creartbox: true, adar: false }: si publica sola

async function pintarCuentas() {
  if (!CONECTADAS) {
    try {
      const r = await fetch('/api/meta-estado?resumen=1', { credentials: 'same-origin', cache: 'no-store' });
      CONECTADAS = r.ok ? await r.json() : {};
    } catch { CONECTADAS = {}; }
  }
  const antes = MARCA;
  const tarjetas = Object.keys(DATOS.marcas).sort((a, b) => (a === 'creartbox' ? -1 : b === 'creartbox' ? 1 : 0)).map((m) => {
    MARCA = m; // fichasDe, faseDe y grupoDe miran la marca de ahora
    const d = DATOS.marcas[m];
    const posts = d.posts;
    const porConfirmar = posts.filter((p) => faseDe(p) === 'preparado').length;
    const ideas = posts.filter((p) => grupoDe(p) === 'idea' && !faseDe(p) && !(p.ventana && hoyISO() > p.ventana.hasta)).length;
    const enCola = Object.entries(PROGRAMADO.posts || {}).filter(([k]) => posts.some((p) => k === p.clave || k.startsWith(p.clave + '#')))
      .flatMap(([, e]) => e.redes).filter((r) => r.estado === 'en cola' && new Date(r.cuando) > new Date());
    const proxima = enCola.map((r) => r.cuando).sort()[0];
    const conectada = CONECTADAS[m];
    const estado = conectada === true
      ? '<span class="cuenta-ok">Posts automatically</span>'
      : conectada === false
        ? '<span class="cuenta-falta">Connect Meta to publish</span>'
        : '';
    return `<button class="cuenta-tarjeta" data-marca="${m}">
      <img class="cuenta-avatar" src="${d.cuentas.avatar}" alt="">
      <span class="cuenta-texto">
        <b>${escapar(d.marca.org)}</b>
        <small>@${escapar(d.cuentas.ig)} · ${escapar(d.cuentas.fb)}</small>
        <span class="cuenta-cifras">${porConfirmar ? `<em>${porConfirmar} to confirm</em> · ` : ''}${ideas} ${ideas === 1 ? 'idea' : 'ideas'} · ${enCola.length} queued${proxima ? ` · next ${new Date(proxima).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'America/New_York' })}` : ''}</span>
        ${estado}
      </span>
      <span class="cuenta-flecha">›</span>
    </button>`;
  });
  MARCA = antes;
  const falta = Object.values(CONECTADAS).some((v) => v === false);
  $('#cuentas-lista').innerHTML = tarjetas.join('')
    + (falta ? '<p class="aviso-suave">To connect an account: <a href="/api/meta-conectar">Connect with Meta</a> and select both Pages on Facebook. You can already work on both; anything you confirm for an unconnected account waits in the queue.</p>' : '');
}

function entrarEnCuenta(m) {
  if (!DATOS.marcas[m]) return;
  cambiarMarca(m);
  // El calendario de una marca no tiene por qué dejar a la otra en el mismo día.
  calMes = null; calDia = null; MES = null;
  // Se entra por Ideas, con todos los meses; «‹ Meses» lleva al resumen.
  vista = 'ideas';
  document.querySelectorAll('.pest').forEach((x) => x.classList.toggle('activo', x.dataset.vista === vista));
  history.replaceState(null, '', '#' + m);
  mostrarVista();
  window.scrollTo(0, 0);
}

$('#cuentas-lista').addEventListener('click', (e) => {
  const b = e.target.closest('.cuenta-tarjeta');
  if (b) entrarEnCuenta(b.dataset.marca);
});

$('#atras').addEventListener('click', volver);
// The logo (header and side bar) goes back to the home page: choosing the account.
function irAInicio() {
  if (actual) volver();
  if (!$('#revision').hidden) cerrarRevision();
  MES = null; vista = 'cuentas';
  history.replaceState(null, '', location.pathname + location.search);
  mostrarVista();
  window.scrollTo(0, 0);
}
for (const el of document.querySelectorAll('.barra .logo-marca, .barra .marca-palabra, .lateral-marca')) {
  el.setAttribute('role', 'link');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', 'Marble home');
  el.addEventListener('click', irAInicio);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') irAInicio(); });
}
$('#marca').addEventListener('click', () => {
  MES = null; vista = 'cuentas';
  history.replaceState(null, '', location.pathname + location.search);
  mostrarVista();
  window.scrollTo(0, 0);
});
$('#filtros').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  $('#filtros').querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c === b));
  filtro = b.dataset.filtro;
  pintarLista();
});
$('#redes').addEventListener('click', (e) => {
  const b = e.target.closest('.red');
  if (!b) return;
  document.querySelectorAll('.red').forEach((c) => c.classList.toggle('activo', c === b));
  pintarPrevia(b.dataset.red);
});
for (const donde of ['#historias', '#historias-prog', '#historias-pub']) {
  $(donde).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-clave]');
    if (b) abrirHistoria(b.dataset.clave);
  });
}
$('#visor-cerrar').addEventListener('click', () => { $('#visor').hidden = true; });
// ── Calendario ─────────────────────────────────────────────────────────
// El mes que se ve y el día elegido. Se fijan al entrar por primera vez, en
// el día de hoy, y después se quedan donde se dejaron aunque se salga a ver
// una ficha y se vuelva.
let calMes = null; // 'AAAA-MM'
let calDia = null; // 'AAAA-MM-DD'

/** Hoy, en la hora de quien mira. */
const hoyISO = () => new Date().toLocaleDateString('en-CA');

/**
 * Todo lo que tiene día, agrupado por día. Cuatro fuentes:
 *   · el histórico de Instagram: lo ya publicado, con su enlace;
 *   · lo que está en cola en Metricool, que si ya pasó de hora cuenta como
 *     salido (se deduce del reloj, no se ha comprobado);
 *   · las ideas que traen su propio día, que son las escritas a mano;
 *   · los conciertos, que son el calendario del que cuelga todo lo demás.
 * Lo descartado no está en el plan y no sale.
 */
function eventosCalendario() {
  const por = new Map();
  const poner = (e) => {
    if (!por.has(e.fecha)) por.set(e.fecha, []);
    por.get(e.fecha).push(e);
  };

  // Lo ya publicado en el Instagram de la cuenta en la que se está.
  if (HISTORICO === HISTORICOS[MARCA]) {
    for (const [fecha, url, tipo, , , , tema] of (HISTORICO?.posts || [])) {
      const code = url.replace(/\/$/, '').split('/').pop();
      poner({
        fecha, forma: 'post', estado: 'publicado', url, titulo: tema, tipo,
        miniatura: `datos/miniaturas/${fecha.replace(/-/g, '')}-${code}.jpg`,
        redes: ['ig'],
      });
    }
  }
  if (MARCA === 'creartbox') {
    for (const c of DATOS.marcas[MARCA].etiquetas.conciertos) {
      poner({ fecha: c.fecha, forma: 'concierto', estado: 'concierto', titulo: c.nombre, sitio: c.sitio });
    }
  }

  for (const p of DATOS.marcas[MARCA].posts) {
    const prog = (PROGRAMADO.posts || {})[p.clave];
    const forma = p.formato === 'historia' ? 'historia' : 'post';
    // Sin foto de origen —como el cartel— se usa la imagen ya dibujada, que
    // `herramientas/preparar-imagenes.mjs` deja con este nombre para todo lo
    // que se programa. Si no existe, el cuadrado se queda gris.
    const dibujada = prog ? `imagenes/${p.clave.replace('/', '-')}-${forma === 'historia' ? 'st' : 'ig'}-1.jpg` : '';
    const comun = {
      forma, titulo: p.title, clave: p.clave,
      miniatura: (p.fotos && p.fotos[0]) || p.image || dibujada,
    };
    if (prog) {
      const cuando = prog.redes[0].cuando;
      const hecha = prog.redes[0].imagenes && prog.redes[0].imagenes[0];
      poner({
        ...comun, ...(hecha ? { miniatura: hecha } : {}), fecha: aLocalNY(cuando).slice(0, 10), hora: aLocalNY(cuando).slice(11, 16), iso: cuando,
        estado: yaSalio(prog) ? 'publicado' : 'programado', salio: yaSalio(prog),
        // Lo que está en cola y todavía espera material saldrá igualmente: por
        // eso es donde más conviene que el calendario lo diga.
        falta: Boolean(p.falta) && !yaSalio(prog),
        redes: prog.redes.map((r) => r.red),
      });
    } else if (faseDe(p) === 'preparado' && preparadoDe(p)) {
      // Lo preparado ya tiene día y hora, aunque falte confirmarlo.
      const cuando = preparadoDe(p).redes[0].cuando;
      const hecha = preparadoDe(p).redes[0].imagenes && preparadoDe(p).redes[0].imagenes[0];
      poner({ ...comun, ...(hecha ? { miniatura: hecha } : {}), fecha: aLocalNY(cuando).slice(0, 10), hora: aLocalNY(cuando).slice(11, 16), iso: cuando,
        estado: 'idea', falta: Boolean(p.falta) });
    } else if (['idea', 'confirmar'].includes(grupoDe(p)) && p.publicaEl
      && faseDe(p) !== 'descartado' && estadoDe(p).estado !== 'descartado') {
      poner({ ...comun, fecha: p.publicaEl, estado: 'idea', falta: Boolean(p.falta) });
    }
  }

  // Las historias que salen en otro día que su post (cobertura diaria):
  // cada una en su día, con su color.
  for (const p of DATOS.marcas[MARCA].posts) {
    const fuentes = [
      ...Object.entries(PROGRAMADO.posts || {}).map(([k, e]) => [k, e, 'cola']),
      ...(faseDe(p) === 'preparado' ? Object.entries(flujoDe(p).preparado || {}).map(([k, e]) => [k, e, 'prep']) : []),
    ];
    const vistas = new Set();
    for (const [k, e, de] of fuentes) {
      if (!k.startsWith(p.clave + '#') || vistas.has(k)) continue;
      vistas.add(k);
      const r = e.redes[0];
      const salio = de === 'cola' && yaSalio(e);
      poner({
        forma: 'historia', titulo: p.title, clave: p.clave, subclave: k,
        miniatura: (r.imagenes && r.imagenes[0]) || p.image || '',
        fecha: aLocalNY(r.cuando).slice(0, 10), hora: aLocalNY(r.cuando).slice(11, 16), iso: r.cuando,
        estado: de === 'prep' ? 'idea' : salio ? 'publicado' : 'programado', salio, redes: ['ig'],
      });
    }
  }

  // Dentro de un día, por hora; lo que no tiene hora, al final.
  for (const lista of por.values()) lista.sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99'));
  return por;
}

const NOMBRE_RED = { ig: 'IG', fb: 'FB' };
const horaMadrid = (iso) => new Date(iso).toLocaleTimeString('en-US', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
});
const largo = (fecha, opciones) => new Date(fecha + 'T12:00:00Z')
  .toLocaleDateString('en-US', { ...opciones, timeZone: 'UTC' });

async function pintarCalendario() {
  await cargarHistorico();
  const hoy = hoyISO();
  if (!calMes) { calMes = hoy.slice(0, 7); calDia = hoy; }
  const por = eventosCalendario();

  const [a, m] = calMes.split('-').map(Number);
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const desfase = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const semanas = Math.ceil((desfase + diasMes) / 7);
  $('#cal-titulo').textContent = largo(`${calMes}-01`, { month: 'long', year: 'numeric' });

  let celdas = '';
  for (let i = 0; i < semanas * 7; i++) {
    const d = i - desfase + 1;
    if (d < 1 || d > diasMes) { celdas += '<span class="cal-celda vacia"></span>'; continue; }
    const fecha = `${calMes}-${String(d).padStart(2, '0')}`;
    const dia = por.get(fecha) || [];
    const concierto = dia.some((e) => e.forma === 'concierto');
    const marcas = dia.filter((e) => e.forma !== 'concierto');
    const cuantas = marcas.length;
    celdas += `<button class="cal-celda${fecha === hoy ? ' hoy' : ''}${fecha === calDia ? ' sel' : ''}"
        data-fecha="${fecha}"
        aria-label="${largo(fecha, { day: 'numeric', month: 'long' })}${cuantas ? `: ${cuantas}` : ''}${concierto ? ', concert' : ''}">
      <span class="cal-num">${d}</span>
      <span class="cal-marcas">${marcas.slice(0, 4)
        .map((e) => `<i class="cal-marca ${e.forma} ${e.estado}"></i>`).join('')}${cuantas > 4 ? `<small class="cal-mas">+${cuantas - 4}</small>` : ''}</span>
      ${concierto ? '<span class="cal-barra"></span>' : ''}
    </button>`;
  }
  $('#cal-rejilla').innerHTML = celdas;
  pintarDiaCalendario(por);
}

function filaCalendario(e) {
  const sello = e.estado === 'idea' ? 'idea or to confirm' : e.estado === 'programado' ? 'queued' : (e.salio ? 'out' : 'published');
  const redes = (e.redes || []).map((r) => NOMBRE_RED[r] || r).join('+');
  const cuando = e.hora ? `${e.hora} NY · ${horaMadrid(e.iso)} Madrid` : '';
  const meta = [sello, cuando, redes].filter(Boolean).join(' · ');
  const mini = e.miniatura
    ? `<img class="cal-mini" src="${e.miniatura}" alt="" loading="lazy" decoding="async"
           onerror="this.style.visibility='hidden'">`
    : '<span class="cal-mini"></span>';
  return `<button class="cal-item" ${e.url ? `data-url="${e.url}"` : `data-clave="${e.clave}"`}>
    ${mini}
    <span class="cal-texto">
      <span class="cal-meta"><span class="cal-tipo ${e.forma}">${e.forma === 'historia' ? 'Story' : 'Post'}</span><i class="cal-marca ${e.forma} ${e.estado}"></i>${escapar(meta)}</span>
      <b>${escapar(e.titulo)}</b>
      ${e.falta ? '<span class="cal-falta">missing</span>' : ''}
    </span>
  </button>`;
}

function pintarDiaCalendario(por) {
  const cont = $('#cal-dia');
  if (!calDia) {
    cont.innerHTML = '<p class="aviso-suave">Nothing this month.</p>';
    return;
  }
  const dia = por.get(calDia) || [];
  const concierto = dia.find((e) => e.forma === 'concierto');
  const cosas = dia.filter((e) => e.forma !== 'concierto');
  cont.innerHTML = `
    <h3>${largo(calDia, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    ${concierto ? `<p class="cal-aviso-concierto"><b>${escapar(concierto.titulo)}</b>${concierto.sitio ? ' · ' + escapar(concierto.sitio) : ''}</p>` : ''}
    ${cosas.length ? cosas.map(filaCalendario).join('') : '<p class="aviso-suave">Nothing on this day.</p>'}`;
}

/** Cambia de mes. Si el día elegido no cae en el nuevo, se elige el primero con algo. */
async function moverMes(delta) {
  const [a, m] = calMes.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1 + delta, 1));
  calMes = `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}`;
  await cargarHistorico();
  const hoy = hoyISO();
  if (!calDia || !calDia.startsWith(calMes)) {
    const por = eventosCalendario();
    const conAlgo = [...por.keys()].filter((k) => k.startsWith(calMes)).sort();
    calDia = hoy.startsWith(calMes) ? hoy : (conAlgo[0] || null);
  }
  pintarCalendario();
}

$('#cal-ant').addEventListener('click', () => moverMes(-1));
$('#cal-sig').addEventListener('click', () => moverMes(1));
$('#cal-hoy').addEventListener('click', () => { calMes = hoyISO().slice(0, 7); calDia = hoyISO(); pintarCalendario(); });
$('#cal-rejilla').addEventListener('click', (e) => {
  const b = e.target.closest('.cal-celda[data-fecha]');
  if (!b) return;
  calDia = b.dataset.fecha;
  pintarCalendario();
});
$('#cal-dia').addEventListener('click', (e) => {
  const b = e.target.closest('.cal-item');
  if (!b) return;
  if (b.dataset.url) return abrirPublicada(b.dataset.url);
  const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === b.dataset.clave);
  if (!p) return;
  if (p.formato === 'historia') abrirHistoria(p.clave); else abrir(p);
});

/** Enseña el apartado que toque y pinta solo ese. */
const TITULOS = { ideas: 'Ideas', confirmar: 'To confirm', programado: 'Scheduled', publicado: 'Published', calendario: 'Calendar', blog: 'Blog', meses: 'Months', mas: 'More' };

function mostrarVista() {
  const enCuentas = vista === 'cuentas';
  document.body.dataset.marca = enCuentas ? '' : MARCA;
  document.body.classList.toggle('con-pestanas', !enCuentas);
  // Review views are full-screen flashcards on the phone (see estilo.css).
  document.body.classList.toggle('modo-tarjeta', ['ideas', 'confirmar', 'blog'].includes(vista));
  $('#idea-nueva').classList.remove('abierta');
  const enMeses = vista === 'meses';
  $('#vista-cuentas').hidden = !enCuentas;
  $('#marca').hidden = enCuentas || !!actual;
  $('#vista-meses').hidden = !enMeses;
  $('#vista-mas').hidden = vista !== 'mas';
  $('#pestanas').hidden = enCuentas;
  $('#mes-barra').hidden = !(vista === 'ideas' || vista === 'confirmar');
  // Título grande, como en las apps del iPhone, con la cuenta encima.
  $('#cabeza-vista').hidden = enCuentas;
  $('#titulo-grande').textContent = TITULOS[vista] || '';
  $('#cabeza-cuenta').textContent = DATOS.marcas[MARCA].marca.org;
  // En el móvil, Programado, Publicado y Meses viven dentro de «Más».
  const enMas = ['mas', 'programado', 'publicado', 'meses'].includes(vista);
  document.querySelectorAll('.pest').forEach((x) => x.classList.toggle('activo', x.dataset.vista === vista || (x.dataset.vista === 'mas' && enMas)));
  pintarSaltos();
  pintarBotonRevisar();
  $('#vista-ideas').hidden = vista !== 'ideas';
  $('#vista-programado').hidden = vista !== 'programado';
  $('#vista-confirmar').hidden = vista !== 'confirmar';
  $('#vista-publicado').hidden = vista !== 'publicado';
  $('#vista-calendario').hidden = vista !== 'calendario';
  $('#vista-blog').hidden = vista !== 'blog';
  if (enCuentas) pintarCuentas();
  else if (enMeses) pintarMeses();
  else if (vista === 'ideas') pintarLista();
  else if (vista === 'programado') pintarProgramado();
  else if (vista === 'confirmar') pintarConfirmar();
  else if (vista === 'calendario') pintarCalendario();
  else if (vista === 'blog') pintarBlog();
  else { pintarPublicadas(); pintarPublicado(); }
}

// ── Los meses: la entrada ──────────────────────────────────────────────
const MESES_ES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function nombreMes(m) { const [a, n] = m.split('-').map(Number); const t = `${MESES_ES[n - 1]} ${a}`; return t[0].toUpperCase() + t.slice(1); }
/** Cada cuenta cierra sus meses: los de ADAR se guardan como «adar:AAAA-MM». */
const claveMes = (m) => (MARCA === 'creartbox' ? m : `${MARCA}:${m}`);
function sumaMes(m, d) { const [a, n] = m.split('-').map(Number); const f = new Date(Date.UTC(a, n - 1 + d, 1)); return f.toISOString().slice(0, 7); }

async function pintarMeses() {
  await cargarHistorico();
  const por = eventosCalendario();
  const resumen = new Map();
  for (const [fecha, lista] of por) {
    const m = fecha.slice(0, 7);
    for (const e of lista) {
      if (e.forma === 'concierto') continue;
      const r = resumen.get(m) || resumen.set(m, { cosas: [] }).get(m);
      r[e.forma] = (r[e.forma] || 0) + 1;
      r[e.estado] = (r[e.estado] || 0) + 1;
      r.cosas.push({ ...e, fecha });
    }
  }
  const hoy = hoyISO().slice(0, 7);
  // De octubre de 2026 a dos meses vista, y los meses más lejanos que ya tengan algo.
  const meses = [];
  for (let m = '2026-10'; m <= sumaMes(hoy, 2); m = sumaMes(m, 1)) meses.push(m);
  // Más allá, solo los meses que ya tengan algo preparado.
  for (const m of [...resumen.keys()].sort()) if (m > sumaMes(hoy, 2) && !meses.includes(m) && resumen.get(m).cosas.length) meses.push(m);
  const cerrados = FLUJO.meses || {};
  const tarjeta = (m) => {
    const r = resumen.get(m) || { cosas: [] };
    const cosas = r.cosas.sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
    const MAX = 40;
    const minis = cosas.slice(0, MAX).map((e) => `<span class="mes-mini ${e.forma} ${e.estado}" title="${escapar(e.titulo)}">${e.miniatura
      ? `<img src="${e.miniatura}" alt="" loading="lazy" onerror="this.remove()">` : ''}<small>${Number(e.fecha.slice(8))}</small></span>`).join('')
      + (cosas.length > MAX ? `<span class="mes-mas">+${cosas.length - MAX}</span>` : '');
    const total = (r.post || 0) + (r.historia || 0);
    const hechos = (r.publicado || 0) + (r.programado || 0);
    const pct = total ? Math.round((hechos / total) * 100) : 0;
    const terminado = cerrados[claveMes(m)] && cerrados[claveMes(m)].terminado;
    const pasado = m < hoy;
    return `<article class="mes-tarjeta${m === hoy ? ' actual' : ''}${terminado ? ' terminado' : ''}" data-mes="${m}">
      <div class="mes-cab"><h3>${nombreMes(m)}</h3>${m === hoy ? '<span class="mes-hoy">this month</span>' : ''}</div>
      ${minis ? `<div class="mes-minis">${minis}</div>` : '<p class="mes-vacio">Nothing yet.</p>'}
      <p class="mes-cifras"><b>${r.post || 0}</b> posts · <b>${r.historia || 0}</b> stories</p>
      <div class="mes-barra-pct"><i style="width:${pct}%"></i></div>
      <p class="mes-estado">${pct}% done · ${r.publicado || 0} published · ${r.programado || 0} queued · ${r.idea || 0} to confirm or ideas</p>
      <label class="mes-check"><input type="checkbox" data-mes="${m}" ${terminado ? 'checked' : ''}> Month done${pasado ? '' : ', all scheduled'}</label>
    </article>`;
  };
  // Los meses que ya pasaron, al archivo: plegados al final.
  const vivos = meses.filter((m) => m >= hoy);
  const pasados = meses.filter((m) => m < hoy).reverse();
  $('#meses-lista').innerHTML = vivos.map(tarjeta).join('')
    + (pasados.length ? `<details class="meses-archivo"><summary>Past months (${pasados.length})</summary>
        <div class="meses-lista">${pasados.map(tarjeta).join('')}</div></details>` : '');
}

$('#meses-lista').addEventListener('click', async (e) => {
  const cb = e.target.closest('input[type="checkbox"][data-mes]');
  if (cb) {
    e.stopPropagation();
    if (!PUEDE_GUARDAR) { cb.checked = !cb.checked; aviso('Sign in with GitHub first (once on this device).'); return; }
    try {
      const r = await fetch('/api/flujo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'mes', mes: claveMes(cb.dataset.mes), terminado: cb.checked }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      FLUJO.meses = j.meses;
      aviso(cb.checked ? `${nombreMes(cb.dataset.mes)}: done.` : `${nombreMes(cb.dataset.mes)}: reopened.`);
      pintarMeses();
    } catch (err) { cb.checked = !cb.checked; aviso(err.message, true); }
    return;
  }
  if (e.target.closest('.mes-check')) return;
  const t = e.target.closest('.mes-tarjeta');
  if (!t) return;
  MES = t.dataset.mes;
  calMes = MES; calDia = hoyISO().startsWith(MES) ? hoyISO() : `${MES}-01`;
  // Si hay algo por confirmar ese mes, se entra por ahí; si no, por las ideas.
  const porConfirmar = DATOS.marcas[MARCA].posts.some((p) => faseDe(p) === 'preparado' && mesDe(p) === MES);
  const ideas = DATOS.marcas[MARCA].posts.some((p) => grupoDe(p) === 'idea' && !faseDe(p) && mesDe(p) === MES && !(p.ventana && hoyISO() > p.ventana.hasta));
  vista = porConfirmar ? 'confirmar' : ideas ? 'ideas' : 'calendario';
  document.querySelectorAll('.pest').forEach((x) => x.classList.toggle('activo', x.dataset.vista === vista));
  // Las listas enseñan todos los meses seguidos: se entra en el elegido y
  // se sigue bajando a los siguientes sin salir.
  const elegido = MES;
  MES = null;
  window.scrollTo(0, 0);
  mostrarVista();
  requestAnimationFrame(() => irAMes(elegido));
});
/** Los meses de arriba: saltan a ese mes dentro de la lista, que los tiene todos. */
function pintarSaltos() {
  const conLista = vista === 'ideas' || vista === 'confirmar';
  $('#mes-saltos').hidden = !conLista;
  if (!conLista) return;
  const grupo = vista === 'ideas' ? 'idea' : 'confirmar';
  const meses = [...new Set(DATOS.marcas[MARCA].posts
    .filter((p) => !p.esBlog && grupoDe(p) === grupo && !(grupo === 'idea' && (faseDe(p) === 'descartado' || (!faseDe(p) && p.ventana && HOY > p.ventana.hasta))))
    .map(mesDe).filter(Boolean))].sort();
  const corto = (m) => { const [a, n] = m.split('-').map(Number); const t = MESES_ES[n - 1].slice(0, 3); return t[0].toUpperCase() + t.slice(1) + (a !== new Date().getFullYear() ? ` ${String(a).slice(2)}` : ''); };
  $('#mes-saltos').innerHTML = meses.map((m) => `<button data-mes="${m}">${corto(m)}</button>`).join('')
    + (vista === 'ideas' && ideasDeBlog(filtro === 'archivo').length ? `<button data-mes="blog">${ICO.doc}Blog</button>` : '');
}
$('#mes-saltos').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mes]');
  if (!b) return;
  irAMes(b.dataset.mes);
});
function irAMes(m) {
  // In the flashcards: jump to the first card of that month (or of the blog).
  const cont = vista === 'confirmar' ? $('#fichas-conf') : $('#fichas');
  const s = cont && cont.querySelector(`.slide[data-mes="${m}"]`);
  if (s) irACarta(cont, Number(s.dataset.i));
}

$('#mes-volver').addEventListener('click', () => { MES = null; vista = 'meses'; mostrarVista(); window.scrollTo(0, 0); });

$('#vista-mas').addEventListener('click', (e) => {
  const f = e.target.closest('.fila[data-ir]');
  if (!f) return;
  if (f.dataset.ir === 'cuentas') { $('#marca').click(); return; }
  if (f.dataset.ir === 'actualizar') { recargar(); return; }
  vista = f.dataset.ir;
  mostrarVista();
  window.scrollTo(0, 0);
});

$('#pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('.pest');
  if (!b) return;
  document.querySelectorAll('.pest').forEach((x) => x.classList.toggle('activo', x === b));
  vista = b.dataset.vista;
  mostrarVista();
});
$('#rejilla').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-url]');
  if (b) abrirPublicada(b.dataset.url);
});
$('#hoja').addEventListener('click', (e) => {
  if (e.target.id === 'hoja' || e.target.id === 'hoja-cerrar') $('#hoja').hidden = true;
});

// ── Avisos en el móvil ─────────────────────────────────────────────────
// La app instalada (en la pantalla de inicio) puede recibir notificaciones.
// En el iPhone solo funciona abierta desde el icono, no desde el navegador.
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const conPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64uABytes = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const bytesAB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function estadoAvisos() {
  const texto = $('#avisos-texto'), activar = $('#avisos-activar'), probar = $('#avisos-probar');
  if (!conPush) {
    activar.hidden = true;
    texto.textContent = iOS && !instalada
      ? 'To get notifications, install the app: in the browser, Share › "Add to Home Screen", then open it from the icon.'
      : 'This browser cannot receive notifications.';
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  let publica = null;
  try { publica = (await (await fetch('/api/avisos', { credentials: 'same-origin' })).json()).publica; } catch {}
  // Si la clave del servidor cambió, la suscripción vieja ya no sirve.
  const vale = sub && publica && bytesAB64u(sub.options.applicationServerKey || new ArrayBuffer(0)) === publica;
  if (sub && !vale) await sub.unsubscribe();
  const activos = vale && Notification.permission === 'granted';
  activar.hidden = !!activos || Notification.permission === 'denied';
  probar.hidden = !activos;
  texto.innerHTML = activos
    ? `${ICO.campana}Notifications are on for this device.`
    : Notification.permission === 'denied'
      ? 'Notifications are blocked for this app. Turn them on in your phone settings (Notifications › Marble).'
      : 'Notifications on your phone: when something needs confirming and when each post goes out.';
}

$('#avisos-activar').addEventListener('click', async () => {
  const b = $('#avisos-activar');
  if (!PUEDE_GUARDAR) { aviso('Sign in with GitHub first (once on this device).'); return; }
  b.disabled = true; b.textContent = 'Turning on…';
  try {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('No permission to send notifications.');
    const { publica } = await (await fetch('/api/avisos', { credentials: 'same-origin' })).json();
    if (!publica) throw new Error('Notifications are not set up on the server.');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uABytes(publica) });
    const dispositivo = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Ordenador';
    const r = await fetch('/api/avisos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'alta', sub: sub.toJSON(), dispositivo }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    aviso('Notifications on. A test one is on its way.');
  } catch (e) { aviso(e.message, true); }
  b.disabled = false; b.innerHTML = `${ICO.campana}Turn on notifications`;
  estadoAvisos();
});
$('#avisos-probar').addEventListener('click', async () => {
  try {
    const r = await fetch('/api/avisos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'prueba' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    aviso(j.enviados ? `Sent to ${j.enviados} device(s).` : 'No devices have notifications on.');
  } catch (e) { aviso(e.message, true); }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => estadoAvisos()).catch(() => estadoAvisos());
} else estadoAvisos();


// ── Review mode ─────────────────────────────────────────────────────────
// «Review»: everything that needs a decision, one card at a time, full
// screen, no scrolling. Every card says loud and clear:
//   · where it goes: the Instagram / Facebook / story mark, or the blog;
//   · what you are approving: an IDEA (Claude prepares it next) or a post
//     READY TO GO OUT (it goes into the queue and publishes on time).
// Ready posts come one card per network (Instagram, Facebook, story), each
// approved on its own. Order: ready to post, ideas, blog articles.
let RV = { items: [], hechos: {} };

const MARCAS_RED = {
  ig: '<svg class="logo-red" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="gIg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#gIg)"/><rect x="6" y="6" width="12" height="12" rx="3.6" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="16.2" cy="7.8" r="1" fill="#fff"/></svg>',
  fb: '<svg class="logo-red" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path d="M13.3 19.5v-6h2l.3-2.4h-2.3V9.6c0-.7.2-1.2 1.2-1.2h1.2V6.3c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8h-2v2.4h2v6z" fill="#fff"/></svg>',
  story: '<svg class="logo-red" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="gSt" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".5" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="none" stroke="url(#gSt)" stroke-width="2.6"/><circle cx="12" cy="12" r="6.3" fill="url(#gSt)"/><path d="M12 9v6M9 12h6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  blog: '<svg class="logo-red" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#E59A1D"/><path d="M8 5.5h6l3 3V18a.5.5 0 0 1-.5.5h-8.5A.5.5 0 0 1 7.5 18V6a.5.5 0 0 1 .5-.5z" fill="#fff"/><path d="M10 11h5M10 13.5h5M10 16h3.5" stroke="#E59A1D" stroke-width="1.3" stroke-linecap="round"/></svg>',
};
const NOMBRE_DESTINO = { ig: 'Instagram post', fb: 'Facebook post', story: 'Instagram story', blog: 'Blog article' };

function pendientesRevision() {
  const posts = DATOS.marcas[MARCA].posts;
  // Ready to go out: one card per network still waiting for its approval.
  const listos = [];
  for (const p of posts.filter((x) => !x.esBlog && faseDe(x) === 'preparado' && grupoDe(x) === 'confirmar')) {
    for (const [k, e] of Object.entries(preparadoDe(p) ? flujoDe(p).preparado || {} : {})) {
      for (const r of e.redes) {
        const red = e.tipo === 'historia' ? 'story' : r.red;
        const enCola = ((PROGRAMADO.posts || {})[k]?.redes || []).some((x) => x.red === r.red && x.estado);
        // Already queued or published, or its time has passed: not for review.
        const pasado = new Date(r.cuando) < new Date();
        if (!enCola && !pasado) listos.push({ tipo: 'confirmar', p, red, cuando: r.cuando, texto: r.texto || '' });
      }
    }
  }
  listos.sort((a, b) => String(a.cuando).localeCompare(String(b.cuando)) || ['ig', 'fb', 'story'].indexOf(a.red) - ['ig', 'fb', 'story'].indexOf(b.red));
  const ideas = posts.filter((p) => !p.esBlog && grupoDe(p) === 'idea' && !faseDe(p) && !p.publicadoEn
      && !(p.ventana && HOY > p.ventana.hasta) && estadoDe(p).estado !== 'descartado')
    .sort((a, b) => (mesDe(a) || '').localeCompare(mesDe(b) || '') || a.date.localeCompare(b.date))
    .map((p) => ({ tipo: 'idea', p, red: p.formato === 'historia' ? 'story' : 'ig', texto: p.pies?.ig?.texto || '' }));
  const blog = ideasDeBlog(false).filter((a) => flujoDe(a).faseBlog !== 'aprobado')
    .map((p) => ({ tipo: 'blog', p, red: 'blog', texto: p.excerpt || '' }));
  return [...listos, ...ideas, ...blog];
}

function pintarBotonRevisar() {
  const b = $('#revisar');
  if (!b || !DATOS) return;
  const n = pendientesRevision().length;
  b.hidden = vista === 'cuentas' || !!actual || n === 0;
  $('#revisar-n').textContent = n ? String(n) : '';
}

function cabeceraRevision(it, i, n) {
  const p = it.p;
  // Where it goes: big network mark(s).
  let donde;
  if (it.tipo === 'idea') {
    const redes = p.formato === 'historia' ? ['story'] : ['ig', 'fb', 'story'];
    donde = `<span class="rv-logos">${redes.map((r) => MARCAS_RED[r]).join('')}</span><b>${p.formato === 'historia' ? 'Instagram story' : 'Post + story'}</b>`;
  } else {
    donde = `<span class="rv-logos">${MARCAS_RED[it.red]}</span><b>${NOMBRE_DESTINO[it.red]}</b>`;
  }
  // What you are approving.
  const etapa = it.tipo === 'confirmar'
    ? `<span class="rv-etapa-tag">Final OK</span><span>Already prepared · publishes ${escapar(horaNY(it.cuando))}</span>`
    : it.tipo === 'idea'
      ? `<span class="rv-etapa-tag">Idea</span><span>Approve the idea and I prepare it${p.publicaEl ? ` · for ${escapar(p.publicaEl)}` : ''}</span>`
      : `<span class="rv-etapa-tag">Blog article</span><span>Goes live on festivaladar.com</span>`;
  // Where this card is in the process: a small timeline.
  const pasos = it.tipo === 'blog' ? ['Draft', 'Your OK', 'Live on the website'] : ['Idea', 'Preparing', 'Final OK', 'Published'];
  const aqui = it.tipo === 'idea' ? 0 : it.tipo === 'confirmar' ? 2 : 1;
  const linea = `<ol class="rv-linea">${pasos.map((t, k) => `<li class="${k < aqui ? 'hecho' : k === aqui ? 'aqui' : ''}">${t}</li>`).join('')}</ol>`;
  return `<header class="rv-cab"><span class="rv-red">${donde}</span><span class="rv-n">${i + 1}/${n}</span></header>
    ${linea}
    <div class="rv-etapa rv-etapa-${it.tipo}">${etapa}</div>`;
}

function abrirRevision() {
  RV = { items: pendientesRevision(), hechos: {} };
  if (!RV.items.length) { aviso('Nothing to review right now.'); return; }
  const mazoEl = $('#rv-mazo');
  mazoEl.innerHTML = RV.items.map((it, i) => {
    const p = it.p;
    const pie = it.red === 'story' && it.tipo === 'confirmar' ? '' : it.texto;
    return `<section class="rv-slide rv-es-${it.tipo} rv-red-${it.red}" data-i="${i}">
      ${cabeceraRevision(it, i, RV.items.length)}
      <div class="rv-media">${it.tipo === 'blog'
        ? `${p.image ? `<img class="rv-blog-foto" src="${escapar(p.image)}" alt="">` : ''}<h2 class="rv-blog-titulo">${escapar(p.title)}</h2>`
        : '<div class="espera-lienzo">…</div>'}</div>
      ${pie ? `<button class="rv-pie" data-i="${i}">${escapar(pie)}</button>` : it.red === 'story' ? '<p class="rv-pie rv-sin">Stories have no caption: the stickers carry the details.</p>' : ''}
      ${p.porque && it.tipo !== 'confirmar' ? `<p class="rv-porque"><b>Why:</b> ${escapar(p.porque)}</p>` : ''}
      <div class="rv-sello" hidden></div>
    </section>`;
  }).join('');
  $('#revision').hidden = false;
  document.body.classList.add('en-revision');
  RV.pos = 0;
  mostrarCartaRevision();
}

// E-ink style: only the current card is on screen; it changes instantly.
function mostrarCartaRevision() {
  const cartas = [...$('#rv-mazo').children];
  RV.pos = Math.max(0, Math.min(RV.items.length - 1, RV.pos || 0));
  cartas.forEach((c, j) => {
    c.classList.toggle('actual', j === RV.pos);
    const n = c.querySelector('.rv-n');
    if (n) n.textContent = `${j + 1}/${cartas.length}`;
  });
  $('#rv-fin').hidden = cartas.length > 0;
  pintarBarraRevision();
}

async function dibujarRevision(i) {
  const it = RV.items[i];
  const s = $('#rv-mazo').children[i];
  if (!it || !s || s.dataset.dibujada || it.tipo === 'blog') return;
  s.dataset.dibujada = '1';
  const media = s.querySelector('.rv-media');
  try {
    const historia = it.red === 'story' || it.p.formato === 'historia';
    const el = await (historia ? pintarHistoria(it.p) : it.red === 'fb' ? pintarFacebook(it.p) : pintarInstagram(it.p));
    el.classList.add(historia ? 'rv-historia' : it.red === 'fb' ? 'rv-fb' : 'rv-ig');
    media.replaceChildren(el);
  } catch { media.innerHTML = `<div class="espera-lienzo">Couldn't render</div>`; }
}

const ETIQUETA_SI = (it) => it.tipo === 'idea' ? 'Approve idea'
  : it.tipo === 'blog' ? 'Approve article'
    : 'OK, publish';

const posRevision = () => RV.pos || 0;
function pintarBarraRevision() {
  const i = Math.min(posRevision(), RV.items.length - 1);
  const it = RV.items[i];
  $('#rv-si').hidden = !it; $('#rv-mas').hidden = !it;
  $('#rv-atras').disabled = i <= 0;
  $('#rv-alante').disabled = !it || i >= RV.items.length - 1;
  $('#rv-zona-izq').hidden = i <= 0;
  $('#rv-zona-der').hidden = !it || i >= RV.items.length - 1;
  if (!it) return;
  $('#rv-atras').disabled = i <= 0;
  $('#rv-alante').disabled = i >= RV.items.length - 1;
  const hecho = RV.hechos[i];
  const si = $('#rv-si');
  si.querySelector('span').textContent = hecho || ETIQUETA_SI(it);
  si.disabled = !!hecho;
  si.className = `rv-si rv-si-${it.tipo}`;
  for (const j of [i, i + 1, i - 1]) dibujarRevision(j);
}
function irRevision(i) {
  RV.pos = Math.max(0, Math.min(RV.items.length - 1, i));
  mostrarCartaRevision();
}
function cerrarRevision() {
  $('#revision').hidden = true;
  $('#rv-menu').hidden = true;
  $('#rv-texto').hidden = true;
  document.body.classList.remove('en-revision');
  repintar();
  pintarBotonRevisar();
}

async function decidirRevision(accion, texto, extra) {
  const i = posRevision();
  const it = RV.items[i];
  if (!it) return;
  if (!PUEDE_GUARDAR) { aviso('Sign in with GitHub first (once on this device).'); return; }
  try {
    $('#rv-si').disabled = true;
    await llamarFlujo(it.p.clave, accion, extra);
    // Reviewed: out of the deck at once; the next card takes its place.
    RV.items.splice(i, 1);
    $('#rv-mazo').children[i].remove();
    aviso(texto);
    mostrarCartaRevision();
  } catch (e) { aviso(e.message, true); pintarBarraRevision(); }
}

$('#revisar').addEventListener('click', abrirRevision);
$('#rv-salir').addEventListener('click', cerrarRevision);
$('#rv-atras').addEventListener('click', () => irRevision(posRevision() - 1));
$('#rv-alante').addEventListener('click', () => irRevision(posRevision() + 1));
$('#rv-si').addEventListener('click', () => {
  const it = RV.items[posRevision()];
  if (!it) return;
  if (it.tipo === 'confirmar') {
    const dice = { ig: 'Scheduled on Instagram', fb: 'Scheduled on Facebook', story: 'Story scheduled' }[it.red];
    decidirRevision('confirmar', dice, { red: it.red });
  } else if (it.tipo === 'idea') decidirRevision('aprobar', 'Idea approved: I will prepare it');
  else decidirRevision('blogAprobar', 'Article approved');
});
// Kindle-style page turns: tap the right side to go forward, the left side
// to go back. The small buttons sit at mid-height, within thumb reach.
$('#rv-zona-izq').addEventListener('click', () => irRevision(posRevision() - 1));
$('#rv-zona-der').addEventListener('click', () => irRevision(posRevision() + 1));
$('#rv-fin-salir').addEventListener('click', cerrarRevision);
// The caption: tap to read it whole, tap again to close.
$('#rv-mazo').addEventListener('click', (e) => {
  const b = e.target.closest('.rv-pie');
  if (!b) return;
  const it = RV.items[Number(b.dataset.i)];
  const caja = $('#rv-texto');
  caja.innerHTML = `<p>${escapar(b.textContent)}</p>${it.p.falta ? `<p class="rv-falta"><b>Missing:</b> ${escapar(it.p.falta)}</p>` : ''}<small>Tap to close</small>`;
  caja.hidden = false;
});
$('#rv-texto').addEventListener('click', () => { $('#rv-texto').hidden = true; });
// ⋯: the other decisions.
$('#rv-mas').addEventListener('click', () => {
  const it = RV.items[posRevision()];
  if (!it) return;
  const op = (a, t, cls = '') => `<button class="rv-op ${cls}" data-op="${a}">${t}</button>`;
  const ops = it.tipo === 'confirmar'
    ? op('editar', 'Edit') + op('cambios', 'Request changes') + op('sugerir', 'Suggest a change') + op('ver', 'Open the full post')
    : it.tipo === 'idea'
      ? op('editar', 'Edit') + op('sugerir', 'Suggest a change') + op('descartar', 'Archive', 'peligro')
      : op('publicar', 'Publish to website now') + op('sugerir', 'Suggest a change') + op('blogDescartar', 'Archive', 'peligro');
  $('#rv-menu-caja').innerHTML = `<p class="rv-menu-titulo">${escapar(it.p.title)}</p>${ops}${op('cerrar', 'Cancel', 'suave')}`;
  $('#rv-menu').hidden = false;
});
$('#rv-menu').addEventListener('click', async (e) => {
  if (e.target.id === 'rv-menu') { $('#rv-menu').hidden = true; return; }
  const b = e.target.closest('.rv-op');
  if (!b) return;
  const it = RV.items[posRevision()];
  $('#rv-menu').hidden = true;
  const op = b.dataset.op;
  if (op === 'cerrar') return;
  if (op === 'editar') return abrirEditor(it.p, 'editar');
  if (op === 'cambios') return abrirEditor(it.p, 'cambios');
  if (op === 'ver') { cerrarRevision(); return abrir(it.p); }
  if (op === 'descartar') return decidirRevision('descartar', 'Archived');
  if (op === 'blogDescartar') return decidirRevision('blogDescartar', 'Archived');
  if (op === 'publicar') {
    if (!confirm(`Publish "${it.p.title}" on festivaladar.com now?`)) return;
    try {
      const r = await fetch('/api/flujo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: it.p.slug, accion: 'blogPublicar' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      it.p.estadoWeb = 'publish';
      const k = posRevision();
      RV.items.splice(k, 1);
      $('#rv-mazo').children[k].remove();
      mostrarCartaRevision();
      aviso('Published. It will be on festivaladar.com in a couple of minutes.');
    } catch (err) { aviso(err.message, true); }
    return;
  }
  if (op === 'sugerir') {
    const t = prompt('What should change?');
    if (!t || !t.trim()) return;
    try { await llamarFlujo(it.p.clave, 'sugerir', { nota: t.trim() }); aviso('Noted. I will do it in the next check.'); }
    catch (err) { aviso(err.message, true); }
  }
});
document.addEventListener('keydown', (e) => {
  if ($('#revision').hidden || e.target.closest('input, textarea')) return;
  if (e.key === 'Escape') cerrarRevision();
  if (e.key === 'ArrowRight') irRevision(posRevision() + 1);
  if (e.key === 'ArrowLeft') irRevision(posRevision() - 1);
});

// ── Actualizar: deslizar hacia abajo ────────────────────────────────────
// Con la app abierta mucho rato, lo que cambió (un check, lo que publicó la
// cola) no se veía. Deslizando hacia abajo desde arriba del todo se vuelve a
// leer todo sin perder el sitio; si hay versión nueva de la app, se recarga
// entera. Y al volver a la app tras un rato fuera, se actualiza sola.
let VERSION_APP = null;
const versionApp = async () => {
  try { const r = await fetch('/app.js', { method: 'HEAD', cache: 'no-store' }); return r.headers.get('etag') || r.headers.get('last-modified'); }
  catch { return null; }
};
versionApp().then((v) => { VERSION_APP = v; });

let recargando = false;
async function recargar({ callado = false } = {}) {
  if (recargando) return;
  recargando = true;
  try {
    const v = await versionApp();
    if (VERSION_APP && v && v !== VERSION_APP) { location.reload(); return; }
    DATOS = await (await fetch('datos/posts.json?t=' + Date.now(), { cache: 'no-store' })).json();
    try {
      const r = await fetch('datos/programado.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) PROGRAMADO = await r.json();
    } catch {}
    textosDeMetricool();
    for (const k of Object.keys(HISTORICOS)) delete HISTORICOS[k];
    await cargarFlujo();
    cambiarMarca(MARCA);
    pintarCuentaConfirmar();
    if (actual) {
      const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === actual.clave);
      if (p) { actual = p; repintar(); } else volver();
    } else {
      const y = window.scrollY;
      mostrarVista();
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    if (!callado) aviso('Refreshed.');
  } catch (e) {
    if (!callado) aviso('Refresh failed: ' + e.message, true);
  } finally {
    recargando = false;
  }
}

(() => {
  const ind = $('#tirar');
  const UMBRAL = 72;
  let inicio = null, dy = 0;
  const abierto = () => !$('#visor').hidden || !$('#hoja').hidden || document.querySelector('#editor:not([hidden])');
  const pon = (d, texto) => {
    ind.style.transform = `translateY(${Math.min(d, 110) - 60}px)`;
    ind.style.opacity = String(Math.min(1, d / UMBRAL));
    ind.querySelector('i').style.transform = `rotate(${d * 4}deg)`;
    if (texto) ind.querySelector('span').textContent = texto;
  };
  document.addEventListener('touchstart', (e) => {
    // Inside a full-screen card that is scrolled down, pulling scrolls the card.
    const carta = e.target.closest && e.target.closest('.slide');
    if (recargando || window.scrollY > 0 || (carta && carta.scrollTop > 0) || abierto() || e.touches.length !== 1) { inicio = null; return; }
    inicio = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (inicio === null) return;
    dy = (e.touches[0].clientY - inicio) * 0.55;
    if (dy <= 0) { pon(0); return; }
    if (window.scrollY > 0 || (e.target.closest && e.target.closest('.slide')?.scrollTop > 0)) { inicio = null; pon(0); return; }
    if (e.cancelable) e.preventDefault();
    pon(dy, dy >= UMBRAL ? 'Release to refresh' : 'Pull to refresh');
  }, { passive: false });
  document.addEventListener('touchend', async () => {
    if (inicio === null) return;
    inicio = null;
    if (dy >= UMBRAL) {
      ind.classList.add('girando'); pon(UMBRAL, 'Refreshing…');
      await recargar({ callado: true });
      ind.classList.remove('girando');
      pon(UMBRAL, 'Up to date');
      setTimeout(() => pon(0), 600);
    } else pon(0);
    dy = 0;
  });
})();

// Al volver a la app después de un rato fuera, se pone al día sola.
let fueraDesde = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) fueraDesde = Date.now();
  else if (fueraDesde && Date.now() - fueraDesde > 60000) recargar({ callado: true });
});

arrancar().catch((e) => aviso('Could not load data: ' + e.message, true));
