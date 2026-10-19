// El pie de cada red, compuesto igual que en el kit de redes.
//
// El kit vive en el navegador y no se puede importar desde aquí, así que esta
// es la misma receta escrita en Node. Si allí cambia la forma del pie, hay que
// tocar este archivo: es la única copia que existe, y a propósito, porque el
// encargo era no editar nada del kit.
//
// Las reglas de cada red y los límites están copiados de REDES en
// src/components/KitRedes.astro.

export const REDES = {
  ig: {
    nombre: 'Instagram',
    limite: 2200,
    corte: 125,
    enlaces: false,
    tags: 5,
    pista: 'Se ven 125 caracteres antes del «más». El enlace no se puede pulsar: va en la bio.',
  },
  fb: {
    nombre: 'Facebook',
    limite: 63206,
    corte: 480,
    enlaces: true,
    tags: 2,
    pista: 'Corta por alto, no por caracteres: unas 480. El enlace sí se pulsa y genera tarjeta.',
  },
};

/** Las etiquetas base de la marca más las de la ficha, sin repetir. */
export function hashtags(brand, tags, max) {
  const extra = (tags || [])
    .filter(Boolean)
    .map((t) => t.trim().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length > 2);
  const todas = brand.baseTags.concat(extra);
  const vistas = new Set();
  const fuera = [];
  for (const t of todas) {
    if (fuera.length >= max) break;
    const k = t.toLowerCase();
    if (vistas.has(k)) continue;
    vistas.add(k);
    fuera.push('#' + t);
  }
  return fuera.join(' ');
}

/**
 * Donde el enlace no se puede pulsar, se manda a la bio.
 * Una ficha puede traer su propio cierre: el de la marca habla de la nota de
 * prensa, y cuando lo que toca es vender entradas eso no sirve.
 */
function cierre(idea, brand, red) {
  return REDES[red].enlaces ? idea.url : idea.cta || brand.captionTail;
}

/**
 * Una entrevista entera cabe en Facebook y a veces en Instagram. Donde no
 * cabe se cuenta que la hemos hecho y se manda a leerla.
 */
function entrevista(idea, brand, red) {
  const r = REDES[red];
  const cuerpo = String(idea.body).replace(/^##\s+/gm, '').trim();
  const tags = hashtags(brand, idea.tags, r.tags);
  const entera = `${idea.title}\n\n${cuerpo}\n\n${cierre(idea, brand, red)}\n\n${tags}`;
  if (entera.length <= r.limite) return entera;
  const donde = r.enlaces ? 'The whole interview: ' + idea.url : 'Full interview at the link in bio ↗';
  return `${idea.title}\n\n${idea.excerpt}\n\n${donde}\n\n${tags}`;
}

/**
 * Cuando una ficha trae el pie escrito, ese es el pie y aquí no se compone
 * nada. La receta de abajo —titular, entradilla, cierre y etiquetas— sirve
 * para convertir material en post, pero un texto escrito a mano ya es el
 * post, y trocearlo lo estropea.
 *
 * En Facebook el enlace sí se pulsa, así que la línea que manda a la bio se
 * cambia por la URL. Es la única sustitución que se hace, y se hace sobre
 * líneas enteras para no tocar el resto del texto.
 */
function literal(idea, red) {
  if (red === 'ig') return idea.pie;
  const destino = idea.url || '';
  const lineas = idea.pie.split('\n').map((l) =>
    /\b(in bio|en la bio)\b/i.test(l) && destino ? destino : l
  );
  const texto = lineas.join('\n');
  // Si no había ninguna línea de bio, el enlace se añade antes de las
  // etiquetas, que en Facebook es donde se espera encontrarlo.
  if (!destino || texto.includes(destino)) return texto;
  const i = texto.lastIndexOf('\n\n#');
  return i === -1 ? `${texto}\n\n${destino}` : `${texto.slice(0, i)}\n\n${destino}${texto.slice(i)}`;
}

/** El pie que el kit propondría para esa idea en esa red. */
export function pie(idea, brand, red) {
  if (!REDES[red]) throw new Error(`Esta herramienta solo publica en ig y fb, no en «${red}».`);
  if (idea.pie) return literal(idea, red);
  if (idea.kind === 'entrevista') return entrevista(idea, brand, red);
  const r = REDES[red];
  const tags = hashtags(brand, idea.tags, r.tags);
  if (red === 'ig') {
    return `${idea.title}\n\n${idea.excerpt}\n\n${idea.cta || brand.captionTail}\n\n${tags}`;
  }
  return `${idea.title}\n\n${idea.excerpt}\n\n${idea.url}\n\n${tags}`;
}

/** Lo que se ve antes del «ver más». Es lo único que lee la mayoría. */
export function asomo(texto, red) {
  const corte = REDES[red].corte;
  const t = texto.replace(/\n+/g, ' ');
  return t.length > corte ? t.slice(0, corte) + '…' : t;
}

/**
 * Repasos antes de mandar nada. Devuelve una lista de pegas, vacía si todo va.
 * `via` cambia lo que se exige de la imagen: Meta la descarga él mismo y solo
 * traga JPEG; Metricool la copia antes a sus servidores y no es tan tiquismiquis.
 */
export function repasar({ red, texto, imagen, via = 'meta' }) {
  const pegas = [];
  const r = REDES[red];
  if (!texto || !texto.trim()) pegas.push('El texto está vacío.');
  if (texto && texto.length > r.limite) {
    pegas.push(`El texto pasa del límite de ${r.nombre}: ${texto.length} de ${r.limite}.`);
  }
  const etiquetas = (texto.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  if (etiquetas > 30) pegas.push(`${etiquetas} etiquetas; Instagram admite 30 como mucho.`);

  if (red === 'ig') {
    if (!imagen) pegas.push('Instagram no publica sin imagen.');
    else {
      if (!/^https:\/\//i.test(imagen)) {
        pegas.push('La imagen de Instagram tiene que ser una URL https pública: Meta va a buscarla.');
      }
      if (via === 'meta' && !/\.jpe?g($|\?)/i.test(imagen)) {
        pegas.push('Publicando contra Meta, Instagram solo acepta JPEG por URL. Esta imagen no acaba en .jpg.');
      }
    }
  }
  if (red === 'fb' && imagen && !/^https:\/\//i.test(imagen)) {
    pegas.push('La imagen tiene que ser una URL https pública.');
  }
  return pegas;
}
