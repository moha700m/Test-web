import { waitUntil } from '@vercel/functions';
import { handleApi } from '../worker/api.js';
import { postgresDb } from './postgres-db.js';
const db = postgresDb();
export function vercelHandler(route) { return {
  async fetch(request) {
    const url = new URL(request.url);
    url.pathname = "/api/" + route;
    const routed = new Request(url, request);
    try {
      return await handleApi(routed, { DB: db }, { waitUntil }) || new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('WebsiteCheck database or function failure:', error.code || error.name);
      return Response.json({ error: 'تعذر تشغيل الخدمة. تحقق من إعداد قاعدة البيانات.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
}; }
