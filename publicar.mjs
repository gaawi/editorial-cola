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

function señal(rev, ancho = 0) {
  const texto = rev.estado === 'listo' ? 'listo'
    : rev.estado === 'cambios' ? 'cambios'
    : rev.estado === 'espera' ? 'espera'
    : '—';
  const color = rev.estado === 'listo' ? C.verde : rev.estado === 'cambios' ? C.rojo
    : rev.estado === 'espera' ? C.ambar : C.gris;
  // Se rellena antes de colorear: si no, los códigos de color cuentan y la
  // columna se descuadra.
  return color(texto.padEnd(ancho));
}

// ── Órdenes ───────────────────────────────────────────────────────────────

async function ordenCuentas() {
  const { pagina, igId, igNombre } = await cuentaActiva();
  console.log(C.fuerte('Facebook  ') + pagina.nombre + C.gris('  id ' + pagina.id));
  if (igId) console.log(C.fuerte('Instagram ') + '@' + (igNombre || '?') + C.gris('  id ' + igId));
  else console.log(C.ambar('Instagram  sin cuenta de empresa vinculada a esa Página.'));
  console.log(C.gris('\nPara no volver a descubrirlo: FB_PAGE_ID=' + pagina.id + (igId ? '  IG_USER_ID=' + igId : '')));
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
      `${C.fuerte(clave(f.idea).padEnd(34))} ${señal(f.rev, 8)} ${(f.idea.date || '—').padEnd(10)}  ` +
        (f.idea.image ? '' : C.ambar('sin imagen  ')) +
        (yaIgFb.length ? C.gris('ya en ' + yaIgFb.join('+')) : '')
    );
    console.log('  ' + f.idea.title);
  }
}

async function ordenVer(sueltos, op) {
  const f = await unaIdea(sueltos[0] || morir('Dime qué idea: node publicar.mjs ver <clave>'), op.marca);
  const imagen = op.imagen || f.idea.image;
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

async function ordenSubir(sueltos) {
  const origen = sueltos[0] || morir('Dime qué archivo: node publicar.mjs subir foto.jpg');
  if (!existsSync(origen)) morir(`No existe ${origen}.`);
  if (!/\.jpe?g$/i.test(origen)) morir('Instagram solo acepta JPEG. Convierte la imagen antes.');

  // Instagram va a buscar la imagen por HTTP, así que tiene que estar servida
  // en algún sitio público: este mismo repositorio, en main, sirve.
  const nombre = `${new Date().toISOString().slice(0, 10)}-${basename(origen)}`.replace(/[^\w.-]/g, '-');
  await mkdir(join(AQUI, 'imagenes'), { recursive: true });
  await copyFile(origen, join(AQUI, 'imagenes', nombre));

  const git = (...args) => execFileSync('git', args, { cwd: AQUI, encoding: 'utf8' }).trim();
  git('add', join('imagenes', nombre));
  git('commit', '-m', `Imagen para publicar: ${nombre}`);
  git('push', 'origin', 'HEAD:main');
  const rama = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('push', '-u', 'origin', rama);

  const url = `https://raw.githubusercontent.com/gaawi/editorial-cola/main/imagenes/${encodeURIComponent(nombre)}`;
  console.log(C.verde('✓ ') + 'subida: ' + url);
  return url;
}

async function ordenPublicar(op) {
  const redes = op.red === 'ig' ? ['ig'] : op.red === 'fb' ? ['fb'] : ['ig', 'fb'];

  let texto = {};
  let imagen = op.imagen || null;
  let etiqueta = null;

  if (op.idea) {
    const f = await unaIdea(String(op.idea), op.marca);
    etiqueta = `${f.marca}:${clave(f.idea)}`;
    imagen = imagen || f.idea.image;
    for (const red of redes) texto[red] = pie(f.idea, f.brand, red);
    if (f.rev.estado === 'cambios') {
      console.log(C.ambar('⚠ Esta ficha está marcada «cambios» en el panel' + (f.rev.nota ? ': ' + f.rev.nota : '') + '.'));
    }
  } else {
    const suelto = op['texto-archivo'] ? await readFile(String(op['texto-archivo']), 'utf8') : op.texto;
    if (!suelto) morir('Dime qué publicar: --idea <clave> o --texto "…" o --texto-archivo <ruta>.');
    for (const red of redes) texto[red] = String(suelto).trim();
  }
  if (op['texto-ig']) texto.ig = String(op['texto-ig']);
  if (op['texto-fb']) texto.fb = String(op['texto-fb']);

  // Repaso antes de nada: si algo no cuadra, aquí se para.
  const pegas = [];
  for (const red of redes) {
    for (const p of repasar({ red, texto: texto[red], imagen })) pegas.push(`${REDES[red].nombre}: ${p}`);
  }
  if (pegas.length) {
    console.error(C.rojo('✗ No publico:'));
    for (const p of pegas) console.error('  · ' + p);
    process.exit(1);
  }

  // El ensayo se puede ver sin credenciales: así se repasa el texto antes de
  // tener el token. Para publicar de verdad, ya no.
  let cuenta = null;
  let sinCuenta = null;
  try {
    cuenta = await cuentaActiva();
  } catch (e) {
    if (op.ya) throw e;
    sinCuenta = e.message;
  }
  if (cuenta && redes.includes('ig') && !cuenta.igId) {
    morir('No hay cuenta de Instagram vinculada a esa Página.');
  }

  // Ensayo: enseñar exactamente lo que saldría. Es lo que se hace por defecto.
  if (!op.ya) {
    console.log(C.ambar('ENSAYO') + C.gris('  — nada se ha publicado. Añade --ya para hacerlo de verdad.\n'));
    if (sinCuenta) console.log(C.ambar('⚠ ') + sinCuenta.split('\n')[0] + C.gris('  (el texto se puede repasar igual)\n'));
    console.log(C.gris('imagen  ') + (imagen || 'ninguna'));
    for (const red of redes) {
      const destino = !cuenta
        ? C.gris('la cuenta que se configure')
        : red === 'ig'
          ? '@' + (cuenta.igNombre || cuenta.igId)
          : cuenta.pagina.nombre;
      console.log('\n' + C.fuerte(`── ${REDES[red].nombre} → ${destino}`) + C.gris(`  ${texto[red].length}/${REDES[red].limite}`));
      console.log(C.gris('se verá:  ') + asomo(texto[red], red));
      console.log(C.gris('─────────'));
      console.log(texto[red]);
    }
    return;
  }

  for (const red of redes) {
    try {
      const r =
        red === 'ig'
          ? await publicarInstagram({
              igId: cuenta.igId,
              token: cuenta.pagina.token,
              texto: texto.ig,
              imagen,
              aviso: (m) => process.stdout.write(C.gris(`  ${m}\r`)),
            })
          : await publicarFacebook({
              paginaId: cuenta.pagina.id,
              token: cuenta.pagina.token,
              texto: texto.fb,
              imagen,
              enlace: op.enlace,
            });
      console.log(C.verde('✓ ') + REDES[red].nombre + '  ' + r.enlace);
      await appendFile(
        REGISTRO,
        JSON.stringify({
          fecha: new Date().toISOString(),
          red,
          idea: etiqueta,
          id: r.id,
          enlace: r.enlace,
          imagen,
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
    console.log(`${r.fecha.slice(0, 16).replace('T', ' ')}  ${REDES[r.red]?.nombre.padEnd(9)} ${r.idea || C.gris('suelto')}`);
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
  --imagen <url>               manda sobre la imagen de la ficha
  --enlace <url>               solo Facebook, entrada sin foto
  --red ig | fb | ambas        por defecto, ambas
  --ya                         publicar de verdad
`;

const { sueltos, op } = argumentos(process.argv.slice(2));
const orden = sueltos.shift();
try {
  if (orden === 'cuentas') await ordenCuentas();
  else if (orden === 'ideas') await ordenIdeas(op);
  else if (orden === 'ver') await ordenVer(sueltos, op);
  else if (orden === 'publicar') await ordenPublicar(op);
  else if (orden === 'subir') await ordenSubir(sueltos);
  else if (orden === 'registro') await ordenRegistro(op);
  else console.log(AYUDA);
} catch (e) {
  morir(e.message);
}
