import { describe, expect, it, vi } from 'vitest'
import extension from '../src/index.ts'

describe('@agents-web-search/pi extension skeleton', () => {
  it('is a loadable no-op extension (registers nothing before 4.4)', () => {
    const registerTool = vi.fn()
    expect(() => extension({ registerTool })).not.toThrow()
    expect(registerTool).not.toHaveBeenCalled()
  })
})
