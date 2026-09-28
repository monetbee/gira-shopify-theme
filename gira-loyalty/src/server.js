import http from 'node:http';

const port = Number(process.env.PORT ?? 4100);

// Intentionally only a health endpoint. No Shopify endpoint, proxy, webhook,
// or customer mutation is exposed in this foundation phase.
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ service: 'gira-loyalty', status: 'ok' }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, () => console.info(`gira-loyalty listening on ${port}`));
