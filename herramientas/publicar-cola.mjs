#!/usr/bin/env node
// Publica lo que toca de la cola, directamente en Instagram y Facebook.
//
// La cola es datos/programado.json, el mismo archivo que lee la app: así lo
// que se ve en Programado es exactamente lo que va a salir. Solo se publican
// las redes marcadas con "via": "meta" (lo que aún está en Metricool sale por
// allí y aquí solo se anota). Cada red lleva su texto y sus imágenes ya
// resueltos, para que el publicador no tenga que dibujar nada.
//
// Lo ejecuta GitHub Actions cada pocos minutos (.github/workflows/publicar-cola.yml)
// con los secretos de cada cuenta: META_TOKEN, FB_PAGE_ID e IG_USER_ID para
// CreArtBox y los mismos con _ADAR para Festival ADAR (lib/cuentas.mjs). Cada
// post sale por la cuenta de su marca; si a una marca le faltan los secretos,
// lo suyo espera en la cola y lo de la otra sale igual. Después de cada
// publicación se guarda el resultado y se sube al repositorio en el momento:
// si algo se cae a mitad, lo ya publicado no se vuelve a publicar.
//
//   node herramientas/publicar-cola.mjs            publica lo que toque
//   node herramientas/publicar-cola.mjs --ensayo   dice qué publicaría, sin tocar nada

import { repasoPrevio } from '../lib/repaso-previo.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicarInstagram, publicarFacebook, comentar } from '../lib/meta.mjs';
import { MARCAS, credenciales, variables, marcaDe } from '../lib/cuentas.mjs';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const COLA = join(AQUI, 'datos', 'programado.json');
const ENSAYO = process.argv.includes('--ensayo');
// Si el publicador estuvo parado más de esto, lo atrasado no sale solo: se
// marca y se decide a mano. Un post de «mañana es el concierto» publicado dos
// días tarde hace más daño que no publicarlo.
const MARGEN_MS = 6 * 3600 * 1000;

// CreArtBox tenía sus identificadores puestos a mano antes de usar secretos:
// se mantienen por si falta alguno. ADAR no tiene ninguno de reserva.
const RESERVA = { creartbox: { paginaId: '473145069546753', igId: '17841404259739766' } };
function cuenta(marca) {
  const c = credenciales(marca);
  return { ...c, paginaId: c.paginaId || RESERVA[marca]?.paginaId || '', igId: c.igId || RESERVA[marca]?.igId || '' };
}

// --comprobar: solo mira que los secretos sirven (lee el nombre de la Página
// y de su Instagram de cada marca). No publica nada.
if (process.argv.includes('--comprobar')) {
  const { graph } = await import('../lib/meta.mjs');
  let mal = 0;
  for (const marca of Object.keys(MARCAS)) {
    const c = cuenta(marca);
    const v = variables(marca);
    if (!c.token || !c.paginaId || !c.igId) { console.log(`${MARCAS[marca].nombre}: sin secretos (${Object.values(v).join(', ')}).`); if (marca === 'creartbox') mal++; continue; }
    try {
      const pg = await graph(`/${c.paginaId}`, { params: { fields: 'name' }, token: c.token });
      const ig = await graph(`/${c.igId}`, { params: { fields: 'username' }, token: c.token });
      console.log(`${MARCAS[marca].nombre}: secretos correctos, Página «${pg.name}», Instagram @${ig.username}.`);
    } catch (e) { mal++; console.log(`${MARCAS[marca].nombre}: los secretos no sirven: ${e.message}`); }
  }
  process.exit(mal ? 1 : 0);
}

const ahora = Date.now();
const cola = JSON.parse(await readFile(COLA, 'utf8'));

const pendientes = [];
for (const [clave, e] of Object.entries(cola.posts || {})) {
  for (const r of e.redes || []) {
    if (r.via !== 'meta' || r.estado !== 'en cola') continue;
    if (new Date(r.cuando).getTime() > ahora) continue;
    pendientes.push({ clave, e, r });
  }
}
pendientes.sort((a, b) => a.r.cuando.localeCompare(b.r.cuando));

if (!pendientes.length) {
  console.log('Nada que publicar.');
  process.exit(0);
}

// Sin los secretos de una marca no se publica lo suyo desde aquí: se queda
// en la cola, se avisa una vez y ya. No es un fallo.
const sinCuenta = new Set();

async function guardar(mensaje) {
  cola.actualizado = new Date().toISOString().slice(0, 10);
  await writeFile(COLA, JSON.stringify(cola, null, 1) + '\n');
  if (ENSAYO || !process.env.GITHUB_ACTIONS) return;
  const git = (...a) => execFileSync('git', a, { cwd: AQUI, stdio: 'inherit' });
  git('add', 'datos/programado.json');
  git('commit', '-m', mensaje);
  // Si alguien ha subido algo entretanto, se trae y se reintenta.
  for (let i = 0; i < 4; i++) {
    try { git('pull', '--rebase', '-q', 'origin', 'main'); git('push', '-q', 'origin', 'HEAD:main'); return; }
    catch { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
  throw new Error('No se pudo subir el resultado al repositorio.');
}

let fallos = 0;
for (const { clave, e, r } of pendientes) {
  const nombre = `${clave} · ${r.red.toUpperCase()} · ${r.cuando}`;
  if (ahora - new Date(r.cuando).getTime() > MARGEN_MS) {
    console.log(`Atrasado, no sale solo: ${nombre}`);
    if (!ENSAYO) { r.estado = 'atrasado'; await guardar(`Cola: ${clave} (${r.red}) atrasado, se deja para decidir`); }
    continue;
  }
  const historia = e.tipo === 'historia';
  console.log(`${ENSAYO ? '[ensayo] ' : ''}Publico ${nombre}${historia ? ' (historia)' : ''}`);
  // El último repaso: si algo está mal, no sale y queda escrito por qué.
  const problemas = await repasoPrevio({ red: r.red, historia, texto: r.texto, imagenes: r.imagenes });
  if (problemas.length) {
    console.error(`  ✗ Repaso previo: ${problemas.join('; ')}`);
    if (!ENSAYO) { fallos++; r.estado = 'error'; r.error = `Repaso previo: ${problemas.join('; ')}`; await guardar(`No sale: ${clave} (${r.red}), ${problemas[0]}`); }
    continue;
  }
  if (ENSAYO) continue;
  const marca = marcaDe(clave, e);
  const { token, paginaId, igId } = cuenta(marca);
  if (!token || !paginaId || !igId) {
    if (!sinCuenta.has(marca)) console.log(`  Sin los secretos de ${MARCAS[marca].nombre} (${Object.values(variables(marca)).join(', ')}): espera en la cola.`);
    sinCuenta.add(marca);
    continue;
  }
  try {
    const hecho = r.red === 'ig'
      ? await publicarInstagram({ igId, token, texto: r.texto, imagen: r.imagenes, historia, colaboradores: r.colaboradores || [] })
      : await publicarFacebook({ paginaId, token, texto: r.texto, imagen: r.imagenes });
    r.estado = 'publicado';
    r.url = hecho.enlace;
    r.id = hecho.id;
    r.publicadoEl = new Date().toISOString();
    if (hecho.sinColaboradores) r.avisoColaboradores = 'Instagram rechazó a los colaboradores: salió sin ellos. Revisar el nombre de la cuenta.';
    if (r.comentario) {
      try { await comentar({ red: r.red, id: hecho.id, token, texto: r.comentario }); }
      catch (err) { r.avisoComentario = err.message; }
    }
    console.log(`  ✓ ${hecho.enlace}`);
    await guardar(`Publicado: ${clave} en ${r.red === 'ig' ? 'Instagram' : 'Facebook'}`);
  } catch (err) {
    fallos++;
    r.estado = 'error';
    r.error = err.message;
    console.error(`  ✗ ${err.message}`);
    await guardar(`Falló: ${clave} en ${r.red === 'ig' ? 'Instagram' : 'Facebook'}`);
  }
}
process.exit(fallos ? 1 : 0);
