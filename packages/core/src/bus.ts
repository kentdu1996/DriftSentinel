import { EventEmitter } from "node:events";
import type { DriftVerdict, GepCycle } from "./types.js";

export interface AppEvents {
  "probe.done": { endpointId: string; score: number; ts: number };
  "drift.verdict": DriftVerdict;
  "gep.phase": GepCycle;
  "route.changed": { task: string; best: string };
  "evomap.published": { assetId: string; kind: string };
  "consensus.reached": {
    endpointId: string;
    dimension: string;
    level: string;
    nodes: number;
  };
  // GDI public-verdict social signals (P1): emitted after a real publish when
  // the node casts its own vote / validation report on the freshly shared asset.
  "evomap.vote": { assetId: string; value: number; ok: boolean };
  "evomap.report": { assetId: string; status: string; score: number; ok: boolean };
  // Private experience memory (P1): emitted when the node records the confirmed
  // degradation into its own /a2a/memory/record store.
  "evomap.memory": { endpointId: string; status: string; score: number; ok: boolean };
}

export type AppEventName = keyof AppEvents;

class TypedBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit<K extends AppEventName>(name: K, payload: AppEvents[K]): void {
    this.emitter.emit(name, payload);
    this.emitter.emit("*", { name, payload });
  }

  on<K extends AppEventName>(name: K, fn: (payload: AppEvents[K]) => void): void {
    this.emitter.on(name, fn as (p: unknown) => void);
  }

  onAny(fn: (evt: { name: AppEventName; payload: unknown }) => void): void {
    this.emitter.on("*", fn);
  }

  off<K extends AppEventName>(name: K, fn: (payload: AppEvents[K]) => void): void {
    this.emitter.off(name, fn as (p: unknown) => void);
  }
}

export const bus = new TypedBus();
