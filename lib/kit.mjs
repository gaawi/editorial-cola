// Saca del kit la imagen de una ficha, en el formato que pida cada red.
//
// Por qué esto existe: el kit dibuja la imagen en un canvas del navegador, y
// hasta ahora la única manera de tenerla era pulsar su botón de descarga a
// mano. Mientras tanto publicar.mjs mandaba la foto de origen tal cual, sin
// el rótulo ni el titular encima, así que lo publicado no era lo aprobado.
//
// Aquí se abre el kit de verdad —se construye el sitio, se sirve en local y
// se pulsa su propio botón— en vez de redibujar por nuestra cuenta: si el
// motor cambia allí, esto sigue dando lo mismo que el panel.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

/** Qué página del kit lleva cada marca, y qué botón tiene cada formato. */
const PAGINAS = { adar: 'kit-redes', creartbox: 'kit-redes-creartbox' };

/** Construye el sitio si no está construido. Tarda, pero solo la primera vez. */
function construir(adar) {
  if (existsSync(join(adar, 'dist', 'index.html'))) return;
  if (!existsSync(join(adar, 'node_modules'))) {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: adar, stdio: 'inherit' });
  }
  execFileSync('npm', ['run', 'build'], { cwd: adar, stdio: 'inherit' });
}

/** Sirve dist/ en local: las páginas internas van detrás de una cookie en
 *  producción, pero los archivos construidos no tienen esa puerta. */
function servir(adar, puerto) {
  const srv = spawn('python3', ['-m', 'http.server', String(puerto), '--bind', '127.0.0.1'], {
    cwd: join(adar, 'dist'),
    stdio: 'ignore',
    detached: true,
  });
  return () => { try { process.kill(-srv.pid); } catch {} srv.kill(); };
}

async function esperar(url, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try { if ((await fetch(url)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El servidor local no levantó a tiempo.');
}

/**
 * Devuelve las rutas de las imágenes pedidas para una ficha.
 * `formatos` son los del kit: 'ig' (1080×1080), 'fb' (1200×630), 'story' (9:16).
 */
export async function imagenesDelKit({ marca, clave, formatos, adar, aviso }) {
  const dir = adar || resolve(process.env.ADAR_DIR || '../adar');
  const pagina = PAGINAS[marca];
  if (!pagina) throw new Error(`No sé qué página del kit mira la marca «${marca}».`);

  aviso?.('construyendo el sitio si hace falta…');
  construir(dir);

  const puerto = 8700 + Math.floor(Math.random() * 200);
  const parar = servir(dir, puerto);
  const base = `http://127.0.0.1:${puerto}`;
  const destino = await mkdtemp(join(tmpdir(), 'kit-'));
  const fuera = {};

  try {
    await esperar(`${base}/${pagina}/`);
    const { chromium } = await import(PLAYWRIGHT);
    const nav = await chromium.launch({ executablePath: CHROMIUM });
    const ctx = await nav.newContext({ viewport: { width: 402, height: 874 }, acceptDownloads: true });

    // El navegador de la caja no sale a internet; Node sí, por el proxy.
    const cache = new Map();
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, async (r) => {
      const u = r.request().url();
      if (!cache.has(u)) {
        const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/140' } });
        cache.set(u, { s: res.status, t: res.headers.get('content-type') || 'text/css', b: Buffer.from(await res.arrayBuffer()) });
      }
      const c = cache.get(u);
      await r.fulfill({ status: c.s, contentType: c.t, body: c.b });
    });

    try {
      const p = await ctx.newPage();
      await p.goto(`${base}/${pagina}/`, { waitUntil: 'networkidle' });
      await p.evaluate(() => document.fonts.ready);

      const ficha = p.locator(`article.card[data-rv-key="${clave}"]`);
      await ficha.waitFor({ timeout: 20000 });
      // En el móvil las fichas van plegadas y los botones están ocultos.
      if (await ficha.evaluate((el) => el.classList.contains('is-folded'))) {
        await ficha.locator('button.card-fold').first().click();
        await p.waitForTimeout(500);
      }

      for (const fmt of formatos) {
        aviso?.(`dibujando ${fmt}…`);
        const boton = ficha.locator(`button[data-dl="${fmt}"]`).first();
        await boton.scrollIntoViewIfNeeded();
        const [d] = await Promise.all([
          p.waitForEvent('download', { timeout: 60000 }),
          boton.click(),
        ]);
        const ruta = join(destino, `${clave.replace(/\//g, '-')}-${fmt}.jpg`);
        await d.saveAs(ruta);
        fuera[fmt] = ruta;
      }
    } finally {
      await nav.close();
    }
  } finally {
    parar();
  }
  return fuera;
}
