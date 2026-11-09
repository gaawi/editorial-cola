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
// con META_TOKEN, FB_PAGE_ID e IG_USER_ID como secretos. Después de cada
// publicación se guarda el resultado y se sube al repositorio en el momento:
// si algo se cae a mitad, lo ya publicado no se vuelve a publicar.
//
//   node herramientas/publicar-cola.mjs            publica lo que toque
//   node herramientas/publicar-cola.mjs --ensayo   dice qué publicaría, sin tocar nada

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicarInstagram, publicarFacebook, comentar } from '../lib/meta.mjs';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const COLA = join(AQUI, 'datos', 'programado.json');
const ENSAYO = process.argv.includes('--ensayo');
// Si el publicador estuvo parado más de esto, lo atrasado no sale solo: se
// marca y se decide a mano. Un post de «mañana es el concierto» publicado dos
// días tarde hace más daño que no publicarlo.
const MARGEN_MS = 6 * 3600 * 1000;

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

const token = process.env.META_TOKEN;
const paginaId = process.env.FB_PAGE_ID;
const igId = process.env.IG_USER_ID;
if (!ENSAYO && (!token || !paginaId || !igId)) {
  console.error('Faltan META_TOKEN, FB_PAGE_ID o IG_USER_ID.');
  process.exit(1);
}

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
  if (ENSAYO) continue;
  try {
    const hecho = r.red === 'ig'
      ? await publicarInstagram({ igId, token, texto: r.texto, imagen: r.imagenes, historia, colaboradores: r.colaboradores || [] })
      : await publicarFacebook({ paginaId, token, texto: r.texto, imagen: r.imagenes });
    r.estado = 'publicado';
    r.url = hecho.enlace;
    r.id = hecho.id;
    r.publicadoEl = new Date().toISOString();
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
