import { useState } from 'react'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Button } from 'system-ui/button'
import './WorkDetails.css'

type WorkDetailsProps = {
  plan: StartedPlan
  writeToClipboard?: (text: string) => Promise<void>
}

const WorkDetails = ({
  plan,
  writeToClipboard = (text) => navigator.clipboard.writeText(text),
}: WorkDetailsProps) => {
  const [copyResult, setCopyResult] = useState<string | null>(null)

  const copyFacts = async () => {
    try {
      await writeToClipboard(`Issue #${plan.issue.number}: ${plan.issue.url}\nRepositorio: ${plan.repo}\nAgente: ${plan.agent}\nRama: ${plan.branch}\nWorktree: ${plan.worktree}`)
      setCopyResult('Datos del plan copiados')
    } catch {
      setCopyResult('No se pudieron copiar los datos del plan')
    }
  }

  return (
    <section className="work-details" aria-label="Detalles del trabajo">
        <details className="work-details__disclosure">
          <summary>Detalles del agente y del entorno</summary>
          <p className="work-details__facts">
            Solicitud: issue{' '}
            <a href={plan.issue.url} target="_blank" rel="noreferrer">
              #{plan.issue.number}
            </a>{' '}
            en <code>{plan.repo}</code>
          </p>
          <dl>
            <div>
              <dt className="lg-caption1-regular">Agente</dt>
              <dd><code>{plan.agent}</code></dd>
            </div>
            <div>
              <dt className="lg-caption1-regular">Rama</dt>
              <dd><code>{plan.branch}</code></dd>
            </div>
            <div>
              <dt className="lg-caption1-regular">Worktree</dt>
              <dd><code>{plan.worktree}</code></dd>
            </div>
          </dl>
          <Button type="button" variant="secondary" onClick={() => void copyFacts()}>Copiar datos del plan</Button>
          {copyResult !== null && <p role="status" className="work-details__copy-result">{copyResult}</p>}
        </details>
    </section>
  )
}

export { WorkDetails }
