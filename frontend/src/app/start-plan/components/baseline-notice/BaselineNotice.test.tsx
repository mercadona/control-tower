import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BaselineNotice } from 'app/start-plan/components/baseline-notice'
import { Baseline } from 'app/start-plan/StartPlan.types'

class BaselineMother {
  static green(): Baseline {
    return { outcome: 'verde', command: 'npm test', summary: '42 passed' }
  }

  static red(): Baseline {
    return { outcome: 'rojo', command: 'make test', summary: 'exit 2 · unable to get image postgres:17-alpine' }
  }

  static unverified(): Baseline {
    return { outcome: 'no-verificado', command: null, summary: 'sin comando de test declarado en AGENTS.md' }
  }
}

describe('BaselineNotice', () => {
  it('should say nothing when the repository was green', () => {
    render(<BaselineNotice baseline={BaselineMother.green()} />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('should say nothing when the plan carries no measurement', () => {
    render(<BaselineNotice />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('should warn that the repository was already red, with the command and what it answered', () => {
    render(<BaselineNotice baseline={BaselineMother.red()} />)

    const said = screen.getByRole('status')
    expect(said).toHaveTextContent('El repositorio ya estaba en rojo antes de empezar')
    expect(said).toHaveTextContent('make test')
    expect(said).toHaveTextContent('unable to get image postgres:17-alpine')
    expect(said).toHaveTextContent('no podrá distinguir sus fallos de los que ya había')
  })

  it('should warn that nothing could be measured, without inventing a command', () => {
    render(<BaselineNotice baseline={BaselineMother.unverified()} />)

    const said = screen.getByRole('status')
    expect(said).toHaveTextContent('No se ha podido comprobar cómo estaba el repositorio')
    expect(said).toHaveTextContent('sin comando de test declarado en AGENTS.md')
  })
})
