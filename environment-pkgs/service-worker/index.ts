import {
  DevEnvironment,
  BuildEnvironment,
  type EnvironmentOptions,
  type HotChannel,
  type HotPayload,
} from 'vite'
import { ResolvedConfig, Plugin } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import getRawBody from 'raw-body'
import { fileURLToPath } from 'node:url'
import WebSocket, { WebSocketServer } from 'ws'

export function serviceWorkerPlugin(
  environmentName: string,
  entryId: string,
  hmrPort = 5172,
): Plugin {
  const resolvedEntryId = '\0' + entryId
  const serviceWorkerPathPlaceholder = '__SERVICE__WORKER__ENTRY__'
  const serviceWorkerDevEntryPath = '/__sw_entry.js'
  const serviceWorkerRpcPath = '/__sw_rpc'

  let entrypointPath: string | undefined

  const getFilenamePromises: PromiseWithResolvers<void>[] = []
  let filename: string | undefined

  return {
    name: 'env-service-worker',
    sharedDuringBuild: true,
    config() {
      return {
        environments: {
          [environmentName]: createServiceWorkerEnvironment(hmrPort),
        },
      }
    },
    configEnvironment(name, config) {
      if (name !== environmentName) return

      const input = config.build?.rollupOptions?.input
      if (!input || typeof input !== 'string')
        throw new Error('input is not string')
      entrypointPath = input
      config.build ??= {}
      config.build.rollupOptions ??= {}
      config.build.rollupOptions.input = { 'main': entryId }
    },
    resolveId(id) {
      if (id === entryId) {
        return resolvedEntryId
      }
    },
    async load(id) {
      if (id !== resolvedEntryId) return

      if (this.environment.name === environmentName) {
        return `
import handler from ${JSON.stringify(entrypointPath)}

self.addEventListener('fetch', (event) => {
  handler(event)
})
        `
      }

      let value: string
      if (this.environment.mode === 'dev') {
        value = JSON.stringify(serviceWorkerDevEntryPath)
      } else {
        value = serviceWorkerPathPlaceholder
      }
      return `export default ${value}`
    },
    async renderChunk(code) {
      if (
        !code.includes(serviceWorkerPathPlaceholder) ||
        this.environment.name !== 'client'
      )
        return

      if (filename === undefined) {
        const promiseWithResolvers = createPromiseWithResolvers<void>()
        getFilenamePromises.push(promiseWithResolvers)
        await promiseWithResolvers.promise
      }

      const replacedCode = code.replaceAll(
        serviceWorkerPathPlaceholder,
        JSON.stringify('/' + filename!),
      )

      return { code: replacedCode, map: null } // FIXME: sourcemap is incorrect
    },
    generateBundle(_ops, bundle) {
      if (this.environment.name !== environmentName) return

      const entry = Object.values(bundle).find(
        (chunk) => chunk.type === 'chunk' && chunk.isEntry,
      )
      if (!entry) throw new Error('entry chunk not found')
      filename = entry.fileName

      for (const promiseWithResolvers of getFilenamePromises) {
        promiseWithResolvers.resolve()
      }
      getFilenamePromises.length = 0
    },
    async configureServer(server) {
      const _dirname = path.dirname(fileURLToPath(import.meta.url))
      const devWorkerEntryCode = await fs.readFile(
        path.resolve(_dirname, './worker/index.js'),
        'utf-8',
      )
      const entrypoint = getEntrypointFromInput(
        server.environments[environmentName].config.build.rollupOptions.input,
      )
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.replace(/\?.*$/, '') === serviceWorkerDevEntryPath) {
          res.setHeader('content-type', 'application/javascript')
          res.end(
            `const ROOT = ${JSON.stringify(server.config.root)};\n` +
              `const RPC_PATH = ${JSON.stringify(serviceWorkerRpcPath)};\n` +
              `const HMR_PORT = ${hmrPort};\n` +
              `const ENTRYPOINT = ${JSON.stringify(entrypoint)};\n` +
              devWorkerEntryCode,
          )
          return
        }
        if (req.url === serviceWorkerRpcPath) {
          const type = req.headers['x-vite-rpc-type']
          if (type === 'fetchModule') {
            const content = await getRawBody(req)
            const args = JSON.parse(content.toString())
            const result = await server.environments[
              environmentName
            ].fetchModule(...(args as [any, any]))
            res.setHeader('content-type', 'application/javascript')
            res.end(JSON.stringify(result))
            return
          }
        }
        next()
      })
    },
  }
}

type PromiseWithResolvers<T> = ReturnType<typeof createPromiseWithResolvers<T>>

function createPromiseWithResolvers<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function getEntrypointFromInput(
  input: string | string[] | Record<string, string> | undefined,
) {
  if (typeof input === 'string') {
    return input
  }
  if (Array.isArray(input) && input.length === 1) {
    return input[0]
  }
  if (input === undefined) {
    throw new Error('Could not determine entrypoint: was undefined')
  }
  const entries = Object.values(input)
  if (entries.length === 1) {
    return entries[0]
  }
  throw new Error('Could not determine entrypoint: has multiple entries')
}

export function createServiceWorkerEnvironment(
  hmrPort: number,
): EnvironmentOptions {
  return {
    consumer: 'server',
    webCompatible: true,
    dev: {
      createEnvironment(name, config) {
        return createServiceWorkerDevEnvironment(name, config, hmrPort)
      },
    },
    build: {
      createEnvironment(name, config) {
        return createServiceWorkerBuildEnvironment(name, config)
      },
      rollupOptions: {
        output: {
          entryFileNames: 'sw/[name]-[hash].js',
          chunkFileNames: 'sw/[name]-[hash].js',
          assetFileNames: 'sw/[name]-[hash].[ext]',
        },
      },
    },
  }
}

async function createServiceWorkerBuildEnvironment(
  name: string,
  config: ResolvedConfig,
): Promise<BuildEnvironment> {
  const buildEnv = new BuildEnvironment(name, config)
  return buildEnv
}

async function createServiceWorkerDevEnvironment(
  name: string,
  config: ResolvedConfig,
  hmrPort: number,
): Promise<DevEnvironment> {
  const devEnv = new DevEnvironment(name, config, {
    hot: createHotChannel(hmrPort),
  })
  return devEnv
}

function createHotChannel(hmrPort: number): HotChannel {
  let wss: WebSocketServer | undefined
  const listenersMap = new Map<string, Set<Function>>()

  return {
    listen: () => {
      wss = new WebSocketServer({ port: hmrPort })
      wss.on('connection', (socket) => {
        socket.on('message', (data) => {
          const payload = JSON.parse(data.toString())

          if (!listenersMap.get(payload.event)) {
            listenersMap.set(payload.event, new Set())
          }

          const client = {
            send: (...args: any[]) => {
              let payload: HotPayload
              if (typeof args[0] === 'string') {
                payload = {
                  type: 'custom',
                  event: args[0],
                  data: args[1],
                }
              } else {
                payload = args[0]
              }
              socket.send(JSON.stringify(payload))
            },
          }
          for (const fn of listenersMap.get(payload.event)!) {
            fn(payload.data, client)
          }
        })
      })
    },
    send(...args: any[]) {
      let payload: HotPayload

      if (typeof args[0] === 'string') {
        payload = {
          type: 'custom',
          event: args[0],
          data: args[1],
        }
      } else {
        payload = args[0]
      }

      wss?.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(payload))
        }
      })
    },
    on(event: any, listener: any) {
      if (!listenersMap.get(event)) {
        listenersMap.set(event, new Set())
      }

      listenersMap.get(event)!.add(listener)
    },
    off(event: any, listener: any) {
      listenersMap.get(event)?.delete(listener)
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        if (!wss) {
          resolve()
          return
        }
        wss.clients.forEach((client) => {
          client.terminate()
        })
        wss.close((err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    },
  }
}
