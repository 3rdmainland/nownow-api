/**
 * Simple round-robin load balancer proxy
 * Simulates an ALB distributing traffic across multiple API instances
 */
import http from 'node:http';

const PORTS = (process.env.BACKEND_PORTS || '3101,3102,3103').split(',').map(Number);
const PROXY_PORT = Number(process.env.PROXY_PORT || 3098);

let currentIndex = 0;

function getNextBackend(): number {
    const port = PORTS[currentIndex % PORTS.length];
    currentIndex++;
    return port;
}

const server = http.createServer((clientReq, clientRes) => {
    const backendPort = getNextBackend();

    const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: backendPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: {
            ...clientReq.headers,
            'x-forwarded-for': clientReq.socket.remoteAddress || '127.0.0.1',
            'x-forwarded-port': String(PROXY_PORT),
        },
    };

    const proxyReq = http.request(options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', () => {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ error: `Backend on port ${backendPort} unavailable` }));
    });

    clientReq.pipe(proxyReq, { end: true });
});

server.listen(PROXY_PORT, () => {
    console.log(`ALB proxy listening on :${PROXY_PORT} → backends: ${PORTS.join(', ')}`);
});
