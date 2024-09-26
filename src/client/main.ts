import serviceWorkerPath from 'framework:serviceworker'

function register() {
  return navigator.serviceWorker
    .register(serviceWorkerPath, { type: 'module', updateViaCache: 'none' })
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
        registrations.map((registration) => registration.unregister()),
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
