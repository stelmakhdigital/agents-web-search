/**
 * Mandatory Pi output truncate: 50 KB / 2000 lines (Pi convention for
 * tool results, see the pi-web-access precedent). The core already applies
 * its own caps (fetch maxOutputChars etc.); this is the HOST-level cap for
 * what a tool result may occupy in the model context.
 *
 * The truncate is HEAD-BIASED: the beginning of a search/fetch result is
 * always the most useful part, so the head is kept and the tail is replaced
 * with a one-line marker (size + line counts, so the model can re-request
 * the rest, e.g. via a fetch with a smaller cap).
 *
 * @module @agents-web-search/pi/truncate
 */

/** Maximum characters for one tool result (50 KB). */
export const MAX_RESULT_CHARS = 50_000

/** Maximum lines for one tool result. */
export const MAX_RESULT_LINES = 2_000

/**
 * Truncate a tool result to the Pi host caps.
 * @param text - the full tool result text.
 * @returns the text unchanged when under both caps, otherwise the head part
 *   plus a truncate marker line.
 */
export function truncateForPi(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) {
    return truncateLines(text)
  }
  const budget = MAX_RESULT_CHARS - 160 // room for the marker line
  const head = text.slice(0, budget)
  const totalLines = countLines(text)
  const remainingChars = text.length - budget
  return `${head}\n… [truncated: ${remainingChars.toLocaleString('en-US')} more chars, ${totalLines - countLines(head)} more lines; total ${text.length.toLocaleString('en-US')} chars / ${totalLines.toLocaleString('en-US')} lines]`
}

/** Truncate to the line cap (head-biased), under the char budget. */
function truncateLines(text: string): string {
  if (countLines(text) <= MAX_RESULT_LINES) return text
  const lines = text.split('\n')
  const head = lines.slice(0, MAX_RESULT_LINES).join('\n')
  return `${head}\n… [truncated: ${lines.length - MAX_RESULT_LINES} more lines]`
}

/** Count lines ('a\nb' = 2 lines; trailing newline does not add a line). */
function countLines(text: string): number {
  if (text.length === 0) return 0
  let count = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return count
}
