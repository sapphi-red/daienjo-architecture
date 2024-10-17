import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  DevEnvironment as ViteDevEnvironment,
  BuildEnvironment,
  type EnvironmentOptions,
  type FSWatcher,
  type ViteDevServer,
} from 'vite'
import { HotChannel, HotPayload, ResolvedConfig, Plugin } from 'vite'
import {
  SourcelessWorkerOptions,
  unstable_getMiniflareWorkerOptions,
} from 'wrangler'
import {
  Miniflare,
  Response as MiniflareResponse,
  type Json,
  type MessageEvent,
  type MiniflareOptions,
  type WebSocket,
} from 'miniflare'

export type CloudflareEnvironmentOptions = {
  config?: string
}

const defaultWranglerConfig = 'wrangler.toml'

export function cloudflareEnvironment(
  environmentName: string,
  options: CloudflareEnvironmentOptions = {},
): Plugin {
  const resolvedWranglerConfigPath = resolve(
    options.config ?? defaultWranglerConfig,
  )
  options.config = resolvedWranglerConfigPath

  return {
    name: 'vite-plugin-cloudflare-environment',

    async config() {
      return {
        environments: {
          [environmentName]: createCloudflareEnvironment(options),
        },
      }
    },
    hotUpdate(ctx) {
      if (this.environment.name !== environmentName) {
        return
      }
      if (ctx.file === resolvedWranglerConfigPath) {
        ctx.server.restart()
      }
    },
  }
}

export function createCloudflareEnvironment(
  options: CloudflareEnvironmentOptions,
): EnvironmentOptions {
  return {
    consumer: 'server',
    webCompatible: true,
    dev: {
      createEnvironment(name, config) {
        return new CloudflareDevEnvironment(name, config, options)
      },
    },
    build: {
      createEnvironment(name, config) {
        return createCloudflareBuildEnvironment(name, config, options)
      },
    },
  }
}

async function createCloudflareBuildEnvironment(
  name: string,
  config: ResolvedConfig,
  _cloudflareOptions: CloudflareEnvironmentOptions,
): Promise<BuildEnvironment> {
  const buildEnv = new BuildEnvironment(name, config)
  // Nothing too special to do here, the default build env is probably ok for now
  return buildEnv
}

export class CloudflareDevEnvironment extends ViteDevEnvironment {
  private mfOptions: MiniflareOptions
  private entrypointSet = false
  private mf: Miniflare | undefined
  public hot: HotChannel & {
    setWebSocket: (ws: WebSocket) => void
  }

  constructor(
    name: string,
    config: ResolvedConfig,
    options: CloudflareEnvironmentOptions,
  ) {
    const { bindings: bindingsFromToml, ...optionsFromToml } =
      getOptionsFromWranglerConfig(options.config!)

    const mfOptions: MiniflareOptions = {
      modulesRoot: fileURLToPath(new URL('./', import.meta.url)),
      modules: [
        {
          type: 'ESModule',
          path: fileURLToPath(new URL('worker/index.js', import.meta.url)),
        },
      ],
      unsafeEvalBinding: 'UNSAFE_EVAL',
      bindings: {
        ...bindingsFromToml,
        ROOT: config.root,
      },
      serviceBindings: {
        __viteFetchModule: async (request) => {
          const args = await request.json()
          try {
            const result: any = await this.fetchModule(...(args as [any, any]))
            return new MiniflareResponse(JSON.stringify(result))
          } catch (error) {
            console.error('[fetchModule]', args, error)
            throw error
          }
        },
      },
      ...optionsFromToml,
    }

    const hot = createHotChannel()
    super(name, config, { hot })

    this.mfOptions = mfOptions
    this.hot = hot
  }

  async init(options?: {
    watcher?: FSWatcher
    previousInstance?: ViteDevEnvironment
  }): Promise<void> {
    await super.init(options)
  }

  async listen(server: ViteDevServer): Promise<void> {
    const mf = new Miniflare(this.mfOptions)
    this.mf = mf

    const resp = await mf.dispatchFetch('http:0.0.0.0/__init-module-runner', {
      headers: {
        upgrade: 'websocket',
      },
    })
    if (!resp.ok) {
      throw new Error('Error: failed to initialize the module runner!')
    }

    const webSocket = resp.webSocket

    if (!webSocket) {
      console.error(
        '\x1b[33m⚠️ failed to create a websocket for HMR (hmr disabled)\x1b[0m',
      )
    } else {
      this.hot.setWebSocket(webSocket)
    }

    super.listen(server)
  }

  async close(): Promise<void> {
    await this.mf?.dispose()
    this.mf = undefined
    await super.close()
  }

  api = {
    getHandler: async ({
      entrypoint,
    }: {
      entrypoint: string
    }): Promise<(req: Request) => Response | Promise<Response>> => {
      // @ts-expect-error
      return async (req: Request) => {
        if (!this.entrypointSet) {
          const resp = await this.mf!.dispatchFetch(
            'http:0.0.0.0/__set-entrypoint',
            {
              headers: [['x-vite-workerd-entrypoint', entrypoint]],
            },
          )
          if (resp.ok) {
            this.entrypointSet = resp.ok
          } else {
            throw new Error(
              'failed to set entrypoint (the error should be logged in the terminal)',
            )
          }
        }

        // TODO: ideally we should pass the request itself with close to no tweaks needed... this needs to be investigated
        return await this.mf!.dispatchFetch(req.url, {
          method: req.method,
          // @ts-expect-error
          body: req.body,
          duplex: 'half',
          headers: [
            // note: we disable encoding since this causes issues when the miniflare response
            //       gets piped into the node one
            ['accept-encoding', 'identity'],
            ...req.headers,
          ],
        })
      }
    },
    setEnvs: async (envs: Record<string, Json>): Promise<void> => {
      await this.mf!.dispatchFetch('http:0.0.0.0/__set-envs', {
        method: 'POST',
        body: JSON.stringify(envs),
      })
    },
  }
}

function createHotChannel(): HotChannel & {
  setWebSocket: (ws: WebSocket) => void
} {
  let webSocket: WebSocket | undefined
  const listenersMap = new Map<string, Set<Function>>()
  let hotDispose: (() => void) | undefined

  return {
    send(...args: any[]) {
      if (!webSocket) return
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

      webSocket.send(JSON.stringify(payload))
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
    listen() {
      if (!webSocket) return

      function eventListener(event: MessageEvent) {
        const payload = JSON.parse(event.data.toString())

        if (!listenersMap.get(payload.event)) {
          listenersMap.set(payload.event, new Set())
        }

        for (const fn of listenersMap.get(payload.event)!) {
          fn(payload.data)
        }
      }

      webSocket.accept()
      webSocket.addEventListener('message', eventListener)
      hotDispose = () => {
        webSocket?.removeEventListener('message', eventListener)
      }
    },
    close() {
      hotDispose?.()
      hotDispose = undefined
    },
    setWebSocket(ws) {
      webSocket = ws
    },
  }
}

function getOptionsFromWranglerConfig(configPath: string) {
  let configOptions: SourcelessWorkerOptions
  try {
    const { workerOptions } = unstable_getMiniflareWorkerOptions(configPath)
    configOptions = workerOptions
  } catch (e) {
    console.warn(`WARNING: unable to read config file at "${configPath}"`)
    return {}
  }

  const {
    bindings,
    textBlobBindings,
    dataBlobBindings,
    wasmBindings,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    compatibilityDate,
    compatibilityFlags,
  } = configOptions

  return {
    bindings,
    textBlobBindings,
    dataBlobBindings,
    wasmBindings,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    compatibilityDate,
    compatibilityFlags,
  }
}
