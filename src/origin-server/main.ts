import { Hono } from 'hono'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const _dirname = path.dirname(fileURLToPath(import.meta.url))

const app = new Hono()

app.get('/', async (c) => {
  let html = import.meta.env.DEV
    ? (await import('../client/index.html?transformIndexHtml')).default
    : await fs.readFile(path.resolve(_dirname, './index.html'), 'utf-8')
  html = html.replace(
    /(<!-- body -->)/,
    '<h1>Hello from origin server 🔥</h1>$1',
  )
  return c.html(html)
})

export default app
