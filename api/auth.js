// Relevo de OAuth para la app de aprobar, copiado de gaawi/adar.
//
// Step 1 of the handshake: the CMS opens this endpoint in a popup. We redirect
// the browser to GitHub's authorization screen. GitHub then sends the user back
// to /api/callback with a temporary code.
//
// Requires two Vercel environment variables (Project → Settings → Environment
// Variables), created from a GitHub OAuth App:
//   GITHUB_CLIENT_ID
//   GITHUB_CLIENT_SECRET
//
// This is a Vercel Serverless Function (Node.js runtime). It lives in /api at
// the repo root and is independent of the static Astro build.

function randomState() {
  // Node 18+ on Vercel exposes the Web Crypto API globally.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function handler(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('Falta GITHUB_CLIENT_ID en las variables de entorno.');
    return;
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/callback`;

  const state = randomState();
  // Guardamos el "state" en una cookie httpOnly para verificarlo en el callback
  // (protección CSRF del flujo OAuth).
  res.setHeader(
    'Set-Cookie',
    `csm_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo',
    state,
    allow_signup: 'false',
  });

  res.writeHead(302, {
    Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
  });
  res.end();
}
