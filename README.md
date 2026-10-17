# social-publisher

Conector MCP mínimo para que Claude publique en LinkedIn, Facebook e Instagram desde el chat.
Una sola herramienta: `publish_post(network, text, image_url?)`. Se despliega gratis en Cloudflare Workers.

## 1. Desplegar (gratis)
1. Crea una cuenta en https://dash.cloudflare.com (plan Free).
2. En este repo: `npx wrangler login` y luego `npx wrangler deploy`.
3. Añade los secretos (te los pedirá uno a uno; no se guardan en el repo):
   ```
   npx wrangler secret put MCP_SECRET        # cadena larga aleatoria
   npx wrangler secret put META_PAGE_TOKEN
   npx wrangler secret put FACEBOOK_PAGE_ID
   npx wrangler secret put INSTAGRAM_ACCOUNT_ID
   npx wrangler secret put LINKEDIN_TOKEN
   npx wrangler secret put LINKEDIN_AUTHOR_URN
   ```
   Solo hacen falta los de las redes que vayas a usar.

## 2. Conectar a Claude
claude.ai → Ajustes → Conectores → Añadir conector personalizado →
URL: `https://social-publisher.<tu-subdominio>.workers.dev/mcp/<MCP_SECRET>`

La URL contiene el secreto: no la compartas.

## 3. Permisos por red

### Facebook Página + Instagram (una sola app de Meta)
1. Instagram debe ser cuenta **Business/Creator** y estar vinculada a tu Página de Facebook.
2. https://developers.facebook.com → Crear app (tipo "Business").
3. Graph API Explorer → selecciona tu app → pide permisos:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `instagram_basic`, `instagram_content_publish`, `business_management`.
4. Genera token de usuario → cámbialo por uno de larga duración (Herramienta de depuración de tokens → "Extender").
5. `GET /me/accounts` → copia el `access_token` y el `id` de tu Página → `META_PAGE_TOKEN` y `FACEBOOK_PAGE_ID`.
6. `GET /{page_id}?fields=instagram_business_account` → `INSTAGRAM_ACCOUNT_ID`.

Mientras seas admin de la app y de la Página, funciona en modo desarrollo sin revisión de Meta.

### LinkedIn (perfil personal)
1. https://developers.linkedin.com → Create app (necesita una Página de empresa asociada).
2. Pestaña Products → añade **Share on LinkedIn** y **Sign In with LinkedIn using OpenID Connect**.
3. Herramienta OAuth Token Generator con scopes `openid profile w_member_social` → `LINKEDIN_TOKEN` (dura 60 días).
4. `GET https://api.linkedin.com/v2/userinfo` con ese token → el campo `sub` → `LINKEDIN_AUTHOR_URN=urn:li:person:<sub>`.
