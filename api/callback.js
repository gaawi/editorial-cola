// Relevo de OAuth para la app de aprobar. Copiado de gaawi/adar, que lleva
// meses funcionando: lo único que cambia es el repositorio, el nombre de la
// cookie y la variable de las cuentas permitidas.
//
// Step 2 of the handshake: GitHub sends the user back here with a temporary
// ?code=. We exchange it (server-side, using the client secret) for an access
// token, then hand that token back to the CMS window via postMessage using the
// message format Decap/Sveltia expect:
//
//   "authorization:github:success:{\"token\":\"...\",\"provider\":\"github\"}"
//
// Requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (see api/auth.js).

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function render(status, payload) {
  // Página mínima que se comunica con la ventana del CMS y se cierra.
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;
  return `<!doctype html>
<html><head><meta charset="utf-8" /></head><body>
<p>${status === 'success' ? 'Autenticado. Puedes cerrar esta ventana.' : 'Error de autenticación.'}</p>
<script>
(function () {
  var message = ${JSON.stringify(message)};
  function receive(e) {
    window.removeEventListener('message', receive, false);
    // Respondemos al mensaje "authorizing:github" del CMS con el resultado.
    if (window.opener) window.opener.postMessage(message, e.origin || '*');
    window.close();
  }
  window.addEventListener('message', receive, false);
  // El CMS espera este primer aviso para empezar el diálogo.
  if (window.opener) window.opener.postMessage('authorizing:github', '*');
})();
</script>
</body></html>`;
}

// Quién puede entrar. La firma de la cookie garantiza que no se falsifica,
// pero no dice nada de quién es: sin esta comprobación, cualquier cuenta de
// GitHub que autorizara la aplicación conseguía sesión, y el repositorio es
// público. Pasan dos tipos de cuenta:
//   · las que pueden escribir en el repositorio (colaboradores), y
//   · las que estén en ADAR_LOGINS, por si se quiere dar acceso a alguien sin
//     darle permisos sobre el código.
async function autorizado(token) {
  const gh = (ruta) =>
    fetch('https://api.github.com' + ruta, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'editorial-cola',
      },
    });

  let login = '';
  try {
    const meRes = await gh('/user');
    if (!meRes.ok) return { ok: false, motivo: 'GitHub no devolvió la identidad de la cuenta.' };
    login = String((await meRes.json()).login || '');
  } catch (e) {
    return { ok: false, motivo: 'No se pudo comprobar la cuenta con GitHub.' };
  }

  const permitidos = (process.env.COLA_LOGINS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (permitidos.includes(login.toLowerCase())) return { ok: true, login };

  const repo = process.env.GITHUB_REPO || 'gaawi/editorial-cola';
  try {
    const repoRes = await gh('/repos/' + repo);
    if (repoRes.ok) {
      const info = await repoRes.json();
      if (info && info.permissions && info.permissions.push) return { ok: true, login };
    }
  } catch (e) {
    return { ok: false, motivo: 'No se pudo comprobar el acceso al repositorio.' };
  }
  return {
    ok: false,
    motivo: `La cuenta ${login} no tiene acceso a este panel. Pide que te añadan al repositorio.`,
  };
}

// Cookie firmada (HMAC-SHA256) que autoriza las vistas previas de borradores.
// Formato: "<caduca en ms>.<firma hex>".
async function previewCookie(secret, days) {
  const { createHmac } = await import('node:crypto');
  const exp = String(Date.now() + days * 24 * 3600 * 1000);
  const sig = createHmac('sha256', secret).update('preview:' + exp).digest('hex');
  return `${exp}.${sig}`;
}

export default async function handler(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).send('Faltan GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET en las variables de entorno.');
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req.headers.cookie);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Limpiamos la cookie de estado en cualquier caso.
  res.setHeader('Set-Cookie', 'csm_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  if (!code || !state || !cookies.csm_state || state !== cookies.csm_state) {
    res.status(400).send(render('error', { error: 'Estado OAuth no válido. Inténtalo de nuevo.' }));
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const data = await tokenRes.json();
    if (data.error || !data.access_token) {
      res.status(401).send(render('error', { error: data.error_description || data.error || 'Sin token.' }));
      return;
    }

    // Antes de entregar nada: comprobar que la cuenta es de las nuestras.
    const permiso = await autorizado(data.access_token);
    if (!permiso.ok) {
      res.status(403).send(render('error', { error: permiso.motivo }));
      return;
    }

    // Además del token para el CMS, dejamos una cookie firmada que habilita
    // la app entera. La comprueba
    // middleware.js con el mismo secreto.
    const preview = await previewCookie(clientSecret, 30);
    res.setHeader('Set-Cookie', [
      'csm_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      `cola_preview=${preview}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
    ]);

    res.status(200).send(render('success', { token: data.access_token, provider: 'github' }));
  } catch (err) {
    res.status(500).send(render('error', { error: 'Fallo al contactar con GitHub.' }));
  }
}
