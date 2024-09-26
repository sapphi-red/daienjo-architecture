import { Hono } from 'hono'
import { handle } from 'hono/service-worker'

const app = new Hono()
app.get('/', async (c) => {
  try {
    let html = await (await fetch(c.req.url)).text()

    html = html.replace(
      /(<!-- body -->)/,
      '<h1>Hello from service worker 🔥</h1>$1',
    )
    return c.html(html)
  } catch {
    return Response.error()
  }
})

export default handle(app, {
  // FIXME: https://github.com/honojs/hono/pull/3200
  fetch: globalThis.self.fetch.bind(globalThis.self),
})
