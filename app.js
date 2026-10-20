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
const CLAVE_TOKEN = 'cola_gh_token';
const REPO = 'gaawi/editorial-cola';
const RAMA = 'main';
const ARCHIVO = 'aprobaciones.json';

// Las cuatro que caben bajo un post. Son cuatro de los siete estados del
// panel, con el nombre de lo que uno hace, no de en qué queda la ficha.
const DECISIONES = [
  { estado: 'listo',      icono: '✓', texto: 'Listo' },
  { estado: 'espera',     icono: '◷', texto: 'Posponer' },
  { estado: 'cambios',    icono: '✎', texto: 'Mejorar' },
  { estado: 'descartado', icono: '×', texto: 'Descartar' },
];

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
let tipo = 'post';
const HOY = new Date().toISOString().slice(0, 10);
const DIA = 86400000;
let HISTORICO = null;

/**
 * Pedir un texto sin usar prompt(), que en el móvil saca el diálogo del
 * sistema con su «Suppress Alerts» y encima bloquea la página.
 * Devuelve el texto, o null si se cancela.
 */
function pedirTexto({ titulo, valor = '', ayuda = '', aceptar = 'Guardar', largo = true }) {
  return new Promise((resolve) => {
    const hoja = document.createElement('div');
    hoja.className = 'pide';
    hoja.innerHTML = `
      <div class="pide-caja">
        <h3>${escapar(titulo)}</h3>
        ${ayuda ? `<p>${escapar(ayuda)}</p>` : ''}
        ${largo
          ? `<textarea rows="4" placeholder="Escribe aquí…"></textarea>`
          : `<input type="text" placeholder="Escribe aquí…">`}
        <div class="pide-botones">
          <button class="btn btn-no" data-no>Cancelar</button>
          <button class="btn btn-si" data-si>${escapar(aceptar)}</button>
        </div>
      </div>`;
    document.body.appendChild(hoja);
    const campo = hoja.querySelector('textarea, input');
    campo.value = valor;
    setTimeout(() => campo.focus(), 50);

    const cerrar = (v) => { hoja.remove(); resolve(v); };
    hoja.querySelector('[data-si]').onclick = () => cerrar(campo.value.trim());
    hoja.querySelector('[data-no]').onclick = () => cerrar(null);
    hoja.onclick = (e) => { if (e.target === hoja) cerrar(null); };
    campo.onkeydown = (e) => { if (e.key === 'Enter' && !largo) { e.preventDefault(); cerrar(campo.value.trim()); } };
  });
}

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
  $('#visor-pie').innerHTML = `<div class="decidir-fila">${DECISIONES.map((d) => `
    <button class="dec ${d.estado}${estadoDe(p).estado === d.estado ? ' on' : ''}" data-dec="${d.estado}">
      <em>${d.icono}</em>${d.texto}
    </button>`).join('')}</div>`;
  $('#visor-pie').querySelector('.decidir-fila').onclick = (ev) => {
    const b = ev.target.closest('.dec');
    if (!b) return;
    decidirEn(p, b.dataset.dec, null).then(() => {
      $('#visor-pie').querySelectorAll('.dec').forEach((x) =>
        x.classList.toggle('on', x.dataset.dec === estadoDe(p).estado));
      mostrarVista();
    });
  };
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

/** Las de un apartado, del tipo que toque, ordenadas por fecha. */
function fichasDe(grupo) {
  return DATOS.marcas[MARCA].posts
    .filter((p) => grupoDe(p) === grupo)
    .filter((p) => (tipo === 'historia') === (p.formato === 'historia'))
    .sort((a, b) => a.date.localeCompare(b.date));
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
  if (tipo === 'historia') {
    pintarHistorias(posts);
    $('#historias').hidden = false;
  } else {
    $('#historias').hidden = true;
    for (const p of posts) cont.appendChild(tarjeta(p));
  }
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
  for (const p of fichas) cont.appendChild(tarjeta(p, { sinDecidir: true }));
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

  if (tipo === 'historia') {
    $('#historias-prog').hidden = false;
    pintarHistorias(fichas, '#historias-prog');
  } else {
    $('#historias-prog').hidden = true;
    for (const p of fichas) cont.appendChild(tarjeta(p, { sinDecidir: true }));
  }
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
    ${opciones.sinDecidir ? '' : `<div class="decidir-fila">
      ${DECISIONES.map((d) => `
        <button class="dec ${d.estado}${e.estado === d.estado ? ' on' : ''}" data-dec="${d.estado}">
          <em>${d.icono}</em>${d.texto}
        </button>`).join('')}
    </div>`}
    <button class="abrir">Ver en Facebook y como historia ·  Etiquetas ›</button>`;

  art.querySelector('.abrir').addEventListener('click', () => abrir(p));
  if (opciones.sinDecidir) return art;
  art.querySelector('.decidir-fila').addEventListener('click', (ev) => {
    const b = ev.target.closest('.dec');
    if (b) decidirEn(p, b.dataset.dec, art);
  });
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

/** Decidir desde el muro, sin abrir la ficha. */
async function decidirEn(p, estado, art) {
  if (estado === 'cambios') {
    const nota = await pedirTexto({
      titulo: '¿Qué hay que mejorar?',
      ayuda: p.title,
      valor: estadoDe(p).nota || '',
    });
    if (nota === null) return;
    return guardarDecision(p, 'cambios', nota, art);
  }
  // Volver a tocar la que ya estaba la quita.
  const ya = estadoDe(p).estado === estado;
  if (ya) return guardarDecision(p, '', '', art);
  if (estado === 'espera') {
    const volver = cuandoVolver(p);
    await guardarDecision(p, 'espera', '', art, volver);
    aviso(volver ? `Vuelve el ${volver}` : 'Guardado: a este ya se le pasó el momento');
    mostrarVista();
    return;
  }
  return guardarDecision(p, estado, '', art);
}

async function guardarDecision(p, estado, nota, art, volver) {
  const antes = APROB.posts[p.clave];
  if (estado) {
    APROB.posts[p.clave] = { estado, nota, titulo: p.title, fecha: new Date().toISOString() };
    if (volver) APROB.posts[p.clave].volver = volver;
  }
  else delete APROB.posts[p.clave];
  refrescarDecisiones(p, art);
  aviso('Guardando…');
  try {
    await guardarJSON('aprobaciones.json', (remoto) => {
      APROB.posts = { ...(remoto.posts || {}), ...APROB.posts };
      if (!estado) delete APROB.posts[p.clave];
      return {
        _ayuda: 'Aprobaciones escritas desde la app. Cada clave es «idioma/slug». '
          + 'estado: listo · espera · cambios · descartado. Lo escribe la propia app.',
        posts: APROB.posts,
      };
    }, `${ESTADOS[estado] || 'Sin marcar'}: ${p.title}`);
    aviso(estado ? ESTADOS[estado] : 'Desmarcado');
  } catch (e) {
    if (antes) APROB.posts[p.clave] = antes; else delete APROB.posts[p.clave];
    refrescarDecisiones(p, art);
    aviso(e.message, true);
  }
}

function refrescarDecisiones(p, art) {
  if (!art) return;
  const e = estadoDe(p);
  art.querySelectorAll('.dec').forEach((b) => b.classList.toggle('on', b.dataset.dec === e.estado));
  const vieja = art.querySelector('.nota-puesta');
  if (vieja) vieja.remove();
  if (e.nota) {
    const n = document.createElement('p');
    n.className = 'nota-puesta';
    n.textContent = `“${e.nota}”`;
    art.querySelector('.decidir-fila').before(n);
  }
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
  $('#caja-nota').hidden = true;
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
async function pintarPublicado() {
  if (!HISTORICO) {
    try { HISTORICO = await (await fetch('datos/historico-ig.json', { cache: 'no-store' })).json(); }
    catch { HISTORICO = { posts: [] }; }
  }
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

// ── Entrar en GitHub ───────────────────────────────────────────────────
// El mismo baile que el panel de ADAR: /api/auth abre GitHub, devuelve el
// token por postMessage y se queda en sessionStorage, o sea que muere al
// cerrar la pestaña. Aquí no se guarda ningún secreto.
function pedirToken() {
  const guardado = sessionStorage.getItem(CLAVE_TOKEN);
  if (guardado) return Promise.resolve(guardado);

  return new Promise((resolve, reject) => {
    const w = window.open('/api/auth', 'cola-gh', 'width=700,height=740');
    if (!w) return reject(new Error('El navegador bloqueó la ventana. Permite las emergentes.'));
    const tope = setTimeout(() => {
      window.removeEventListener('message', recibir);
      reject(new Error('Se agotó el tiempo esperando a GitHub.'));
    }, 120000);

    function recibir(ev) {
      if (ev.origin !== window.location.origin || typeof ev.data !== 'string') return;
      if (ev.data === 'authorizing:github') { try { w.postMessage('cola', window.location.origin); } catch {} return; }
      const m = ev.data.match(/^authorization:github:(success|error):([\s\S]*)$/);
      if (!m) return;
      clearTimeout(tope);
      window.removeEventListener('message', recibir);
      let carga;
      try { carga = JSON.parse(m[2]); } catch { return reject(new Error('Respuesta de GitHub ilegible.')); }
      if (m[1] === 'success' && carga.token) {
        sessionStorage.setItem(CLAVE_TOKEN, carga.token);
        resolve(carga.token);
      } else reject(new Error(carga.error || 'GitHub no dio permiso.'));
    }
    window.addEventListener('message', recibir);
  });
}

async function api(ruta, opciones = {}) {
  const token = await pedirToken();
  const r = await fetch(`https://api.github.com/repos/${REPO}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (r.status === 401) { sessionStorage.removeItem(CLAVE_TOKEN); throw new Error('El permiso caducó. Vuelve a intentarlo.'); }
  if (!r.ok && r.status !== 404) {
    const e = new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || ''}`);
    e.estado = r.status;
    throw e;
  }
  return r.status === 404 ? null : r.json();
}

/**
 * Escribe un archivo JSON en el repositorio.
 * Relee el sha justo antes: si alguien lo cambió desde otro sitio, GitHub
 * rechaza la escritura en vez de pisarla, y `fundir` decide qué conservar.
 */
async function guardarJSON(ruta, fundir, mensaje) {
  // GitHub sirve la lectura desde una caché que va por detrás de la
  // escritura: al guardar dos veces seguidas, la segunda lee un sha viejo y
  // la rechaza con un 409. No es un choque de verdad —aquí escribe una sola
  // persona—, así que se vuelve a leer y se reintenta.
  let ultimo;
  for (let intento = 0; intento < 4; intento++) {
    if (intento) await new Promise((r) => setTimeout(r, 400 * intento));
    const enRepo = await api(`/contents/${ruta}?ref=${RAMA}&t=${Date.now()}`);
    let remoto = {};
    let sha = null;
    if (enRepo) {
      sha = enRepo.sha;
      try { remoto = JSON.parse(decodeURIComponent(escape(atob(enRepo.content.replace(/\n/g, ''))))); } catch {}
    }
    const cuerpo = fundir(remoto);
    cuerpo.actualizado = new Date().toISOString();
    try {
      const res = await api(`/contents/${ruta}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: mensaje,
          content: btoa(unescape(encodeURIComponent(JSON.stringify(cuerpo, null, 1) + '\n'))),
          branch: RAMA,
          ...(sha ? { sha } : {}),
        }),
      });
      return res.content.sha;
    } catch (e) {
      if (e.estado !== 409) throw e;
      ultimo = e;
    }
  }
  throw new Error('GitHub sigue rechazando la escritura. Espera un momento y vuelve a darle.');
}

// ── Guardar la decisión ────────────────────────────────────────────────
async function decidir(estado, nota) {
  if (!actual) return;
  const antes = APROB.posts[actual.clave];
  APROB.posts[actual.clave] = {
    estado,
    nota: nota || '',
    titulo: actual.title,
    fecha: new Date().toISOString(),
  };
  pintarEstadoActual();
  aviso('Guardando…');

  try {
    await guardarJSON('aprobaciones.json', (remoto) => {
      APROB.posts = { ...(remoto.posts || {}), ...APROB.posts };
      return {
        _ayuda: 'Aprobaciones escritas desde la app de aprobar. Cada clave es «idioma/slug». '
          + 'estado: listo · cambios · espera · borrador · idea · descartado. Lo escribe la propia app.',
        posts: APROB.posts,
      };
    }, `${estado === 'listo' ? 'Listo' : 'Cambios'}: ${actual.title}`);
    aviso(estado === 'listo' ? 'Marcado como listo' : 'Guardado');
    $('#caja-nota').hidden = true;
  } catch (e) {
    if (antes) APROB.posts[actual.clave] = antes; else delete APROB.posts[actual.clave];
    pintarEstadoActual();
    aviso(e.message, true);
  }
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
for (const donde of ['#historias', '#historias-prog']) {
  $(donde).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-clave]');
    if (b) abrirHistoria(b.dataset.clave);
  });
}
$('#visor-cerrar').addEventListener('click', () => { $('#visor').hidden = true; });
/** Enseña el apartado que toque y pinta solo ese. */
function mostrarVista() {
  $('#vista-ideas').hidden = vista !== 'ideas';
  $('#vista-programado').hidden = vista !== 'programado';
  $('#vista-publicado').hidden = vista !== 'publicado';
  $('#tipos').hidden = false;
  // La rejilla del perfil de Instagram solo tiene sentido con los posts:
  // las historias no se quedan en el perfil.
  $('#rejilla').hidden = vista === 'publicado' && tipo === 'historia';
  if (vista === 'ideas') pintarLista();
  else if (vista === 'programado') pintarProgramado();
  else { pintarPublicadas(); pintarPublicado(); }
}

$('#pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('.pest');
  if (!b) return;
  document.querySelectorAll('.pest').forEach((x) => x.classList.toggle('activo', x === b));
  vista = b.dataset.vista;
  mostrarVista();
});
$('#tipos').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  $('#tipos').querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c === b));
  tipo = b.dataset.tipo;
  mostrarVista();
});
$('#rejilla').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-url]');
  if (b) abrirPublicada(b.dataset.url);
});
$('#hoja').addEventListener('click', (e) => {
  if (e.target.id === 'hoja' || e.target.id === 'hoja-cerrar') $('#hoja').hidden = true;
});
$('#aprobar').addEventListener('click', () => decidir('listo', ''));
$('#cambios').addEventListener('click', () => {
  const caja = $('#caja-nota');
  caja.hidden = !caja.hidden;
  if (!caja.hidden) { $('#nota').value = estadoDe(actual).nota || ''; $('#nota').focus(); }
});
$('#guardar-nota').addEventListener('click', () => decidir('cambios', $('#nota').value.trim()));

arrancar().catch((e) => aviso('No se pudieron cargar los datos: ' + e.message, true));
