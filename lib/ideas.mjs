// Las ideas salen del kit de redes, en el repositorio de ADAR, y se leen tal
// cual: aquí NO se escribe nada en el kit. Dos fuentes, las mismas dos que
// pinta el kit:
//   · Festival ADAR  → los artículos de src/content/blog/
//   · CreArtBox      → las fichas de src/data/kit-creartbox.ts
//
// De kit-brands.ts se reutilizan la identidad de cada marca y buildPost(), que
// es lo que convierte el material en la forma que el kit consume. Node lee el
// TypeScript directamente, sin compilarlo.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Dónde está el repositorio de ADAR. Se puede mover con ADAR_DIR. */
export function dirAdar(base) {
  return process.env.ADAR_DIR || base || '../adar';
}

async function kit(dir) {
  const url = (f) => pathToFileURL(join(dir, 'src/data', f)).href;
  const marcas = await import(url('kit-brands.ts'));
  return marcas;
}

/**
 * Frontmatter mínimo: cadenas sueltas y listas de un nivel, en las dos formas
 * que usa el repositorio. El CMS escribe las etiquetas en línea
 * (`tags: ["a", "b"]`) y a mano se escriben con guiones debajo; los artículos
 * del blog de ADAR están casi todos en la primera forma.
 */
function frontmatter(texto) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { datos: {}, cuerpo: texto };
  const datos = {};
  let lista = null;
  for (const linea of m[1].split('\n')) {
    const item = linea.match(/^\s+-\s+(.*)$/);
    if (item && lista) {
      datos[lista].push(desentrecomillar(item[1]));
      continue;
    }
    const par = linea.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!par) continue;
    const [, clave, valor] = par;
    if (valor === '') {
      lista = clave;
      datos[clave] = [];
    } else {
      lista = null;
      datos[clave] = enLinea(valor);
    }
  }
  return { datos, cuerpo: m[2] };
}

/** Una lista escrita entre corchetes, o un valor suelto. */
function enLinea(v) {
  const s = v.trim();
  if (!(s.startsWith('[') && s.endsWith(']'))) return desentrecomillar(s);
  try {
    const l = JSON.parse(s);
    if (Array.isArray(l)) return l.map((x) => String(x));
  } catch {
    // YAML admite comillas simples donde JSON no: se parte a mano.
  }
  return s
    .slice(1, -1)
    .split(',')
    .map((x) => desentrecomillar(x))
    .filter(Boolean);
}

function desentrecomillar(v) {
  const s = v.trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

async function markdownDeBlog(dir) {
  const raiz = join(dir, 'src/content/blog');
  const fuera = [];
  for (const idioma of await readdir(raiz, { withFileTypes: true })) {
    if (!idioma.isDirectory()) continue;
    for (const f of await readdir(join(raiz, idioma.name))) {
      if (!f.endsWith('.md')) continue;
      const { datos, cuerpo } = frontmatter(await readFile(join(raiz, idioma.name, f), 'utf8'));
      fuera.push({
        lang: datos.lang || idioma.name,
        slug: f.replace(/\.md$/, ''),
        title: datos.title || '',
        excerpt: datos.excerpt || '',
        image: datos.featured_image || '',
        status: datos.status || 'draft',
        date: (datos.date || '').slice(0, 10),
        tags: datos.tags || [],
        body: cuerpo,
      });
    }
  }
  return fuera;
}

/**
 * Todas las ideas de una marca, en el orden del kit: lo publicado primero y,
 * dentro, lo más reciente arriba.
 */
export async function cargarIdeas(marca, base) {
  const dir = dirAdar(base);
  const { BRANDS, buildPost, sortPosts } = await kit(dir);
  const brand = BRANDS[marca];
  if (!brand) throw new Error(`No conozco la marca «${marca}». Hay: ${Object.keys(BRANDS).join(', ')}.`);

  if (marca === 'creartbox') {
    const { CREARTBOX_SOURCES } = await import(
      pathToFileURL(join(dir, 'src/data/kit-creartbox.ts')).href
    );
    // Sin ordenar, igual que el kit: aquí las fechas son de conciertos futuros.
    // Estos tres no los conoce buildPost, son nuestros: `cta` para que una
    // ficha mande a comprar entradas en vez de a la nota de prensa, `estilo`
    // para que pida su propio diseño, y `cifra` para el dato que se dibuja
    // a tamaño de titular.
    const PROPIOS = ['cta', 'estilo', 'cifra', 'tabla', 'pie', 'falta'];
    return {
      brand,
      ideas: CREARTBOX_SOURCES.map((s) => {
        const idea = buildPost(s, brand);
        for (const k of PROPIOS) if (s[k]) idea[k] = s[k];
        return idea;
      }),
    };
  }

  const ideas = sortPosts((await markdownDeBlog(dir)).map((s) => buildPost(s, brand)));
  return { brand, ideas };
}

/** La clave con la que se nombra una idea desde la línea de órdenes. */
export function clave(idea) {
  return `${idea.lang}/${idea.slug}`;
}

/** Busca por clave exacta y, si no, por trozo del título o del slug. */
export function buscar(ideas, texto) {
  const t = texto.toLowerCase();
  const exacta = ideas.find((i) => clave(i).toLowerCase() === t);
  if (exacta) return [exacta];
  return ideas.filter(
    (i) => clave(i).toLowerCase().includes(t) || i.title.toLowerCase().includes(t)
  );
}
