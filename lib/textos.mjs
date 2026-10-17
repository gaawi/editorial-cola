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

/** Donde el enlace no se puede pulsar, se manda a la bio. */
function cierre(idea, brand, red) {
  return REDES[red].enlaces ? idea.url : brand.captionTail;
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

/** El pie que el kit propondría para esa idea en esa red. */
export function pie(idea, brand, red) {
  if (!REDES[red]) throw new Error(`Esta herramienta solo publica en ig y fb, no en «${red}».`);
  if (idea.kind === 'entrevista') return entrevista(idea, brand, red);
  const r = REDES[red];
  const tags = hashtags(brand, idea.tags, r.tags);
  if (red === 'ig') {
    return `${idea.title}\n\n${idea.excerpt}\n\n${brand.captionTail}\n\n${tags}`;
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
