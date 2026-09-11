export class TelemetryLines {
  static objectsOf(text) {
    const objects = []
    for (const line of String(text ?? '').split('\n')) {
      if (line.trim() === '') continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      objects.push(parsed)
    }
    return objects
  }
}
