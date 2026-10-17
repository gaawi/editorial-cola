// Servidor MCP mínimo (Cloudflare Worker) con una herramienta: publish_post.
const GRAPH = "https://graph.facebook.com/v23.0";

const TOOL = {
  name: "publish_post",
  description:
    "Publica un post en una red social. Instagram requiere image_url. Confirma siempre el texto con el usuario antes de publicar.",
  inputSchema: {
    type: "object",
    properties: {
      network: { type: "string", enum: ["linkedin", "facebook", "instagram"] },
      text: { type: "string", description: "Texto del post" },
      image_url: { type: "string", description: "URL pública de una imagen (opcional salvo en Instagram)" },
    },
    required: ["network", "text"],
  },
};

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return { res, data: text ? JSON.parse(text) : {} };
}

const publishers = {
  async linkedin(env, { text }) {
    if (!env.LINKEDIN_TOKEN) throw new Error("Falta LINKEDIN_TOKEN");
    const { res } = await post(
      "https://api.linkedin.com/rest/posts",
      {
        author: env.LINKEDIN_AUTHOR_URN,
        commentary: text,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
      {
        Authorization: `Bearer ${env.LINKEDIN_TOKEN}`,
        "LinkedIn-Version": env.LINKEDIN_VERSION || "202609",
        "X-Restli-Protocol-Version": "2.0.0",
      }
    );
    return `Publicado en LinkedIn: ${res.headers.get("x-restli-id")}`;
  },

  async facebook(env, { text, image_url }) {
    if (!env.META_PAGE_TOKEN) throw new Error("Falta META_PAGE_TOKEN");
    const page = env.FACEBOOK_PAGE_ID;
    const token = env.META_PAGE_TOKEN;
    const { data } = image_url
      ? await post(`${GRAPH}/${page}/photos`, { url: image_url, caption: text, access_token: token })
      : await post(`${GRAPH}/${page}/feed`, { message: text, access_token: token });
    return `Publicado en Facebook: ${data.post_id || data.id}`;
  },

  async instagram(env, { text, image_url }) {
    if (!env.META_PAGE_TOKEN) throw new Error("Falta META_PAGE_TOKEN");
    if (!image_url) throw new Error("Instagram requiere image_url");
    const ig = env.INSTAGRAM_ACCOUNT_ID;
    const token = env.META_PAGE_TOKEN;
    const { data: media } = await post(`${GRAPH}/${ig}/media`, { image_url, caption: text, access_token: token });
    const { data } = await post(`${GRAPH}/${ig}/media_publish`, { creation_id: media.id, access_token: token });
    return `Publicado en Instagram: ${data.id}`;
  },
};

async function handle(env, msg) {
  const { method, params } = msg;
  if (method === "initialize")
    return {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "social-publisher", version: "0.1.0" },
    };
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: [TOOL] };
  if (method === "tools/call") {
    const args = params.arguments || {};
    const publish = publishers[args.network];
    try {
      if (!publish) throw new Error(`Red no soportada: ${args.network}`);
      return { content: [{ type: "text", text: await publish(env, args) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
  throw Object.assign(new Error(`Método no soportado: ${method}`), { code: -32601 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.MCP_SECRET || url.pathname !== `/mcp/${env.MCP_SECRET}`) return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const msg = await request.json();
    if (msg.id === undefined) return new Response(null, { status: 202 }); // notificación
    let reply;
    try {
      reply = { jsonrpc: "2.0", id: msg.id, result: await handle(env, msg) };
    } catch (e) {
      reply = { jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32603, message: e.message } };
    }
    return Response.json(reply);
  },
};
