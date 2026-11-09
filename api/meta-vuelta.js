// Paso 2: Facebook vuelve aquí con ?code=. Se cambia por un token de usuario de
// larga duración y, con él, por el de la Página de CreArtBox, que no caduca.
// Se comprueba que la Página tiene su Instagram de empresa y se enseña el
// resultado, con lo que hay que guardar en Vercel.
//
// Vercel no deja escribir sus variables desde una función, así que el token
// se muestra una vez para pegarlo en Settings → Environment Variables. No se
// guarda en ningún sitio más ni pasa por el chat.

import { conSesion, VERSION, APP_ID, urlVuelta } from './_puerta.js';

const API = `https://graph.facebook.com/${VERSION}`;

async function graph(ruta, params) {
  const url = new URL(API + ruta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error((d.error && d.error.message) || `Meta respondió ${r.status}`);
  return d;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(titulo, cuerpo) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1b1a17;background:#f6f4ee}
h1{font-size:22px}code,textarea{font:13px ui-monospace,monospace}textarea{width:100%;height:110px;box-sizing:border-box}
.ok{color:#1a6b2f}.mal{color:#a12a1a}dt{font-weight:600;margin-top:12px}button{font:inherit;padding:8px 14px;margin-top:6px}
a{color:inherit}</style></head><body>${cuerpo}</body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!(await conSesion(req))) return res.redirect(302, '/entrar.html');

  const { code, state, error_description } = req.query || {};
  const guardado = ((req.headers.cookie || '').match(/(?:^|;\s*)meta_state=([^;]+)/) || [])[1];
  if (error_description) return res.status(400).send(pagina('No se conectó', `<h1 class="mal">No se conectó</h1><p>Facebook dijo: ${esc(error_description)}</p><p><a href="/api/meta-conectar">Probar otra vez</a></p>`));
  if (!code || !state || state !== guardado) return res.status(400).send(pagina('Enlace caducado', `<h1 class="mal">El enlace ha caducado</h1><p><a href="/api/meta-conectar">Empezar otra vez</a></p>`));

  const secreto = process.env.META_APP_SECRET;
  if (!secreto) return res.status(500).send(pagina('Falta una variable', `<h1 class="mal">Falta META_APP_SECRET en Vercel</h1><p>Está en developers.facebook.com → tu app → Configuración de la app → Básica → Clave secreta de la app.</p>`));

  try {
    const corto = await graph('/oauth/access_token', { client_id: APP_ID, client_secret: secreto, redirect_uri: urlVuelta(req), code });
    const largo = await graph('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: secreto, fb_exchange_token: corto.access_token });
    const cuentas = await graph('/me/accounts', { access_token: largo.access_token, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' });
    const paginas = cuentas.data || [];
    const pag = paginas.find((p) => /creartbox/i.test(p.name)) || paginas.find((p) => p.instagram_business_account) || paginas[0];
    if (!pag) throw new Error('Facebook no ha dado acceso a ninguna Página. Vuelve a conectar y marca la de CreArtBox.');
    const ig = pag.instagram_business_account;

    res.setHeader('Set-Cookie', 'meta_state=; Path=/api; Max-Age=0');
    res.send(pagina('Conectado', `
<h1 class="ok">Conectado</h1>
<p>Página de Facebook: <b>${esc(pag.name)}</b><br>
Instagram: ${ig ? `<b>@${esc(ig.username)}</b>` : '<b class="mal">esta Página no tiene un Instagram profesional vinculado</b>'}</p>
<p>Último paso: en Vercel, proyecto <b>editorial-cola</b> → Settings → Environment Variables, crea estas tres y vuelve a desplegar.</p>
<dl>
<dt>META_TOKEN</dt><dd><textarea id="t" readonly>${esc(pag.access_token)}</textarea><br><button onclick="navigator.clipboard.writeText(document.getElementById('t').value);this.textContent='Copiado'">Copiar</button></dd>
<dt>FB_PAGE_ID</dt><dd><code>${esc(pag.id)}</code></dd>
${ig ? `<dt>IG_USER_ID</dt><dd><code>${esc(ig.id)}</code></dd>` : ''}
</dl>
<p>El token es de la Página y no caduca mientras sigas siendo administrador y no cambies la contraseña de Facebook. No lo pegues en ningún chat.</p>
${paginas.length > 1 ? `<p>Otras Páginas a las que diste acceso: ${paginas.filter((p) => p !== pag).map((p) => esc(p.name)).join(', ')}.</p>` : ''}`));
  } catch (e) {
    res.status(500).send(pagina('No se conectó', `<h1 class="mal">No se conectó</h1><p>${esc(e.message)}</p><p><a href="/api/meta-conectar">Probar otra vez</a></p>`));
  }
}
