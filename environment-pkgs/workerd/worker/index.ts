/// <reference types="@cloudflare/workers-types" />

import { WebSocket } from '@cloudflare/workers-types'
import { Json } from 'miniflare'
import {
  createWebSocketModuleRunnerTransport,
  ModuleRunner,
} from 'vite/module-runner'

type Env = {
  ROOT: string
  UNSAFE_EVAL: {
    eval: (code: string, filename?: string) => any
  }
  __viteInvokeModule: {
    fetch: (request: Request) => Promise<Response>
  }
}

let entrypoint: string | undefined
let moduleRunner: ModuleRunner
let envs: Record<string, Json> = {}

export default {
  async fetch(req: Request, env: Env, ctx: any) {
    const url = new URL(req.url)

    if (url.pathname === '/__init-module-runner') {
      const pair = new WebSocketPair()
      moduleRunner = await getModuleRunner(env, pair[0] as unknown as WebSocket)
      return new Response(null, { status: 101, webSocket: pair[1] })
    }

    if (url.pathname === '/__set-entrypoint') {
      entrypoint = req.headers.get('x-vite-workerd-entrypoint') ?? undefined
      try {
        await moduleRunner.import(entrypoint!)
      } catch (error) {
        console.error(error)
        return new Response(null, {
          status: 500,
        })
      }
      return new Response('entrypoint successfully set')
    }

    if (url.pathname === '/__set-envs') {
      const newEnvs: Record<string, Json> = await req.json()
      envs = { ...envs, ...newEnvs }
      return new Response('envs successfully set')
    }

    // here we filter out the extra bindings that we use for the environment
    // integration, so that user code doesn't get access to them
    const { ROOT, UNSAFE_EVAL, __viteInvokeModule, ...userEnv } = env
    const mergedUserEnv = { ...userEnv, ...envs }

    let entrypointModule: any
    try {
      entrypointModule = await moduleRunner.import(entrypoint!)
    } catch (error) {
      console.error(error)
      return new Response(null, {
        status: 500,
      })
    }
    return entrypointModule.default.fetch(req, mergedUserEnv, ctx)
  },
}

let _moduleRunner: ModuleRunner | undefined

async function getModuleRunner(env: Env, ws: WebSocket) {
  if (_moduleRunner) return _moduleRunner

  const transport = createWebSocketModuleRunnerTransport({
    createConnection: () => {
      ws.accept()
      return ws as any
    },
  })

  _moduleRunner = new ModuleRunner(
    {
      root: env.ROOT,
      transport: {
        ...transport,
        async invoke(data) {
          const response = await env.__viteInvokeModule.fetch(
            new Request('http://localhost', {
              method: 'POST',
              body: JSON.stringify(data),
            }),
          )
          const result = response.json()
          return result as Promise<{ r: any } | { e: any }>
        },
      },
    },
    {
      runInlinedModule: async (context, transformed, module) => {
        const codeDefinition = `'use strict';async (${Object.keys(context).join(
          ',',
        )})=>{{`
        const code = `${codeDefinition}${transformed}\n}}`
        const fn = env.UNSAFE_EVAL.eval(code, module.id)
        await fn(...Object.values(context))
        Object.freeze(context.__vite_ssr_exports__)
      },
      async runExternalModule(filepath) {
        // strip the file:// prefix if present
        // Note: I _think_ that the module fallback service is going to strip this for us
        //       in the future, so this will very likely become unnecessary
        filepath = filepath.replace(/^file:\/\//, '')
        return import(filepath)
      },
    },
  )
  return _moduleRunner
}
