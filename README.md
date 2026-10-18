# editorial/cola

Dos cosas que comparten material: **la app de aprobar**, que se abre en el
móvil y enseña cada post como se va a ver en Instagram y en Facebook, y la
**herramienta de publicar**, que sale desde el chat.

## La app de aprobar

Vive en la raíz y se despliega en Vercel. Solo hace tres cosas: enseñar,
decidir y guardar. Y enseña como se va a ver: es un muro que se desplaza
como la app, con los circulitos de las historias arriba y la decisión
colgando de cada post —**Listo · Posponer · Mejorar · Descartar**, que son
cuatro de los siete estados del panel dichos como lo que uno hace—. No genera imágenes para descargar, no edita textos, no
tiene calendario: para eso está el kit de ADAR mientras siga en pie.

```
index.html · app.js · estilo.css   la app (solo móvil, 402×874)
motor.js                           el motor de dibujo del kit, traído tal cual
entrar.html                        la puerta: entrar con GitHub
middleware.js                      sin cookie firmada, no se entra
api/auth.js · api/callback.js      el relevo de OAuth, copiado de ADAR
render.html                        la misma página, sin interfaz: dibuja para publicar
datos/posts.json                   las fichas, generadas desde el repo de ADAR
datos/historico-ig.json            lo ya publicado en Instagram, con sus números
datos/miniaturas/                  las portadas de lo publicado, para la rejilla
etiquetas.json                     los tipos, los conciertos y qué lleva cada ficha
aprobaciones.json                  lo que se decide, lo escribe la propia app
construir-datos.mjs                rehace datos/posts.json
```

Cuando cambien las fichas en ADAR hay que rehacer los datos:

```sh
node construir-datos.mjs      # lee ../adar y escribe datos/posts.json
```

**El motor de dibujo salió del kit y ya ha crecido.** Las medidas y los
cuatro tipos de diapositiva vienen de `KitRedes.astro`, pero aquí dibuja en
**4:5 (1080×1350)** para Instagram y acepta el estilo desde fuera. Las dos
cosas hacían falta y el kit no las tiene, así que esto ya no es una copia que
seguir: es el motor bueno.

Por qué 4:5: la rejilla del perfil de Instagram es vertical y a una imagen
cuadrada le recorta 108 px por cada lado. El texto empezaba a 92 px, así que
el titular salía decapitado. Está medido, no supuesto.

**El estilo lo decide la etiqueta**, no el gusto del día: así la rejilla
tiene ritmo y de un vistazo se sabe qué es cada post.

| Etiqueta | Estilo |
|---|---|
| Concert, News, Program | cinta |
| Context | marco |
| Offer | bloque |
| Interview, Video, Recap | foto limpia |

Las etiquetas viven en `etiquetas.json` y se editan desde la app, incluidas
las nuevas.

## Publicar en Facebook e Instagram desde el chat. No tiene pantalla a propósito:
la herramienta la ejecuta Claude en la conversación, enseña lo que va a salir,
y solo publica cuando se le dice.

Las ideas salen del **kit de redes** del repositorio de ADAR, que se lee sin
tocarlo: ni el kit ni los archivos de revisión se modifican nunca desde aquí.

## Tres caminos

El que está en uso es el **conector de Metricool** en claude.ai: se activa en
la conversación y Claude llama a sus herramientas directamente, sin token ni
plan de pago. Entonces esta herramienta hace la mitad de delante —sacar la
idea del kit, componer el pie de cada red, repasarlo y enseñar el ensayo— y
el conector se encarga de mandarlo.

Los otros dos no necesitan conector y viven enteros aquí: la **API de
Metricool** y **Meta** directamente. Hacen lo mismo y comparten todo menos el
último paso.

|  | Metricool | Meta |
|---|---|---|
| Hace falta | token de la API de Metricool | app propia + token de Página |
| App Review | no | puede que sí |
| Cuándo sale | pasa por el planificador: «ahora» son unos minutos | en el acto |
| Imágenes | las copia él; vale png o jpg | solo JPEG por URL pública |
| Requisito | plan Advanced o Custom | nada |

Si no hay nada configurado se usa Meta; con `METRICOOL_TOKEN` puesto, Metricool.
`--via meta` o `--via metricool` manda sobre eso. El conector no se elige con
`--via`: no pasa por aquí.

## Metricool

El token está en **Configuración de la cuenta → API**. Hace falta también el
`userId`, que sale de la URL al abrir una marca. En los ajustes del entorno:

```
METRICOOL_TOKEN     el token de la API
METRICOOL_USER_ID   el número que va detrás de userId en la URL
METRICOOL_BLOG_ID   solo si el token alcanza más de una marca
```

`node publicar.mjs cuentas` dice qué marcas alcanza y qué redes tienen
conectadas.

Metricool **no publica en el acto**: todo pasa por su planificador. Sin
`--cuando`, la entrada se programa para dentro de cinco minutos con
autoPublish puesto, que es lo más cerca que se llega de publicar ya. Con
`--cuando 2026-10-20T09:30` se programa para esa hora, y con `--borrador` se
queda en el planificador sin salir.

Los planes Free y Starter no tienen API. Ahí el camino es el conector de
Metricool, que funciona con cualquier plan.

## Meta

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
hace falta pegarlo en el chat — y lo mismo vale para el de Metricool.

Opcionales, si el token alcanza más de una Página: `FB_PAGE_ID` y `IG_USER_ID`.
`node publicar.mjs cuentas` dice cuáles son.

## Cómo se usa

```sh
node publicar.mjs cuentas          # qué Página y qué Instagram alcanza el token
node publicar.mjs ideas --listas   # lo que el panel tiene marcado «listo»
node publicar.mjs ver en/currents  # la ficha y el pie que saldría en cada red

node publicar.mjs publicar --idea en/currents --red ambas        # ensayo
node publicar.mjs publicar --idea en/currents --red ambas --ya   # de verdad
node publicar.mjs publicar --idea en/currents --via metricool --cuando 2026-10-20T09:30 --ya

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

- **La imagen la dibuja el motor, y va el carrusel entero.** Al publicar una
  ficha se dibujan todas sus diapositivas en 1080×1350 para Instagram —el
  kit monta seis y antes salía solo la portada— y la portada en 1200×630 para
  Facebook. Con `--suelta` va una sola; con `--foto-pelada`, la foto de
  origen sin pasar por el motor.
- **La imagen siempre tiene que estar en una URL pública que no caduque.**
  Publicando contra Meta, además, solo vale JPEG: Meta va a buscarla al
  publicar. Metricool se la copia antes a su servidor y acepta más formatos.
  Las fotos del kit ya están servidas (el CDN de ADAR, creartbox.nyc) y valen
  tal cual. Para una imagen que esté solo en el portátil, `subir` la deja en
  `imagenes/` de este repositorio y devuelve su URL.
- **Instagram no publica sin imagen.** Facebook sí.
- El pie de cada red se compone con la misma receta que el kit
  (`lib/textos.mjs`). Es una copia escrita en Node, porque el kit vive en el
  navegador: si allí cambia la forma del pie, hay que cambiarla aquí también.
- Lo que el kit guarda en el navegador (textos corregidos a mano desde el
  panel) no se ve desde aquí; lo que se lee es el material del repositorio.
- **Solo se publica lo que esté en «listo».** Los otros seis estados del panel
  —idea, borrador, hay que cambiar algo, en espera, descartado, sin marcar—
  salen con un aviso delante. El estado lo decide él, no esto.
- Las fotos con ruta relativa (`/kit/…`) se resuelven contra festivaladar.com,
  que es desde donde el kit las sirve. Se cambia con `SITIO_KIT`.
- Cada publicación se anota en `registro.jsonl`. El estado del panel
  (`revisiones*.json`, en el repositorio de ADAR) no se toca.

## Los archivos

```
publicar.mjs      la línea de órdenes
lib/meta.mjs      Graph API: Facebook e Instagram
lib/metricool.mjs el planificador de Metricool
lib/ideas.mjs     lee el material del kit de redes (solo lectura)
lib/textos.mjs    el pie de cada red y los repasos previos
registro.jsonl    lo publicado desde aquí
```
