import { describe, expect, it } from 'vitest'

import {
  normalizeArielOpenString,
  pathFromArielDeepLink,
  pathFromOpenDeepLink,
  resolveArielOpenPath
} from './ariel-open-target'

describe('normalizeArielOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeArielOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeArielOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped ariel:// deep links to the same path', () => {
    expect(normalizeArielOpenString('ariel://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeArielOpenString('ariel://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps ariel://open/… deep links by stripping the open host', () => {
    expect(normalizeArielOpenString('ariel://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeArielOpenString('ariel://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved ariel kinds and unsafe paths', () => {
    expect(normalizeArielOpenString('ariel://blueprint/morning-brief')).toBeNull()
    expect(normalizeArielOpenString('ariel://plugin/install')).toBeNull()
    expect(normalizeArielOpenString('https://example.com/x')).toBeNull()
    expect(normalizeArielOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeArielOpenString('index-network')).toBeNull()
  })
})

describe('resolveArielOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveArielOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveArielOpenPath({ href: 'ariel://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromArielDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromArielDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from ariel://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromArielDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromArielDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromArielDeepLink('plugin', 'install')).toBeNull()
  })
})
