import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Express } from 'express'

export class Loopback {
  static readonly HOST = '127.0.0.1'
  static readonly FRONTEND_NEVER_BUILT = join(tmpdir(), 'ct-frontend-never-built')

  static originOf(port: number): string {
    return `http://${Loopback.HOST}:${port}`
  }
}

export interface StartableServer {
  start(): Promise<number>
  stop(): Promise<void>
}

export class RunningServers {
  static readonly #startable: StartableServer[] = []
  static readonly #listening: Server[] = []

  static async started(server: StartableServer): Promise<number> {
    const port = await server.start()
    RunningServers.#startable.push(server)

    return port
  }

  static async listening(app: Express): Promise<number> {
    const server = createServer(app)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, Loopback.HOST, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    RunningServers.#listening.push(server)

    return (server.address() as AddressInfo).port
  }

  static async stopAll(): Promise<void> {
    const startable = RunningServers.#startable.splice(0)
    const listening = RunningServers.#listening.splice(0)
    await Promise.all([
      ...startable.map((server) => server.stop()),
      ...listening.map((server) => new Promise<void>((resolve) => { server.close(() => resolve()) })),
    ])
  }
}
