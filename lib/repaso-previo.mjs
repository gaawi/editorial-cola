// El último repaso antes de publicar: lo que Meta rechazaría o lo que saldría
// mal maquetado. Si algo falla, no se publica y queda el motivo.
//   · las imágenes existen y son imágenes;
//   · en el muro de Instagram, la proporción entre 4:5 y 1,91:1;
//   · en historias, vertical (9:16 o cerca);
//   · el texto de Instagram, 2.200 caracteres y 30 etiquetas como mucho;
//   · un carrusel, 10 imágenes como mucho.

/** Ancho y alto de un JPEG o PNG leyendo solo la cabecera. */
export function medidas(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const largo = buf.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + largo;
  }
  return null;
}

export async function repasoPrevio({ red, historia, texto = '', imagenes = [] }) {
  const problemas = [];
  const lista = Array.isArray(imagenes) ? imagenes : [imagenes];
  if (!lista.length) problemas.push('no lleva imagen');
  if (red === 'ig' && !historia) {
    if (texto.length > 2200) problemas.push(`el texto tiene ${texto.length} caracteres (máximo 2.200)`);
    const etiquetas = (texto.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (etiquetas > 30) problemas.push(`${etiquetas} etiquetas (máximo 30)`);
    if (lista.length > 10) problemas.push(`${lista.length} imágenes en el carrusel (máximo 10)`);
  }
  for (const [n, url] of lista.entries()) {
    try {
      const r = await fetch(url);
      if (!r.ok) { problemas.push(`la imagen ${n + 1} no se puede descargar (${r.status})`); continue; }
      const tipo = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer());
      if (!/image\//.test(tipo) && !medidas(buf)) { problemas.push(`la imagen ${n + 1} no es una imagen`); continue; }
      const m = medidas(buf);
      if (!m || red !== 'ig') continue;
      const p = m.w / m.h;
      if (historia && (p < 0.5 || p > 0.62)) problemas.push(`la historia no es vertical 9:16 (${m.w}×${m.h})`);
      if (!historia && (p < 0.79 || p > 1.92)) problemas.push(`la imagen ${n + 1} tiene una proporción que Instagram no admite (${m.w}×${m.h})`);
    } catch (e) {
      problemas.push(`la imagen ${n + 1} no se pudo comprobar (${e.message})`);
    }
  }
  return problemas;
}
