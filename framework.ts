import {
  createServerModuleRunner,
  normalizePath,
  type Plugin,
  type ViteDevServer,
} from 'vite'
import type { DevEnvironment } from 'vite-env-workerd'
import { serve, getRequestListener, type ServerType } from '@hono/node-server'
import fs from 'node:fs/promises'
import path from 'node:path'

type Options = {
  clientEntry: string
  serviceWorkerEntry: string
  edgeServerEntry: string
  originServerEntry: string
  originServer?: {
    port?: number
  }
}

export const environmentNames = {
  client: 'client',
  serviceworker: 'serviceworker',
  edge: 'edge',
  ssr: 'ssr',
}

export default function frameworkPlugin(options: Options): Plugin {
  const originServerPort = options.originServer?.port ?? 5170
  const frameworkInfoId = 'framework:info'
  const resolvedFrameworkInfoId = '\0' + frameworkInfoId
  const resolvedFrameworkOriginEntryId = '\0framework:originentry'

  let originServer: ServerType | undefined
  let viteServer: ViteDevServer | undefined

  return {
    name: 'framework-plugin',
    config() {
      return {
        environments: {
          [environmentNames.client]: {
            build: {
              rollupOptions: {
                input: normalizePath(path.resolve(options.clientEntry)),
              },
              outDir: 'dist/client',
              emptyOutDir: false,
            },
          },
          [environmentNames.serviceworker]: {
            build: {
              rollupOptions: {
                input: normalizePath(path.resolve(options.serviceWorkerEntry)),
              },
              outDir: 'dist/client',
              emptyOutDir: false,
              copyPublicDir: false,
            },
            resolve: {
              noExternal: true,
            },
          },
          [environmentNames.edge]: {
            build: {
              rollupOptions: {
                input: normalizePath(path.resolve(options.edgeServerEntry)),
              },
              outDir: 'dist/edge-server',
              emptyOutDir: false,
              copyPublicDir: false,
            },
            resolve: {
              noExternal: true,
            },
          },
          [environmentNames.ssr]: {
            build: {
              rollupOptions: {
                input: { main: resolvedFrameworkOriginEntryId },
              },
              outDir: 'dist/origin-server',
              emptyOutDir: false,
              copyPublicDir: false,
            },
          },
        },
        builder: {
          async buildApp(builder) {
            await fs.rm(path.resolve(builder.config.root, 'dist'), {
              recursive: true,
              force: true,
            })
            await Promise.all([
              builder.build(builder.environments[environmentNames.client]),
              builder.build(
                builder.environments[environmentNames.serviceworker],
              ),
            ])
            for (const env of ['edge', 'ssr']) {
              await builder.build(builder.environments[env])
            }
            await fs.rename(
              path.resolve(
                builder.config.root,
                'dist/client',
                options.clientEntry,
              ),
              path.resolve(builder.config.root, 'dist/origin-server/index.html'),
            )
          },
        },
        appType: 'custom',
      }
    },
    async configureServer(server) {
      viteServer = server
      const edge = server.environments[environmentNames.edge] as DevEnvironment

      const ssrRunner = createServerModuleRunner(
        server.environments[environmentNames.ssr],
      )

      if (originServer) {
        await new Promise<void>((resolve, reject) => {
          originServer!.close((err) => (err ? reject(err) : resolve()))
        })
      }
      originServer = serve({
        async fetch(request, env) {
          const module = await ssrRunner.import(options.originServerEntry)
          return module.default.fetch(request, env)
        },
        port: originServerPort,
      })
      if (!originServer.listening) {
        await new Promise<void>((resolve) => {
          originServer!.once('listening', resolve)
        })
      }

      await edge.api.setEnvs({
        UPSTREAM_PROTOCOL: 'http:',
        UPSTREAM_HOSTNAME: 'localhost',
        UPSTREAM_PORT: '' + originServerPort,
      })

      return async () => {
        const edgeHandler = getRequestListener(
          await edge.api.getHandler({ entrypoint: options.edgeServerEntry }),
        )

        server.middlewares.use((req, res, next) => {
          edgeHandler(req, res).then(
            () => {
              next()
            },
            (err) => {
              next(err)
            },
          )
        })
      }
    },
    hotUpdate(ctx) {
      // auto refresh if server is updated
      if (
        (this.environment.name === environmentNames.ssr ||
          this.environment.name === environmentNames.edge ||
          this.environment.name === environmentNames.serviceworker) &&
        ctx.modules.length > 0
      ) {
        ctx.server.environments.client.hot.send({
          type: 'full-reload',
        })
      }
    },
    resolveId(id) {
      if (id === frameworkInfoId) {
        return resolvedFrameworkInfoId
      }
      if (id === resolvedFrameworkOriginEntryId) {
        return resolvedFrameworkOriginEntryId
      }
    },
    async load(id) {
      if (id == resolvedFrameworkInfoId) {
        return `export default {
                  upstream: {
                    hostname: 'localhost',
                    port: ${originServerPort},
                  },
                }`
      }
      if (id === resolvedFrameworkOriginEntryId) {
        return `
import app from ${JSON.stringify(
          normalizePath(path.resolve(options.originServerEntry)),
        )}
import { serve } from '@hono/node-server'

serve({ fetch: app.fetch, port: process.env.PORT })
        `
      }
      if (id.endsWith('?transformIndexHtml')) {
        const cleanId = id.replace('?transformIndexHtml', '')
        let content = await fs.readFile(cleanId, 'utf-8')
        if (viteServer) {
          content = await viteServer.transformIndexHtml('/', content)
        }
        return `export default ${JSON.stringify(content)}`
      }
    },
  }
}
