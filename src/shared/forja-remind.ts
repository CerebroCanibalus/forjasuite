import { logSync } from "./logger.js"

interface Reminder {
  id: string
  text: string
  dueAt: number | null
  recurring: number | null
  sessionId: string
}

export class ForjaRemind {
  private client: any
  private reminders: Reminder[] = []
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(client: any) {
    this.client = client
  }

  async addReminder(text: string, delaySec: number, sessionId: string, recurring?: boolean): Promise<string> {
    const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const dueAt = delaySec > 0 ? Date.now() + delaySec * 1000 : null
    const reminder: Reminder = { id, text, dueAt, recurring: recurring && delaySec > 0 ? delaySec * 1000 : null, sessionId }
    this.reminders.push(reminder)
    this.scheduleReminder(reminder)
    return id
  }

  listReminders(): Reminder[] {
    return [...this.reminders]
  }

  async removeReminder(id: string): Promise<boolean> {
    const idx = this.reminders.findIndex(r => r.id === id)
    if (idx === -1) return false
    this.reminders.splice(idx, 1)
    const timer = this.timers.get(id)
    if (timer) { clearTimeout(timer); this.timers.delete(id) }
    return true
  }

  private scheduleReminder(r: Reminder) {
    if (!r.dueAt || !r.sessionId) return
    const delay = Math.max(0, r.dueAt - Date.now())
    const timer = setTimeout(async () => {
      try {
        await this.client.session.prompt({
          path: { id: r.sessionId },
          body: { noReply: true, parts: [{ type: "text", text: `🔔 Recordatorio: ${r.text}` }] },
        })
        if (r.recurring) {
          r.dueAt = Date.now() + r.recurring
          this.scheduleReminder(r)
        }
      } catch (err) {
        logSync(this.client, { service: "remind", level: "error", message: `recordatorio #${r.id} falló: ${String(err).slice(0, 100)}` })
      }
    }, delay)
    this.timers.set(r.id, timer)
  }

  clearAll() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.reminders = []
  }
}
