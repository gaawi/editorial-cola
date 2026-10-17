# editorial/cola

Publicar en Facebook e Instagram desde el chat. No tiene pantalla a propósito:
la herramienta la ejecuta Claude en la conversación, enseña lo que va a salir,
y solo publica cuando se le dice.

Las ideas salen del **kit de redes** del repositorio de ADAR, que se lee sin
tocarlo: ni el kit ni los archivos de revisión se modifican nunca desde aquí.

## Lo único que hay que preparar

Un **token de Meta** con permiso para publicar en la Página de Facebook y en
la cuenta de Instagram vinculada a ella.

1. En [developers.facebook.com](https://developers.facebook.com/apps/) crear
   una app de tipo *Business* (o usar una que ya exista).
2. En el **Graph API Explorer**, elegir esa app y pedir un token de usuario con
   estos permisos:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `instagram_basic`, `instagram_content_publish`.
3. Cambiarlo por uno de **larga duración** (el propio Explorer lo hace, o
   `/oauth/access_token?grant_type=fb_exchange_token`). El token de Página que
   sale de ahí no caduca mientras no se cambie la contraseña ni se retire el
   permiso.
4. La cuenta de Instagram tiene que ser **de empresa o de creador** y estar
   vinculada a esa Página; si no, Meta no deja publicar por API.

Ese token se guarda en los **ajustes del entorno** de la sesión (el menú del
entorno en la barra de título → *Edit*), como secreto de red o variable de
entorno, con el nombre `META_TOKEN`. La siguiente sesión ya lo encuentra. No
hace falta pegarlo en el chat.

Opcionales, si el token alcanza más de una Página: `FB_PAGE_ID` y `IG_USER_ID`.
`node publicar.mjs cuentas` dice cuáles son.

## Cómo se usa

```sh
node publicar.mjs cuentas          # qué Página y qué Instagram alcanza el token
node publicar.mjs ideas --listas   # lo que el panel tiene marcado «listo»
node publicar.mjs ver en/currents  # la ficha y el pie que saldría en cada red

node publicar.mjs publicar --idea en/currents --red ambas        # ensayo
node publicar.mjs publicar --idea en/currents --red ambas --ya   # de verdad

node publicar.mjs subir foto.jpg   # deja una imagen en una URL pública
node publicar.mjs registro         # lo publicado desde aquí
```

Sin `--ya` no sale nada: se imprime el texto entero, lo que se ve antes del
«ver más» y la cuenta de caracteres de cada red.

Para publicar algo que no esté en el kit:

```sh
node publicar.mjs publicar --texto "…" --imagen https://…/foto.jpg --red ambas
node publicar.mjs publicar --texto-ig "…" --texto-fb "…" --imagen …
node publicar.mjs publicar --texto "…" --enlace https://… --red fb
```

## Lo que conviene saber

- **Instagram solo acepta una URL pública de un JPEG.** No hay subida directa:
  Meta va a buscar la imagen a ese enlace en el momento de publicar. Las fotos
  del kit ya están servidas (el CDN de ADAR, creartbox.nyc) y valen tal cual.
  Para una imagen que esté solo en el portátil, `subir` la deja en
  `imagenes/` de este repositorio y devuelve su URL.
- **Instagram no publica sin imagen.** Facebook sí.
- El pie de cada red se compone con la misma receta que el kit
  (`lib/textos.mjs`). Es una copia escrita en Node, porque el kit vive en el
  navegador: si allí cambia la forma del pie, hay que cambiarla aquí también.
- Lo que el kit guarda en el navegador (textos corregidos a mano desde el
  panel) no se ve desde aquí; lo que se lee es el material del repositorio.
- Cada publicación se anota en `registro.jsonl`. El estado del panel
  (`revisiones*.json`, en el repositorio de ADAR) no se toca.

## Los archivos

```
publicar.mjs      la línea de órdenes
lib/meta.mjs      Graph API: Facebook e Instagram
lib/ideas.mjs     lee el material del kit de redes (solo lectura)
lib/textos.mjs    el pie de cada red y los repasos previos
registro.jsonl    lo publicado desde aquí
```
