// Ereignisbus für Live-Aktualisierungen der Oberfläche (Server-Sent Events).
import { EventEmitter } from 'node:events';
import type { ChangeEntity, ChangeEvent } from '../../shared/schemas.ts';

class EventBus extends EventEmitter {
  changed(entity: ChangeEntity, id?: number) {
    const event: ChangeEvent = { type: 'changed', entity, id };
    this.emit('event', event);
  }
}

export const events = new EventBus();
events.setMaxListeners(100);
