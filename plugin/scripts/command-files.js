import * as fs from 'node:fs'
import { resolve } from 'node:path'

export class CommandFiles {
  constructor(cwd) { this.cwd = cwd }

  path(path) { return typeof path === 'string' ? resolve(this.cwd, path) : path }

  readFileSync = (path, ...options) => fs.readFileSync(this.path(path), ...options)
  writeFileSync = (path, ...options) => fs.writeFileSync(this.path(path), ...options)
  appendFileSync = (path, ...options) => fs.appendFileSync(this.path(path), ...options)
  existsSync = (path) => fs.existsSync(this.path(path))
  mkdirSync = (path, ...options) => fs.mkdirSync(this.path(path), ...options)
  unlinkSync = (path) => fs.unlinkSync(this.path(path))
  readdirSync = (path, ...options) => fs.readdirSync(this.path(path), ...options)
  statSync = (path, ...options) => fs.statSync(this.path(path), ...options)
}
