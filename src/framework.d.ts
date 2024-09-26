declare module 'framework:info' {
  export default {
    upstream: {
      hostname: string,
      port: number
    }
  }
}

declare module 'framework:serviceworker' {
  export default string
}

declare module '*?transformIndexHtml' {
  export default string
}
