/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'marked' {
  const marked: {
    parse(src: string, options?: any): string
    parseInline(src: string, options?: any): string
    use(options?: any): void
    setOptions(options?: any): void
  }
  export { marked }
}
