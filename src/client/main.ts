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
function start() {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      console.log('Unregister Service Worker')
      return Promise.all(
        registrations.map((registration) =>
          import.meta.env.PROD &&
          registration.active?.scriptURL === absoluteServiceWorkerPath
            ? null
            : registration.unregister(),
        ),
      )
    })
    .then(() => {
      return register()
    })
}
start()

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <img src="/vite.svg">
  <h1>Hello from client 🔥</h1>
`
