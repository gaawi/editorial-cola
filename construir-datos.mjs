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

// Cuántas diapositivas como mucho. El kit monta hasta ocho y son demasiadas
// para un carrusel: nadie llega al final. Portada + dos + cierre.
const TOPE_SLIDES = Number(process.env.TOPE_SLIDES || 4);

/**
 * Recorta el carrusel conservando lo que importa: la portada, las primeras
 * de texto y el cierre, que es el que lleva a dónde ir.
 */
function recortar(slides) {
  if (slides.length <= TOPE_SLIDES) return slides;
  const cierre = slides[slides.length - 1];
  return slides.slice(0, TOPE_SLIDES - 1).concat([cierre]);
}

/**
 * Cuándo tiene sentido publicar una ficha.
 *
 * El calendario son los conciertos, y de ellos cuelga todo: un «context» de
 * Currents no pinta nada en agosto y una crónica no existe antes de que el
 * concierto ocurra. Lo que no cuelga de un concierto se cuenta desde su
 * propia fecha.
 */
function ventanaDe(tipo, concierto, fechaFicha) {
  const v = tipo?.ventana;
  const dia = 86400000;
  if (v && concierto?.fecha) {
    const d = new Date(concierto.fecha + 'T12:00:00Z').getTime();
    return {
      desde: new Date(d + v.desde * dia).toISOString().slice(0, 10),
      hasta: new Date(d + v.hasta * dia).toISOString().slice(0, 10),
      ancla: concierto.nombre,
      porque: v.porque,
    };
  }
  if (!fechaFicha) return null;
  const d = new Date(fechaFicha + 'T12:00:00Z').getTime();
  return {
    desde: fechaFicha,
    hasta: new Date(d + 30 * dia).toISOString().slice(0, 10),
    ancla: null,
    porque: 'No cuelga de ningún concierto: cuenta desde su propia fecha.',
  };
}

/** Lo ya publicado en Instagram, para no volver a ofrecerlo. */
async function yaEnInstagram() {
  const f = join(AQUI, 'datos', 'historico-ig.json');
  if (!existsSync(f)) return [];
  return (JSON.parse(await readFile(f, 'utf8')).posts || []).map((r) => ({
    fecha: r[0], url: r[1], tema: String(r[6] || '').toLowerCase(),
  }));
}
/** El titular de la ficha aparece al principio de lo publicado. */
function casa(titulo, historico) {
  const t = String(titulo).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (t.length < 12) return null;
  return historico.find((h) => h.tema.includes(t.slice(0, Math.min(40, t.length)))) || null;
}

/** Las fotos con ruta relativa las sirve el sitio; el móvil necesita la URL. */
function urlImagen(img) {
  if (!img) return null;
  if (/^https?:\/\//i.test(img)) return img;
  return `https://${SITIO_KIT}${img.startsWith('/') ? '' : '/'}${img}`;
}

/**
 * Cómo se llama cada marca en cada red, y con qué cara sale.
 *
 * El avatar de CreArtBox es el de verdad: la imagen de la página de Facebook,
 * descargada de Metricool y guardada aquí para no depender de su CDN. Antes
 * las vistas previas ponían la foto del propio post como avatar, que no se
 * parece a nada.
 */
const CUENTAS = {
  creartbox: { ig: 'creartboxnyc', fb: 'CreArtBox', avatar: 'avatares/creartbox.png' },
  adar: { ig: 'festivaladar', fb: 'Festival ADAR', avatar: 'avatares/adar.png' },
};

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

// Las etiquetas viven en su propio archivo porque la app las edita.
const ETIQUETAS = JSON.parse(await readFile(join(AQUI, 'etiquetas.json'), 'utf8'));
const TIPOS = Object.fromEntries(ETIQUETAS.tipos.concat(ETIQUETAS.nuevas || []).map((t) => [t.id, t]));

const soloMarca = process.argv[2];
const marcas = soloMarca ? [soloMarca] : ['creartbox', 'adar'];
const HISTORICO = await yaEnInstagram();
const salida = { generado: new Date().toISOString(), origen: 'gaawi/adar', marcas: {} };

for (const nombre of marcas) {
  const { brand, ideas } = await cargarIdeas(nombre, ADAR);
  const rev = await revisiones(nombre);

  salida.marcas[nombre] = {
    marca: marcaParaDibujar(brand),
    cuentas: CUENTAS[nombre],
    etiquetas: { tipos: ETIQUETAS.tipos.concat(ETIQUETAS.nuevas || []), conciertos: ETIQUETAS.conciertos },
    posts: ideas.map((p) => {
      const r = rev[clave(p)] || {};
      const etq = ETIQUETAS.fichas[`${nombre}:${clave(p)}`] || {};
      const tipo = TIPOS[etq.tipo];
      const salio = nombre === 'creartbox' ? casa(p.title, HISTORICO) : null;
      return {
        // Si ya salió, el muro deja de ofrecerlo como pendiente.
        publicadoEn: salio ? { fecha: salio.fecha, url: salio.url } : null,
        ventana: ventanaDe(tipo, ETIQUETAS.conciertos.find((c) => c.id === etq.concierto), p.date),
        // El estilo no se elige: lo decide para qué es el post.
        tipo: etq.tipo || null,
        concierto: etq.concierto || null,
        estilo: tipo ? tipo.estilo : 'cinta',
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
        slides: recortar(p.slides),
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
