import { WorkflowStep } from 'system-ui/workflow-step'

describe('the workflow step disclosure union', () => {
  it('should accept a collapsible step with its handler', () => {
    const element = (
      <WorkflowStep status="active" title="Paso" isExpanded onExpandedChange={() => undefined}>
        Contenido
      </WorkflowStep>
    )

    expect(element).toBeDefined()
  })

  it('should accept a step that cannot collapse with neither prop', () => {
    const element = (
      <WorkflowStep status="active" title="Paso" canCollapse={false}>
        Contenido
      </WorkflowStep>
    )

    expect(element).toBeDefined()
  })

  it('should refuse a step that cannot collapse but still carries isExpanded and onExpandedChange', () => {
    const element = (
      // @ts-expect-error a static step takes neither isExpanded nor onExpandedChange
      <WorkflowStep status="active" title="Paso" canCollapse={false} isExpanded onExpandedChange={() => undefined}>
        Contenido
      </WorkflowStep>
    )

    expect(element).toBeDefined()
  })

  it('should refuse a collapsible step with no onExpandedChange', () => {
    const element = (
      // @ts-expect-error a collapsible step requires onExpandedChange
      <WorkflowStep status="active" title="Paso" isExpanded>
        Contenido
      </WorkflowStep>
    )

    expect(element).toBeDefined()
  })
})
