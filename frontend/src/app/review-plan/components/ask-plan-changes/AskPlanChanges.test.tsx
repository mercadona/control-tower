import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { ReviewPlanMother } from '__scenarios__/ReviewPlanMother'
import { AskPlanChanges } from './AskPlanChanges'

const ASK_BUTTON = { name: 'Pedir cambios' }
const FIELD_LABEL = 'Qué quieres cambiar del plan'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const ask = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText(FIELD_LABEL), text)
  await user.click(screen.getByRole('button', ASK_BUTTON))
}

const answerWithAndThenHold = (answer: { status: number; body: string }) => {
  let release = () => {}
  const held = new Promise<Response>((resolve) => {
    release = () => resolve(new Response(answer.body, { status: answer.status }))
  })
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(async () => new Response(answer.body, { status: answer.status }))
    .mockImplementationOnce(() => held))

  return { release }
}

describe('AskPlanChanges', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should say where the plan is read, so you know what you are reviewing', () => {
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    expect(screen.getByText(/último comentario del issue/)).toBeInTheDocument()
  })

  it('should ask for nothing until you write what to change', () => {
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    expect(screen.getByRole('button', ASK_BUTTON)).toBeDisabled()
  })

  it('should send what you wrote with the issue and the repo of the plan', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(fetch).toHaveBeenCalledWith('/review-plan', expect.objectContaining({
      body: ReviewPlanMother.REQUEST_BODY,
    }))
  })

  it('should say the changes were asked for without waiting for the agent, and say it takes a while', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    const said = await screen.findByRole('status')
    expect(said).toHaveTextContent(/Cambios pedidos/)
    expect(said).toHaveTextContent(/30 segundos/)
  })

  it('should empty the field once accepted, so the same change is not asked for twice', async () => {
    answerWith(ReviewPlanMother.changesAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue('')
  })

  it('should keep what you wrote when the backend no longer watches the plan', async () => {
    answerWith(ReviewPlanMother.noLiveSession())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no tiene este plan activo/)
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue(ReviewPlanMother.CHANGES)
  })

  it('should show the backend own words on any other refusal, and keep what you wrote', async () => {
    answerWith(ReviewPlanMother.notAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent('gh issue comment failed: gh: not found')
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue(ReviewPlanMother.CHANGES)
  })

  it('should ask for nothing when all you typed is spaces', async () => {
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await user.type(screen.getByLabelText(FIELD_LABEL), '   ')

    expect(screen.getByRole('button', ASK_BUTTON)).toBeDisabled()
  })

  it('should let you ask again after a refusal, adding to what you already wrote', async () => {
    answerWith(ReviewPlanMother.notAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.type(screen.getByLabelText(FIELD_LABEL), ' y la tres')

    expect(screen.getByLabelText(FIELD_LABEL)).toBeEnabled()
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveValue(`${ReviewPlanMother.CHANGES} y la tres`)
    expect(screen.getByRole('button', ASK_BUTTON)).toBeEnabled()
  })

  it('should take the previous refusal down as soon as the next request leaves, not when it answers', async () => {
    const held = answerWithAndThenHold(ReviewPlanMother.notAsked())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', ASK_BUTTON))

    expect(screen.queryByRole('alert')).toBeNull()
    held.release()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('should not tell a plan already being implemented to recover the active plan', async () => {
    answerWith(ReviewPlanMother.alreadyImplementing())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya se está implementando/)
    expect(screen.queryByText(/Recupera el plan activo/)).toBeNull()
  })

  it('should send an uncertain phase to a person instead of telling anyone to recover anything', async () => {
    answerWith(ReviewPlanMother.phaseUncertain())
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent(/No se puede saber si la implementación ya empezó/)
    expect(said).toHaveTextContent(/Una persona tiene que comprobarlo/)
    expect(screen.queryByText(/Recupera el plan activo/)).toBeNull()
  })

  it('should say when the backend could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const user = userEvent.setup()
    render(<AskPlanChanges plan={ImplementPlanMother.plan()} />)

    await ask(user, ReviewPlanMother.CHANGES)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })
})
