import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import ApiKeySetupModal from '../components/ApiKeySetupModal'

type MissingKey = 'deepseek' | 'somark' | 'ark'

interface ApiKeyContextType {
  showApiKeySetup: (missingKeys?: MissingKey[]) => void
}

const ApiKeyContext = createContext<ApiKeyContextType | undefined>(undefined)

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [missingKeys, setMissingKeys] = useState<MissingKey[] | undefined>()

  const showApiKeySetup = useCallback((keys?: MissingKey[]) => {
    setMissingKeys(keys)
    setIsOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  useEffect(() => {
    const handler = (e: CustomEvent<{ missingKeys?: MissingKey[] }>) => {
      setMissingKeys(e.detail?.missingKeys)
      setIsOpen(true)
    }
    window.addEventListener('api-key-missing' as any, handler as any)
    return () => window.removeEventListener('api-key-missing' as any, handler as any)
  }, [])

  return (
    <ApiKeyContext.Provider value={{ showApiKeySetup }}>
      {children}
      <ApiKeySetupModal isOpen={isOpen} onClose={handleClose} missingKeys={missingKeys} />
    </ApiKeyContext.Provider>
  )
}

export function useApiKeyContext(): ApiKeyContextType {
  const context = useContext(ApiKeyContext)
  if (!context) {
    throw new Error('useApiKeyContext must be used within an ApiKeyProvider')
  }
  return context
}
