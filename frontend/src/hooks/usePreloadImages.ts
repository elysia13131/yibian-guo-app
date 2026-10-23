import { useEffect, useRef } from 'react'

export function usePreloadImages(urls: string[]): void {
  const loaded = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const url of urls) {
      if (!url || loaded.current.has(url)) continue
      loaded.current.add(url)
      const img = new Image()
      img.src = url
    }
  }, [urls])
}
