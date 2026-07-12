export function ok(data: string): string {
  return JSON.stringify({ ok: true, data })
}

export function fail(err: string): string {
  return JSON.stringify({ ok: false, err })
}
