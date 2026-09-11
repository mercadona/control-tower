import express from 'express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

export class Refusal {
  readonly status: number
  readonly code: string
  readonly detail: string

  constructor({ status, code, detail }: { status: unknown, code: unknown, detail: unknown }) {
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`a refusal answers with a client or server status, got ${JSON.stringify(status)}`)
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error(`a refusal names its code, got ${JSON.stringify(code)}`)
    }
    if (typeof detail !== 'string' || detail.trim().length === 0) {
      throw new Error(`a refusal says why, got ${JSON.stringify(detail)}`)
    }
    this.status = status
    this.code = code
    this.detail = detail
    Object.freeze(this)
  }
}

export class Answer {
  static readonly JSON_MEDIA_TYPE = 'application/json'

  static send(response: Response, status: number, payload: unknown): void {
    response.setHeader('Content-Type', Answer.JSON_MEDIA_TYPE)
    response.status(status).end(JSON.stringify(payload))
  }

  static refuse(response: Response, status: number, code: string, detail: string): void {
    Answer.send(response, status, { code, detail })
  }

  static refuseAs(response: Response, refusal: Refusal): void {
    Answer.refuse(response, refusal.status, refusal.code, refusal.detail)
  }
}

export class Route {
  static readonly #TRAILING_SLASHES = /\/+$/

  static collapseTrailingSlashes(request: Request, response: Response, next: NextFunction): void {
    const asked = request.url.indexOf('?')
    const path = asked === -1 ? request.url : request.url.slice(0, asked)
    const query = asked === -1 ? '' : request.url.slice(asked)
    request.url = `${path.replace(Route.#TRAILING_SLASHES, '') || '/'}${query}`

    next()
  }
}

export class Browsers {
  static readonly #ORIGIN = 'Origin'
  static readonly #HOST = 'Host'
  static readonly LOOPBACK_NAMES: readonly string[] = Object.freeze(['127.0.0.1', 'localhost', '[::1]'])

  static #hostnameOf(host: string): string {
    return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  }

  static isOurOwnPage(origin: unknown, host: unknown): boolean {
    if (typeof host !== 'string' || !Browsers.LOOPBACK_NAMES.includes(Browsers.#hostnameOf(host))) return false

    return origin === `http://${host}`
  }

  static turnAwayForeign(request: Request, response: Response, next: NextFunction): void {
    const origin = request.get(Browsers.#ORIGIN)
    if (origin === undefined || Browsers.isOurOwnPage(origin, request.get(Browsers.#HOST))) {
      next()
      return
    }
    Answer.refuse(response, 403, 'foreign-origin', 'this api only serves the page it hosts')
  }
}

export class JsonBody {
  static readonly MAX_BYTES = 8 * 1024
  static readonly #OVERFLOW = 'entity.too.large'

  static isOverflow(cause: { type?: unknown }): boolean {
    return cause.type === JsonBody.#OVERFLOW
  }

  static overflowRefusal(): Refusal {
    return new Refusal({ status: 413, code: 'body-too-large', detail: `body must not exceed ${JsonBody.MAX_BYTES} bytes` })
  }

  static #declaredBy(request: Request): boolean {
    const declared = request.get('Content-Type')

    return typeof declared === 'string' && declared.split(';')[0].trim() === Answer.JSON_MEDIA_TYPE
  }

  static demandDeclared(request: Request, response: Response, next: NextFunction): void {
    if (JsonBody.#declaredBy(request)) {
      next()
      return
    }
    Answer.refuse(response, 415, 'unsupported-media-type', `Content-Type must be ${Answer.JSON_MEDIA_TYPE}`)
  }

  static reader(): RequestHandler {
    return express.raw({ type: Answer.JSON_MEDIA_TYPE, limit: JsonBody.MAX_BYTES, inflate: false })
  }

  static textOf(request: Request): string {
    return Buffer.isBuffer(request.body) ? request.body.toString('utf8') : ''
  }
}
