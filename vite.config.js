import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
    allowedHosts: true
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Name lazily loaded level chunks after their level (src/levels/<id>/index.js).
        chunkFileNames: (chunk) => {
          const level = chunk.facadeModuleId?.match(/src\/levels\/([^/]+)\/index\.js$/)?.[1];
          return level ? `assets/level-${level}-[hash].js` : 'assets/[name]-[hash].js';
        },
        manualChunks: {
          three: ['three'],
          'three-postprocessing': [
            'three/addons/postprocessing/EffectComposer.js',
            'three/addons/postprocessing/RenderPass.js',
            'three/addons/postprocessing/ShaderPass.js',
            'three/addons/postprocessing/UnrealBloomPass.js'
          ]
        }
      }
    }
  }
});
