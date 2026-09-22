import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'http';
import { handleChatRequest, handleTTSRequest } from './src/server/apiHandler';

function apiServerPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'avatar-api-routes',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url?.split('?')[0];

        if (url === '/api/chat' || url === '/api/tts') {
          // Set CORS headers for local multi-port development (e.g. docs viewer on 8088)
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          if (req.method === 'POST') {
            let bodyStr = '';
            req.on('data', (chunk) => {
              bodyStr += chunk;
            });

            req.on('end', async () => {
              try {
                const body = bodyStr ? JSON.parse(bodyStr) : {};
                res.setHeader('Content-Type', 'application/json');

                if (url === '/api/chat') {
                  const response = await handleChatRequest(body, env);
                  res.writeHead(200);
                  res.end(JSON.stringify(response));
                } else if (url === '/api/tts') {
                  const response = await handleTTSRequest(body, env);
                  res.writeHead(200);
                  res.end(JSON.stringify(response));
                }
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Server error';
                console.error('[APIServerPlugin] Error handling request:', message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: message }));
              }
            });
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  return {
    plugins: [react(), apiServerPlugin(env)],
    server: {
      port: 5173,
      host: true,
    },
  };
});
