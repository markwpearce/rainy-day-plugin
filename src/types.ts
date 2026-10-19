export type Meter = 'session' | 'weekly'; // session = the 5-hour window

export interface MeterReading {
  usedPct: number;
  resetsAt: number; // epoch ms
}

export interface UsageSnapshot {
  session?: MeterReading;
  weekly?: MeterReading;
  fetchedAt: number;
}

export interface Limit {
  id: string;
  meter: Meter;
  stopAt: number; // absolute percent on the meter
  scope: { kind: 'global' } | { kind: 'session'; sessionId: string };
  until: { kind: 'cleared' } | { kind: 'reset'; at: number } | { kind: 'date'; at: number };
  label?: string;
  createdAt: number;
  warned: boolean;
  trippedAt?: number;
  graceLeft?: number;
}
