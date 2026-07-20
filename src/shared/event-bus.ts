import type { DomainEvent, DomainEventType } from "../domain/events.js";
import type { EventSink } from "./ports.js";

export interface EventBus extends EventSink {
  onAny(handler: (event: DomainEvent) => void): () => void;
}

/** Small synchronous event bus; subscribers cannot mutate scheduler truth. */
export function createEventBus(): EventBus {
  const handlers = new Map<DomainEventType, Set<(event: DomainEvent) => void>>();
  const anyHandlers = new Set<(event: DomainEvent) => void>();

  function emit(event: DomainEvent): void {
    for (const handler of [...(handlers.get(event.type) ?? []), ...anyHandlers]) {
      try {
        handler(event);
      } catch {
        // Observability subscribers are deliberately isolated from scheduling.
      }
    }
  }

  function on(type: DomainEventType, handler: (event: DomainEvent) => void): () => void {
    const set = handlers.get(type) ?? new Set<(event: DomainEvent) => void>();
    set.add(handler);
    handlers.set(type, set);
    return () => set.delete(handler);
  }

  function onAny(handler: (event: DomainEvent) => void): () => void {
    anyHandlers.add(handler);
    return () => anyHandlers.delete(handler);
  }

  return { emit, on, onAny };
}
