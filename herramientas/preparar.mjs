#!/usr/bin/env node
// Prepara fichas aprobadas: dibuja sus imágenes (Instagram, Facebook e
// historia), las copia a imagenes/ y escribe `preparado` en flujo.json.
//
//   node herramientas/preparar.mjs plan.json
//
// plan.json: [{ marca, clave, cuando: ISO con zona, historia?: true|false,
//               cuandoHistoria?: ISO, colaboradores?: [] }]
// Sin `historia: false`, el post lleva también su historia. Las fichas que
// son solo historia (formato «historia») van solo a historias.

import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagenesDe } from '../lib/render.mjs';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const plan = JSON.parse(await readFile(process.argv[2], 'utf8'));
const datos = JSON.parse(await readFile(join(AQUI, 'datos', 'posts.json'), 'utf8'));
const flujo = JSON.parse(await readFile(join(AQUI, 'flujo.json'), 'utf8'));
const RAW = 'https://raw.githubusercontent.com/gaawi/editorial-cola/main/imagenes/';
await mkdir(join(AQUI, 'imagenes'), { recursive: true });

const mas = (iso, min) => {
  const d = new Date(new Date(iso).getTime() + min * 60000);
  const off = iso.slice(-6);
  const h = Number(off.slice(0, 3)), m = Number(off.slice(4)) * Math.sign(h || 1);
  const local = new Date(d.getTime() + (h * 60 + m) * 60000).toISOString().slice(0, 19);
  return local + off;
};

for (const f of plan) {
  const p = datos.marcas[f.marca].posts.find((x) => x.clave === f.clave);
  if (!p) throw new Error('No encuentro ' + f.clave);
  const base = f.clave.replace(/\//g, '-');
  const soloHistoria = p.formato === 'historia';
  const conHistoria = soloHistoria || f.historia !== false;
  const formatos = soloHistoria ? { story: 'story' } : { ig: 'ig', fb: 'fb', ...(conHistoria ? { story: 'story' } : {}) };
  const hechas = await imagenesDe({ marca: f.marca, clave: f.clave, formatos, carrusel: true });
  const copia = async (rutas, sufijo, tope = 99) => {
    const urls = [];
    for (let i = 0; i < Math.min(rutas.length, tope); i++) {
      const n = `${base}-${sufijo}-${i + 1}.jpg`;
      await copyFile(rutas[i], join(AQUI, 'imagenes', n));
      urls.push(RAW + n);
    }
    return urls;
  };
  const prep = {};
  if (!soloHistoria) {
    // Las fotos tal cual: el carrusel son ellas (hasta 10), Facebook la primera.
    // Las fotos de la ficha se publican tal cual (ya recortadas si hacía falta).
    const enteras = p.fotos && p.fotos.length;
    const ig = enteras ? p.fotos.slice(0, 10) : await copia(hechas.ig, 'ig', 10);
    const fb = enteras ? [p.fotos[0]] : await copia(hechas.fb, 'fb', 1);
    const colab = f.colaboradores || p.colaboradores || [];
    prep[f.clave] = { tipo: 'post', redes: [
      { red: 'ig', cuando: f.cuando, texto: p.pies.ig.texto, imagenes: ig, ...(colab.length ? { colaboradores: colab } : {}) },
      { red: 'fb', cuando: mas(f.cuando, 2), texto: p.pies.fb.texto, imagenes: fb },
    ] };
  }
  if (conHistoria) {
    const st = await copia(hechas.story, 'st', 1);
    const k = soloHistoria ? f.clave : f.clave + '#historia';
    prep[k] = { tipo: 'historia', redes: [{ red: 'ig', cuando: soloHistoria ? f.cuando : (f.cuandoHistoria || mas(f.cuando, 10)), texto: '', imagenes: st }] };
  }
  const g = flujo.posts[f.clave] || (flujo.posts[f.clave] = { historial: [] });
  g.fase = 'preparado';
  g.preparado = prep;
  (g.historial ||= []).push({ accion: 'preparar', quien: 'claude', fecha: new Date().toISOString() });
  console.log('preparado', f.clave, Object.keys(prep).join(', '));
}
await writeFile(join(AQUI, 'flujo.json'), JSON.stringify(flujo, null, 1) + '\n');
