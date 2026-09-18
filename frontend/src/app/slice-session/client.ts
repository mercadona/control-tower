import { SliceMessageAsked, SliceMessageOutcome } from 'app/slice-session/SliceSession.types'

const PATH = (issue: number) => `/slices/${issue}/message`
const DELIVERED_STATUS = 202

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRefusal = (value: unknown): value is { code: string; detail: string } =>
  isRecord(value) && typeof value.code === 'string' && typeof value.detail === 'string'

const send = async ({ issue, repo, agent, text }: SliceMessageAsked): Promise<SliceMessageOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH(issue), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, agent, text }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }

  if (response.status === DELIVERED_STATUS) return { kind: 'delivered' }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (!isRefusal(body)) return { kind: 'backend-unreachable' }

  return { kind: 'refused', code: body.code, error: body.detail }
}

export const SliceSessionClient = { send }
