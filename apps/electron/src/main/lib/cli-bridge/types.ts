import type { CliBridgeDiscovery } from '@kila/shared'

export interface CliBridgeRouteContext {
  appVersion: string
  broadcastSessionChannel: (channel: string, payload: unknown) => void
}

export interface CliBridgeServerState {
  discovery: CliBridgeDiscovery
}
