import { join } from 'node:path'

export class ClaudeCodeAccount {
  static CONFIG_FILE = '.claude.json'

  static emailFrom({ home, read }) {
    let text
    try {
      text = read(join(home, ClaudeCodeAccount.CONFIG_FILE))
    } catch {
      return null
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
    const email = parsed?.oauthAccount?.emailAddress
    return typeof email === 'string' && email.length > 0 ? email : null
  }
}
