# daienjo architecture

To try it out, run:
```bash
git clone https://github.com/sapphi-red/daienjo-architecture.git
cd daienjo-architecture
pnpm i

# start the dev server
pnpm dev

# build for production
pnpm build
```

### deploy notes
- Deploy `dist/client` and `dist/origin-server` to a hosting service that supports Node.js server (e.g. Render)
  - Run `pnpm start` to start the origin server
- Deploy `dist/client` and `dist/edge-server` to Cloudflare Workers
  - Run `pnpm wrangler deploy` to achieve this
