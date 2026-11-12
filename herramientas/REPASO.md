# Repaso diario de redes (CreArtBox)

Lo hace una tarea programada cada mañana, en una sesión nueva. Guillermo
revisa desde la app (https://editorial-cola.vercel.app) y decide con dos
botones: **Aprobar** y, más tarde, **Confirmar publicación**. Esta tarea hace
lo que hay entre medias.

## Dónde está cada cosa

- `gaawi/editorial-cola` (rama de trabajo `claude/wonderful-clarke-9wgnjz`,
  se publica en `main` en avance directo, como dice `CLAUDE.md` de adar).
  - `flujo.json`: la fase de cada post, la escribe la app (`api/flujo.js`).
  - `datos/programado.json`: la cola. La publica sola la Action
    `publicar-cola` cada 10 minutos. **Esta tarea no escribe aquí nunca**:
    solo entra lo que Guillermo confirma desde la app.
  - `datos/posts.json`: se regenera con `node construir-datos.mjs creartbox`
    (necesita `../adar` al lado).
  - `lib/render.mjs`: `imagenesDe({ marca, clave, formatos, carrusel })`
    dibuja las imágenes finales.
- `gaawi/adar`, `src/data/kit-creartbox.ts`: las fichas (ideas) de CreArtBox.

## Lo que Guillermo ya ha dicho (no volver a preguntarlo)

- La app es para revisar. Él decide con Aprobar y Confirmar; lo demás lo
  hace esta tarea.
- **No pedirle material.** Si falta una imagen, buscarla o generarla:
  - archivo propio: `creartbox.nyc/archive/…` (fotos de cada concierto en
    `creartbox-archive.b-cdn.net`), prensa en `creartbox.nyc/assets/press/`;
  - dominio público: Internet Archive funciona (`archive.org/download/<id>/page/nN.jpg`);
    Wikimedia bloquea las descargas desde estas máquinas;
  - fotos de compositores: la de prensa de su web oficial;
  - o un gráfico con el motor (`estilo: 'cartel'`, `cinta`, `limpia`).
  - Nada de inventar datos. Lo que no esté publicado en ningún sitio, no se
    afirma.
- Las fotos que van tal cual van **enteras**, con su proporción
  (`fotosEnteras: true`), y del mismo formato dentro de un carrusel.
- Fuentes de la marca: Literata Display (titulares) y Archivo, como en
  `creartbox.nyc/brand.html`. Ya están en `kit-brands.ts`.
- Textos: frases cortas, que no suene a IA, **nunca la raya «—»**. La
  convocatoria es «Open Call», nunca «Calls for Scores». La Open Call en
  plan guía, sencilla.
- Nunca «link in bio»: siempre a la web, «Tickets at creartbox.nyc», «Apply:
  creartbox.nyc», también en las pegatinas. En Facebook, esa línea se cambia
  sola por el enlace entero.
- Feverdream y Pressure and Release: archivados hasta enero de 2027.
  Recuperarlos en el primer check de enero.
- Colaboradores en Instagram: los de `colaboradores` de la ficha si los
  trae (máximo 3); si no, `thedimennacenter` para lo que pasa en la DiMenna.
- Fotos de Currents (30 oct 2026): de Tao Ho, `@toseiho`. Darle crédito.
- No repetir la misma imagen en posts seguidos (el cartel de Winterlight ya
  salió el 9 de noviembre).
- Cada idea lleva `porque`.
- Los conciertos en bibliotecas de Queens (The Queens Passport, The Queens
  Mother Goose) son proyectos de Guillermo y de Josefina, no de CreArtBox.
  CreArtBox ya recibe fondos del Estado de NY y no es elegible para esos
  regrants: nombrar CreArtBox no pasa nada, pero nunca debe parecer que
  Flushing Town Hall o el Queens Arts Fund financian a CreArtBox. Créditos
  siempre atribuidos («a project by Guillermo Laporta…»), sin
  «presented by CreArtBox» e imagen sin marca (`sinMarca`). Sin el logo de
  Flushing Town Hall: lo pidió quitar el 12 de noviembre.
- Las historias no tienen texto: siempre con `pegatinas` (hasta 3), por
  ejemplo fecha y hora, lugar y «Tickets in bio» en ámbar (`senal: true`).
  Si el fondo es claro (una partitura, papel), `estilos: { story: 'duo' }`.
- Revisar las imágenes de las tres redes, no solo la de Instagram.
- Estilos que le gustan: `cielo` (foto entera, titular grande arriba,
  pegatinas abajo; para fotos con aire arriba), `ambar` (fondo amarillo
  entero, titular grande, pegatinas; para avisos) y `fondoAmbar: true` en
  carruseles de texto. Fotos verticales de una persona: en Facebook va la
  misma imagen de Instagram, que el apaisado corta la cara.
- Le gusta que el título y los datos formen parte de la imagen, como en las
  historias: en posts de venta o de convocatoria, `pegatinasMuro: true` pone
  las pegatinas también en la portada del post.
- Historia hecha con un cartel que ya trae texto: meterlo en la zona segura
  (unos 250 px libres arriba y 360 abajo en 1080×1920), que Instagram pone
  ahí la cuenta y «Enviar mensaje» y se montan.
- Carrusel de Instagram por API: **máximo 10** imágenes. Facebook: una.

## Fases (flujo.json → posts[clave].fase)

| fase | quién la pone | qué hace esta tarea |
|---|---|---|
| (ninguna) | — | idea en la app |
| `aprobado` | Guillermo | **prepararlo** (abajo) y pasarlo a `preparado` |
| `cambios` | Guillermo | leer `nota`, cambiar la ficha en adar, quitar la fase (vuelve a idea) |
| `preparado` | esta tarea | nada; comprobar que la hora sigue en el futuro |
| `confirmado` | Guillermo | nada: ya está en la cola |
| `luego` | Guillermo | «ahora no, más adelante»: proponerlo otra vez cuando vuelva a tener sentido (quitando la fase) |
| `descartado` | Guillermo | archivo: nada, salvo que vuelva a ser útil; entonces sugerirlo como idea nueva |

`edicion` es lo que él cambió a mano y **manda** sobre la ficha. En la fase
de idea solo edita `texto` (uno solo, la idea): al preparar, adaptarlo tú a
cada red (Instagram con «link in bio», Facebook con el enlace, etc.) sin
cambiarle el sentido. `ig`/`fb` solo aparecen si editó lo ya preparado, y
entonces van tal cual. También `cuando`, `fotos`, `fondo`, `encuadre` ({x, y, zoom}, de 0 a 1:
qué parte de la foto se ve; en el motor es `encuadre` de la ficha) y
`recorte` para las fotos tal cual: `entera` (con su proporción, entre 4:5 y
1,91:1) o `cortar` (recortar a 4:5 con ese encuadre y subir el recorte).

## Sugerencias

`posts[clave].sugerencias` son cambios que él escribe en el campo «Sugerir un
cambio…» de cada post. En cada repaso, aplicar todas las pendientes (en la
ficha de adar, en lo preparado o en `edicion`, donde toque) y marcarlas
`"hecha": true` con una `"respuesta"` corta de qué se ha hecho. Si una pide
algo que no se puede, `hecha: true` y la respuesta dice por qué. No cambian
la fase.

## Ideas que pide él

`flujo.json → ideas` son ideas que escribe en «Sugerir una idea nueva…». En
cada repaso, convertir cada pendiente en una ficha de verdad (con foto,
`pie`, `date` y `porque`), y marcarla `"hecha": true` con una `"respuesta"`
que diga el título de la ficha nueva. Queda como idea normal: él la aprueba.

## Preparar un post aprobado

1. Fecha y hora: `edicion.cuando` si la hay (hora de Nueva York); si no, la
   fecha de la ficha o la mejor libre en los próximos días, sin dos posts el
   mismo día, entre 11:00 y 19:00 de Nueva York, y siempre antes de que caduque
   lo que anuncia.
2. Imágenes: dibujar con `imagenesDe` (ig, fb y story), copiarlas a
   `imagenes/<idioma>-<slug>-{ig,fb,st}-N.jpg`. Si `edicion.fotos`, se publican
   esas fotos tal cual. Si `edicion.fondo`, la ficha se dibuja con ese fondo.
   Mirar cada imagen antes de darla por buena.
3. Escribir en `flujo.json`:

```json
"posts": { "en/slug": {
  "fase": "preparado",
  "preparado": {
    "en/slug": { "tipo": "post", "redes": [
      { "red": "ig", "cuando": "2026-11-17T18:00:00-05:00", "texto": "…", "imagenes": ["https://raw.githubusercontent.com/gaawi/editorial-cola/main/imagenes/…"], "colaboradores": ["dimennacenter"] },
      { "red": "fb", "cuando": "2026-11-17T18:02:00-05:00", "texto": "…", "imagenes": ["…"] } ] },
    "en/slug#historia": { "tipo": "historia", "redes": [
      { "red": "ig", "cuando": "2026-11-17T18:10:00-05:00", "texto": "", "imagenes": ["…-st-1.jpg"] } ] }
  },
  "historial": [ …, { "accion": "preparar", "quien": "claude", "fecha": "…" } ]
} }
```

   Sin `estado` ni `via`: los pone la app al confirmar. Historia solo si
   aporta (y si `edicion.historia === false`, no).

## Decisiones pequeñas: hacerlas, no preguntarlas

Lo obvio se hace sin preguntar y se deja una nota de por qué (en la ficha, en
`porque` o en el historial de `flujo.json`): archivar lo que ya pasó su fecha,
corregir un dato que la web contradice, cambiar una foto repetida, etc. Solo
se pregunta lo que de verdad es suyo de decidir. En el resumen final, una
línea con lo que se ha hecho así.

## Sugerir

Una o dos ideas nuevas, como fichas en `kit-creartbox.ts`, según lo que venga
(conciertos en `src/data`, campañas abiertas). Con `pie` escrito a mano, foto
real del archivo, `date` y **`porque`**: una o dos frases de por qué este post y por qué ese día (queda un día para algo, es Black Friday, une dos campañas…). Se enseña en la app junto a los botones. Nada de inventar datos: si falta un precio o una
fecha, `falta: '…'`. Estilo: frases cortas, nada que suene a IA, **nunca la
raya «—»**, y en las convocatorias decir «Open Call», no «Calls for Scores».

## Al terminar

Regenerar `datos/posts.json`, commit en las dos ramas y a `main`. La app escribe `flujo.json` y la cola escribe `programado.json` mientras tanto: `git pull --rebase origin main` justo antes de subir, y si `flujo.json` choca, quedarse con lo de él y volver a aplicar lo tuyo. Último
mensaje, en español y muy breve: cuántos hay para confirmar, qué ideas nuevas,
qué sale hoy y mañana, y si algo preparado se ha quedado con la hora pasada.
