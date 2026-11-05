const API_HOST = 'https://api.github.com';
const UPLOADS_HOST = 'https://uploads.github.com';
const REPO = 'CodeXyLabs/OpenMarket';

function withCors(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const path = url.pathname + url.search;
    const isUploads = path.startsWith('/uploads/');
    const apiPath = isUploads ? path.slice('/uploads'.length) : path;

    const allowed = apiPath.startsWith(`/repos/${REPO}`) || apiPath === '/user';
    if (!allowed) {
      return withCors(new Response(JSON.stringify({ error: 'path not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    const target = new URL((isUploads ? UPLOADS_HOST : API_HOST) + apiPath);
    const headers = new Headers();
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('User-Agent', 'OpenMarket-Worker');

    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    if (env.GITHUB_TOKEN) headers.set('Authorization', `Bearer ${env.GITHUB_TOKEN}`);

    const init = { method: request.method, headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const response = await fetch(target, init);
    return withCors(new Response(response.body, {
      status: response.status,
      headers: response.headers,
    }));
  },
};
