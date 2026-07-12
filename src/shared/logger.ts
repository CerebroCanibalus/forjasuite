export interface LogEntry {
  service: string
  level: "debug" | "info" | "warn" | "error"
  message: string
  extra?: Record<string, unknown>
}

export async function log(client: any, entry: LogEntry): Promise<void> {
  try {
    await client.app.log({ body: { ...entry, service: `forja/${entry.service}` } })
  } catch {
    // Fallback: console cuando el client no está disponible
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`[${ts}] [forja/${entry.service}] [${entry.level}] ${entry.message}`)
  }
}

export function logSync(client: any, entry: LogEntry): void {
  log(client, entry).catch(() => {})
}
