import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Browser → DeepL is blocked by CORS, so dev requests go through Vite's
// dev-server proxy at `/api/deepl/*` → `<target>/*`. The target defaults to
// the Free tier; Pro users override with `DEEPL_API_TARGET=https://api.deepl.com`
// in `apps/app/.env.local`. Production deployments need their own
// same-origin proxy (Cloudflare Worker, nginx, …); see ARCHITECTURE.md §4.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const deeplTarget = env.DEEPL_API_TARGET ?? 'https://api-free.deepl.com';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/deepl': {
          target: deeplTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/deepl/, ''),
        },
      },
    },
  };
});
