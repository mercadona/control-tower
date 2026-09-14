import { describe, it, expect } from 'vitest'
import { ClaudeCodeAccount } from '../scripts/claude-code-account.js'

class ConfigFile {
  static withEmail(email) {
    return JSON.stringify({ oauthAccount: { emailAddress: email } })
  }

  static withoutOauthAccount() {
    return JSON.stringify({ theme: 'dark' })
  }

  static withOauthAccountMissingEmail() {
    return JSON.stringify({ oauthAccount: { accountUuid: 'abc' } })
  }
}

class Reads {
  static returning(text) {
    return () => text
  }

  static throwing(error) {
    return () => { throw error }
  }
}

describe('ClaudeCodeAccount reads the oauth email out of <home>/.claude.json', () => {
  it('a_file_with_an_oauth_email_yields_it_at_the_path_composed_from_home', () => {
    let requested = null
    const read = (path) => { requested = path; return ConfigFile.withEmail('dev@mercadona.es') }

    const email = ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })

    expect(email).toBe('dev@mercadona.es')
    expect(requested).toBe('/home/dev/.claude.json')
  })

  it('a_missing_file_yields_null_instead_of_throwing', () => {
    const read = Reads.throwing(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    expect(ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })).toBeNull()
  })

  it('a_file_that_cannot_be_parsed_as_json_yields_null', () => {
    const read = Reads.returning('not json at all')

    expect(ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })).toBeNull()
  })

  it('a_file_with_no_oauth_account_yields_null', () => {
    const read = Reads.returning(ConfigFile.withoutOauthAccount())

    expect(ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })).toBeNull()
  })

  it('an_oauth_account_with_no_email_address_yields_null', () => {
    const read = Reads.returning(ConfigFile.withOauthAccountMissingEmail())

    expect(ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })).toBeNull()
  })

  it('a_read_that_throws_for_any_other_reason_still_yields_null_and_never_propagates', () => {
    const read = Reads.throwing(new Error('EACCES: permission denied'))

    expect(() => ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })).not.toThrow()
    expect(ClaudeCodeAccount.emailFrom({ home: '/home/dev', read })).toBeNull()
  })
})
