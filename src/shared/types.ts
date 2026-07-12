import type { Plugin, Hooks, ToolDefinition } from "@opencode-ai/plugin"

export interface ForjaConfig {
  enableGuard: boolean
  enableRead: boolean
  enableSieve: boolean
  enableRefactor: boolean
  enableBuild: boolean
}

export const DEFAULT_CONFIG: ForjaConfig = {
  enableGuard: true,
  enableRead: true,
  enableSieve: true,
  enableRefactor: true,
  enableBuild: true,
}

export { type Plugin, type Hooks, type ToolDefinition }
