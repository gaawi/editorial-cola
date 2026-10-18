// Dibuja las imágenes de una ficha con el motor de la app.
//
// Antes esto lo hacía el kit de ADAR, abriendo su página y pulsando su botón
// de descarga. Ya no sirve: el kit solo sabe cuadrado y siempre en estilo
// cinta, y hacen falta 4:5 (porque la rejilla de Instagram recorta la
// cuadrada) y un estilo por tipo de post. Mismo motor que la vista previa,
// así que lo que se aprueba es lo que sale.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

function servir(puerto) {
  const srv = spawn('python3', ['-m', 'http.server', String(puerto), '--bind', '127.0.0.1'], {
    cwd: AQUI, stdio: 'ignore', detached: true,
  });
  return () => { try { process.kill(-srv.pid); } catch {} srv.kill(); };
}

async function esperar(url, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('El servidor local no levantó a tiempo.');
}

/**
 * Devuelve las rutas de las imágenes de una ficha.
 * `formatos` es un objeto {red: formato}, p.ej. {ig: 'ig', fb: 'fb'}.
 * Para Instagram se dibujan todas las diapositivas (el carrusel); para las
 * demás, solo la portada.
 */
export async function imagenesDe({ marca, clave, formatos, carrusel = true, aviso }) {
  const puerto = 8900 + Math.floor(Math.random() * 90);
  const parar = servir(puerto);
  const base = `http://127.0.0.1:${puerto}`;
  const destino = await mkdtemp(join(tmpdir(), 'render-'));
  const fuera = {};

  try {
    await esperar(`${base}/render.html`);
    const { chromium } = await import(PLAYWRIGHT);
    const nav = await chromium.launch({ executablePath: CHROMIUM });
    const ctx = await nav.newContext({ viewport: { width: 500, height: 500 } });

    // El navegador de la caja no sale a internet; Node sí, por el proxy.
    const cache = new Map();
    await ctx.route((u) => !u.hostname.startsWith('127.0.0.1'), async (r) => {
      const url = r.request().url();
      if (!cache.has(url)) {
        try {
          const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/140' } });
          cache.set(url, {
            s: res.status,
            t: res.headers.get('content-type') || 'application/octet-stream',
            b: Buffer.from(await res.arrayBuffer()),
          });
        } catch { cache.set(url, null); }
      }
      const c = cache.get(url);
      if (!c) return r.abort();
      await r.fulfill({ status: c.s, contentType: c.t, body: c.b, headers: { 'access-control-allow-origin': '*' } });
    });

    try {
      const p = await ctx.newPage();
      await p.goto(`${base}/render.html`, { waitUntil: 'networkidle' });
      await p.waitForFunction(() => window.listo === true, { timeout: 20000 });
      await p.evaluate(() => document.fonts.ready);

      const total = await p.evaluate(([m, c]) => window.cuantas(m, c), [marca, clave]);
      if (!total) throw new Error(`La ficha ${clave} no tiene diapositivas.`);

      for (const [red, fmt] of Object.entries(formatos)) {
        const cuantas = red === 'ig' && carrusel ? total : 1;
        fuera[red] = [];
        for (let i = 0; i < cuantas; i++) {
          aviso?.(`${red} ${i + 1}/${cuantas}…`);
          const b64 = await p.evaluate(
            ([m, c, idx, f]) => window.dibujarSlide(m, c, idx, f),
            [marca, clave, i, fmt]
          );
          const ruta = join(destino, `${clave.replace(/\//g, '-')}-${red}-${i + 1}.jpg`);
          await writeFile(ruta, Buffer.from(b64, 'base64'));
          fuera[red].push(ruta);
        }
      }
    } finally {
      await nav.close();
    }
  } finally {
    parar();
  }
  return fuera;
}
