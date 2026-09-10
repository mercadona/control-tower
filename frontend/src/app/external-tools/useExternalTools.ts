import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalToolsClient } from 'app/external-tools/client'
import { MetricsDelivery, ToolSession } from 'app/external-tools/ExternalTools.types'

type Surveyed = { tools: ToolSession[]; metricsDelivery: MetricsDelivery }

type ExternalTools =
  | { phase: 'checking' }
  | ({ phase: 'ready' } & Surveyed)
  | ({ phase: 'attention' } & Surveyed)
  | { phase: 'unknown' }

const useExternalTools = () => {
  const [tools, setTools] = useState<ExternalTools>({ phase: 'checking' })
  const tokenRef = useRef<symbol | null>(null)
  const check = useCallback(async () => {
    const token = Symbol('tools')
    tokenRef.current = token
    setTools({ phase: 'checking' })
    const outcome = await ExternalToolsClient.get()
    if (tokenRef.current !== token) return
    if (outcome.kind === 'unavailable') {
      setTools({ phase: 'unknown' })
      return
    }
    setTools({
      phase: outcome.ready ? 'ready' : 'attention',
      tools: outcome.tools,
      metricsDelivery: outcome.metricsDelivery,
    })
  }, [])

  useEffect(() => {
    void check()
    return () => {
      tokenRef.current = null
    }
  }, [check])

  return { tools, check }
}
export { useExternalTools }
export type { ExternalTools }
