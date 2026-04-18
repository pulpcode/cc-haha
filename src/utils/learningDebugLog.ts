import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { jsonStringify } from './slowOperations.js'

function getLearningDebugLogPath(): string {
  return (
    process.env.CLAUDE_CODE_LEARNING_DEBUG_FILE ??
    join(getClaudeConfigHomeDir(), 'learning-debug.log')
  )
}

export function logForLearning(tag: string, data?: Record<string, unknown>): void {
  const fs = getFsImplementation()
  const logPath = getLearningDebugLogPath()
  const entry = {
    timestamp: new Date().toISOString(),
    tag,
    data: data ?? {},
  }
  const line = `${jsonStringify(entry)}\n`

  try {
    mkdirSync(dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, line)
  } catch {
    // Learning logs should never interfere with normal app behavior.
  }
}
