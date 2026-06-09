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
