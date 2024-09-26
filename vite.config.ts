import { defineConfig } from 'vite'
import { cloudflareEnvironment } from 'vite-env-workerd'
import { serviceWorkerPlugin } from 'vite-env-service-worker'
import frameworkPlugin, { environmentNames } from './framework'

export default defineConfig({
  plugins: [
    serviceWorkerPlugin(environmentNames.serviceworker, 'framework:serviceworker'),
    cloudflareEnvironment(environmentNames.edge),
    frameworkPlugin({
      clientEntry: './src/client/index.html',
      serviceWorkerEntry: './src/service-worker/main.ts',
      edgeServerEntry: './src/edge-server/main.ts',
      originServerEntry: './src/origin-server/main.ts',
    }),
  ],
})
