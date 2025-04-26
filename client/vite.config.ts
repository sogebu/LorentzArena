import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'src',
    server: {
      port: 3000,
    },
    define: {
      'process.env.VITE_SIGNALING_SERVER_URL': JSON.stringify(env.VITE_SIGNALING_SERVER_URL),
    },
  };
});
