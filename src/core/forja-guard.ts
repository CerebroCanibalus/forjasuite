const SENSITIVE_READ = [/\.env$/i, /credentials\./i, /\bsecret\b/i, /\.pem$/i]

export function createGuardHooks() {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      const toolName = String(input.tool || "")
      const filePath = output.args?.filePath || input.args?.filePath || ""

      if (toolName === "read" && filePath) {
        for (const re of SENSITIVE_READ) {
          if (re.test(filePath)) {
            throw new Error(`🛡️ Forja-Guard: lectura bloqueada — archivo sensible: ${filePath}`)
          }
        }
      }
    },
  }
}
