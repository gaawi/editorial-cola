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
 */
export const ESTILOS = ['cinta', 'bloque', 'marco', 'limpia'];

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
  function encajar(ctx, texto, maxW, maxH, peso, familia, inicio, minimo) {
    let size = inicio;
    while (size > minimo) {
      ctx.font = `${peso} ${size}px ${familia}`;
      const ls = partir(ctx, texto, maxW);
      if (ls.length * size * 1.32 <= maxH) return { size, lines: ls };
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
  async function foto(ctx, src, x, y, w, h, fx = 0.5, fy = 0.5) {
    if (!src) return false;
    try {
      const img = await cargarFoto(src);
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

    if (slide.type === 'cover') {
      ctx.fillStyle = B.ink; ctx.fillRect(0, 0, W, H);

      // La foto y nada más.
      if (estilo === 'limpia') {
        await foto(ctx, post.image, 0, 0, W, H);
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
        rotulo(ctx, rotSize, B.accent, Math.round(rotSize * 0.16));
        ctx.fillText(B.stamp, pad, bTop + rotSize);
        sinEspaciado(ctx);
        const bAvail = bandH - Math.round(pad * 0.75) - rotSize * 3.4 - safeBottom;
        const bfit = encajar(ctx, slide.title, W - pad * 2 - safeRight, bAvail, TW, DISPLAY, Math.round(W * 0.070), Math.round(W * 0.032));
        ctx.font = `${TW} ${bfit.size}px ${DISPLAY}`; ctx.fillStyle = B.paper;
        const byy = bTop + rotSize * 2.6 + bfit.size * 0.86;
        bfit.lines.forEach((l, i) => ctx.fillText(l, pad, byy + i * bfit.size * 1.12));
        rotulo(ctx, rotSize, rgba(B.paper, 0.6), 0);
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

        const mAvail = H - safeTop - safeBottom;
        const mfit = encajar(ctx, slide.title, W - pad * 2.4 - safeRight, mAvail * 0.44, TW, DISPLAY, Math.round(W * 0.078), Math.round(W * 0.034));
        ctx.textAlign = 'center';
        rotulo(ctx, rotSize, B.accent, Math.round(rotSize * 0.18));
        const mBlockH = rotSize * 2.6 + mfit.lines.length * mfit.size * 1.12;
        const mTop = safeTop + (mAvail - mBlockH) / 2;
        ctx.fillText(B.stamp, W / 2, mTop + rotSize);
        sinEspaciado(ctx);
        ctx.font = `${TW} ${mfit.size}px ${DISPLAY}`; ctx.fillStyle = B.overPhotoInk;
        const myy = mTop + rotSize * 2.6 + mfit.size * 0.86;
        mfit.lines.forEach((l, i) => ctx.fillText(l, W / 2, myy + i * mfit.size * 1.12));
        rotulo(ctx, rotSize, rgba(B.paper, 0.75), 0);
        ctx.fillText(B.site, W / 2, H - inset - Math.round(pad * 0.35) - safeBottom);
        ctx.textAlign = 'left';
        sinEspaciado(ctx);
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
      const fit = encajar(ctx, slide.title, W - pad * 2 - safeRight, maxTitleH, TW, DISPLAY, Math.round(W * 0.072), Math.round(W * 0.034));
      const lineH = Math.round(fit.size * 1.12);
      const baseY = H - pad - safeBottom;
      const startY = baseY - fit.lines.length * lineH + lineH * 0.8;

      ctx.fillStyle = B.accent;
      ctx.fillRect(pad, startY - lineH * 0.8 - Math.round(rotSize * 2.2), Math.round(W * 0.09), Math.max(3, Math.round(W * 0.005)));
      rotulo(ctx, rotSize, B.accent, Math.round(rotSize * 0.16));
      ctx.fillText(B.stamp, pad, startY - lineH * 0.8 - Math.round(rotSize * 0.75));
      sinEspaciado(ctx);

      ctx.font = `${TW} ${fit.size}px ${DISPLAY}`;
      ctx.fillStyle = B.overPhotoInk;
      fit.lines.forEach((l, i) => ctx.fillText(l, pad, startY + i * lineH));

      rotulo(ctx, rotSize, rgba(B.paper, 0.72), 0);
      ctx.fillText(B.site, pad, H - Math.round(pad * 0.4) - safeBottom);
      sinEspaciado(ctx);
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
      ctx.font = `400 ${cbf.size}px ${UI}`; ctx.fillStyle = rgba(B.paper, 0.9);
      const by = cTop + ruleH + gapRule + cTitleH + gapBody + cbf.size * 0.86;
      cbf.lines.forEach((l, i) => ctx.fillText(l, pad, by + i * cbf.size * 1.42));

      rotulo(ctx, rotSize, rgba(B.paper, 0.6), 0);
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
    const tCuerpo = estilo === 'bloque' ? rgba(B.paper, 0.88) : B.textBody;
    const tPie = estilo === 'bloque' ? rgba(B.paper, 0.55) : B.textFoot;
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
