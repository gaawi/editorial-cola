#!/usr/bin/env node
// Saca de ADAR lo que la app de aprobar necesita y lo deja en datos/posts.json.
//
// La app corre en el navegador de un móvil y no puede leer TypeScript ni
// recorrer un repositorio, así que todo —las fichas, la identidad de la marca
// y los pies de cada red— se cocina aquí y viaja ya hecho. Los pies se
// componen con el mismo lib/textos.mjs que usa publicar.mjs, así que lo que
// se aprueba en la pantalla es exactamente lo que sale publicado.
//
//   node construir-datos.mjs            # las dos marcas
//   node construir-datos.mjs creartbox  # solo una

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cargarIdeas, clave } from './lib/ideas.mjs';
import { pie, asomo, REDES } from './lib/textos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ADAR = process.env.ADAR_DIR || resolve(AQUI, '../adar');
const SITIO_KIT = process.env.SITIO_KIT || 'festivaladar.com';

/** Las fotos con ruta relativa las sirve el sitio; el móvil necesita la URL. */
function urlImagen(img) {
  if (!img) return null;
  if (/^https?:\/\//i.test(img)) return img;
  return `https://${SITIO_KIT}${img.startsWith('/') ? '' : '/'}${img}`;
}

/** Solo lo que el motor de dibujo mira. El resto de la marca no hace falta. */
function marcaParaDibujar(b) {
  return {
    id: b.id, org: b.org, stamp: b.stamp, site: b.site, logo: b.logo,
    ink: b.ink, paper: b.paper, accent: b.accent, overPhotoInk: b.overPhotoInk,
    ctaInk: b.ctaInk, textBg: b.textBg, textTitle: b.textTitle,
    textBody: b.textBody, textFoot: b.textFoot,
    display: b.display, ui: b.ui, label: b.label,
    labelWeight: b.labelWeight, titleWeight: b.titleWeight,
    fontsHref: b.fontsHref, fontLoads: b.fontLoads,
  };
}

async function revisiones(marca) {
  const archivo = join(ADAR, 'src/data', marca === 'adar' ? 'revisiones.json' : 'revisiones-creartbox.json');
  if (!existsSync(archivo)) return {};
  return JSON.parse(await readFile(archivo, 'utf8')).posts || {};
}

const soloMarca = process.argv[2];
const marcas = soloMarca ? [soloMarca] : ['creartbox', 'adar'];
const salida = { generado: new Date().toISOString(), origen: 'gaawi/adar', marcas: {} };

for (const nombre of marcas) {
  const { brand, ideas } = await cargarIdeas(nombre, ADAR);
  const rev = await revisiones(nombre);

  salida.marcas[nombre] = {
    marca: marcaParaDibujar(brand),
    posts: ideas.map((p) => {
      const r = rev[clave(p)] || {};
      return {
        clave: clave(p),
        lang: p.lang,
        slug: p.slug,
        kind: p.kind,
        title: p.title,
        excerpt: p.excerpt,
        image: urlImagen(p.image),
        url: p.url,
        date: p.date,
        tags: p.tags,
        slides: p.slides,
        // El pie de cada red, ya compuesto, con lo que se ve antes del «más».
        pies: {
          ig: { texto: pie(p, brand, 'ig'), asomo: asomo(pie(p, brand, 'ig'), 'ig'), limite: REDES.ig.limite },
          fb: { texto: pie(p, brand, 'fb'), asomo: asomo(pie(p, brand, 'fb'), 'fb'), limite: REDES.fb.limite },
        },
        // El estado que traía el panel viejo, como punto de partida.
        heredado: { estado: r.estado || '', nota: r.nota || '', publicado: r.publicado || {} },
      };
    }),
  };
}

await mkdir(join(AQUI, 'datos'), { recursive: true });
const ruta = join(AQUI, 'datos', 'posts.json');
await writeFile(ruta, JSON.stringify(salida, null, 1) + '\n');

for (const [n, m] of Object.entries(salida.marcas)) console.log(`${n}: ${m.posts.length} fichas`);
console.log('escrito en', ruta);
