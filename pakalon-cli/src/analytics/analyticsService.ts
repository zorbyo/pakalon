import type { AnalyticsSink, LogEventMetadata } from './events.js';

const eventQueue: { eventName: string; metadata: LogEventMetadata; async: boolean }[] = [];
let sink: AnalyticsSink | null = null;

export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  if (sink !== null) {
    return;
  }
  sink = newSink;

  if (eventQueue.length > 0) {
    const queuedEvents = [...eventQueue];
    eventQueue.length = 0;

    queueMicrotask(() => {
      for (const event of queuedEvents) {
        if (event.async) {
          void sink!.logEventAsync(event.eventName, event.metadata);
        } else {
          sink!.logEvent(event.eventName, event.metadata);
        }
      }
    });
  }
}

export function logEvent(eventName: string, metadata: LogEventMetadata): void {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: false });
    return;
  }
  sink.logEvent(eventName, metadata);
}

export async function logEventAsync(eventName: string, metadata: LogEventMetadata): Promise<void> {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: true });
    return;
  }
  await sink.logEventAsync(eventName, metadata);
}

export function _resetForTesting(): void {
  sink = null;
  eventQueue.length = 0;
}