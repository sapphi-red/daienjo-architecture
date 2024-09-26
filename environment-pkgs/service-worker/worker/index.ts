declare const self: ServiceWorkerGlobalScope

import type { HotPayload } from 'vite'
import { ModuleRunner, ESModulesEvaluator } from 'vite/module-runner'

declare const ROOT: string
declare const RPC_PATH: string
declare const HMR_PORT: number
declare const ENTRYPOINT: string

let handler: ((event: Event) => void) | undefined
const setHandler = () => {
  return moduleRunner
    .import(ENTRYPOINT)
    .then((module) => {
      handler = module.default
    })
    .catch((error) => {
      console.error(error)
    })
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', () => {
  setHandler()
})
self.addEventListener('fetch', (event) => {
  handler?.(event)
  if (event.request.mode === 'navigate') {
    event.waitUntil(setHandler())
  }
})

let ws: WebSocket | undefined
const moduleRunner = new ModuleRunner(
  {
    root: ROOT,
    transport: {
      fetchModule: async (...args) => {
        const response = await fetch(RPC_PATH, {
          method: 'POST',
          headers: { 'x-vite-rpc-type': 'fetchModule' },
          body: JSON.stringify(args),
        })
        const result = response.json()
        return result as any
      },
    },
    hmr: {
      connection: {
        isReady: () => !!ws && ws.readyState === WebSocket.OPEN,
        onUpdate(callback) {
          ws = new WebSocket(`ws://localhost:${HMR_PORT}`)
          ws.addEventListener('message', async (event) => {
            const payload: HotPayload = JSON.parse(event.data)
            if (payload.type === 'full-reload') {
              await setHandler()
            }
            callback(payload)
          })
        },
        send(message) {
          ws?.send(JSON.stringify(message))
        },
      },
    },
  },
  new ESModulesEvaluator(),
)
