declare const self: ServiceWorkerGlobalScope

import type { HotPayload } from 'vite'
import {
  ModuleRunner,
  ESModulesEvaluator,
  createWebSocketModuleRunnerTransport,
  type ModuleRunnerTransport,
} from 'vite/module-runner'

declare const ROOT: string
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
  if (event.request.mode === 'navigate') {
    event.waitUntil(setHandler())
  }
  handler?.(event)
})

const transport = createWebSocketModuleRunnerTransport({
  createConnection() {
    return new WebSocket(`ws://localhost:${HMR_PORT}`)
  },
})
const wrappedTransport: ModuleRunnerTransport = {
  ...transport,
  connect({ onMessage, onDisconnection }) {
    const wrappedOnMessage = async (data: HotPayload) => {
      if (data.type === 'full-reload') {
        await setHandler()
      }
      onMessage(data)
    }
    return transport.connect({ onMessage: wrappedOnMessage, onDisconnection })
  },
}

const moduleRunner = new ModuleRunner(
  {
    root: ROOT,
    transport: wrappedTransport,
  },
  new ESModulesEvaluator(),
)
