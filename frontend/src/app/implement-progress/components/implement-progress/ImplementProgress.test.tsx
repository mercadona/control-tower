import { render, screen } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { useWorkProgress } from 'app/work-progress/useWorkProgress'
import { WorkProgressPresentation } from 'app/work-progress/presentation'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { ImplementProgress } from './ImplementProgress'

const answerWith = (answer: { status: number; body: string }) => {
  const work = WorkProgressMother.implementing(answer)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(work.body, { status: work.status })))
}

const Progress = () => (
  <ImplementProgress progress={WorkProgressPresentation.execution(useWorkProgress({ issue: ImplementProgressMother.ISSUE, repo: ImplementProgressMother.REPO, agent: StartPlanMother.AGENT }))} />
)

const renderProgress = () => render(<Progress />)

describe('ImplementProgress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should show the task, the total tasks, the task name and the attempt of a run in progress', async () => {
    answerWith(ImplementProgressMother.progress())

    renderProgress()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(screen.getByText('el lector del plan')).toBeInTheDocument()
    expect(screen.getByText('Intento 2')).toBeInTheDocument()
  })

  it('should show a task without a name instead of the word null', async () => {
    answerWith(ImplementProgressMother.withoutTaskName())

    renderProgress()

    const status = await screen.findByText(/Tarea 1 de 8/)
    expect(status).not.toHaveTextContent('null')
  })

  it('shows independently supplied progress fields without an empty diagnostic', async () => {
    answerWith({
      status: 200,
      body: JSON.stringify({
        step: 'implement',
        task: null,
        total_tasks: 4,
        name: 'Preparar cambios',
        attempt: 2,
        discards: null,
      }),
    })

    renderProgress()

    expect(await screen.findByText('4 tareas previstas')).toBeInTheDocument()
    expect(screen.getByText('Preparar cambios')).toBeInTheDocument()
    expect(screen.getByText('Intento 2')).toBeInTheDocument()
    expect(screen.queryByText(/^Diagnóstico:/)).toBeNull()
  })

  it('keeps an unreadable worktree explicit instead of claiming execution is starting', async () => {
    answerWith(ImplementProgressMother.notRead())

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent(ImplementProgressMother.NOT_READ_DETAIL)
  })

  it('should show a real refusal as an error with the backend text', async () => {
    answerWith(ImplementProgressMother.malformedRoot())

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent(ImplementProgressMother.MALFORMED_ROOT_DETAIL)
  })

  it('should say the backend is unreachable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should name the review the delivered plan is standing in', async () => {
    answerWith(ImplementProgressMother.inReview())

    renderProgress()

    expect(await screen.findByText(/En revisión/)).toHaveAttribute('role', 'status')
  })

  it('shows publication as pending even when the pull request already exists', async () => {
    answerWith(ImplementProgressMother.publishing())

    renderProgress()

    expect(await screen.findByText('Implementación terminada; publicación pendiente')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('link', { name: /#31/ })).toHaveAttribute('href', 'https://github.com/owner/name/pull/31')
    expect(screen.queryByText(/^En revisión$/)).toBeNull()
  })

  it('should link the pull request once the plan is in review', async () => {
    answerWith(ImplementProgressMother.inReview())

    renderProgress()

    const link = await screen.findByRole('link', { name: /#31/ })
    expect(link).toHaveAttribute('href', 'https://github.com/owner/name/pull/31')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('should show no pull request link before the backend knows one', async () => {
    answerWith(ImplementProgressMother.progress())

    renderProgress()

    await screen.findByText(/Tarea 3 de 7/)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('does not claim review from an unreadable progress response', async () => {
    answerWith(ImplementProgressMother.inReviewWithMalformedPullRequest())

    renderProgress()

    await screen.findByRole('alert')
    expect(screen.queryByText('En revisión')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('should show the real backend answer for a plan whose pull request is in review', async () => {
    answerWith(ImplementProgressMother.realWorldInReview())

    renderProgress()

    expect(await screen.findByText(/En revisión/)).toHaveAttribute('role', 'status')
    const link = await screen.findByRole('link', { name: /#46/ })
    expect(link).toHaveAttribute('href', 'https://github.com/jjponz/repo-pulse/pull/46')
  })

  it('should name the work of fixing what the review asked for', async () => {
    answerWith(ImplementProgressMother.fixing())

    renderProgress()

    expect(await screen.findByText(/Corrigiendo lo pedido en la revisión/)).toHaveAttribute('role', 'status')
  })
})
