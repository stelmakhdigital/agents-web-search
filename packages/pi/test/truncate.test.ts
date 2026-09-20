import { describe, expect, it } from 'vitest'
import { MAX_RESULT_CHARS, MAX_RESULT_LINES, truncateForPi } from '../src/truncate.ts'

describe('truncateForPi (Pi host caps: 50KB / 2000 lines)', () => {
  it('returns short text unchanged', () => {
    expect(truncateForPi('hello')).toBe('hello')
    expect(truncateForPi('')).toBe('')
    const exactly = 'x'.repeat(MAX_RESULT_CHARS)
    expect(truncateForPi(exactly)).toBe(exactly)
  })

  it('truncates over-long text head-biased with a marker', () => {
    const text = 'a'.repeat(MAX_RESULT_CHARS + 5_000)
    const out = truncateForPi(text)
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 1)
    expect(out).toContain('… [truncated:')
    expect(out).toContain('more chars')
    expect(out.startsWith('aaa')).toBe(true)
  })

  it('truncates over-long line counts with a marker', () => {
    const text = Array.from({ length: MAX_RESULT_LINES + 100 }, (_, i) => `line-${i}`).join('\n')
    const out = truncateForPi(text)
    const lines = out.split('\n')
    expect(lines.length).toBeLessThanOrEqual(MAX_RESULT_LINES + 1)
    expect(lines[0]).toBe('line-0')
    expect(out).toContain('more lines')
  })

  it('keeps the char budget intact when both caps trip', () => {
    // 40 lines of ~2KB each = ~80KB / 40 lines: the char cap dominates.
    const text = Array.from({ length: 40 }, () => 'y'.repeat(2_000)).join('\n')
    const out = truncateForPi(text)
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 1)
    expect(out).toContain('more chars')
  })
})
