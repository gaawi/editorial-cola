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

`edicion` (ig, fb, cuando, fotos, fondo) es lo que él cambió a mano y
**manda** sobre la ficha: usar su texto tal cual, sus fotos y su hora.

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
