export class CommandOutput {
  constructor(code, stdout) {
    this.code = code
    this.stdout = stdout
    Object.freeze(this)
  }
}
