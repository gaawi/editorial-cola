#!/usr/bin/env node
// editorial/cola · publicar en Facebook e Instagram desde el chat.
//
// La idea es que esto no tenga pantalla: Claude lo ejecuta desde la
// conversación, enseña lo que va a salir, y solo publica cuando se le dice
// «--ya». El material sale del kit de redes del repositorio de ADAR y se lee
// sin tocarlo.
//
//   node publicar.mjs cuentas
//   node publicar.mjs ideas --marca creartbox --listas
//   node publicar.mjs ver en/currents
//   node publicar.mjs publicar --idea en/currents --red ambas
//   node publicar.mjs publicar --idea en/currents --red ambas --ya
//   node publicar.mjs subir foto.jpg
//   node publicar.mjs registro

import { appendFile, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { descubrirCuentas, publicarFacebook, publicarInstagram } from './lib/meta.mjs';
import { marcas, normalizarImagen, programar } from './lib/metricool.mjs';
import { imagenesDelKit } from './lib/kit.mjs';
import { cargarIdeas, clave, buscar } from './lib/ideas.mjs';
import { pie, asomo, repasar, REDES } from './lib/textos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MARCAS = ['adar', 'creartbox'];
const REGISTRO = join(AQUI, 'registro.jsonl');

// ── Línea de órdenes ──────────────────────────────────────────────────────

function argumentos(argv) {
  const sueltos = [];
  const op = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [clave, valor] = a.slice(2).split('=');
      if (valor !== undefined) op[clave] = valor;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) op[clave] = argv[++i];
      else op[clave] = true;
    } else sueltos.push(a);
  }
  return { sueltos, op };
}

const C = {
  gris: (s) => `\x1b[90m${s}\x1b[0m`,
  fuerte: (s) => `\x1b[1m${s}\x1b[0m`,
  verde: (s) => `\x1b[32m${s}\x1b[0m`,
  rojo: (s) => `\x1b[31m${s}\x1b[0m`,
  ambar: (s) => `\x1b[33m${s}\x1b[0m`,
};

function morir(mensaje) {
  console.error(C.rojo('✗ ') + mensaje);
  process.exit(1);
}

// ── Credenciales ──────────────────────────────────────────────────────────
//
// Por orden: variables de entorno (lo propio de una sesión en la nube, que se
// configuran una vez en los ajustes del entorno) y, si no están, un
// credenciales.json local que nunca se sube.

async function credenciales() {
  const archivo = join(AQUI, 'credenciales.json');
  let fichero = {};
  if (existsSync(archivo)) fichero = JSON.parse(await readFile(archivo, 'utf8'));
  const token = process.env.META_TOKEN || fichero.token;
  if (!token) {
    throw new Error(
      'No hay token de Meta.\n' +
        '  Pon META_TOKEN en el entorno, o escribe credenciales.json con {"token":"…"}.\n' +
        '  Mira el README: hace falta un token de Página de larga duración.'
    );
  }
  return {
    token,
    paginaId: process.env.FB_PAGE_ID || fichero.paginaId || null,
    igId: process.env.IG_USER_ID || fichero.igId || null,
  };
}

/**
 * Metricool, que es la otra vía: ya tiene las cuentas conectadas, así que no
 * hace falta app de Meta. Pide plan Advanced o Custom.
 */
async function credencialesMetricool() {
  const archivo = join(AQUI, 'credenciales.json');
  const fichero = existsSync(archivo) ? JSON.parse(await readFile(archivo, 'utf8')).metricool || {} : {};
  const token = process.env.METRICOOL_TOKEN || fichero.token;
  if (!token) {
    throw new Error(
      'No hay token de Metricool.\n' +
        '  Está en Metricool → Configuración de la cuenta → API.\n' +
        '  Ponlo en el entorno como METRICOOL_TOKEN, con METRICOOL_USER_ID.'
    );
  }
  const userId = process.env.METRICOOL_USER_ID || fichero.userId;
  if (!userId) throw new Error('Falta METRICOOL_USER_ID: sale de la URL de Metricool al abrir una marca.');
  return { token, userId: String(userId), blogId: process.env.METRICOOL_BLOG_ID || fichero.blogId || null };
}

/** Por dónde se publica. Lo que se pida, y si no, lo que esté configurado. */
async function elegirVia(op) {
  if (op.via === 'metricool' || op.via === 'meta') return op.via;
  if (op.via) morir(`No sé publicar «por ${op.via}»: es «meta» o «metricool».`);
  if (process.env.METRICOOL_TOKEN) return 'metricool';
  if (process.env.META_TOKEN) return 'meta';
  const archivo = join(AQUI, 'credenciales.json');
  if (existsSync(archivo)) {
    const f = JSON.parse(await readFile(archivo, 'utf8'));
    if (f.metricool?.token) return 'metricool';
    if (f.token) return 'meta';
  }
  return 'meta';
}

/** La marca de Metricool con la que se trabaja. */
async function marcaActiva() {
  const cred = await credencialesMetricool();
  const lista = await marcas(cred);
  if (!lista.length) throw new Error('Ese token de Metricool no alcanza ninguna marca.');
  if (cred.blogId) {
    const m = lista.find((x) => x.blogId === cred.blogId);
    if (!m) throw new Error(`El token no alcanza la marca ${cred.blogId}.`);
    return { cred, marca: m };
  }
  if (lista.length > 1) {
    throw new Error(
      'El token alcanza varias marcas; di con cuál:\n' +
        lista.map((m) => `  METRICOOL_BLOG_ID=${m.blogId}  ${m.nombre}`).join('\n')
    );
  }
  return { cred: { ...cred, blogId: lista[0].blogId }, marca: lista[0] };
}

/** La Página con la que se trabaja y su token, resueltas del token que haya. */
async function cuentaActiva() {
  const cred = await credenciales();
  const { paginas } = await descubrirCuentas(cred.token);
  if (!paginas.length) throw new Error('Ese token no da acceso a ninguna Página de Facebook.');

  let pagina = paginas[0];
  if (cred.paginaId) {
    pagina = paginas.find((p) => p.id === cred.paginaId);
    if (!pagina) throw new Error(`El token no alcanza la Página ${cred.paginaId}.`);
  } else if (paginas.length > 1) {
    throw new Error(
      'El token alcanza varias Páginas; di con cuál:\n' +
        paginas.map((p) => `  FB_PAGE_ID=${p.id}  ${p.nombre}`).join('\n')
    );
  }
  const igId = cred.igId || pagina.ig?.id || null;
  return { pagina, igId, igNombre: pagina.ig?.username || null };
}

// ── Ideas ─────────────────────────────────────────────────────────────────

async function revisiones(marca) {
  const dir = process.env.ADAR_DIR || resolve(AQUI, '../adar');
  const archivo = join(dir, 'src/data', marca === 'adar' ? 'revisiones.json' : 'revisiones-creartbox.json');
  if (!existsSync(archivo)) return {};
  return JSON.parse(await readFile(archivo, 'utf8')).posts || {};
}

async function todasLasIdeas(soloMarca) {
  const fuera = [];
  for (const marca of soloMarca ? [soloMarca] : MARCAS) {
    const { brand, ideas } = await cargarIdeas(marca, resolve(AQUI, '../adar'));
    const rev = await revisiones(marca);
    for (const idea of ideas) fuera.push({ marca, brand, idea, rev: rev[clave(idea)] || {} });
  }
  return fuera;
}

/** Una sola idea, por clave o por trozo del título. */
async function unaIdea(texto, soloMarca) {
  const todas = await todasLasIdeas(soloMarca);
  // La clave exacta manda: hay fichas cuyo slug es el principio de otras.
  const exacta = todas.find((f) => clave(f.idea).toLowerCase() === texto.toLowerCase());
  if (exacta) return exacta;
  const encontradas = todas.filter((f) => buscar([f.idea], texto).length);
  if (!encontradas.length) morir(`No encuentro ninguna idea que sea «${texto}».`);
  if (encontradas.length > 1) {
    morir(
      'Eso encaja con varias; afina o añade --marca:\n' +
        encontradas.map((f) => `  ${f.marca}  ${clave(f.idea)}  ${f.idea.title}`).join('\n')
    );
  }
  return encontradas[0];
}

// Los siete estados del desplegable del panel, con el mismo nombre que allí.
// Verde: se puede publicar. Rojo: no se toca. Lo demás, todavía no está.
const ESTADOS = {
  listo: { texto: 'listo', color: 'verde' },
  cambios: { texto: 'cambios', color: 'rojo' },
  descartado: { texto: 'descartado', color: 'rojo' },
  espera: { texto: 'espera', color: 'ambar' },
  borrador: { texto: 'borrador', color: 'ambar' },
  idea: { texto: 'idea', color: 'gris' },
  '': { texto: '—', color: 'gris' },
};

/**
 * Algunas fichas traen la foto con ruta relativa porque el kit la sirve desde
 * el propio sitio. Ni Meta ni Metricool pueden ir a buscar eso: necesitan la
 * URL entera. Las imágenes del kit viven en festivaladar.com, también las de
 * CreArtBox, que es lo que dice el comentario de kit-creartbox.ts.
 */
function urlImagen(img) {
  if (!img) return null;
  if (/^https?:\/\//i.test(img)) return img;
  const sitio = process.env.SITIO_KIT || 'festivaladar.com';
  return `https://${sitio}${img.startsWith('/') ? '' : '/'}${img}`;
}

function señal(rev, ancho = 0) {
  const e = ESTADOS[rev.estado || ''] || { texto: rev.estado, color: 'gris' };
  // Se rellena antes de colorear: si no, los códigos de color cuentan y la
  // columna se descuadra.
  return C[e.color](e.texto.padEnd(ancho));
}

/** ¿Lo ha dado él por bueno? Solo «listo» lo es; lo demás, no todavía. */
function luzVerde(rev) {
  if (rev.estado === 'listo') return null;
  if (rev.estado === 'descartado') return 'está descartada en el panel';
  if (rev.estado === 'cambios') return 'está marcada «hay que cambiar algo»' + (rev.nota ? ': ' + rev.nota : '');
  if (rev.estado) return `está en «${ESTADOS[rev.estado]?.texto || rev.estado}», no en «listo»`;
  return 'no está marcada en el panel';
}

// ── Órdenes ───────────────────────────────────────────────────────────────

async function ordenCuentas(op) {
  const via = await elegirVia(op);
  console.log(C.gris(`vía por defecto: ${via}\n`));

  try {
    const { pagina, igId, igNombre } = await cuentaActiva();
    console.log(C.fuerte('── Meta'));
    console.log('  Facebook   ' + pagina.nombre + C.gris('  id ' + pagina.id));
    if (igId) console.log('  Instagram  @' + (igNombre || '?') + C.gris('  id ' + igId));
    else console.log(C.ambar('  Instagram  sin cuenta de empresa vinculada a esa Página.'));
    console.log(C.gris('  FB_PAGE_ID=' + pagina.id + (igId ? '  IG_USER_ID=' + igId : '')));
  } catch (e) {
    console.log(C.fuerte('── Meta') + C.gris('  ' + e.message.split('\n')[0]));
  }

  try {
    const { cred, marca } = await marcaActiva();
    console.log(C.fuerte('\n── Metricool'));
    console.log('  ' + marca.nombre + C.gris('  blogId ' + marca.blogId));
    if (marca.redes.length) console.log(C.gris('  conectadas: ' + marca.redes.join(', ')));
    console.log(C.gris('  METRICOOL_BLOG_ID=' + cred.blogId));
  } catch (e) {
    console.log(C.fuerte('\n── Metricool') + C.gris('  ' + e.message.split('\n')[0]));
  }
}

async function ordenIdeas(op) {
  const todas = await todasLasIdeas(op.marca);
  let lista = todas;
  if (op.buscar) lista = lista.filter((f) => buscar([f.idea], String(op.buscar)).length);
  if (op.listas) lista = lista.filter((f) => f.rev.estado === 'listo');
  if (!op.todas) lista = lista.filter((f) => f.idea.status === 'publish' || f.rev.estado);
  const n = Number(op.n || 20);

  console.log(C.gris(`${lista.length} ideas${lista.length > n ? ', enseño ' + n : ''}\n`));
  for (const f of lista.slice(0, n)) {
    const hechas = Object.keys(f.rev.publicado || {});
    const yaIgFb = ['ig', 'fb'].filter((r) => hechas.includes(r));
    console.log(
      `${C.fuerte(clave(f.idea).padEnd(34))} ${señal(f.rev, 10)} ${(f.idea.date || '—').padEnd(10)}  ` +
        (f.idea.image ? '' : C.ambar('sin imagen  ')) +
        (yaIgFb.length ? C.gris('ya en ' + yaIgFb.join('+')) : '')
    );
    console.log('  ' + f.idea.title);
  }
}

async function ordenVer(sueltos, op) {
  const f = await unaIdea(sueltos[0] || morir('Dime qué idea: node publicar.mjs ver <clave>'), op.marca);
  const imagen = op.imagen || urlImagen(f.idea.image);
  console.log(C.fuerte(f.idea.title));
  console.log(C.gris(`${f.marca} · ${clave(f.idea)} · ${f.idea.date} · ${f.idea.status}`));
  console.log(C.gris('enlace  ') + f.idea.url);
  console.log(C.gris('imagen  ') + (imagen || C.ambar('ninguna')));
  if (f.rev.estado) console.log(C.gris('estado  ') + señal(f.rev) + (f.rev.nota ? C.gris('  · ' + f.rev.nota) : ''));
  for (const red of ['ig', 'fb']) {
    const texto = pie(f.idea, f.brand, red);
    console.log('\n' + C.fuerte('── ' + REDES[red].nombre) + C.gris(`  ${texto.length}/${REDES[red].limite}`));
    console.log(texto);
  }
}

/**
 * Deja una imagen en una URL pública y la devuelve.
 *
 * Ni Meta ni Metricool aceptan un archivo: van a buscarlo por HTTP cuando
 * publican, así que tiene que estar servido en algún sitio. Se usa este mismo
 * repositorio, en la rama en la que estemos.
 *
 * Ojo el día que el repositorio pase a privado: raw.githubusercontent deja de
 * servir y habrá que llevarlas a public/kit/ del repositorio de ADAR, que es
 * público y lo sirve festivaladar.com.
 */
async function subirImagen(origen, etiqueta) {
  if (!existsSync(origen)) morir(`No existe ${origen}.`);
  const nombre = `${new Date().toISOString().slice(0, 10)}-${etiqueta || basename(origen)}`.replace(/[^\w.-]/g, '-');
  await mkdir(join(AQUI, 'imagenes'), { recursive: true });
  await copyFile(origen, join(AQUI, 'imagenes', nombre));

  const git = (...args) => execFileSync('git', args, { cwd: AQUI, encoding: 'utf8' }).trim();
  const rama = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('add', join('imagenes', nombre));
  // Si la imagen ya estaba igual, no hay nada que confirmar y no es un error.
  try { git('commit', '-m', `Imagen para publicar: ${nombre}`); } catch {}
  git('push', '-u', 'origin', rama);

  return `https://raw.githubusercontent.com/gaawi/editorial-cola/${rama}/imagenes/${encodeURIComponent(nombre)}`;
}

async function ordenSubir(sueltos) {
  const origen = sueltos[0] || morir('Dime qué archivo: node publicar.mjs subir foto.jpg');
  if (!/\.jpe?g$/i.test(origen)) morir('Instagram solo acepta JPEG. Convierte la imagen antes.');
  const url = await subirImagen(origen);
  console.log(C.verde('✓ ') + 'subida: ' + url);
  return url;
}

async function ordenPublicar(op) {
  const redes = op.red === 'ig' ? ['ig'] : op.red === 'fb' ? ['fb'] : ['ig', 'fb'];

  let texto = {};
  // Una imagen por red: el kit dibuja 1080×1080 para Instagram y 1200×630
  // para Facebook, y no son recortes la una de la otra.
  const imagenes = {};
  let etiqueta = null;
  let ficha = null;

  if (op.idea) {
    const f = await unaIdea(String(op.idea), op.marca);
    ficha = f;
    etiqueta = `${f.marca}:${clave(f.idea)}`;
    for (const red of redes) texto[red] = pie(f.idea, f.brand, red);
    const pega = luzVerde(f.rev);
    if (pega) console.log(C.ambar('⚠ ') + 'Ojo: esta ficha ' + pega + '.');
  } else {
    const suelto = op['texto-archivo'] ? await readFile(String(op['texto-archivo']), 'utf8') : op.texto;
    if (!suelto) morir('Dime qué publicar: --idea <clave> o --texto "…" o --texto-archivo <ruta>.');
    for (const red of redes) texto[red] = String(suelto).trim();
  }

  // Qué imagen lleva cada red, por orden: la que se pida a mano, la que dibuja
  // el kit, o —solo si se pide— la foto de origen pelada.
  if (op.imagen) {
    for (const red of redes) imagenes[red] = String(op.imagen);
  } else if (ficha && op['foto-pelada']) {
    for (const red of redes) imagenes[red] = urlImagen(ficha.idea.image);
  } else if (ficha && ficha.idea.image) {
    if (op.ya) {
      console.log(C.gris('Sacando las imágenes del kit…'));
      const hechas = await imagenesDelKit({
        marca: ficha.marca,
        clave: clave(ficha.idea),
        formatos: redes,
        adar: resolve(AQUI, '../adar'),
        aviso: (m) => process.stdout.write(C.gris(`  ${m}\r`)),
      });
      for (const red of redes) imagenes[red] = await subirImagen(hechas[red], `${clave(ficha.idea).split('/').pop()}-${red}.jpg`);
    } else {
      // En ensayo no se construye el sitio entero: basta con decir qué saldría.
      for (const red of redes) imagenes[red] = `(la dibuja el kit: ${red === 'ig' ? '1080×1080' : '1200×630'} sobre ${urlImagen(ficha.idea.image)})`;
    }
  }
  if (op['texto-ig']) texto.ig = String(op['texto-ig']);
  if (op['texto-fb']) texto.fb = String(op['texto-fb']);

  const via = await elegirVia(op);

  // Repaso antes de nada: si algo no cuadra, aquí se para.
  const pegas = [];
  for (const red of redes) {
    const img = imagenes[red];
    // En ensayo la imagen del kit todavía no existe: se repasa lo demás.
    const sinDibujar = typeof img === 'string' && img.startsWith('(');
    for (const p of repasar({ red, texto: texto[red], imagen: sinDibujar ? 'https://x/y.jpg' : img, via })) {
      pegas.push(`${REDES[red].nombre}: ${p}`);
    }
  }
  if (pegas.length) {
    console.error(C.rojo('✗ No publico:'));
    for (const p of pegas) console.error('  · ' + p);
    process.exit(1);
  }

  // El ensayo se puede ver sin credenciales: así se repasa el texto antes de
  // tener el token. Para publicar de verdad, ya no.
  let destino = null;
  let sinCuenta = null;
  try {
    destino = via === 'metricool' ? await marcaActiva() : await cuentaActiva();
  } catch (e) {
    if (op.ya) throw e;
    sinCuenta = e.message;
  }
  if (via === 'meta' && destino && redes.includes('ig') && !destino.igId) {
    morir('No hay cuenta de Instagram vinculada a esa Página.');
  }

  const aDonde = (red) => {
    if (!destino) return C.gris('la cuenta que se configure');
    if (via === 'metricool') return destino.marca.nombre + C.gris(' (Metricool)');
    return red === 'ig' ? '@' + (destino.igNombre || destino.igId) : destino.pagina.nombre;
  };

  // Ensayo: enseñar exactamente lo que saldría. Es lo que se hace por defecto.
  if (!op.ya) {
    console.log(C.ambar('ENSAYO') + C.gris(`  — nada se ha publicado. Por ${via}. Añade --ya para hacerlo de verdad.\n`));
    if (sinCuenta) console.log(C.ambar('⚠ ') + sinCuenta.split('\n')[0] + C.gris('  (el texto se puede repasar igual)\n'));
    for (const red of redes) console.log(C.gris(`imagen ${red}  `) + (imagenes[red] || 'ninguna'));
    if (via === 'metricool') {
      console.log(C.gris('cuando  ') + (op.cuando || 'dentro de 5 minutos') + (op.borrador ? C.ambar('  · como borrador') : ''));
    }
    for (const red of redes) {
      console.log('\n' + C.fuerte(`── ${REDES[red].nombre} → ${aDonde(red)}`) + C.gris(`  ${texto[red].length}/${REDES[red].limite}`));
      console.log(C.gris('se verá:  ') + asomo(texto[red], red));
      console.log(C.gris('─────────'));
      console.log(texto[red]);
    }
    return;
  }

  // Metricool no publica imágenes de fuera: primero las copia a su servidor.
  const mediaIds = {};
  if (via === 'metricool') {
    for (const red of redes) if (imagenes[red]) mediaIds[red] = await normalizarImagen(imagenes[red], destino.cred);
  }

  for (const red of redes) {
    try {
      let r;
      if (via === 'metricool') {
        r = await programar({
          red,
          texto: texto[red],
          mediaId: mediaIds[red],
          fecha: op.cuando,
          zona: op.zona || process.env.TZ_PUBLICACION,
          borrador: op.borrador,
          autoPublicar: !op.borrador,
          cred: destino.cred,
        });
        console.log(C.verde('✓ ') + REDES[red].nombre + C.gris(`  ${op.borrador ? 'borrador' : 'programado'} para ${r.cuando}`) + '  ' + r.enlace);
      } else {
        r =
          red === 'ig'
            ? await publicarInstagram({
                igId: destino.igId,
                token: destino.pagina.token,
                texto: texto.ig,
                imagen: imagenes.ig,
                aviso: (m) => process.stdout.write(C.gris(`  ${m}\r`)),
              })
            : await publicarFacebook({
                paginaId: destino.pagina.id,
                token: destino.pagina.token,
                texto: texto.fb,
                imagen: imagenes.fb,
                enlace: op.enlace,
              });
        console.log(C.verde('✓ ') + REDES[red].nombre + '  ' + r.enlace);
      }
      await appendFile(
        REGISTRO,
        JSON.stringify({
          fecha: new Date().toISOString(),
          via,
          red,
          idea: etiqueta,
          id: r.id,
          enlace: r.enlace,
          cuando: r.cuando || null,
          imagen: imagenes[red],
          texto: texto[red],
        }) + '\n'
      );
    } catch (e) {
      console.error(C.rojo('✗ ') + REDES[red].nombre + '  ' + e.message);
      process.exitCode = 1;
    }
  }
}

async function ordenRegistro(op) {
  if (!existsSync(REGISTRO)) return console.log(C.gris('Todavía no se ha publicado nada desde aquí.'));
  const lineas = (await readFile(REGISTRO, 'utf8')).trim().split('\n').filter(Boolean);
  for (const l of lineas.slice(-Number(op.n || 20))) {
    const r = JSON.parse(l);
    console.log(
      `${r.fecha.slice(0, 16).replace('T', ' ')}  ${(REDES[r.red]?.nombre || r.red).padEnd(9)} ` +
        `${(r.via || 'meta').padEnd(9)} ${r.idea || C.gris('suelto')}`
    );
    console.log('  ' + C.gris(r.enlace));
  }
}

const AYUDA = `
editorial/cola · publicar en Facebook e Instagram

  cuentas                      qué Página y qué Instagram alcanza el token
  ideas [--marca m] [--listas] [--buscar t] [--todas] [--n 20]
  ver <clave> [--marca m]      la ficha y el pie que saldría en cada red
  publicar [opciones]          por defecto ensayo; --ya publica de verdad
  subir <foto.jpg>             deja la imagen en una URL pública para Instagram
  registro [--n 20]            lo publicado desde aquí

opciones de publicar
  --idea <clave>               saca texto e imagen del kit de redes
  --texto "…" | --texto-archivo <ruta>
  --texto-ig "…" --texto-fb "…"   para separar el texto de cada red
  --imagen <url>               manda sobre todo lo demás, la misma en las dos
  --foto-pelada                la foto de origen, sin pasar por el kit
  --enlace <url>               solo Facebook, entrada sin foto
  --red ig | fb | ambas        por defecto, ambas
  --via meta | metricool       por defecto, la que tenga credenciales
  --ya                         publicar de verdad

solo por Metricool (que programa, no publica en el acto)
  --cuando <2026-10-20T09:30>  por defecto, dentro de cinco minutos
  --zona Europe/Madrid         por defecto, Europe/Madrid
  --borrador                   dejarlo en el planificador sin publicar
`;

const { sueltos, op } = argumentos(process.argv.slice(2));
const orden = sueltos.shift();
try {
  if (orden === 'cuentas') await ordenCuentas(op);
  else if (orden === 'ideas') await ordenIdeas(op);
  else if (orden === 'ver') await ordenVer(sueltos, op);
  else if (orden === 'publicar') await ordenPublicar(op);
  else if (orden === 'subir') await ordenSubir(sueltos);
  else if (orden === 'registro') await ordenRegistro(op);
  else console.log(AYUDA);
} catch (e) {
  morir(e.message);
}
