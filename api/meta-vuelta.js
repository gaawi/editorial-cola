// Paso 2: Facebook vuelve aquí con ?code=. Se cambia por un token de usuario de
// larga duración y, con él, por el de cada Página que se haya marcado
// (CreArtBox y Festival ADAR), que no caducan.
// Se comprueba que la Página tiene su Instagram de empresa y se enseña el
// resultado, con lo que hay que guardar en Vercel.
//
// Vercel no deja escribir sus variables desde una función, así que el token
// se muestra una vez para pegarlo en Settings → Environment Variables. No se
// guarda en ningún sitio más ni pasa por el chat.

import { conSesion, VERSION, APP_ID, urlVuelta } from './_puerta.js';
import { MARCAS, variables } from './_cuentas.js';

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
h1{font-size:22px}h2{font-size:18px;margin-top:28px;border-top:1px solid #ddd;padding-top:16px}code,textarea{font:13px ui-monospace,monospace}textarea{width:100%;height:110px;box-sizing:border-box}
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
    if (!paginas.length) throw new Error('Facebook no ha dado acceso a ninguna Página. Vuelve a conectar y marca las de CreArtBox y Festival ADAR.');

    // Cada marca, con su Página. Lo que no case con ninguna se enseña al final.
    const usadas = new Set();
    const bloques = Object.entries(MARCAS).map(([marca, m]) => {
      const pag = paginas.find((p) => m.patron.test(p.name));
      const v = variables(marca);
      if (!pag) return `<section><h2>${esc(m.nombre)}</h2><p class="mal">No está entre las Páginas que diste. Vuelve a <a href="/api/meta-conectar">conectar</a> y márcala, si quieres publicar en ella.</p></section>`;
      usadas.add(pag);
      const ig = pag.instagram_business_account;
      const id = `t-${marca}`;
      return `<section><h2>${esc(m.nombre)}</h2>
<p>Página de Facebook: <b>${esc(pag.name)}</b><br>
Instagram: ${ig ? `<b>@${esc(ig.username)}</b>` : '<b class="mal">esta Página no tiene un Instagram profesional vinculado</b>'}</p>
<dl>
<dt>${v.token}</dt><dd><textarea id="${id}" readonly>${esc(pag.access_token)}</textarea><br><button onclick="navigator.clipboard.writeText(document.getElementById('${id}').value);this.textContent='Copiado'">Copiar</button></dd>
<dt>${v.pagina}</dt><dd><code>${esc(pag.id)}</code></dd>
${ig ? `<dt>${v.ig}</dt><dd><code>${esc(ig.id)}</code></dd>` : ''}
</dl></section>`;
    });
    const otras = paginas.filter((p) => !usadas.has(p));

    res.setHeader('Set-Cookie', 'meta_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    res.send(pagina('Conectado', `
<h1 class="ok">Conectado</h1>
<p>Último paso: guarda los datos de cada marca <b>en dos sitios</b>, con el mismo nombre y el mismo valor:</p>
<ol>
<li><b>Vercel</b>, proyecto <b>editorial-cola</b> → Settings → Environment Variables. Después, Redeploy.</li>
<li><b>GitHub</b>, repositorio <b>gaawi/editorial-cola</b> → Settings → Secrets and variables → Actions → New repository secret.</li>
</ol>
<p>Si un dato ya está guardado con ese mismo valor, no hace falta tocarlo.</p>
${bloques.join('')}
<p>Los tokens son de las Páginas y no caducan mientras sigas siendo administrador y no cambies la contraseña de Facebook. No los pegues en ningún chat.</p>
${otras.length ? `<p>Otras Páginas a las que diste acceso (no se usan): ${otras.map((p) => esc(p.name)).join(', ')}.</p>` : ''}`));
  } catch (e) {
    res.status(500).send(pagina('No se conectó', `<h1 class="mal">No se conectó</h1><p>${esc(e.message)}</p><p><a href="/api/meta-conectar">Probar otra vez</a></p>`));
  }
}
