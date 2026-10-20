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
let vista = 'ideas';
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
  return 'idea';
}

/** ¿Ha pasado ya la última hora programada de esta ficha? */
function yaSalio(e) {
  return e.redes.every((r) => new Date(r.cuando) < new Date());
}

/** Las de un apartado, ordenadas por fecha. */
function fichasDe(grupo) {
  return DATOS.marcas[MARCA].posts
    .filter((p) => grupoDe(p) === grupo)
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
  const posts = fichasDe('idea').filter((p) => {
    if (filtro === 'todas') return true;
    return estadoDe(p).estado !== 'descartado' && enVentana(p) && !dormido(p);
  });

  $('#vacio').hidden = posts.length > 0;
  const { historias, posts: muro } = reparte(posts);
  $('#historias').hidden = !historias.length;
  pintarHistorias(historias);
  for (const p of muro) cont.appendChild(tarjeta(p));
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
  const redes = e.redes.map((r) => (r.red === 'ig' ? 'IG' : 'FB')).join('+');
  const salio = yaSalio(e);
  const que = salio ? 'salió' : (e.tipo === 'historia' ? 'historia' : 'en cola');
  return `<a class="sello en-cola${salio ? ' salido' : ''}" href="${PROGRAMADO.calendario}"
    target="_blank" rel="noopener"
    title="${salio
      ? 'Le tocaba salir a esta hora. Deducido del calendario, no comprobado contra la red.'
      : 'Programado en Metricool. Para cambiarlo o quitarlo hay que ir allí.'}"
    >${que} ${dia} ${hora} ${redes} ↗</a>`;
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
    ? `${n} publicaciones en cola, de ${todas.length} fichas. Para cambiar o quitar algo hay que ir
       a <a href="${PROGRAMADO.calendario}" target="_blank" rel="noopener">Metricool</a>:
       desde aquí no se para.`
    : 'Nada en cola.';

  const { historias, posts: muro } = reparte(fichas);
  $('#historias-prog').hidden = !historias.length;
  pintarHistorias(historias, '#historias-prog');
  for (const p of muro) cont.appendChild(tarjeta(p, { sinDecidir: true }));
  observarLienzos();
}

/** Un post del muro: como se verá, con la decisión debajo. */
function tarjeta(p, opciones = {}) {
  const e = estadoDe(p);
  const c = p.concierto ? conciertoDe(p.concierto) : null;
  const pub = yaPublicado(p);

  const art = document.createElement('article');
  art.className = 'tarjeta';
  art.dataset.clave = p.clave;
  art.innerHTML = `
    <div class="cabecera-ficha">
      ${c ? `<span class="cuando-ficha">${escapar(c.nombre)}</span>` : ''}
      ${cuandoTexto(p) && grupoDe(p) === 'idea'
        ? `<span class="cuando-ficha tenue">${cuandoTexto(p)}</span>` : ''}
      ${p.publicadoEn
        ? `<a class="sello publicado" href="${p.publicadoEn.url}" target="_blank" rel="noopener">publicado el ${p.publicadoEn.fecha} ↗</a>`
        : pub.length ? `<span class="sello publicado">ya en ${pub.join('+')}</span>` : ''}
      ${selloProgramado(p)}
      <span class="crece"></span>
    </div>
    <div class="hueco-ig"><div class="espera-lienzo">…</div></div>
    ${p.falta ? `<p class="falta-material">Falta material: ${escapar(p.falta)}</p>` : ''}
    ${e.nota ? `<p class="nota-puesta">“${escapar(e.nota)}”</p>` : ''}
    <button class="abrir">Ver en Facebook y como historia ·  Etiquetas ›</button>`;

  art.querySelector('.abrir').addEventListener('click', () => abrir(p));
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
        hueco.replaceChildren(await pintarInstagram(p));
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

function pintarPie(texto, corte, claseMas, etiqueta, enlaces) {
  // Aquí se lee, no se publica: el texto sale entero y desplegado.
  if (texto.length <= corte) return `<span class="pie-texto">${tintar(texto, enlaces)}</span>`;
  // El corte se lleva al final de la palabra: partir «twenty-two» por la
  // mitad para marcar el pliegue estropea más de lo que informa.
  let fin = texto.lastIndexOf(' ', corte);
  if (fin < corte * 0.6) fin = corte;
  return '<span class="pie-texto">'
    + tintar(texto.slice(0, fin), enlaces)
    + `<span class="tras-pliegue">${tintar(texto.slice(fin), enlaces)}</span>`
    + `<small class="aviso-pliegue">Hasta aquí se ve sin tocar «${etiqueta}»; lo gris queda debajo.</small>`
    + '</span>';
}

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
  await MOTOR.dibujar(c, post, slide, idx, total, fmt, post.estilo || 'cinta');
  return c;
}

/**
 * Una foto que se publica tal cual, sin pasar por el motor. Hay posts que no
 * quieren diseño: las cinco de Kuopio son las de la web y lo que cuentan lo
 * cuentan ellas. Se recorta a 4:5 con CSS, que es lo que hace Instagram.
 */
function fotoSuelta(url) {
  const img = new Image();
  img.className = 'foto-suelta';
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

async function pintarInstagram(p) {
  const piezas = piezasDe(p);
  const slides = piezas.slides || piezas.fotos;
  const caja = document.createElement('div');
  caja.className = 'ig';
  caja.innerHTML = `
    <div class="ig-cab">
      <img class="ig-av" src="${CUENTAS.avatar}" alt="">
      <span class="ig-usuario">${CUENTAS.ig}</span>
      <span class="ig-mas">•••</span>
    </div>
    <div class="ig-carrete"><div class="tira"></div>${slides.length > 1 ? `
      <span class="ig-cuenta">1/${slides.length}</span>
      <button class="paso atras" aria-label="Anterior">‹</button>
      <button class="paso alante" aria-label="Siguiente">›</button>` : ''}</div>
    ${slides.length > 1 ? `<div class="ig-puntos">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    <div class="ig-acciones">${ICONOS.corazon}${ICONOS.comentar}${ICONOS.enviar}<span class="guardar">${ICONOS.guardar}</span></div>
    <div class="ig-pie"><b>${CUENTAS.ig}</b>${pintarPie(p.pies.ig.texto, 125, 'mas', 'más', false)}</div>
    <div class="ig-hora">Hace un momento</div>`;

  const tira = caja.querySelector('.tira');
  for (let i = 0; i < slides.length; i++) {
    tira.appendChild(piezas.fotos
      ? fotoSuelta(piezas.fotos[i])
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
    <div class="fb-texto">${pintarPie(p.pies.fb.texto, 480, 'mas', 'Ver más', true)}</div>
    <div class="fb-acciones">
      <span>${ICONOS.pulgar} Me gusta</span>
      <span>${ICONOS.comentar} Comentar</span>
      <span>${ICONOS.compartir} Compartir</span>
    </div>`;
  caja.insertBefore(
    p.fotos && p.fotos.length ? fotoSuelta(p.fotos[0]) : await lienzo(p, p.slides[0], 0, 1, 'fb'),
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
  caja.insertBefore(
    p.fotos && p.fotos.length ? fotoSuelta(p.fotos[0]) : await lienzo(p, p.slides[0], 0, 1, 'story'),
    caja.firstElementChild
  );
  return caja;
}

const PINTORES = { ig: pintarInstagram, fb: pintarFacebook, story: pintarHistoria };

async function pintarPrevia(red) {
  const esc = $('#escenario');
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

function pintarEstadoActual() {
  const e = estadoDe(actual);
  const d = $('#estado-actual');
  d.innerHTML = `Ahora: <b>${ESTADOS[e.estado] || e.estado}</b>` +
    (e.nota ? ` · ${escapar(e.nota)}` : '') +
    (e.mio ? '' : ' <span style="color:var(--tenue)">(del panel viejo)</span>');
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

  cambiarMarca(MARCA);
  mostrarVista();
}

function cambiarMarca(m) {
  MARCA = m;
  MOTOR = crearMotor(DATOS.marcas[MARCA].marca);
  CUENTAS = DATOS.marcas[MARCA].cuentas;
  $('#marca').textContent = DATOS.marcas[MARCA].marca.org;
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
        ...comun, fecha: cuando.slice(0, 10), hora: cuando.slice(11, 16), iso: cuando,
        estado: yaSalio(prog) ? 'publicado' : 'programado', salio: yaSalio(prog),
        // Lo que está en cola y todavía espera material saldrá igualmente: por
        // eso es donde más conviene que el calendario lo diga.
        falta: Boolean(p.falta) && !yaSalio(prog),
        redes: prog.redes.map((r) => r.red),
      });
    } else if (grupoDe(p) === 'idea' && p.publicaEl && estadoDe(p).estado !== 'descartado') {
      poner({ ...comun, fecha: p.publicaEl, estado: 'idea', falta: Boolean(p.falta) });
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
  const sello = e.estado === 'idea' ? 'idea' : e.estado === 'programado' ? 'en cola' : (e.salio ? 'salió' : 'publicado');
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
      <span class="cal-meta"><i class="cal-marca ${e.forma} ${e.estado}"></i>${escapar(meta)}</span>
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
  $('#vista-ideas').hidden = vista !== 'ideas';
  $('#vista-programado').hidden = vista !== 'programado';
  $('#vista-publicado').hidden = vista !== 'publicado';
  $('#vista-calendario').hidden = vista !== 'calendario';
  if (vista === 'ideas') pintarLista();
  else if (vista === 'programado') pintarProgramado();
  else if (vista === 'calendario') pintarCalendario();
  else { pintarPublicadas(); pintarPublicado(); }
}

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
