/* La app de aprobar. Solo hace tres cosas: enseñar la ficha como se verá en
 * cada red, dejar decidir, y guardar esa decisión en el repositorio.
 *
 * El dibujo no se inventa nada: lo hace motor.js, que es el motor del kit de
 * ADAR traído tal cual, así que la imagen de la vista previa es la misma que
 * se publica. Los pies tampoco: vienen ya compuestos en datos/posts.json por
 * el mismo código que usa publicar.mjs.
 */
import { crearMotor, TAMANOS } from './motor.js';

const $ = (s) => document.querySelector(s);
const RAMA = 'main';
const ARCHIVO = 'aprobaciones.json';

const ESTADOS = {
  listo: 'Listo para publicar',
  cambios: 'Hay que cambiar algo',
  espera: 'En espera',
  borrador: 'Borrador',
  idea: 'Idea',
  descartado: 'Descartado',
  sin: 'Sin marcar',
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
let vista = 'meses';
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
  $('#visor-hueco').innerHTML = '<p class="vacio" style="color:#777">Dibujando…</p>';
  $('#visor-pie').innerHTML = '<p class="aviso-suave">Los comentarios van por el chat.</p>';
  v.hidden = false;
  try {
    $('#visor-hueco').replaceChildren(await pintarHistoria(p));
  } catch (e) {
    $('#visor-hueco').innerHTML = `<p class="vacio" style="color:#777">No se pudo dibujar</p>`;
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

function pintarLista() {
  const cont = $('#fichas');
  cont.innerHTML = '';
  // Ideas: lo que no está publicado ni en cola. «Ahora» deja además fuera lo
  // descartado y lo que todavía no toca; «Todas» lo enseña entero.
  // Ideas: todas juntas, por fecha. Archivo: lo descartado, que se guarda
  // por si vuelve a servir.
  const posts = fichasDe('idea').filter((p) => {
    const fase = faseDe(p);
    // Lo que ya pasó su fecha se archiva solo, con una nota que lo dice.
    const caducada = !fase && p.ventana && HOY > p.ventana.hasta;
    const archivada = fase === 'descartado' || caducada || (!fase && estadoDe(p).estado === 'descartado');
    return filtro === 'archivo' ? archivada : !archivada;
  });
  $('#vacio').textContent = filtro === 'archivo' ? 'El archivo está vacío.' : 'Nada por aquí.';
  $('#vacio').hidden = posts.length > 0;
  $('#idea-nueva').hidden = filtro === 'archivo';
  pintarIdeasPedidas();
  // En Ideas no hay fila de circulitos: todo va al muro, también lo que es
  // solo una historia, que lleva su sello y se ve en 9:16. Se decide igual.
  $('#historias').hidden = true;
  for (const p of posts) cont.appendChild(tarjeta(p));
  observarLienzos();
}

/**
 * El sello de «ya está en cola». Dice el día, la hora de Nueva York y en qué
 * redes, y lleva al calendario de Metricool para cambiarlo o quitarlo.
 */
function selloProgramado(p) {
  const e = (PROGRAMADO.posts || {})[p.clave];
  if (!e) return '';
  const cuando = new Date(e.redes[0].cuando);
  const dia = cuando.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'America/New_York' });
  const hora = cuando.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  // En una línea y corto: esto va en la cabecera de la ficha, al lado del
  // concierto y de los días que quedan, y no puede comérselos.
  const redes = e.redes.map((r) => (r.red === 'ig' ? 'IG' : 'FB') + (r.estado === 'error' ? ' falló' : r.estado === 'pausado' ? ' en pausa' : '')).join('+');
  const salio = yaSalio(e);
  const que = salio ? 'salió' : (e.tipo === 'historia' ? 'historia' : 'en cola');
  // Si ya salió, el sello lleva al post (Instagram primero); si está en cola
  // por Metricool, a su calendario; si va por la app, a ningún sitio de fuera.
  const conUrl = e.redes.find((r) => r.red === 'ig' && r.url) || e.redes.find((r) => r.url);
  const porMetricool = e.redes.some((r) => r.via !== 'meta');
  const destino = conUrl ? conUrl.url : (porMetricool ? PROGRAMADO.calendario : '');
  const titulo = conUrl ? 'Abre el post publicado.'
    : porMetricool ? 'Programado en Metricool. Para cambiarlo o quitarlo hay que ir allí.'
    : 'En la cola de la app: sale solo a su hora.';
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
    ? `${n} publicaciones en cola, de ${todas.length} fichas. Salen solas a su hora; para pararlas,
       «Quitar de la cola» en cada una.`
    : 'Nada en cola.';

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
    `<a href="${r.url}" target="_blank" rel="noopener">Ver en ${r.red === 'ig' ? 'Instagram' : 'Facebook'} ↗</a>`).join('')}</div>`;
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
      ${p.formato === 'historia' ? '<span class="sello solo-hist">Solo historia</span>' : ''}
      ${c ? `<span class="cuando-ficha">${escapar(c.nombre)}</span>` : ''}
      ${cuandoTexto(p) && grupoDe(p) === 'idea'
        ? `<span class="cuando-ficha tenue">${cuandoTexto(p)}</span>` : ''}
      ${p.publicadoEn
        ? `<a class="sello publicado" href="${p.publicadoEn.url}" target="_blank" rel="noopener">publicado el ${p.publicadoEn.fecha} ↗</a>`
        : pub.length ? `<span class="sello publicado">ya en ${pub.join('+')}</span>` : ''}
      ${selloProgramado(p)}
      <span class="crece"></span>
    </div>
    ${enlacesPublicados(p)}
    <div class="hueco-ig"><div class="espera-lienzo">…</div></div>
    ${p.falta ? `<p class="falta-material">Falta material: ${escapar(p.falta)}</p>` : ''}
    ${e.nota && !faseDe(p) ? `<p class="nota-puesta">“${escapar(e.nota)}”</p>` : ''}
    ${!faseDe(p) && p.ventana && HOY > p.ventana.hasta && grupoDe(p) === 'idea'
      ? `<p class="porque archivo-nota"><b>Archivada sola:</b> su momento era hasta el ${p.ventana.hasta.split('-').reverse().slice(0, 2).join('/')} y ya pasó.</p>`
      : p.porque && grupoDe(p) !== 'publicado' ? `<p class="porque"><b>Por qué:</b> ${escapar(p.porque)}</p>` : ''}
    <div class="acciones-flujo">${accionesFlujo(p)}</div>
    ${cajaSugerir(p)}
    ${grupoDe(p) === 'idea' ? '' : '<button class="abrir">Ver en Facebook y como historia ›</button>'}`;

  art.querySelector('.abrir')?.addEventListener('click', () => abrir(p));
  return art;
}

/**
 * Dibujar doce posts a la vez atasca el móvil, así que cada uno se dibuja
 * cuando se asoma por la pantalla y no antes.
 */
let vigia = null;
function observarLienzos() {
  vigia?.disconnect();
  vigia = new IntersectionObserver(async (entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      vigia.unobserve(en.target);
      const clave = en.target.dataset.clave;
      const p = DATOS.marcas[MARCA].posts.find((x) => x.clave === clave);
      const hueco = en.target.querySelector('.hueco-ig');
      try {
        hueco.replaceChildren(await (p.formato === 'historia' ? pintarHistoria(p) : pintarInstagram(p)));
      } catch (err) {
        hueco.innerHTML = `<div class="espera-lienzo">No se pudo dibujar</div>`;
      }
    }
  }, { rootMargin: '600px 0px' });
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
  if (HOY < v.desde) return `su momento empieza el ${v.desde}`;
  if (HOY > v.hasta) return `se pasó su momento el ${v.hasta}`;
  const quedan = Math.round((new Date(v.hasta + 'T12:00:00Z') - new Date(HOY + 'T12:00:00Z')) / DIA);
  return quedan <= 0 ? 'último día' : `quedan ${quedan} día${quedan === 1 ? '' : 's'}`;
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

function plegar(el) {
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
  return { slides: esCarrusel ? p.slides : [p.slides[0]], n: esCarrusel ? p.slides.length : 1 };
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
  return todos.slice(0, -1).join(', ') + ' <span class="ig-y">y</span> ' + todos.at(-1);
}

async function pintarInstagram(p) {
  const piezas = piezasDe(p);
  const slides = piezas.slides || piezas.fotos;
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
      <button class="paso atras" aria-label="Anterior">‹</button>
      <button class="paso alante" aria-label="Siguiente">›</button>` : ''}</div>
    ${slides.length > 1 ? `<div class="ig-puntos">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    <div class="ig-acciones">${ICONOS.corazon}${ICONOS.comentar}${ICONOS.enviar}<span class="guardar">${ICONOS.guardar}</span></div>
    <div class="ig-pie"><b>${CUENTAS.ig}</b>${pintarPie(p.pies.ig.texto, 2, 'mas', 'más', false)}</div>
    <div class="ig-hora">Hace un momento</div>`;

  const tira = caja.querySelector('.tira');
  for (let i = 0; i < slides.length; i++) {
    tira.appendChild(piezas.fotos
      ? fotoSuelta(piezas.fotos[i], p.fotosEnteras, p.encuadre)
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
        <div class="fb-meta">Ahora · 🌐</div>
      </span>
    </div>
    <div class="fb-texto">${pintarPie(p.pies.fb.texto, 5, 'mas', 'Ver más', true)}</div>
    <div class="fb-acciones">
      <span>${ICONOS.pulgar} Me gusta</span>
      <span>${ICONOS.comentar} Comentar</span>
      <span>${ICONOS.compartir} Compartir</span>
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
      <small>ahora</small>
    </div>
    <div class="responder"><span>Enviar mensaje</span>${ICONOS.corazon}${ICONOS.enviar}</div>`;
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
  const cols = [['ig', 'Instagram'], ['fb', 'Facebook'], ['story', 'Historia']].map(([red, nombre]) => {
    const col = document.createElement('div');
    col.className = `col-previa col-${red}`;
    col.innerHTML = `<h4>${nombre}</h4><div class="hueco-previa"><p class="vacio">Dibujando…</p></div>`;
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
      hueco.innerHTML = `<p class="vacio">No se pudo dibujar: ${escapar(e.message)}</p>`;
    }
    col.insertAdjacentHTML('beforeend', aprobarRed(yo, red));
  }
}

/** Debajo de cada vista: aprobar esa red, o cuándo sale si ya está aprobada. */
function aprobarRed(p, red) {
  const NOMBRE = { ig: 'Instagram', fb: 'Facebook', story: 'la historia' };
  const esDeRed = (k, r) => (red === 'story' ? k.includes('#') || p.formato === 'historia' : !k.includes('#') && r.red === red);
  const enCola = Object.entries(PROGRAMADO.posts || {})
    .filter(([k]) => k === p.clave || k.startsWith(p.clave + '#'))
    .flatMap(([k, e]) => e.redes.filter((r) => esDeRed(k, r)));
  if (enCola.length) {
    const r = enCola[0];
    if (r.estado === 'pausado') return `<p class="fl-red-pausa">⏸ En pausa: ${escapar(r.pausa || 'lo paré en el repaso, te lo pregunto en el chat')}</p>`;
    const txt = r.estado === 'publicado' ? '✓ Publicado' : `✓ Aprobado · sale ${horaNY(r.cuando)}`;
    return `<p class="fl-red-ok">${txt}</p>`;
  }
  if (faseDe(p) !== 'preparado') return '';
  const prep = Object.entries(flujoDe(p).preparado || {}).flatMap(([k, e]) => e.redes.filter((r) => esDeRed(k, r)));
  if (!prep.length) return '<p class="fl-red-no">No se publica aquí.</p>';
  return `<div class="fl-red"><span>Sale ${horaNY(prep[0].cuando)}</span>
    <button class="fl fl-si" data-accion="confirmar" data-red="${red}" data-clave="${p.clave}">Aprobar ${NOMBRE[red]}</button></div>`;
}

async function pintarPrevia(red) {
  // Siempre las tres vistas, en scroll: sin pestañas (lo pidió así).
  return pintarTodas();
  const esc = $('#escenario');
  esc.classList.remove('triple');
  esc.innerHTML = '<p class="vacio">Dibujando…</p>';
  try {
    const nodo = await PINTORES[red](actual);
    esc.innerHTML = '';
    esc.appendChild(nodo);
  } catch (e) {
    esc.innerHTML = `<p class="vacio">No se pudo dibujar: ${escapar(e.message)}</p>`;
  }
}

// ── Navegación ─────────────────────────────────────────────────────────
function abrir(p) {
  actual = p;
  $('#lista').classList.remove('activa');
  $('#detalle').classList.add('activa');
  $('#atras').hidden = false;
  $('#marca').hidden = true;
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
  $('#marca').hidden = false;
  $('#titulo').textContent = 'Aprobar';
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
  caja.innerHTML = `<h3>${e.tipo === 'historia' ? 'Historia' : 'Post'} en la cola</h3>` + e.redes.map((r) => {
    const cuando = new Date(r.cuando).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
    const est = r.estado || (new Date(r.cuando) < new Date() ? 'salió' : 'en cola');
    const mal = est === 'error' || est === 'atrasado';
    return `<div class="linea-red">${RED_LARGA[r.red]} · ${cuando} (NY) · <b class="${mal ? 'mal' : ''}">${est}</b> · ${r.via === 'meta' ? 'vía app' : 'vía Metricool'}`
      + (r.url ? ` · <a href="${r.url}" target="_blank" rel="noopener">ver ↗</a>` : '')
      + (r.error ? `<br><span class="mal">${escapar(r.error)}</span>` : '') + '</div>';
  }).join('');
}

function pintarEstadoActual() {
  const e = estadoDe(actual);
  const d = $('#estado-actual');
  const FASES = { aprobado: 'Aprobado, en preparación', preparado: 'Preparado, falta confirmar', confirmado: 'Confirmado',
    descartado: 'En el archivo', cambios: 'Cambios pedidos', luego: 'Para más adelante' };
  const fase = faseDe(actual);
  const porque = actual.porque ? `<p class="porque">${escapar(actual.porque)}</p>` : '';
  if (fase) { d.innerHTML = `Ahora: <b>${FASES[fase]}</b>${porque}`; $('#acciones-detalle').innerHTML = accionesFlujo(actual) + cajaSugerir(actual); return; }
  d.innerHTML = `Ahora: <b>${ESTADOS[e.estado] || e.estado}</b>` +
    (e.nota ? ` · ${escapar(e.nota)}` : '') +
    (e.mio ? '' : ' <span style="color:var(--tenue)">(del panel viejo)</span>') + porque;
  $('#acciones-detalle').innerHTML = accionesFlujo(actual) + cajaSugerir(actual);
}

// ── La rejilla de lo ya publicado ──────────────────────────────────────
async function cargarHistorico() {
  if (!HISTORICO) {
    try { HISTORICO = await (await fetch('datos/historico-ig.json', { cache: 'no-store' })).json(); }
    catch { HISTORICO = { posts: [] }; }
  }
  return HISTORICO;
}

async function pintarPublicado() {
  await cargarHistorico();
  const p = HISTORICO.posts || [];
  const conFoto = p.filter((r) => r[1]);
  $('#resumen-publicado').textContent =
    `${p.length} publicaciones en @${HISTORICO.cuenta || ''}, de ${p[p.length - 1]?.[0] || ''} a ${p[0]?.[0] || ''}. ` +
    'Para no repetirse: toca una y verás el texto, los números y el enlace.';
  $('#rejilla').innerHTML = conFoto
    .map((r) => {
      const [fecha, url, , likes, alcance] = r;
      const code = url.replace(/\/$/, '').split('/').pop();
      return `<button data-url="${url}">
        <img src="datos/miniaturas/${fecha.replace(/-/g, '')}-${code}.jpg" alt="" loading="lazy"
             onerror="this.style.visibility='hidden'">
        <span class="num">♥ ${likes} · ${alcance}</span>
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
      <span><b>${likes}</b><span>me gusta</span></span>
      <span><b>${alcance}</b><span>alcance</span></span>
      <span><b>${vistas || '—'}</b><span>vistas</span></span>
    </div>
    <a href="${enlace}" target="_blank" rel="noopener">Abrir en Instagram ↗</a>`;
  $('#hoja').hidden = false;
}

// ── El circuito: aprobar → preparado → confirmar ──────────────────────
// Lo decidido vive en el repositorio (flujo.json), no en el navegador: se
// lee y se escribe por /api/flujo, y se ve igual en el iPhone y en el
// ordenador. Hace falta haber entrado con GitHub una vez en cada aparato.
let FLUJO = { posts: {} };
let PUEDE_GUARDAR = false;

async function cargarFlujo() {
  try {
    const r = await fetch('/api/flujo', { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.flujo) { FLUJO = j.flujo; PUEDE_GUARDAR = true; }
    else if (j.entrar) $('#entrar-aviso').hidden = false;
  } catch {}
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
  const dia = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/New_York' });
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  return conDia ? `${dia}, ${hora}` : hora;
}

/** Los botones de cada fase. */
function accionesFlujo(p) {
  if (grupoDe(p) === 'publicado') return '';
  const f = flujoDe(p);
  const b = (accion, texto, clase = '') => `<button class="fl ${clase}" data-accion="${accion}" data-clave="${p.clave}">${texto}</button>`;
  const enCola = (PROGRAMADO.posts || {})[p.clave];
  if (enCola && enCola.redes.every((r) => r.estado === 'en cola')) {
    return `<div class="fl-fila"><span class="fl-dice">Confirmado · sale ${horaNY(enCola.redes[0].cuando)}</span>${b('quitar', 'Quitar de la cola', 'fl-suave')}</div>`;
  }
  if (enCola) return '';
  switch (f.fase) {
    case 'aprobado':
      return `<div class="fl-fila"><span class="fl-dice">✓ Aprobado · lo estoy preparando</span>${b('editar', 'Editar')}${b('recuperar', 'Deshacer', 'fl-suave')}</div>`;
    case 'preparado': {
      const prep = Object.values(f.preparado || {}).flatMap((e) => e.redes.map((r) => ({ ...r, tipo: e.tipo })));
      const primera = prep.map((r) => r.cuando).sort()[0];
      const donde = [...new Set(prep.map((r) => r.tipo === 'historia' ? 'historia' : r.red === 'ig' ? 'Instagram' : 'Facebook'))].join(' + ');
      return `<div class="fl-prep">Sale <b>${primera ? horaNY(primera) : '—'}</b> · ${donde}</div>
        <div class="fl-fila">${b('confirmar', 'Aprobar todo', 'fl-si')}${b('editar', 'Editar')}${b('cambios', 'Cambios')}</div>`;
    }
    case 'descartado':
      return `<div class="fl-fila"><span class="fl-dice">En el archivo</span>${b('recuperar', 'Recuperar', 'fl-suave')}</div>`;
    default:
      return `${f.fase === 'cambios' && f.nota ? `<p class="fl-nota">Cambios pedidos: “${escapar(f.nota)}”</p>` : ''}
        <div class="fl-fila">${b('aprobar', 'Aprobar', 'fl-si')}${b('editar', 'Editar')}</div>
        <div class="fl-fila fl-segunda">${b('descartar', 'Descartar (al archivo)', 'fl-suave')}</div>`;
  }
}

/** El campo de sugerir cambios, con lo ya sugerido encima. */
function cajaSugerir(p) {
  if (grupoDe(p) === 'publicado') return '';
  const sug = flujoDe(p).sugerencias || [];
  const lista = sug.map((x) => `<li class="${x.hecha ? 'hecha' : ''}"><span class="tarea">${escapar(x.texto)}</span>${x.hecha
    ? `<small>${x.respuesta ? escapar(/^hech/i.test(x.respuesta) ? x.respuesta : 'Hecho: ' + x.respuesta) : 'Hecho'}</small>` : '<small>Pendiente: lo hago en el próximo repaso</small>'}</li>`).join('');
  return `<div class="sugerir">${lista ? `<ul>${lista}</ul>` : ''}
    <form class="sugerir-form" data-clave="${p.clave}">
      <textarea rows="1" placeholder="Sugerir un cambio…"></textarea>
      <button type="submit">Enviar</button>
    </form></div>`;
}

/** Las ideas que él ha pedido y todavía no están hechas, encima del muro. */
function pintarIdeasPedidas() {
  const pend = (FLUJO.ideas || []).filter((x) => !x.hecha);
  const hechas = (FLUJO.ideas || []).filter((x) => x.hecha).slice(-2);
  $('#ideas-pedidas').innerHTML = [...pend.map((x) => `<li>${escapar(x.texto)}<small>Pendiente: la preparo en el próximo repaso</small></li>`),
    ...hechas.map((x) => `<li class="hecha"><span class="tarea">${escapar(x.texto)}</span><small>${x.respuesta ? escapar(/^hech/i.test(x.respuesta) ? x.respuesta : 'Hecha: ' + x.respuesta) : 'Hecha'}</small></li>`)].join('');
}

$('#idea-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (!PUEDE_GUARDAR) { aviso('Primero entra con GitHub (una vez en este aparato).'); setTimeout(() => { location.href = '/entrar.html'; }, 900); return; }
  const t = ev.target.querySelector('textarea');
  const texto = t.value.trim();
  if (!texto) { aviso('Escribe primero la idea.'); t.focus(); return; }
  const b = ev.target.querySelector('button');
  if (b.disabled) return;
  b.disabled = true; b.textContent = 'Enviando…';
  try {
    const r = await fetch('/api/flujo', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'idea', nota: texto }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    FLUJO.ideas = j.ideas;
    t.value = ''; t.style.height = '';
    pintarIdeasPedidas();
    t.blur();
    aviso('Apuntada. La preparo en el próximo «check».');
  } catch (e) { aviso(e.message, true); }
  b.disabled = false; b.textContent = 'Enviar';
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
  if (!PUEDE_GUARDAR) { aviso('Primero entra con GitHub (una vez en este aparato).'); setTimeout(() => { location.href = '/entrar.html'; }, 900); return; }
  const t = f.querySelector('textarea');
  const texto = t.value.trim();
  if (!texto) { aviso('Escribe primero qué cambiar.'); t.focus(); return; }
  const b = f.querySelector('button');
  f.dataset.enviando = '1'; b.disabled = true; b.textContent = 'Enviando…';
  try {
    await llamarFlujo(f.dataset.clave, 'sugerir', { nota: texto });
    t.blur();
    aviso('Apuntado. Lo cambio en el próximo «check».');
    repintar();
  } catch (e) {
    aviso(e.message, true);
    delete f.dataset.enviando; b.disabled = false; b.textContent = 'Enviar';
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
    body: JSON.stringify({ clave, accion, ...extra }),
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
  aprobar: 'Aprobado. Lo preparo y te aviso para confirmar.',
  descartar: 'Al archivo. Lo tienes en Ideas › Archivo.',
  luego: 'Aparcado. Lo tienes en Ideas › Más adelante.',
  recuperar: 'Vuelve a ideas.',
  cambios: 'Apuntado. Lo cambio y vuelve a confirmar.',
  editar: 'Guardado.',
  confirmar: 'Aprobado: sale solo a su hora.',
  quitar: 'Fuera de la cola. Vuelve a «para confirmar».',
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
    aviso('Primero entra con GitHub (una vez en este aparato).');
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
    return pa - pb || a.date.localeCompare(b.date);
  });
  const listos = fichas.filter((p) => faseDe(p) === 'preparado').length;
  $('#resumen-confirmar').textContent = fichas.length
    ? `${listos === 1 ? '1 listo' : `${listos} listos`} para confirmar${fichas.length - listos ? ` · ${fichas.length - listos === 1 ? '1 aprobado' : `${fichas.length - listos} aprobados`} que estoy preparando` : ''}. Nada sale sin «Confirmar publicación».`
    : 'Nada pendiente. Lo que apruebes en Ideas aparecerá aquí cuando esté preparado.';
  $('#historias-conf').hidden = true;
  for (const p of fichas) cont.appendChild(tarjeta(p));
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
    ? fotosEditor.map((u, i) => `<span class="ed-foto"><img src="${u}" alt=""><button type="button" data-quitar="${i}" aria-label="Quitar">×</button></span>`).join('')
    : '<small>Sin fotos subidas: se usa la de la ficha.</small>';
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
  $('#editor-titulo').textContent = notaSolo ? 'Pedir cambios' : f.fase === 'preparado' ? 'Editar lo preparado' : 'Editar la idea';
  $('#editor-ayuda').textContent = notaSolo
    ? 'Dime qué cambiar. Lo arreglo y vuelve a «para confirmar».'
    : f.fase === 'preparado'
      ? 'Ya está preparado: el texto de cada red y la hora se cambian al momento. Una foto nueva hace que lo vuelva a montar.'
      : 'Es la idea: un solo texto. Cuando la apruebes, la adapto yo a Instagram, Facebook y lo que haga falta.';
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
  if (!/^https:\/\//.test(url)) return aviso('Pega una dirección que empiece por https://', true);
  aviso('Trayendo la foto…');
  try {
    const r = await fetch('/api/traer?url=' + encodeURIComponent(url), { credentials: 'same-origin' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Error ${r.status}`); }
    await subirArchivo(await r.blob());
    $('#ed-url').value = '';
    aviso('Foto añadida. Falta darle a Guardar.');
  } catch (err) { aviso(`No se pudo: ${err.message}`, true); }
});

$('#ed-archivo').addEventListener('change', async (e) => {
  const archivos = [...e.target.files];
  e.target.value = '';
  for (const a of archivos) {
    aviso(`Subiendo ${a.name}…`);
    try {
      const r = await fetch('/api/subir', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datos: await aJPEG(a) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      fotosEditor.push(j.url);
      pintarFotosEditor();
    } catch (err) { aviso(`No se pudo subir: ${err.message}`, true); return; }
  }
  aviso('Fotos subidas. Falta darle a Guardar.');
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

  cambiarMarca(MARCA);
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
  $('#marca').textContent = DATOS.marcas[MARCA].marca.org;
  if (DATOS.marcas[MARCA].posts[0]?._orig) pintarCuentaConfirmar();
}

$('#atras').addEventListener('click', volver);
$('#marca').addEventListener('click', () => {
  cambiarMarca(MARCA === 'creartbox' ? 'adar' : 'creartbox');
  // El calendario de una marca no tiene por qué dejar a la otra en el mismo día.
  calMes = null; calDia = null;
  mostrarVista();
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

  // El histórico es de la cuenta de CreArtBox: en la otra marca no pinta nada.
  if (MARCA === 'creartbox') {
    for (const [fecha, url, tipo, , , , tema] of (HISTORICO?.posts || [])) {
      const code = url.replace(/\/$/, '').split('/').pop();
      poner({
        fecha, forma: 'post', estado: 'publicado', url, titulo: tema, tipo,
        miniatura: `datos/miniaturas/${fecha.replace(/-/g, '')}-${code}.jpg`,
        redes: ['ig'],
      });
    }
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
      poner({
        ...comun, fecha: aLocalNY(cuando).slice(0, 10), hora: aLocalNY(cuando).slice(11, 16), iso: cuando,
        estado: yaSalio(prog) ? 'publicado' : 'programado', salio: yaSalio(prog),
        // Lo que está en cola y todavía espera material saldrá igualmente: por
        // eso es donde más conviene que el calendario lo diga.
        falta: Boolean(p.falta) && !yaSalio(prog),
        redes: prog.redes.map((r) => r.red),
      });
    } else if (faseDe(p) === 'preparado' && preparadoDe(p)) {
      // Lo preparado ya tiene día y hora, aunque falte confirmarlo.
      const cuando = preparadoDe(p).redes[0].cuando;
      poner({ ...comun, fecha: aLocalNY(cuando).slice(0, 10), hora: aLocalNY(cuando).slice(11, 16), iso: cuando,
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
const horaMadrid = (iso) => new Date(iso).toLocaleTimeString('es-ES', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
});
const largo = (fecha, opciones) => new Date(fecha + 'T12:00:00Z')
  .toLocaleDateString('es-ES', { ...opciones, timeZone: 'UTC' });

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
        aria-label="${largo(fecha, { day: 'numeric', month: 'long' })}${cuantas ? `: ${cuantas}` : ''}${concierto ? ', concierto' : ''}">
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
  const sello = e.estado === 'idea' ? 'idea o por confirmar' : e.estado === 'programado' ? 'en cola' : (e.salio ? 'salió' : 'publicado');
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
      <span class="cal-meta"><span class="cal-tipo ${e.forma}">${e.forma === 'historia' ? 'Historia' : 'Post'}</span><i class="cal-marca ${e.forma} ${e.estado}"></i>${escapar(meta)}</span>
      <b>${escapar(e.titulo)}</b>
      ${e.falta ? '<span class="cal-falta">falta material</span>' : ''}
    </span>
  </button>`;
}

function pintarDiaCalendario(por) {
  const cont = $('#cal-dia');
  if (!calDia) {
    cont.innerHTML = '<p class="aviso-suave">Nada este mes.</p>';
    return;
  }
  const dia = por.get(calDia) || [];
  const concierto = dia.find((e) => e.forma === 'concierto');
  const cosas = dia.filter((e) => e.forma !== 'concierto');
  cont.innerHTML = `
    <h3>${largo(calDia, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    ${concierto ? `<p class="cal-aviso-concierto"><b>${escapar(concierto.titulo)}</b>${concierto.sitio ? ' · ' + escapar(concierto.sitio) : ''}</p>` : ''}
    ${cosas.length ? cosas.map(filaCalendario).join('') : '<p class="aviso-suave">Nada este día.</p>'}`;
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
function mostrarVista() {
  const enMeses = vista === 'meses';
  $('#vista-meses').hidden = !enMeses;
  $('#pestanas').hidden = enMeses;
  $('#mes-barra').hidden = enMeses || !MES;
  if (MES) $('#mes-nombre').textContent = nombreMes(MES);
  $('#vista-ideas').hidden = vista !== 'ideas';
  $('#vista-programado').hidden = vista !== 'programado';
  $('#vista-confirmar').hidden = vista !== 'confirmar';
  $('#vista-publicado').hidden = vista !== 'publicado';
  $('#vista-calendario').hidden = vista !== 'calendario';
  if (enMeses) pintarMeses();
  else if (vista === 'ideas') pintarLista();
  else if (vista === 'programado') pintarProgramado();
  else if (vista === 'confirmar') pintarConfirmar();
  else if (vista === 'calendario') pintarCalendario();
  else { pintarPublicadas(); pintarPublicado(); }
}

// ── Los meses: la entrada ──────────────────────────────────────────────
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreMes(m) { const [a, n] = m.split('-').map(Number); const t = `${MESES_ES[n - 1]} ${a}`; return t[0].toUpperCase() + t.slice(1); }
function sumaMes(m, d) { const [a, n] = m.split('-').map(Number); const f = new Date(Date.UTC(a, n - 1 + d, 1)); return f.toISOString().slice(0, 7); }

async function pintarMeses() {
  await cargarHistorico();
  const por = eventosCalendario();
  const resumen = new Map();
  for (const [fecha, lista] of por) {
    const m = fecha.slice(0, 7);
    for (const e of lista) {
      if (e.forma === 'concierto') { (resumen.get(m) || resumen.set(m, { conciertos: [] }).get(m)).conciertos ||= []; resumen.get(m).conciertos.push(e.titulo); continue; }
      const r = resumen.get(m) || resumen.set(m, { conciertos: [] }).get(m);
      r[e.forma] = (r[e.forma] || 0) + 1;
      r[e.estado] = (r[e.estado] || 0) + 1;
    }
  }
  const hoy = hoyISO().slice(0, 7);
  // De octubre de 2026 a dos meses vista, y los meses más lejanos que ya tengan algo.
  const meses = [];
  for (let m = '2026-10'; m <= sumaMes(hoy, 2); m = sumaMes(m, 1)) meses.push(m);
  for (const m of [...resumen.keys()].sort()) if (m > sumaMes(hoy, 2) && !meses.includes(m)) meses.push(m);
  const cerrados = FLUJO.meses || {};
  $('#meses-lista').innerHTML = meses.map((m) => {
    const r = resumen.get(m) || { conciertos: [] };
    const total = (r.post || 0) + (r.historia || 0);
    const hechos = (r.publicado || 0) + (r.programado || 0);
    const pct = total ? Math.round((hechos / total) * 100) : 0;
    const terminado = cerrados[m] && cerrados[m].terminado;
    const pasado = m < hoy;
    return `<article class="mes-tarjeta${m === hoy ? ' actual' : ''}${terminado ? ' terminado' : ''}" data-mes="${m}">
      <div class="mes-cab"><h3>${nombreMes(m)}</h3>${m === hoy ? '<span class="mes-hoy">este mes</span>' : ''}</div>
      ${r.conciertos.length ? `<p class="mes-conciertos">🎻 ${r.conciertos.map(escapar).join(' · ')}</p>` : ''}
      <p class="mes-cifras"><b>${r.post || 0}</b> posts · <b>${r.historia || 0}</b> historias</p>
      <div class="mes-barra-pct"><i style="width:${pct}%"></i></div>
      <p class="mes-estado">${pct}% resuelto · ${r.publicado || 0} publicados · ${r.programado || 0} en cola · ${r.idea || 0} por confirmar o ideas</p>
      <label class="mes-check"><input type="checkbox" data-mes="${m}" ${terminado ? 'checked' : ''}> Mes terminado${pasado ? '' : ', todo programado'}</label>
    </article>`;
  }).join('');
}

$('#meses-lista').addEventListener('click', async (e) => {
  const cb = e.target.closest('input[type="checkbox"][data-mes]');
  if (cb) {
    e.stopPropagation();
    if (!PUEDE_GUARDAR) { cb.checked = !cb.checked; aviso('Primero entra con GitHub (una vez en este aparato).'); return; }
    try {
      const r = await fetch('/api/flujo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'mes', mes: cb.dataset.mes, terminado: cb.checked }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      FLUJO.meses = j.meses;
      aviso(cb.checked ? `${nombreMes(cb.dataset.mes)}: terminado.` : `${nombreMes(cb.dataset.mes)}: abierto otra vez.`);
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
  mostrarVista();
  window.scrollTo(0, 0);
});
$('#mes-volver').addEventListener('click', () => { MES = null; vista = 'meses'; mostrarVista(); window.scrollTo(0, 0); });

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

arrancar().catch((e) => aviso('No se pudieron cargar los datos: ' + e.message, true));
