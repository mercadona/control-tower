import { Baseline } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'

const TITLES: Record<string, string> = {
  rojo: 'El repositorio ya estaba en rojo antes de empezar',
  'no-verificado': 'No se ha podido comprobar cómo estaba el repositorio',
}

const describe = (baseline: Baseline): string => {
  const said = baseline.command === null ? baseline.summary : `${baseline.command}: ${baseline.summary}`

  return baseline.outcome === 'rojo'
    ? `${said}. El agente no podrá distinguir sus fallos de los que ya había.`
    : said
}

type Props = {
  baseline?: Baseline
}

const BaselineNotice = ({ baseline }: Props) => {
  if (baseline === undefined || baseline.outcome === 'verde') return null

  return (
    <Banner
      type="warning"
      title={TITLES[baseline.outcome]}
      description={describe(baseline)}
    />
  )
}

export { BaselineNotice }
