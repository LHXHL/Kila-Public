import type { RuntimeMessageChannel, RuntimeMessageEnvelopeV1 } from '@kila/shared'

export const MAX_RUNTIME_MESSAGE_BYTES = 256 * 1024

export type SequenceDecision = 'accepted' | 'duplicate' | 'desync'

export class RuntimeSequenceTracker {
  private expected = 1

  accept(sequence: number): SequenceDecision {
    if (!Number.isInteger(sequence) || sequence < 1) return 'desync'
    if (sequence < this.expected) return 'duplicate'
    if (sequence > this.expected) return 'desync'
    this.expected += 1
    return 'accepted'
  }

  nextSequence(): number {
    return this.expected
  }
}

export class RuntimeTransportSequenceState {
  private readonly trackers: Record<RuntimeMessageChannel, RuntimeSequenceTracker> = {
    command: new RuntimeSequenceTracker(),
    control: new RuntimeSequenceTracker(),
    event: new RuntimeSequenceTracker(),
  }

  accept(channel: RuntimeMessageChannel, sequence: number): SequenceDecision {
    return this.trackers[channel].accept(sequence)
  }

  nextSequence(channel: RuntimeMessageChannel): number {
    return this.trackers[channel].nextSequence()
  }
}

export function assertRuntimeMessageSize<T>(message: RuntimeMessageEnvelopeV1<T>): void {
  const encoded = JSON.stringify(message)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_RUNTIME_MESSAGE_BYTES) {
    throw new Error('runtime_protocol_payload_too_large: control message 超过 256KiB')
  }
}

