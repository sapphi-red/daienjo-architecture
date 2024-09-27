import { env } from 'hono/adapter'
import { Hono } from 'hono'

type Env = {
  Bindings: {
    UPSTREAM_PROTOCOL: string
    UPSTREAM_HOSTNAME: string
    UPSTREAM_PORT: string
  }
}

const app = new Hono<Env>()

app.get('/', async (c) => {
  const url = new URL(c.req.url)
  const { UPSTREAM_PROTOCOL, UPSTREAM_HOSTNAME, UPSTREAM_PORT } = env(c)
  url.protocol = UPSTREAM_PROTOCOL
  url.hostname = UPSTREAM_HOSTNAME
  url.port = UPSTREAM_PORT
  let html = await (await fetch(url)).text()
  html = html.replace(/(<!-- body -->)/, '<h1>Hello from edge server 🔥</h1>$1')
  return c.html(html)
})

export default app
