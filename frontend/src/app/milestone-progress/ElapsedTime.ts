export class ElapsedTime {
  static since(startedAt: string, now: number): string {
    const elapsedMs = Math.max(0, now - Date.parse(startedAt))
    const totalSeconds = Math.floor(elapsedMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
}
