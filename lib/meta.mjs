// Llamadas a la Graph API de Meta: Facebook (Página) e Instagram (cuenta de
// empresa vinculada a esa Página). Sin dependencias: fetch de Node.
//
// Las dos redes publican de forma distinta y conviene tenerlo presente:
//   · Facebook acepta la foto por URL o por archivo.
//   · Instagram SOLO acepta una URL pública de un JPEG. No hay subida directa:
//     Meta va a buscar la imagen a ese enlace, así que tiene que estar en pie
//     en el momento de publicar (de ahí el comando «subir»).

// La última que Meta sirve a día de hoy (comprobado contra graph.facebook.com
// en octubre de 2026). Cada versión dura unos dos años; cuando empiecen a
// llegar avisos de caducidad, subir esto o pasar META_API_VERSION.
const VERSION = process.env.META_API_VERSION || 'v26.0';
const API = `https://graph.facebook.com/${VERSION}`;

/** Una llamada a la Graph API. Devuelve el JSON o lanza el error de Meta. */
export async function graph(ruta, { metodo = 'GET', params = {}, token } = {}) {
  const url = new URL(API + (ruta.startsWith('/') ? ruta : '/' + ruta));
  const cuerpo = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (metodo === 'GET') url.searchParams.set(k, String(v));
    else cuerpo.set(k, String(v));
  }
  if (token) {
    if (metodo === 'GET') url.searchParams.set('access_token', token);
    else cuerpo.set('access_token', token);
  }

  const res = await fetch(url, {
    method: metodo,
    body: metodo === 'GET' ? undefined : cuerpo,
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok || datos.error) {
    const e = datos.error || {};
    const err = new Error(
      `Meta ${res.status}: ${e.message || 'respuesta ilegible'}` +
        (e.code ? ` (código ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})` : '')
    );
    err.meta = e;
    throw err;
  }
  return datos;
}

/**
 * Qué hay detrás del token. Vale tanto un token de usuario (del que cuelgan
 * las Páginas, cada una con el suyo) como un token de Página ya emitido.
 */
export async function descubrirCuentas(token) {
  const campos = 'id,name,access_token,instagram_business_account{id,username,name}';

  // Token de usuario: las Páginas vienen por aquí, con su propio token.
  try {
    const r = await graph('/me/accounts', { params: { fields: campos, limit: 50 }, token });
    if (r.data?.length) {
      return {
        tipo: 'usuario',
        paginas: r.data.map((p) => ({
          id: p.id,
          nombre: p.name,
          token: p.access_token,
          ig: p.instagram_business_account || null,
        })),
      };
    }
  } catch {
    // Un token de Página no tiene arista /accounts: se prueba abajo.
  }

  // Token de Página: él mismo es la Página.
  const p = await graph('/me', {
    params: { fields: 'id,name,instagram_business_account{id,username,name}' },
    token,
  });
  return {
    tipo: 'pagina',
    paginas: [{ id: p.id, nombre: p.name, token, ig: p.instagram_business_account || null }],
  };
}

/** Cuánto le queda al token. Necesita el id y el secreto de la app. */
export async function caducidad(token, appId, appSecret) {
  if (!appId || !appSecret) return null;
  const r = await graph('/debug_token', {
    params: { input_token: token, access_token: `${appId}|${appSecret}` },
    token: null,
  });
  return r.data || null;
}

/** Publica en la Página. Con imagen va como foto; sin ella, como entrada. */
export async function publicarFacebook({ paginaId, token, texto, imagen, enlace }) {
  if (imagen) {
    const r = await graph(`/${paginaId}/photos`, {
      metodo: 'POST',
      params: { url: imagen, caption: texto, published: 'true' },
      token,
    });
    const id = r.post_id || r.id;
    return { id, enlace: `https://www.facebook.com/${id}` };
  }
  const r = await graph(`/${paginaId}/feed`, {
    metodo: 'POST',
    params: { message: texto, link: enlace },
    token,
  });
  return { id: r.id, enlace: `https://www.facebook.com/${r.id}` };
}

/**
 * Publica en Instagram. Son tres pasos: se crea un contenedor con la imagen y
 * el pie, se espera a que Meta la descargue, y entonces se publica.
 */
export async function publicarInstagram({ igId, token, texto, imagen, espera = 90000, aviso }) {
  if (!imagen) throw new Error('Instagram no publica sin imagen.');

  const cont = await graph(`/${igId}/media`, {
    metodo: 'POST',
    params: { image_url: imagen, caption: texto },
    token,
  });

  // El contenedor tarda en estar listo: Meta descarga la imagen por su cuenta.
  const limite = Date.now() + espera;
  let estado = '';
  while (Date.now() < limite) {
    const s = await graph(`/${cont.id}`, { params: { fields: 'status_code,status' }, token });
    estado = s.status_code;
    if (estado === 'FINISHED') break;
    if (estado === 'ERROR' || estado === 'EXPIRED') {
      throw new Error(`Instagram rechazó la imagen (${estado}): ${s.status || 'sin detalle'}`);
    }
    aviso?.(`contenedor ${estado || 'IN_PROGRESS'}…`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (estado !== 'FINISHED') throw new Error('El contenedor de Instagram no estuvo listo a tiempo.');

  const pub = await graph(`/${igId}/media_publish`, {
    metodo: 'POST',
    params: { creation_id: cont.id },
    token,
  });
  const info = await graph(`/${pub.id}`, { params: { fields: 'permalink' }, token }).catch(() => ({}));
  return { id: pub.id, enlace: info.permalink || `https://www.instagram.com/p/${pub.id}/` };
}
