import re, html, json, urllib.request, urllib.parse, ssl, sys, os
BASE='https://creartbox.nyc/'
ctxs=ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
op=urllib.request.build_opener(urllib.request.ProxyHandler({'https':proxy,'http':proxy}) if proxy else urllib.request.BaseHandler(),
                               urllib.request.HTTPSHandler(context=ctxs))
op.addheaders=[('user-agent','Mozilla/5.0 Chrome/140')]

def get(u):
    try:
        with op.open(u, timeout=30) as r: return r.read().decode('utf8','replace')
    except Exception as e:
        print('  x', u, e, file=sys.stderr); return ''

vistas=set(); cola=[BASE]; imgs={}
while cola:
    u=cola.pop(0)
    if u in vistas or len(vistas)>80: continue
    vistas.add(u)
    s=get(u)
    if not s: continue
    for m in re.findall(r'(?:src|href|data-src|content)=["\']([^"\']+\.(?:jpg|jpeg|png|webp))["\']', s, re.I):
        a=urllib.parse.urljoin(u, html.unescape(m))
        if 'b-cdn.net' in a or 'creartbox.nyc' in a: imgs.setdefault(a, set()).add(u)
    for m in re.findall(r'href=["\']([^"\'#?]+\.html)["\']', s, re.I):
        a=urllib.parse.urljoin(u, html.unescape(m))
        if a.startswith(BASE) and a not in vistas: cola.append(a)

print(f'{len(vistas)} páginas, {len(imgs)} imágenes', file=sys.stderr)
json.dump({k:sorted(v) for k,v in sorted(imgs.items())}, open('banco-bruto.json','w'), indent=1)  # luego se limpia a datos/banco-fotos.json
