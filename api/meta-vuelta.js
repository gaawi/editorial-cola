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
  if (!r.ok || d.error) throw new Error((d.error && d.error.message) || `Meta responded ${r.status}`);
  return d;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(titulo, cuerpo) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
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
  if (error_description) return res.status(400).send(pagina('Not connected', `<h1 class="mal">Not connected</h1><p>Facebook said: ${esc(error_description)}</p><p><a href="/api/meta-conectar">Try again</a></p>`));
  if (!code || !state || state !== guardado) return res.status(400).send(pagina('Link expired', `<h1 class="mal">The link has expired</h1><p><a href="/api/meta-conectar">Start again</a></p>`));

  const secreto = process.env.META_APP_SECRET;
  if (!secreto) return res.status(500).send(pagina('Missing variable', `<h1 class="mal">META_APP_SECRET is missing in Vercel</h1><p>It is at developers.facebook.com → your app → App settings → Basic → App secret.</p>`));

  try {
    const corto = await graph('/oauth/access_token', { client_id: APP_ID, client_secret: secreto, redirect_uri: urlVuelta(req), code });
    const largo = await graph('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: secreto, fb_exchange_token: corto.access_token });
    const cuentas = await graph('/me/accounts', { access_token: largo.access_token, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' });
    const paginas = cuentas.data || [];
    if (!paginas.length) throw new Error('Facebook did not grant access to any Page. Connect again and select the CreArtBox and Festival ADAR Pages.');

    // Cada marca, con su Página. Lo que no case con ninguna se enseña al final.
    const usadas = new Set();
    const bloques = Object.entries(MARCAS).map(([marca, m]) => {
      const pag = paginas.find((p) => m.patron.test(p.name));
      const v = variables(marca);
      if (!pag) return `<section><h2>${esc(m.nombre)}</h2><p class="mal">It is not among the Pages you granted. <a href="/api/meta-conectar">Connect</a> again and select it if you want to publish to it.</p></section>`;
      usadas.add(pag);
      const ig = pag.instagram_business_account;
      const id = `t-${marca}`;
      return `<section><h2>${esc(m.nombre)}</h2>
<p>Facebook Page: <b>${esc(pag.name)}</b><br>
Instagram: ${ig ? `<b>@${esc(ig.username)}</b>` : '<b class="mal">this Page has no linked Instagram professional account</b>'}</p>
<dl>
<dt>${v.token}</dt><dd><textarea id="${id}" readonly>${esc(pag.access_token)}</textarea><br><button onclick="navigator.clipboard.writeText(document.getElementById('${id}').value);this.textContent='Copied'">Copy</button></dd>
<dt>${v.pagina}</dt><dd><code>${esc(pag.id)}</code></dd>
${ig ? `<dt>${v.ig}</dt><dd><code>${esc(ig.id)}</code></dd>` : ''}
</dl></section>`;
    });
    const otras = paginas.filter((p) => !usadas.has(p));

    res.setHeader('Set-Cookie', 'meta_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    res.send(pagina('Connected', `
<h1 class="ok">Connected</h1>
<p>Last step: save each brand's values <b>in two places</b>, with the same name and the same value:</p>
<ol>
<li><b>Vercel</b>, project <b>editorial-cola</b> → Settings → Environment Variables. Then Redeploy.</li>
<li><b>GitHub</b>, repository <b>gaawi/editorial-cola</b> → Settings → Secrets and variables → Actions → New repository secret.</li>
</ol>
<p>If a value is already saved with that same value, you do not need to touch it.</p>
${bloques.join('')}
<p>The tokens belong to the Pages and do not expire as long as you stay an admin and do not change your Facebook password. Do not paste them into any chat.</p>
${otras.length ? `<p>Other Pages you granted access to (not used): ${otras.map((p) => esc(p.name)).join(', ')}.</p>` : ''}`));
  } catch (e) {
    res.status(500).send(pagina('Not connected', `<h1 class="mal">Not connected</h1><p>${esc(e.message)}</p><p><a href="/api/meta-conectar">Try again</a></p>`));
  }
}
