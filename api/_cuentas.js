// Las dos cuentas que publica la app y dónde está la clave de cada una.
//
// CreArtBox usa META_TOKEN, FB_PAGE_ID e IG_USER_ID (los de siempre).
// Festival ADAR, los mismos con _ADAR al final. Están en los secretos de
// GitHub (para el publicador) y en las variables de Vercel (para la app).
// lib/cuentas.mjs es el original de esta copia: si cambia uno, el otro.

export const MARCAS = {
  creartbox: { nombre: 'CreArtBox', sufijo: '', patron: /creartbox/i },
  // La Página de ADAR se llama «Festival para el Desarollo de las Artes en el Medio Rural».
  adar: { nombre: 'Festival ADAR', sufijo: '_ADAR', patron: /adar|medio rural/i },
};

/** Variables de entorno de una marca. */
export const variables = (marca) => {
  const s = (MARCAS[marca] || MARCAS.creartbox).sufijo;
  return { token: 'META_TOKEN' + s, pagina: 'FB_PAGE_ID' + s, ig: 'IG_USER_ID' + s };
};

/** Token e identificadores de la cuenta de una marca (o vacíos si faltan). */
export function credenciales(marca = 'creartbox', env = process.env) {
  const v = variables(marca);
  return { marca, token: env[v.token] || '', paginaId: env[v.pagina] || '', igId: env[v.ig] || '' };
}

/** De qué marca es un post de la cola. Lo dice la entrada (la app lo apunta
 *  al confirmar); si no, el idioma de la clave: ADAR publica en español
 *  (es/…) y CreArtBox en inglés (en/…). */
export function marcaDe(clave, entrada) {
  if (entrada && MARCAS[entrada.marca]) return entrada.marca;
  return String(clave).startsWith('es/') ? 'adar' : 'creartbox';
}
