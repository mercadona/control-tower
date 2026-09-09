export class PlansInFlight {
  static listed(watches) {
    return new PlansInFlight(watches, null)
  }

  static refused(reason) {
    return new PlansInFlight(null, reason)
  }

  constructor(watches, reason) {
    this.watches = watches
    this.reason = reason
    Object.freeze(this)
  }

  get wereListed() {
    return this.reason === null
  }
}
