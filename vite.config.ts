import { defineConfig, loadEnv } from 'vite';
import { realmApi } from './server/plugin';

export default defineConfig(({ mode }) => {
  // '' prefix: load every variable from .env / .env.local — they stay in this Node process.
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [realmApi(env)] };
});
