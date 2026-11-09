// Paso 1 de «Conectar con Instagram y Facebook»: manda al navegador a la
// ventana de permisos de Facebook. Guillermo inicia sesión allí, en Facebook,
// y Facebook le devuelve a /api/meta-vuelta con un código de un solo uso.
//
// Solo para quien ya ha entrado en la app (cookie cola_preview).

import { conSesion, VERSION, APP_ID, urlVuelta } from './_puerta.js';

// Lo justo para publicar y leer resultados en la Página y en su Instagram.
const PERMISOS = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights',
  'business_management', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights',
].join(',');

export default async function handler(req, res) {
  if (!(await conSesion(req))) return res.redirect(302, '/entrar.html');

  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const url = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', APP_ID);
  url.searchParams.set('redirect_uri', urlVuelta(req));
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  // Las apps de tipo Empresa usan «Facebook Login for Business», que pide una
  // configuración en vez de una lista de permisos. Si existe, manda ella.
  if (process.env.META_CONFIG_ID) url.searchParams.set('config_id', process.env.META_CONFIG_ID);
  else url.searchParams.set('scope', PERMISOS);

  res.setHeader('Set-Cookie', `meta_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.redirect(302, url.toString());
}
