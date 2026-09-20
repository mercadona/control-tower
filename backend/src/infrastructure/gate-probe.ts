// A deliberate prose comment: the backend yardstick refuses these, so this file
// turns the `backend` job red on purpose and with it the `ci` aggregator.
export class GateProbe {
  static readonly WHY = 'throwaway probe of the ruleset on main, never to be merged'
}
