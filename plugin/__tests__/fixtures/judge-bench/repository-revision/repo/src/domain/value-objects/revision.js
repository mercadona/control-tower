export class Revision {
  constructor(text) {
    this.text = text
    Object.freeze(this)
  }
}
