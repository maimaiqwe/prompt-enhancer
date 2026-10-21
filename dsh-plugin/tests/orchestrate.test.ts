import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG } from '../src/config'
import { defaultRouteOf, sessionRouteOf } from '../src/orchestrate'

/**
 * Minimal cordis stand-in. Cordis services are injected as CONTEXT PROPERTIES
 * (`ctx.agentDefaultModel`), not via `ctx.get`, hence the second argument —
 * a cordis-service face has to be shaped as a property to be reachable.
 */
function fakeCtx(services: Record<string, unknown>, props: Record<string, unknown> = {}): Context {
  return { get: (key: string) => services[key], ...props } as never
}

describe('route resolution helpers', () => {
  it('reads the harness default model and trims it', () => {
    const ctx = fakeCtx({ settings: { get: (ns: string) => (ns === 'agent-default-model' ? { provider: ' zhipu ', model: ' glm ' } : undefined) } })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'zhipu', model: 'glm' })
  })

  it('ignores malformed default-model sections', () => {
    expect(defaultRouteOf(fakeCtx({ settings: { get: () => ({ provider: 'x', model: '' }) } }))).toBeUndefined()
    expect(defaultRouteOf(fakeCtx({ settings: { get: () => null } }))).toBeUndefined()
    expect(defaultRouteOf(fakeCtx({}))).toBeUndefined()
  })

  // Regression (dsh >= 0.1.5-rc.3): the settings service became `SettingsForms`
  // with no synchronous `get`. Calling through the old shape threw
  // `ctx.get(...)?.get is not a function` and 502'd EVERY enhancement, because
  // this sits on every request's route-resolution path. A missing reader must
  // degrade to "no answer", never to a thrown TypeError.
  it('degrades when the settings service has no synchronous reader', () => {
    const forms = { configure: () => {}, describe: () => [], update: async () => {} }
    expect(() => defaultRouteOf(fakeCtx({ settings: forms }))).not.toThrow()
    expect(defaultRouteOf(fakeCtx({ settings: forms }))).toBeUndefined()
  })

  it('degrades when the sessions store has no reader', () => {
    expect(sessionRouteOf(fakeCtx({ sessions: { list: () => [] } }), 's1')).toBeUndefined()
  })

  // dsh >= 0.1.5-rc.3 reads the selection from `ctx.agentDefaultModel`
  // instead of the settings namespace. Both shapes must answer; neither may
  // throw, because this runs on every enhance request.
  it('reads the harness default model from agentDefaultModel', () => {
    const ctx = fakeCtx({}, { agentDefaultModel: { currentSelection: () => ({ provider: ' deepseek ', model: ' chat ' }) } })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('prefers agentDefaultModel and falls back to the legacy settings read', () => {
    const legacy = fakeCtx({ settings: { get: () => ({ provider: 'legacy-p', model: 'legacy-m' }) } })
    expect(defaultRouteOf(legacy)).toEqual({ provider: 'legacy-p', model: 'legacy-m' })

    const emptyModern = fakeCtx(
      { settings: { get: () => ({ provider: 'legacy-p', model: 'legacy-m' }) } },
      { agentDefaultModel: { currentSelection: () => undefined } },
    )
    expect(defaultRouteOf(emptyModern)).toEqual({ provider: 'legacy-p', model: 'legacy-m' })
  })

  it('survives an agentDefaultModel that throws', () => {
    const ctx = fakeCtx({}, { agentDefaultModel: { currentSelection: () => { throw new Error('boom') } } })
    expect(() => defaultRouteOf(ctx)).not.toThrow()
    expect(defaultRouteOf(ctx)).toBeUndefined()
  })

  // cordis throws `cannot get property "agentDefaultModel" without inject` for
  // any service that was not declared via `inject`, and the PROPERTY READ is
  // what throws — so guarding only the call would still 502 every request.
  it('survives reading agentDefaultModel without inject', () => {
    const ctx = {
      get: (key: string) => undefined,
      get agentDefaultModel(): never {
        throw new Error('cannot get property "agentDefaultModel" without inject')
      },
    } as never
    expect(() => defaultRouteOf(ctx)).not.toThrow()
    expect(defaultRouteOf(ctx)).toBeUndefined()
  })

  // Regression: `Session.requestHeader` is a method in both 0.1.1-rc.2 and
  // 0.1.2-alpha.3. The previous mock shaped it as a plain property, so the test
  // passed against something the runtime never produces while the real call
  // silently returned undefined.
  it('reads the session request route when a session id is given', () => {
    const ctx = fakeCtx({
      sessions: {
        get: (id: string) => (id === 's1' ? { requestHeader: () => ({ config: { provider: ' p1 ', model: ' m1 ' } }) } : undefined),
      },
    })
    expect(sessionRouteOf(ctx, 's1')).toEqual({ provider: 'p1', model: 'm1' })
    expect(sessionRouteOf(ctx, 'missing')).toBeUndefined()
    expect(sessionRouteOf(ctx, undefined)).toBeUndefined()
    expect(sessionRouteOf(ctx, '')).toBeUndefined()
  })

  it('tolerates a header method that returns nothing', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => undefined }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  // Regression: a throwing `requestHeader()` (frozen session object, future
  // signature change) must degrade to the default route instead of failing
  // the whole enhance request.
  it('degrades when the header method throws', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => { throw new Error('boom') } }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  it('still accepts the property shape defensively', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: { config: { provider: 'p2', model: 'm2' } } }) } })
    expect(sessionRouteOf(ctx, 's1')).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('resolves nothing without a sessions service or a partial section', () => {
    expect(sessionRouteOf(fakeCtx({}), 's1')).toBeUndefined()
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => ({ config: { provider: 'p', model: '' } }) }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  it('resolves nothing when the harness has no default model either', () => {
    expect(defaultRouteOf(fakeCtx({}))).toBeUndefined()
  })

  it('keeps the defaults constant in sync', () => {
    expect(DEFAULT_CONFIG.maxConcurrent).toBe(2)
    expect(DEFAULT_CONFIG.rateLimitPerMinute).toBe(10)
  })
})
