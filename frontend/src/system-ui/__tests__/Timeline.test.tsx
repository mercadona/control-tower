import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { Timeline } from 'system-ui/timeline'

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'timeline', 'Timeline.css'), 'utf8'
)

describe('Timeline', () => {
  it('renders each item with its label, in order', () => {
    render(
      <Timeline
        items={[
          { id: '1', label: 'Sesión iniciada', status: 'past' },
          { id: '2', label: 'Trabajando', status: 'current' },
        ]}
      />
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Sesión iniciada')
    expect(items[1]).toHaveTextContent('Trabajando')
  })

  it('marks only the last item as current', () => {
    render(
      <Timeline
        items={[
          { id: '1', label: 'Sesión iniciada', status: 'past' },
          { id: '2', label: 'Trabajando', status: 'current' },
        ]}
      />
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveClass('timeline__item--past')
    expect(items[1]).toHaveClass('timeline__item--current')
  })

  it('exposes only the current item as aria-current=step', () => {
    render(
      <Timeline
        items={[
          { id: '1', label: 'Sesión iniciada', status: 'past' },
          { id: '2', label: 'Trabajando', status: 'current' },
        ]}
      />
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).not.toHaveAttribute('aria-current')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
  })

  it('shows the timestamp and the detail of an item that carries them', () => {
    render(
      <Timeline
        items={[
          { id: '1', label: 'Esperando permiso', detail: '¿Puedo usar Bash?', timestamp: '10:42', status: 'current' },
        ]}
      />
    )

    expect(screen.getByText('¿Puedo usar Bash?')).toBeInTheDocument()
    expect(screen.getByText('10:42')).toBeInTheDocument()
  })

  it('says nothing about a detail or a timestamp an item does not carry', () => {
    render(<Timeline items={[{ id: '1', label: 'Sesión iniciada', status: 'past' }]} />)

    const item = screen.getByRole('listitem')
    expect(item.querySelector('.timeline__detail')).toBeNull()
    expect(item.querySelector('.timeline__timestamp')).toBeNull()
  })

  it('declares no min-width beyond 0, so it fits the narrowest panel the column allows', () => {
    const declared = [...STYLESHEET.matchAll(/min-width:\s*([^;]+);/g)].map((match) => match[1].trim())

    expect(declared.every((value) => value === '0')).toBe(true)
  })
})
