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
let shaAprob = null;
let actual = null;
let filtro = 'pendientes';

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
  if (mio && mio.estado) return { estado: mio.estado, nota: mio.nota || '', mio: true, fecha: mio.fecha };
  const h = p.heredado || {};
  return { estado: h.estado || 'sin', nota: h.nota || '', mio: false };
}
function yaPublicado(p) {
  const h = (p.heredado && p.heredado.publicado) || {};
  return ['ig', 'fb'].filter((r) => h[r]);
}

// ── Lista ──────────────────────────────────────────────────────────────
function pintarLista() {
  const cont = $('#fichas');
  cont.innerHTML = '';
  const posts = DATOS.marcas[MARCA].posts.filter((p) => {
    const e = estadoDe(p).estado;
    if (filtro === 'listos') return e === 'listo';
    if (filtro === 'pendientes') return e !== 'listo' && e !== 'descartado';
    return true;
  });

  $('#vacio').hidden = posts.length > 0;
  for (const p of posts) {
    const b = document.createElement('button');
    b.className = 'ficha';
    const e = estadoDe(p);
    const pub = yaPublicado(p);
    b.innerHTML = `
      ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : '<span class="sinfoto"></span>'}
      <span class="txt">
        <h2>${escapar(p.title)}</h2>
        <span class="pie">
          <span class="sello ${e.estado}">${ESTADOS[e.estado] || e.estado}</span>
          ${pub.length ? `<span class="sello publicado">ya en ${pub.join('+')}</span>` : ''}
          <span>${p.date || ''}</span>
        </span>
      </span>`;
    b.addEventListener('click', () => abrir(p));
    cont.appendChild(b);
  }
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
  const visible = texto.length > corte ? texto.slice(0, corte) : texto;
  const resto = texto.length > corte;
  let html = escapar(visible).replace(/#[\p{L}\p{N}_]+/gu, (m) => `<span class="eti">${m}</span>`);
  if (enlaces) html = html.replace(/https?:\/\/[^\s<]+/g, (m) => `<a>${m}</a>`);
  return html + (resto ? `<span class="${claseMas}">… ${etiqueta}</span>` : '');
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
  await MOTOR.dibujar(c, post, slide, idx, total, fmt);
  return c;
}

async function pintarInstagram(p) {
  const esCarrusel = p.slides.length > 1 && p.kind !== 'entrevista';
  const slides = esCarrusel ? p.slides : [p.slides[0]];
  const caja = document.createElement('div');
  caja.className = 'ig';
  caja.innerHTML = `
    <div class="ig-cab">
      <img class="ig-av" src="${CUENTAS.avatar}" alt="">
      <span class="ig-usuario">${CUENTAS.ig}</span>
      <span class="ig-mas">•••</span>
    </div>
    <div class="ig-carrete"><div class="tira"></div>${slides.length > 1 ? `<span class="ig-cuenta">1/${slides.length}</span>` : ''}</div>
    ${slides.length > 1 ? `<div class="ig-puntos">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    <div class="ig-acciones">${ICONOS.corazon}${ICONOS.comentar}${ICONOS.enviar}<span class="guardar">${ICONOS.guardar}</span></div>
    <div class="ig-pie"><b>${CUENTAS.ig}</b>${pintarPie(p.pies.ig.texto, 125, 'mas', 'más', false)}</div>
    <div class="ig-hora">Hace un momento</div>`;

  const tira = caja.querySelector('.tira');
  for (let i = 0; i < slides.length; i++) tira.appendChild(await lienzo(p, slides[i], i, slides.length, 'ig'));

  // Los puntos y el contador siguen al dedo, como en la app.
  if (slides.length > 1) {
    const puntos = caja.querySelectorAll('.ig-puntos i');
    const cuenta = caja.querySelector('.ig-cuenta');
    tira.addEventListener('scroll', () => {
      const i = Math.round(tira.scrollLeft / tira.clientWidth);
      puntos.forEach((d, j) => d.classList.toggle('on', j === i));
      if (cuenta) cuenta.textContent = `${i + 1}/${slides.length}`;
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
  caja.insertBefore(await lienzo(p, p.slides[0], 0, 1, 'fb'), caja.querySelector('.fb-acciones'));
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
  caja.insertBefore(await lienzo(p, p.slides[0], 0, 1, 'story'), caja.firstElementChild);
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
  pintarLista();
}

function pintarEstadoActual() {
  const e = estadoDe(actual);
  const d = $('#estado-actual');
  d.innerHTML = `Ahora: <b>${ESTADOS[e.estado] || e.estado}</b>` +
    (e.nota ? ` · ${escapar(e.nota)}` : '') +
    (e.mio ? '' : ' <span style="color:var(--tenue)">(del panel viejo)</span>');
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
  if (!r.ok && r.status !== 404) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || ''}`);
  return r.status === 404 ? null : r.json();
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
    // Se relee el sha antes de escribir: si ha cambiado desde otro sitio,
    // GitHub rechaza la escritura en vez de pisarla.
    const actualEnRepo = await api(`/contents/${ARCHIVO}?ref=${RAMA}`);
    if (actualEnRepo) {
      shaAprob = actualEnRepo.sha;
      const remoto = JSON.parse(decodeURIComponent(escape(atob(actualEnRepo.content.replace(/\n/g, '')))));
      APROB.posts = { ...(remoto.posts || {}), ...APROB.posts };
    }

    const cuerpo = {
      _ayuda: 'Aprobaciones escritas desde la app de aprobar. Cada clave es «idioma/slug». '
        + 'estado: listo · cambios · espera · borrador · idea · descartado. Lo escribe la propia app.',
      actualizado: new Date().toISOString(),
      posts: APROB.posts,
    };
    const contenido = btoa(unescape(encodeURIComponent(JSON.stringify(cuerpo, null, 1) + '\n')));

    const res = await api(`/contents/${ARCHIVO}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `${estado === 'listo' ? 'Listo' : 'Cambios'}: ${actual.title}`,
        content: contenido,
        branch: RAMA,
        ...(shaAprob ? { sha: shaAprob } : {}),
      }),
    });
    shaAprob = res.content.sha;
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
  // Lo ya decidido: del propio sitio, que es lo último desplegado.
  try {
    const r = await fetch(ARCHIVO + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) APROB = await r.json();
  } catch {}
  if (!APROB.posts) APROB.posts = {};

  cambiarMarca(MARCA);
  pintarLista();
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
  pintarLista();
});
$('#filtros').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c === b));
  filtro = b.dataset.filtro;
  pintarLista();
});
$('#redes').addEventListener('click', (e) => {
  const b = e.target.closest('.red');
  if (!b) return;
  document.querySelectorAll('.red').forEach((c) => c.classList.toggle('activo', c === b));
  pintarPrevia(b.dataset.red);
});
$('#aprobar').addEventListener('click', () => decidir('listo', ''));
$('#cambios').addEventListener('click', () => {
  const caja = $('#caja-nota');
  caja.hidden = !caja.hidden;
  if (!caja.hidden) { $('#nota').value = estadoDe(actual).nota || ''; $('#nota').focus(); }
});
$('#guardar-nota').addEventListener('click', () => decidir('cambios', $('#nota').value.trim()));

arrancar().catch((e) => aviso('No se pudieron cargar los datos: ' + e.message, true));
