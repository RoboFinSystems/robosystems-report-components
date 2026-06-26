/**
 * Vitest setup — runs before every test file.
 *
 * Component tests render into happy-dom; unmount React trees after each test so
 * they don't leak between cases.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
