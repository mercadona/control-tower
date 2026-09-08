import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalToolsClient } from 'app/external-tools/client'
import { SessionState, ToolSession } from 'app/external-tools/ExternalTools.types'

type ExternalTools =
  | { phase: 'checking' }
  | { phase: 'ready'; tools: ToolSession[] }
  | { phase: 'attention'; tools: ToolSession[] }
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
    const phase = outcome.tools.some((tool) => tool.session !== SessionState.READY)
      ? 'attention'
      : 'ready'
    setTools({ phase, tools: outcome.tools })
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
