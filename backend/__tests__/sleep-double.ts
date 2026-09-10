export class SleepDouble {
  readonly slept: number[]

  constructor() {
    this.slept = []
  }

  sleep(seconds: number): Promise<void> {
    this.slept.push(seconds)

    return Promise.resolve()
  }
}
