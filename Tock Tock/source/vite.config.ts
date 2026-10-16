import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages sert le site sous /<nom-du-depot>/ : on utilise une base relative et un routage par « # »,
// donc aucune configuration de redirection serveur n'est nécessaire.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
});
