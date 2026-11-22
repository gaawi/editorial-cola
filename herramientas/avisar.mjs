#!/usr/bin/env node
// Manda un aviso a los móviles suscritos. Lo usa la Action «Avisar» (que
// lanza Claude al terminar un check) y se puede usar a mano:
//   node herramientas/avisar.mjs "Título" "Texto" [/url]
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avisar } from '../lib/avisos.mjs';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const [titulo, texto = '', url = '/'] = process.argv.slice(2);
if (!titulo) { console.log('Falta el título.'); process.exit(1); }
const datos = JSON.parse(await readFile(join(AQUI, 'datos', 'avisos.json'), 'utf8').catch(() => '{"suscripciones":[]}'));
const r = await avisar(datos.suscripciones, { titulo, texto, url });
console.log(`Avisos enviados: ${r.enviados}${r.muertos.length ? ` · ${r.muertos.length} aparatos ya no responden` : ''}`);
