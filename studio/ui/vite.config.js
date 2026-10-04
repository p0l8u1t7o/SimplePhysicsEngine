// vs3d 網頁介面：npm run build 輸出到 dist/，由 vs3d ui 的伺服器提供；開發時 npm run dev 會把 /api、/files 轉給 vs3d ui（8780）
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8780', '/files': 'http://127.0.0.1:8780' } },
});
