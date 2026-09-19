import { isAbsolute, join } from 'node:path'

export class ControlTowerState {
  static VARIABLE = 'CT_STATE_DIR'
  static DIRECTORY = 'control-tower'

  static directory(configured, requested) {
    if (requested === undefined || requested === null || requested === '') {
      return join(configured, ControlTowerState.DIRECTORY)
    }
    if (typeof requested !== 'string' || !isAbsolute(requested) || requested.includes('\0')) {
      throw new InvalidStateDirectory(requested)
    }

    return requested
  }
}

export class InvalidStateDirectory extends TypeError {
  constructor(requested) {
    super(`${ControlTowerState.VARIABLE} must be an absolute path without null bytes, got ${JSON.stringify(requested)}`)
  }
}
