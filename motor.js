/* Motor de dibujo, traído del kit de redes de ADAR (components/KitRedes.astro).
 *
 * Es el mismo código y las mismas medidas: lo que se ve aquí es exactamente la
 * imagen que se publica. Lo que no ha venido son los estilos «bloque» y
 * «marco» y el formato de X, porque aquí solo se aprueba y se aprueba lo que
 * de verdad se manda: Instagram y Facebook, en estilo cinta.
 *
 * Si allí cambian las medidas, hay que traer el cambio. Es la única copia.
 */
export const TAMANOS = {
  // 4:5 y no cuadrado, a propósito. La rejilla del perfil de Instagram es
  // vertical: a una imagen cuadrada le recorta 108 px por cada lado, y el
  // titular empieza a 92 px, así que se decapita. Medido, no supuesto.
  ig: [1080, 1350],
  cuadrada: [1080, 1080],
  story: [1080, 1920],
  fb: [1200, 630],
};

/**
 * El estilo con que se dibuja cada diapositiva. No se elige a capricho: lo
 * decide para qué es el post, así la rejilla tiene ritmo y de un vistazo se
 * sabe qué es cada cosa.
 *   cinta   — filete de acento y texto sobre la foto. El de siempre.
 *   bloque  — banda sólida bajo la foto. Se lee como un aviso.
 *   marco   — foto a sangre, velo y recuadro. El texto centrado.
 *   limpia  — la foto y nada más. Para cuando la foto ya lo dice todo.
 *
 * Y cuatro que rompen la retícula a propósito. No se reparten por tipo: se
 * eligen ficha a ficha, porque uno solo en la pantalla es un golpe y tres
 * seguidos son un escándalo.
 *   cifra   — el dato ocupa la imagen. La foto es el fondo del número.
 *   cartel  — tipografía a tamaño de pared y un filo de foto abajo.
 *   duo     — la foto en blanco y negro y el titular sobre un panel ámbar.
 *   tabla   — el orden de la noche, compuesto. Cifras en versales tabulares.
 *   programa — la portada del cuadernillo de mano: todo centrado y el
 *              trapecio ámbar a sangre abajo. Es el único sitio donde hay
 *              dos ámbares en pantalla, porque así es su portada de verdad:
 *              el trapecio es superficie, no señal.
 *
 * Hubo una quinta, «franja», una banda ámbar cruzada a seis grados. Se
 * quitó: el manual dice «square everywhere, including buttons», y una banda
 * torcida es lo más lejos de eso que se puede llegar.
 *
 * Las tres reglas de creartbox.nyc/brand.html que mandan aquí:
 *   · Una señal por pantalla. El ámbar se usa UNA vez, en lo que hay que
 *     leer primero. Todo lo demás baja por la escala de papel.
 *   · Se apaga con tinta, no con alfa. Nada de rgba(papel, 0.6).
 *   · Los títulos van a 0,94 de interlineado. Es su firma tipográfica.
 */
export const ESTILOS = ['cinta', 'bloque', 'marco', 'limpia', 'cifra', 'cartel', 'duo', 'tabla', 'programa'];

/** El interlineado de los titulares, que el manual fija en 0,94. */
const PLOMO = 0.94;

export function crearMotor(B) {
  const DISPLAY = B.display;
  const UI = B.ui;
  const LABEL = B.label;
  const TW = B.titleWeight;

  function rgba(hex, a) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // La escala de papel del manual. Si una marca no la trae, se cae al tono
  // entero antes que a un alfa: el alfa es justo lo que se quiere evitar.
  const TINTA = B.sobreFoto || B.overPhotoInk;
  const TINTA_MEDIA = B.sobreFotoMedio || TINTA;
  const TINTA_DIM = B.sobreFotoDim || TINTA;
  const TINTA_MUDA = B.sobreFotoMudo || TINTA_DIM;
  const FILETE = B.filete || B.ink;

  function rotulo(ctx, size, color, spacing) {
    ctx.font = `${B.labelWeight} ${size}px ${LABEL}`;
    ctx.fillStyle = color;
    try { ctx.letterSpacing = (spacing || 0) + 'px'; } catch {}
  }
  function sinEspaciado(ctx) {
    try { ctx.letterSpacing = '0px'; } catch {}
  }

  function partir(ctx, texto, maxW) {
    const palabras = String(texto).split(/\s+/);
    const lineas = [];
    let linea = '';
    for (const p of palabras) {
      const prueba = linea ? linea + ' ' + p : p;
      if (ctx.measureText(prueba).width > maxW && linea) { lineas.push(linea); linea = p; }
      else linea = prueba;
    }
    if (linea) lineas.push(linea);
    return lineas;
  }

  /** Baja el cuerpo hasta que quepa en la caja. Igual que en el kit. */
  function encajar(ctx, texto, maxW, maxH, peso, familia, inicio, minimo, plomo = 1.32) {
    let size = inicio;
    while (size > minimo) {
      ctx.font = `${peso} ${size}px ${familia}`;
      const ls = partir(ctx, texto, maxW);
      if (ls.length * size * plomo <= maxH) return { size, lines: ls };
      size -= 2;
    }
    ctx.font = `${peso} ${minimo}px ${familia}`;
    return { size: minimo, lines: partir(ctx, texto, maxW) };
  }

  const cacheFotos = new Map();
  function cargarFoto(src) {
    if (cacheFotos.has(src)) return cacheFotos.get(src);
    const p = new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('no se pudo cargar la imagen'));
      img.src = src;
    });
    cacheFotos.set(src, p);
    return p;
  }

  let fuentesListas = null;
  function asegurarFuentes() {
    if (fuentesListas) return fuentesListas;
    fuentesListas = (async () => {
      if (!document.fonts || !document.fonts.load) return;
      try { await Promise.all((B.fontLoads || []).map((f) => document.fonts.load(f))); } catch {}
    })();
    return fuentesListas;
  }

  /** La foto recortada «cover» dentro de un rectángulo, sin salirse. */
  /**
   * Dónde está lo que hay que ver. Recortar siempre por el centro va bien
   * en 4:5 y fatal en 9:16: de una foto apaisada se queda una columna
   * estrecha, y en una foto de concierto esa columna suele ser pared negra.
   *
   * En un escenario lo que importa es lo que está iluminado, así que se
   * busca el centro de masas del brillo y se recorta por ahí. Si el servidor
   * de la foto no manda cabeceras CORS no se pueden leer los píxeles: en ese
   * caso se vuelve al centro, que es lo que había.
   */
  const focos = new Map();
  function focoDe(img) {
    const clave = img.src;
    if (focos.has(clave)) return focos.get(clave);
    let foco = { x: 0.5, y: 0.5 };
    try {
      const n = 48;
      const c = document.createElement('canvas');
      c.width = n; c.height = n;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, n, n);
      const d = cx.getImageData(0, 0, n, n).data;
      let sx = 0, sy = 0, total = 0;
      for (let i = 0; i < n * n; i++) {
        const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
        // Al cubo: así un foco de luz pesa mucho más que una pared gris y el
        // encuadre va al sujeto y no al promedio de la sala.
        const peso = l * l * l;
        sx += (i % n) * peso; sy += Math.floor(i / n) * peso; total += peso;
      }
      if (total > 0) {
        // Se tira hacia la luz solo a medias: entera se come los bordes.
        foco = {
          x: 0.5 + (sx / total / (n - 1) - 0.5) * 0.7,
          y: 0.5 + (sy / total / (n - 1) - 0.5) * 0.7,
        };
      }
    } catch { /* foto de otro dominio sin CORS: al centro */ }
    focos.set(clave, foco);
    return foco;
  }

  async function foto(ctx, src, x, y, w, h, fx, fy) {
    if (!src) return false;
    try {
      const img = await cargarFoto(src);
      if (fx === undefined || fy === undefined) {
        const f = focoDe(img);
        if (fx === undefined) fx = f.x;
        if (fy === undefined) fy = f.y;
      }
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const ox = Math.min(0, Math.max(w - dw, -(dw - w) * fx));
      const oy = Math.min(0, Math.max(h - dh, -(dh - h) * fy));
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.drawImage(img, x + ox, y + oy, dw, dh);
      ctx.restore();
      return true;
    } catch { return false; }
  }

  /**
   * Pasa a dos tintas lo que ya esté pintado en ese rectángulo: las sombras
   * al color oscuro y las luces al claro. Se hace con modos de fusión y no
   * con `ctx.filter` porque el filtro de canvas llegó tarde a WebKit y el
   * móvil desde el que se aprueba esto es un iPhone.
   *   «saturation» coge la saturación del origen —cero— y conserva la
   *   luminosidad de lo de abajo, así que deja la foto en gris.
   */
  function duotono(ctx, x, y, w, h, sombra, luz) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'hsl(0, 0%, 50%)'; ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = luz; ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = sombra; ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /** El cuerpo más grande con el que una sola línea cabe a lo ancho. */
  function aLoAncho(ctx, texto, maxW, maxH, peso, familia) {
    let size = Math.min(Math.round(maxW * 0.5), Math.round(maxH / 0.74));
    ctx.font = `${peso} ${size}px ${familia}`;
    while (ctx.measureText(texto).width > maxW && size > 24) {
      size -= 4;
      ctx.font = `${peso} ${size}px ${familia}`;
    }
    return size;
  }

  /**
   * Dibuja una diapositiva en el canvas que se le pase.
   * `fmt` es 'ig', 'story' o 'fb'; `post` trae la foto y `slide` el texto.
   */
  async function dibujar(canvas, post, slide, idx, total, fmt, estilo = 'cinta') {
    const [W, H] = TAMANOS[fmt];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    await asegurarFuentes();

    const pad = Math.round(W * 0.085);
    const rotSize = Math.max(13, Math.round(W * 0.019));
    // El 9:16 vale para Stories y para TikTok: el margen se calcula para la
    // peor de las dos interfaces, que es TikTok.
    const safeBottom = fmt === 'story' ? Math.round(H * 0.18) : 0;
    const safeTop = fmt === 'story' ? Math.round(H * 0.09) : 0;
    const safeRight = fmt === 'story' ? Math.round(W * 0.16) : 0;

    // Las pegatinas van encima de todo y solo en historias. En el muro no
    // pintan nada: una pegatina es de las que duran un día.
    function pegatinas() {
      if (fmt !== 'story' || !post.pegatinas || !post.pegatinas.length) return;
      const alto = Math.round(W * 0.075);
      const cuerpo = Math.round(alto * 0.42);
      let y = safeTop + Math.round(H * 0.055);
      for (const peg of post.pegatinas.slice(0, 2)) {
        const texto = String(peg.texto || peg).toUpperCase();
        const senal = peg.senal === true;
        rotulo(ctx, cuerpo, senal ? (B.onAccent || B.ink) : B.ink, Math.round(cuerpo * 0.16));
        const ancho = Math.round(ctx.measureText(texto).width + alto * 1.1);
        ctx.save();
        // Tres grados: lo justo para que se lea como algo pegado encima y no
        // como parte de la maqueta. Los bordes siguen rectos, que es la casa.
        ctx.translate(pad + ancho / 2, y + alto / 2);
        ctx.rotate((-3 * Math.PI) / 180);
        ctx.fillStyle = senal ? B.accent : B.paper;
        ctx.fillRect(-ancho / 2, -alto / 2, ancho, alto);
        ctx.fillStyle = senal ? (B.onAccent || B.ink) : B.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText(texto, -ancho / 2 + alto * 0.55, 1);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
        sinEspaciado(ctx);
        y += Math.round(alto * 1.35);
      }
    }

    if (slide.type === 'cover') {
      ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);

      // La foto y nada más.
      if (estilo === 'limpia') {
        await foto(ctx, post.image, 0, 0, W, H);
        pegatinas();
        return;
      }

      // Foto arriba, banda sólida abajo. Para fotos con mucho ruido.
      if (estilo === 'bloque') {
        const bandH = Math.round(H * (fmt === 'story' ? 0.42 : 0.46));
        await foto(ctx, post.image, 0, 0, W, H - bandH);
        ctx.fillStyle = B.ink; ctx.fillRect(0, H - bandH, W, bandH);
        ctx.fillStyle = B.accent;
        ctx.fillRect(0, H - bandH, W, Math.max(5, Math.round(W * 0.009)));

        const bTop = H - bandH + Math.round(pad * 0.75);
        rotulo(ctx, rotSize, TINTA_DIM, Math.round(rotSize * 0.16));
        ctx.fillText(B.stamp, pad, bTop + rotSize);
        sinEspaciado(ctx);
        const bAvail = bandH - Math.round(pad * 0.75) - rotSize * 3.4 - safeBottom;
        const bfit = encajar(ctx, slide.title, W - pad * 2 - safeRight, bAvail, TW, DISPLAY, Math.round(W * 0.070), Math.round(W * 0.032), PLOMO);
        ctx.font = `${TW} ${bfit.size}px ${DISPLAY}`; ctx.fillStyle = B.paper;
        const byy = bTop + rotSize * 2.6 + bfit.size * 0.86;
        bfit.lines.forEach((l, i) => ctx.fillText(l, pad, byy + i * bfit.size * PLOMO));
        rotulo(ctx, rotSize, TINTA_MUDA, 0);
        ctx.fillText(B.site, pad, H - Math.round(pad * 0.4) - safeBottom);
        sinEspaciado(ctx);
        return;
      }

      // Foto a sangre, velo y filete perimetral; el texto, centrado.
      if (estilo === 'marco') {
        await foto(ctx, post.image, 0, 0, W, H);
        ctx.fillStyle = rgba(B.ink, 0.52); ctx.fillRect(0, 0, W, H);
        const inset = Math.round(W * 0.05);
        ctx.strokeStyle = rgba(B.accent, 0.85);
        ctx.lineWidth = Math.max(2, Math.round(W * 0.0035));
        ctx.strokeRect(inset + safeTop * 0.2, inset + safeTop, W - inset * 2 - safeTop * 0.4, H - inset * 2 - safeTop - safeBottom);

        // Dentro del recuadro va el titular y nada más. El sello y el
        // dominio se quitaron a petición suya: ensuciaban la foto y la marca
        // ya se lee en el nombre de la cuenta, justo encima en el muro.
        const mAvail = H - safeTop - safeBottom;
        const mfit = encajar(ctx, slide.title, W - pad * 2.4 - safeRight, mAvail * 0.50, TW, DISPLAY, Math.round(W * 0.078), Math.round(W * 0.034), PLOMO);
        ctx.textAlign = 'center';
        const mBlockH = mfit.lines.length * mfit.size * PLOMO;
        const myy = safeTop + (mAvail - mBlockH) / 2 + mfit.size * 0.86;
        ctx.font = `${TW} ${mfit.size}px ${DISPLAY}`; ctx.fillStyle = B.overPhotoInk;
        mfit.lines.forEach((l, i) => ctx.fillText(l, W / 2, myy + i * mfit.size * PLOMO));
        ctx.textAlign = 'left';
        pegatinas();
        return;
      }

      // ── Los cuatro de riesgo ──────────────────────────────────────────

      // La cifra es el post. El titular no se dibuja: el número y su pie ya
      // lo dicen, y a tamaño de miniatura se lee un número antes que nada.
      if (estilo === 'cifra' && post.cifra) {
        await foto(ctx, post.image, 0, 0, W, H);
        // Dónde va el bloque. Lo decide la foto: si lo que hay que ver está
        // abajo —el público de una sala llena—, el número se sube y le deja
        // el sitio. Por defecto va abajo, que es lo habitual.
        const arriba = post.cifra.posicion === 'arriba';
        // Velo en degradado y no plano: se oscurece solo la mitad donde cae
        // el texto, y la otra respira.
        const vg = ctx.createLinearGradient(0, 0, 0, H);
        for (const [t, a] of [[0, 0.26], [0.38, 0.58], [1, 0.90]]) {
          vg.addColorStop(arriba ? 1 - t : t, rgba(B.ink, a));
        }
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

        const util = W - pad * 2 - safeRight;
        const valor = String(post.cifra.valor);
        // Grande hasta donde den el ancho y el alto: en 1200×630 manda el alto.
        const cs = aLoAncho(ctx, valor, util, H * 0.46, TW, DISPLAY);
        const pie = String(post.cifra.pie || '');
        const pf = encajar(ctx, pie, util, H * 0.22, '400', UI, Math.round(W * 0.046), Math.round(W * 0.028), 1.38);
        const pieH = pf.lines.length * pf.size * 1.38;

        // Hairline, no barra: el manual pone los filetes en 1px a su escala
        // de página (1120 de ancho), que aquí son tres.
        const ruleH2 = Math.max(2, Math.round(W * 0.0026));
        // El bloque se arma siempre igual —filete, rótulo, cifra, pie— y solo
        // cambia de dónde cuelga.
        const rotBase = arriba
          ? pad + safeTop + ruleH2 + Math.round(W * 0.030) + rotSize
          : H - pad - safeBottom - pieH - Math.round(W * 0.040) - Math.round(cs * 0.76) - Math.round(W * 0.034);
        const cifraBase = rotBase + Math.round(cs * 0.76) + Math.round(W * 0.034);

        // La única señal de la pantalla es el número. El filete y el rótulo
        // son filete y tinta dim: separan y sitúan, no gritan.
        ctx.fillStyle = FILETE;
        ctx.fillRect(pad, rotBase - rotSize - Math.round(W * 0.030), Math.round(W * 0.14), ruleH2);
        if (post.cifra.rotulo) {
          rotulo(ctx, rotSize, TINTA_DIM, Math.round(rotSize * 0.16));
          ctx.fillText(String(post.cifra.rotulo).toUpperCase(), pad, rotBase);
          sinEspaciado(ctx);
        }
        ctx.font = `${TW} ${cs}px ${DISPLAY}`; ctx.fillStyle = B.accent;
        ctx.fillText(valor, pad, cifraBase);
        ctx.font = `400 ${pf.size}px ${UI}`; ctx.fillStyle = B.overPhotoInk;
        const py = cifraBase + Math.round(W * 0.040) + pf.size * 0.86;
        pf.lines.forEach((l, i) => ctx.fillText(l, pad, py + i * pf.size * 1.38));
        pegatinas();
        return;
      }

      // Cartel: la tipografía a tamaño de pared, apoyada en un filo de foto.
      // Es el único que no enseña la foto entera, y por eso no puede ir en
      // dos fichas seguidas.
      if (estilo === 'cartel') {
        ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);
        // Sin foto es un cartel de pared de verdad: solo tipografía. Con
        // foto, un filo abajo. Lo decide la ficha trayendo imagen o no.
        const lineas = (post.cartel && post.cartel.lineas) || [];
        const conFoto = Boolean(post.image);
        const filo = Math.max(5, Math.round(W * 0.009));
        const tira = conFoto ? Math.round(H * (fmt === 'fb' ? 0.26 : 0.20)) : 0;
        if (conFoto) {
          await foto(ctx, post.image, 0, H - tira, W, tira);
          ctx.fillStyle = B.accent; ctx.fillRect(0, H - tira - filo, W, filo);
        }

        const arriba = pad + safeTop;
        rotulo(ctx, rotSize, TINTA_DIM, Math.round(rotSize * 0.16));
        ctx.fillText(B.stamp, pad, arriba + rotSize);
        sinEspaciado(ctx);

        // Las líneas de abajo (fecha, hora, sitio) se reservan su sitio antes
        // de que el titular decida cuánto ocupa.
        // Las líneas se encogen hasta que la más larga entra de margen a
        // margen: una fecha cortada por la derecha no es un cartel.
        let lf = Math.round(W * 0.040);
        if (lineas.length) {
          const anchoUtil = W - pad * 2 - safeRight;
          while (lf > Math.round(W * 0.024)) {
            ctx.font = `400 ${lf}px ${UI}`;
            if (lineas.every((l) => ctx.measureText(String(l)).width <= anchoUtil)) break;
            lf -= 1;
          }
        }
        const altoLineas = lineas.length ? lineas.length * lf * 1.46 + Math.round(W * 0.05) : 0;
        const techo = arriba + rotSize * 2.4;
        const suelo = (conFoto ? H - tira - filo : H - safeBottom - Math.round(pad * 0.9))
          - Math.round(pad * 0.7) - altoLineas;
        const cf = encajar(ctx, slide.title, W - pad * 2 - safeRight, suelo - techo, TW, DISPLAY, Math.round(W * 0.145), Math.round(W * 0.050), PLOMO);
        ctx.font = `${TW} ${cf.size}px ${DISPLAY}`; ctx.fillStyle = B.paper;
        const cy = suelo - cf.lines.length * cf.size * PLOMO + cf.size * 0.82;
        cf.lines.forEach((l, i) => ctx.fillText(l, pad, cy + i * cf.size * PLOMO));

        if (lineas.length) {
          // Un filete de señal separa el titular de los datos. Es el único
          // ámbar de la pantalla cuando no hay foto debajo.
          const alto = Math.max(4, Math.round(W * 0.007));
          let ly = suelo + Math.round(W * 0.050);
          if (!conFoto) {
            ctx.fillStyle = B.accent;
            ctx.fillRect(pad, suelo + Math.round(W * 0.022), Math.round(W * 0.16), alto);
          }
          ctx.font = `400 ${lf}px ${UI}`;
          lineas.forEach((l, i) => {
            ctx.fillStyle = i === 0 ? B.paper : TINTA_MEDIA;
            ctx.fillText(String(l), pad, ly + lf * 0.9 + i * lf * 1.46);
          });
        }
        return;
      }

      // Foto a dos tintas y el titular en negro sobre un panel de señal que
      // se sale por la izquierda y se queda corto por la derecha. La única
      // señal de la pantalla es ese panel, así que la foto va sin color.
      if (estilo === 'duo') {
        ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);
        await foto(ctx, post.image, 0, 0, W, H);
        duotono(ctx, 0, 0, W, H, B.ink, B.paper);

        const panelW = Math.round(W * 0.86);
        const df = encajar(ctx, slide.title, panelW - pad * 1.8, H * 0.30, TW, DISPLAY, Math.round(W * 0.080), Math.round(W * 0.038), PLOMO);
        // El antetítulo, si lo hay: «Did you know?» en versalitas de rótulo
        // encima del titular, dentro del mismo panel. Sigue siendo una sola
        // señal, porque la señal es el panel entero.
        const kick = post.kicker ? String(post.kicker).toUpperCase() : '';
        const kickH = kick ? Math.round(rotSize * 2.1) : 0;
        const panelH = Math.round(kickH + df.lines.length * df.size * PLOMO + pad * 1.4);
        const panelY = H - safeBottom - Math.round(pad * 0.7) - panelH;
        ctx.fillStyle = B.accent; ctx.fillRect(0, panelY, panelW, panelH);
        let dy = panelY + Math.round(pad * 0.7);
        if (kick) {
          rotulo(ctx, rotSize, B.onAccent || B.ink, Math.round(rotSize * 0.16));
          ctx.fillText(kick, pad, dy + rotSize);
          sinEspaciado(ctx);
          dy += kickH;
        }
        ctx.font = `${TW} ${df.size}px ${DISPLAY}`; ctx.fillStyle = B.onAccent || B.ink;
        dy += df.size * 0.84;
        df.lines.forEach((l, i) => ctx.fillText(l, pad, dy + i * df.size * PLOMO));
        pegatinas();
        return;
      }

      // El orden de la noche, compuesto. No es una foto con texto encima:
      // es un documento, y por eso va sobre --foso en vez de sobre sala.
      // Autor en versalitas de rótulo, obra en Literata cursiva porque el
      // manual pide cursiva en los títulos de obra, y duración a la derecha.
      if (estilo === 'tabla' && post.tabla) {
        ctx.fillStyle = B.textBg || B.ink; ctx.fillRect(0, 0, W, H);
        const filas = post.tabla.filas || [];
        const hair = Math.max(2, Math.round(W * 0.0026));
        const util = W - pad * 2 - safeRight;
        const colCifra = W - pad - safeRight;

        let y = pad + safeTop + rotSize;
        if (post.tabla.rotulo) {
          rotulo(ctx, rotSize, TINTA_DIM, Math.round(rotSize * 0.16));
          ctx.fillText(String(post.tabla.rotulo).toUpperCase(), pad, y);
          sinEspaciado(ctx);
        }

        y += Math.round(W * 0.040);
        const tf = encajar(ctx, slide.title, util, H * 0.20, TW, DISPLAY, Math.round(W * 0.064), Math.round(W * 0.036), PLOMO);
        ctx.font = `${TW} ${tf.size}px ${DISPLAY}`; ctx.fillStyle = B.paper;
        tf.lines.forEach((l, i) => ctx.fillText(l, pad, y + tf.size * 0.82 + i * tf.size * PLOMO));
        y += tf.lines.length * tf.size * PLOMO + Math.round(W * 0.034);

        // La única señal: el filete bajo el titular. De ahí para abajo, pelo.
        ctx.fillStyle = B.accent;
        ctx.fillRect(pad, y, Math.round(W * 0.16), Math.max(3, Math.round(W * 0.005)));
        y += Math.round(W * 0.046);

        // Las filas se reparten lo que queda, con su propio aire.
        const pie = rotSize * 2.2;
        const libre = H - safeBottom - Math.round(pad * 0.8) - pie - y;
        // Las filas se comen lo que hay: una tabla con un palmo de hueco
        // debajo parece que se ha quedado a medias. Tope alto para que en
        // 1200×630 no se estiren hasta deformarse.
        const alto = Math.min(Math.round(W * 0.145), Math.floor(libre / Math.max(1, filas.length + (post.tabla.total ? 1 : 0))));
        const quienS = Math.max(12, Math.round(alto * 0.20));

        // La columna de duraciones tiene calle propia: se mide la más ancha
        // y el título de obra se compone en lo que queda. Un cuerpo para
        // todas las filas, el mayor con el que entra la obra más larga; por
        // fila quedaría disparejo y una tabla despareja no es una tabla.
        let obraS = Math.round(alto * 0.335);
        const minObra = Math.round(alto * 0.20);
        const todas = filas.map((f) => String(f.cifra))
          .concat(post.tabla.total ? [String(post.tabla.total.cifra)] : []);
        const anchoObra = () => {
          ctx.font = `600 ${obraS}px ${UI}`;
          const calle = Math.max(...todas.map((c) => ctx.measureText(c).width)) + Math.round(W * 0.045);
          return util - calle;
        };
        while (obraS > minObra) {
          const disp = anchoObra();
          ctx.font = `italic 400 ${obraS}px ${DISPLAY}`;
          if (filas.every((f) => ctx.measureText(f.que).width <= disp)) break;
          obraS -= 2;
        }
        const anchoDisp = anchoObra();

        const linea = (quien, obra, cifra, tono, pesoObra) => {
          ctx.fillStyle = FILETE; ctx.fillRect(pad, y, util, hair);
          const base = y + alto * 0.52;
          rotulo(ctx, quienS, TINTA_DIM, Math.round(quienS * 0.16));
          ctx.fillText(String(quien).toUpperCase(), pad, base - obraS * 0.72);
          sinEspaciado(ctx);
          ctx.font = `${pesoObra} ${obraS}px ${DISPLAY}`; ctx.fillStyle = tono;
          // Si aun así una obra se pasa, se aprieta a su calle en vez de
          // meterse en la de la cifra. Nunca se corta un título de obra.
          ctx.fillText(obra, pad, base + obraS * 0.44, anchoDisp);
          // La duración, a la derecha y en la de texto: son cifras tabulares.
          ctx.font = `500 ${Math.round(obraS * 0.86)}px ${UI}`;
          ctx.textAlign = 'right';
          ctx.fillText(cifra, colCifra, base + obraS * 0.44);
          ctx.textAlign = 'left';
          y += alto;
        };

        for (const f of filas) linea(f.quien, f.que, f.cifra, B.paper, `italic 400`);
        if (post.tabla.total) {
          ctx.fillStyle = FILETE; ctx.fillRect(pad, y, util, hair);
          const base = y + alto * 0.52;
          rotulo(ctx, quienS, TINTA_DIM, Math.round(quienS * 0.16));
          ctx.fillText(String(post.tabla.total.que).toUpperCase(), pad, base + obraS * 0.10);
          ctx.textAlign = 'right';
          ctx.font = `600 ${obraS}px ${UI}`; ctx.fillStyle = B.paper;
          ctx.fillText(post.tabla.total.cifra, colCifra, base + obraS * 0.10);
          ctx.textAlign = 'left';
          sinEspaciado(ctx);
          y += alto;
        }

        rotulo(ctx, rotSize, TINTA_MUDA, 0);
        ctx.fillText(B.site, pad, H - Math.round(pad * 0.5) - safeBottom);
        sinEspaciado(ctx);
        return;
      }

      // La portada del cuadernillo. Medidas tomadas de
      // downloads/currents-2026-program.pdf: el trapecio ocupa el tercio de
      // abajo, entra un 16% por cada lado arriba y se abre hasta un 4%
      // abajo, donde sangra.
      if (estilo === 'programa') {
        ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);
        const tr = post.trapecio || {};
        const util = W - pad * 2 - safeRight;
        const centro = (W - safeRight) / 2;
        ctx.textAlign = 'center';

        const trH = Math.round(H * (fmt === 'story' ? 0.26 : 0.31));
        const trY = H - safeBottom - trH;

        let y = pad + safeTop + rotSize;
        rotulo(ctx, rotSize, B.paper, Math.round(rotSize * 0.2));
        ctx.fillText(B.stamp, centro, y);
        sinEspaciado(ctx);

        if (post.kicker) {
          y += Math.round(H * 0.055);
          rotulo(ctx, Math.round(rotSize * 0.92), B.accent, Math.round(rotSize * 0.22));
          ctx.fillText(String(post.kicker).toUpperCase(), centro, y);
          sinEspaciado(ctx);
        }

        const lineas = (post.cartel && post.cartel.lineas) || [];
        let lf = Math.round(W * 0.036);
        while (lf > Math.round(W * 0.022)) {
          ctx.font = `400 ${lf}px ${UI}`;
          if (lineas.every((l) => ctx.measureText(String(l)).width <= util)) break;
          lf -= 1;
        }
        const altoLineas = lineas.length * lf * 1.5;

        const techo = y + Math.round(H * 0.045);
        const suelo = trY - Math.round(H * 0.05) - altoLineas;
        const pf = encajar(ctx, slide.title, util, Math.max(1, suelo - techo), TW, DISPLAY, Math.round(W * 0.155), Math.round(W * 0.055), PLOMO);
        ctx.font = `${TW} ${pf.size}px ${DISPLAY}`; ctx.fillStyle = B.paper;
        const py2 = techo + (suelo - techo - pf.lines.length * pf.size * PLOMO) / 2 + pf.size * 0.82;
        pf.lines.forEach((l, i) => ctx.fillText(l, centro, py2 + i * pf.size * PLOMO));

        ctx.font = `400 ${lf}px ${UI}`;
        lineas.forEach((l, i) => {
          ctx.fillStyle = i === 0 ? B.paper : TINTA_DIM;
          ctx.fillText(String(l), centro, suelo + lf * 0.9 + i * lf * 1.5);
        });

        // El trapecio. Se abre hacia abajo y sangra por abajo.
        const dentroArriba = Math.round(W * 0.16);
        const dentroAbajo = Math.round(W * 0.04);
        ctx.beginPath();
        ctx.moveTo(dentroArriba, trY);
        ctx.lineTo(W - dentroArriba, trY);
        ctx.lineTo(W - dentroAbajo, H);
        ctx.lineTo(dentroAbajo, H);
        ctx.closePath();
        ctx.fillStyle = B.accent; ctx.fill();

        const tinta = B.onAccent || B.ink;
        let ty2 = trY + Math.round(trH * 0.22);
        if (tr.rotulo) {
          rotulo(ctx, Math.round(rotSize * 1.15), tinta, Math.round(rotSize * 0.26));
          ctx.fillText(String(tr.rotulo).toUpperCase(), centro, ty2);
          sinEspaciado(ctx);
        }
        if (tr.sub) {
          ty2 += Math.round(trH * 0.14);
          ctx.font = `400 ${Math.round(W * 0.028)}px ${UI}`; ctx.fillStyle = tinta;
          ctx.fillText(String(tr.sub), centro, ty2);
        }
        if (tr.titulo) {
          ty2 += Math.round(trH * 0.26);
          ctx.font = `${TW} ${Math.round(W * 0.062)}px ${DISPLAY}`; ctx.fillStyle = tinta;
          ctx.fillText(String(tr.titulo), centro, ty2);
        }
        if (tr.pie) {
          ty2 += Math.round(trH * 0.17);
          rotulo(ctx, Math.round(rotSize * 1.05), tinta, Math.round(rotSize * 0.24));
          const t = String(tr.pie).toUpperCase();
          ctx.fillText(t, centro, ty2);
          // Los dos filetes a los lados, como en la portada.
          const w2 = ctx.measureText(t).width;
          const raya = Math.round(W * 0.055);
          const hueco = Math.round(W * 0.022);
          ctx.fillRect(centro - w2 / 2 - hueco - raya, ty2 - Math.round(rotSize * 0.3), raya, 2);
          ctx.fillRect(centro + w2 / 2 + hueco, ty2 - Math.round(rotSize * 0.3), raya, 2);
          sinEspaciado(ctx);
        }

        ctx.textAlign = 'left';
        pegatinas();
        return;
      }

      await foto(ctx, post.image, 0, 0, W, H);
      const gTop = fmt === 'story' ? H * 0.42 : H * 0.32;
      const g = ctx.createLinearGradient(0, gTop, 0, H);
      g.addColorStop(0, rgba(B.ink, 0));
      g.addColorStop(0.55, rgba(B.ink, 0.72));
      g.addColorStop(1, rgba(B.ink, 0.94));
      ctx.fillStyle = g; ctx.fillRect(0, gTop, W, H - gTop);

      const maxTitleH = H * (fmt === 'story' ? 0.30 : 0.34);
      const fit = encajar(ctx, slide.title, W - pad * 2 - safeRight, maxTitleH, TW, DISPLAY, Math.round(W * 0.072), Math.round(W * 0.034), PLOMO);
      const lineH = Math.round(fit.size * PLOMO);
      const baseY = H - pad - safeBottom;
      const startY = baseY - fit.lines.length * lineH + lineH * 0.8;

      ctx.fillStyle = B.accent;
      ctx.fillRect(pad, startY - lineH * 0.8 - Math.round(rotSize * 2.2), Math.round(W * 0.09), Math.max(3, Math.round(W * 0.005)));
      // Una señal por pantalla: la lleva el filete. El sello baja a dim.
      rotulo(ctx, rotSize, TINTA_DIM, Math.round(rotSize * 0.16));
      ctx.fillText(B.stamp, pad, startY - lineH * 0.8 - Math.round(rotSize * 0.75));
      sinEspaciado(ctx);

      ctx.font = `${TW} ${fit.size}px ${DISPLAY}`;
      ctx.fillStyle = B.overPhotoInk;
      fit.lines.forEach((l, i) => ctx.fillText(l, pad, startY + i * lineH));

      rotulo(ctx, rotSize, TINTA_MUDA, 0);
      ctx.fillText(B.site, pad, H - Math.round(pad * 0.4) - safeBottom);
      sinEspaciado(ctx);
      pegatinas();
      return;
    }

    // Las de texto, cita y cierre centran su bloque en la zona segura.
    const footY = H - Math.round(pad * 0.45) - safeBottom;
    const areaTop = pad + safeTop;
    const areaH = footY - rotSize * 2.4 - areaTop;
    const maxW = W - pad * 2 - safeRight;
    const ruleH = Math.max(4, Math.round(W * 0.007));
    const gapRule = Math.round(W * 0.032);
    const gapBody = Math.round(W * 0.038);

    if (slide.type === 'cta') {
      ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);
      const cf = encajar(ctx, slide.title, maxW, areaH * 0.42, TW, DISPLAY, Math.round(W * 0.10), Math.round(W * 0.05));
      const cbf = encajar(ctx, slide.body, maxW, areaH * 0.34, '400', UI, Math.round(W * 0.042), Math.round(W * 0.026));
      const cTitleH = cf.lines.length * cf.size * 1.12;
      const cBodyH = cbf.lines.length * cbf.size * 1.42;
      const cTop = areaTop + Math.max(0, (areaH - (ruleH + gapRule + cTitleH + gapBody + cBodyH)) / 2);

      ctx.fillStyle = B.accent;
      ctx.fillRect(pad, cTop, Math.round(W * 0.16), ruleH);
      ctx.font = `${TW} ${cf.size}px ${DISPLAY}`; ctx.fillStyle = B.ctaInk;
      const cy = cTop + ruleH + gapRule + cf.size * 0.86;
      cf.lines.forEach((l, i) => ctx.fillText(l, pad, cy + i * cf.size * 1.12));
      ctx.font = `400 ${cbf.size}px ${UI}`; ctx.fillStyle = TINTA_MEDIA;
      const by = cTop + ruleH + gapRule + cTitleH + gapBody + cbf.size * 0.86;
      cbf.lines.forEach((l, i) => ctx.fillText(l, pad, by + i * cbf.size * 1.42));

      rotulo(ctx, rotSize, TINTA_MUDA, 0);
      ctx.fillText(B.site, pad, footY);
      sinEspaciado(ctx);
      return;
    }

    if (slide.type === 'quote') {
      ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);
      const qf = encajar(ctx, slide.body || slide.title, maxW, areaH * 0.62, TW, DISPLAY, Math.round(W * 0.072), Math.round(W * 0.036));
      const qH = qf.lines.length * qf.size * 1.16;
      const markSize = Math.round(W * 0.20);
      const qTop = areaTop + Math.max(0, (areaH - (markSize * 0.42 + qH)) / 2);

      ctx.font = `${TW} ${markSize}px ${DISPLAY}`;
      ctx.fillStyle = rgba(B.accent, 0.22);
      ctx.fillText('“', pad - Math.round(W * 0.012), qTop + markSize * 0.62);

      ctx.font = `${TW} ${qf.size}px ${DISPLAY}`; ctx.fillStyle = B.paper;
      const qy = qTop + markSize * 0.42 + qf.size * 0.86;
      qf.lines.forEach((l, i) => ctx.fillText(l, pad, qy + i * qf.size * 1.16));

      rotulo(ctx, rotSize, B.accent, Math.round(rotSize * 0.12));
      ctx.fillText(`${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, pad, footY);
      sinEspaciado(ctx);
      return;
    }

    // type === 'text'
    const tBg = estilo === 'bloque' ? B.ink : B.textBg;
    const tTitulo = estilo === 'bloque' ? B.paper : B.textTitle;
    const tCuerpo = estilo === 'bloque' ? TINTA_MEDIA : B.textBody;
    const tPie = estilo === 'bloque' ? TINTA_MUDA : B.textFoot;
    ctx.fillStyle = tBg; ctx.fillRect(0, 0, W, H);
    if (estilo === 'marco') {
      const tInset = Math.round(W * 0.05);
      ctx.strokeStyle = rgba(B.accent, 0.9);
      ctx.lineWidth = Math.max(2, Math.round(W * 0.0035));
      ctx.strokeRect(tInset, tInset + safeTop, W - tInset * 2, H - tInset * 2 - safeTop - safeBottom);
    }
    const tf = encajar(ctx, slide.title, maxW, areaH * 0.34, TW, DISPLAY, Math.round(W * 0.066), Math.round(W * 0.036));
    const tTitleH = tf.lines.length * tf.size * 1.12;
    const bf = encajar(ctx, slide.body, maxW, areaH - tTitleH - ruleH - gapRule - gapBody, '400', UI, Math.round(W * 0.042), Math.round(W * 0.024));
    const tBodyH = bf.lines.length * bf.size * 1.42;
    const tTop = areaTop + Math.max(0, (areaH - (ruleH + gapRule + tTitleH + gapBody + tBodyH)) / 2);

    ctx.fillStyle = B.accent;
    ctx.fillRect(pad, tTop, Math.round(W * 0.12), ruleH);
    ctx.font = `${TW} ${tf.size}px ${DISPLAY}`; ctx.fillStyle = tTitulo;
    const ty = tTop + ruleH + gapRule + tf.size * 0.86;
    tf.lines.forEach((l, i) => ctx.fillText(l, pad, ty + i * tf.size * 1.12));
    ctx.font = `400 ${bf.size}px ${UI}`; ctx.fillStyle = tCuerpo;
    const bodyTop = tTop + ruleH + gapRule + tTitleH + gapBody + bf.size * 0.86;
    bf.lines.forEach((l, i) => ctx.fillText(l, pad, bodyTop + i * bf.size * 1.42));

    rotulo(ctx, rotSize, tPie, Math.round(rotSize * 0.12));
    ctx.fillText(`${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, pad, footY);
    ctx.textAlign = 'right';
    ctx.fillText(B.stamp, W - pad, footY);
    ctx.textAlign = 'left';
    sinEspaciado(ctx);
  }

  return { dibujar, asegurarFuentes, TAMANOS, ESTILOS };
}
