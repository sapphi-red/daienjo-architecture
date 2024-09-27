import serviceWorkerPath from 'framework:serviceworker'

const absoluteServiceWorkerPath = new URL(serviceWorkerPath, import.meta.url)
  .href

function register() {
  return navigator.serviceWorker
    .register(absoluteServiceWorkerPath, {
      type: 'module',
      updateViaCache: 'none',
    })
    .then(
      function (registration) {
        console.log('Register Service Worker: Success')
        return registration
      },
      function (_error) {
        console.log('Register Service Worker: Error')
      },
    )
}
async function start() {
  const registrations = await navigator.serviceWorker.getRegistrations()
  console.log('Unregister Service Worker')

  let exists = false
  await Promise.all(
    registrations.map((registration) => {
      const matched =
        import.meta.env.PROD &&
        registration.active?.scriptURL === absoluteServiceWorkerPath
      if (matched) {
        exists = true
      }
      return matched ? null : registration.unregister()
    }),
  )
  if (!exists) {
    await register()
  }
}
start()

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <img src="/vite.svg">
  <h1>Hello from client 🔥</h1>
`
