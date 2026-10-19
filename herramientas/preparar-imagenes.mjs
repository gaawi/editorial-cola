#!/usr/bin/env node
// Dibuja las imágenes de cada ficha del plan y las deja en una URL pública.
//
// Lo que se publica es la imagen del motor, no la foto pelada: ese fallo ya
// se cometió una vez y el post del 17 de octubre salió sin el sello ni el
// titular. Las fichas que traen `fotos` son la excepción a propósito, porque
// ahí la foto es el post.
//
//   node herramientas/preparar-imagenes.mjs plan.json salida.json

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagenesDe } from '../lib/render.mjs';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAMA = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: AQUI, encoding: 'utf8' }).trim();
const plan = JSON.parse(await readFile(process.argv[2], 'utf8'));

await mkdir(join(AQUI, 'imagenes'), { recursive: true });
const copiadas = [];

function urlDe(nombre) {
  return `https://raw.githubusercontent.com/gaawi/editorial-cola/${RAMA}/imagenes/${encodeURIComponent(nombre)}`;
}

for (const ficha of plan) {
  // Carrusel de fotos de verdad: ya están servidas, no hay nada que dibujar.
  if (ficha.imgs.length > 1) {
    ficha.urls = ficha.imgs;
    console.log(`· ${ficha.clave}: ${ficha.imgs.length} fotos tal cual`);
    continue;
  }
  const fmt = ficha.historia ? { ig: 'story' } : { ig: 'ig' };
  const hechas = await imagenesDe({
    marca: 'creartbox',
    clave: ficha.clave,
    formatos: fmt,
    carrusel: !ficha.historia,
  });
  const rutas = hechas.ig;
  ficha.urls = [];
  for (let i = 0; i < rutas.length; i++) {
    const nombre = `${ficha.clave.replace(/\//g, '-')}-${ficha.historia ? 'st' : 'ig'}-${i + 1}.jpg`;
    await copyFile(rutas[i], join(AQUI, 'imagenes', nombre));
    copiadas.push(join('imagenes', nombre));
    ficha.urls.push(urlDe(nombre));
  }
  console.log(`· ${ficha.clave}: ${rutas.length} dibujada(s)`);
}

const git = (...a) => execFileSync('git', a, { cwd: AQUI, encoding: 'utf8' }).trim();
if (copiadas.length) {
  git('add', ...copiadas);
  try { git('commit', '-m', 'Imágenes dibujadas para la tanda de octubre y noviembre'); } catch {}
  git('push', '-u', 'origin', RAMA);
}
await writeFile(process.argv[3], JSON.stringify(plan, null, 1));
console.log(`\n${plan.length} fichas listas · ${copiadas.length} imágenes subidas a ${RAMA}`);
