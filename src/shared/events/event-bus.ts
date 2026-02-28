import { EventEmitter } from "node:events";
import type { DashboardEvent, DashboardEventMap } from "./event-types.js";

class DashboardEventBus extends EventEmitter {
  private static instance: DashboardEventBus;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  static getInstance(): DashboardEventBus {
    if (!DashboardEventBus.instance) {
      DashboardEventBus.instance = new DashboardEventBus();
    }
    return DashboardEventBus.instance;
  }

  emitEvent<K extends keyof DashboardEventMap>(event: DashboardEventMap[K]): void {
    this.emit(event.type, event);
    this.emit("dashboard_event", event);
  }

  onEvent<K extends keyof DashboardEventMap>(
    type: K,
    listener: (event: DashboardEventMap[K]) => void
  ): this {
    return this.on(type, listener as (...args: any[]) => void);
  }
}

export const eventBus = DashboardEventBus.getInstance();
