import type { MotionSample } from './types.ts';

export type DatasetName =
  | 'STATIONARY'
  | 'WALKING'
  | 'RUNNING'
  | 'PICKUP'
  | 'PUT_DOWN'
  | 'ROTATION'
  | 'DROP'
  | 'VIBRATION'
  | 'MACHINERY'
  | 'SUSTAINED_OSCILLATION'
  | 'NOISY'
  | 'INTERRUPTED'
  | 'IRREGULAR';

export interface SimulatedDataset {
  name: DatasetName;
  description: string;
  samples: MotionSample[];
}

const DT = 20;
const COUNT = 400; // 8 seconds at 50 Hz — enough for consecutive analysis windows

interface Generator {
  description: string;
  value: (t: number, i: number) => {
    ax: number; ay: number; az: number;
    gx?: number; gy?: number; gz?: number;
  };
}

const GENERATORS: Record<DatasetName, Generator> = {
  STATIONARY: {
    description: 'Phone resting still with light sensor noise.',
    value: (t) => ({ ax: Math.sin(t / 170) * 0.03, ay: 9.81 + Math.cos(t / 210) * 0.03, az: 0.02 }),
  },
  WALKING: {
    description: 'Steady 2 Hz walking with rotation.',
    value: (t) => {
      const p = (2 * Math.PI * 2 * t) / 1000;
      const v = Math.sin(p) * 1.2;
      return { ax: v, ay: 9.81 + v * 0.5, az: 0, gx: Math.cos(p) * 1.4 };
    },
  },
  RUNNING: {
    description: 'Vigorous 3 Hz running motion.',
    value: (t) => {
      const p = (2 * Math.PI * 3 * t) / 1000;
      const v = Math.sin(p) * 2.1;
      return { ax: v, ay: 9.81 + v * 0.8, az: Math.sin(p * 0.5) * 0.6, gz: Math.cos(p) * 2.2 };
    },
  },
  PICKUP: {
    description: 'Single smooth lift then settle.',
    value: (t) => {
      const lift = t > 800 && t < 1400 ? Math.sin(((t - 800) / 600) * Math.PI) * 2.2 : 0;
      return { ax: lift, ay: 9.81 + lift * 0.5, az: 0, gz: lift * 0.4 };
    },
  },
  PUT_DOWN: {
    description: 'Lowering the phone onto a surface.',
    value: (t) => {
      const drop = t > 1200 && t < 1700 ? -Math.sin(((t - 1200) / 500) * Math.PI) * 1.8 : 0;
      return { ax: 0, ay: 9.81 + drop, az: 0, gz: -drop * 0.3 };
    },
  },
  ROTATION: {
    description: 'Phone rotated in the hand; high gyroscope activity.',
    value: (t) => {
      const p = (2 * Math.PI * 0.7 * t) / 1000;
      return { ax: Math.sin(p) * 1.0, ay: 9.81 * Math.cos(p * 0.2), az: 2, gz: Math.cos(p) * 3.5 };
    },
  },
  DROP: {
    description: 'Free-fall interval followed by an impact and settling (simulated only).',
    value: (t) => {
      if (t >= 1600 && t < 1900) return { ax: 0, ay: 0.2, az: 0 }; // free fall
      if (t >= 1900 && t < 1950) return { ax: 12, ay: 18, az: 9 };  // impact
      if (t >= 1950 && t < 2300) return { ax: Math.sin(t) * 0.8, ay: 9.81, az: 0 };
      return { ax: 0, ay: 9.81, az: 0 };
    },
  },
  VIBRATION: {
    description: 'Phone vibration motor: high-frequency, low-amplitude.',
    value: (t) => {
      const v = Math.sin((2 * Math.PI * 15 * t) / 1000) * 0.9;
      return { ax: v, ay: 9.81 + v, az: v * 0.5 };
    },
  },
  MACHINERY: {
    description: 'Repetitive machinery or vehicle vibration.',
    value: (t) => {
      const v = Math.sin((2 * Math.PI * 9 * t) / 1000) * 1.3;
      return { ax: v, ay: 9.81 + v * 0.8, az: v * 0.6 };
    },
  },
  SUSTAINED_OSCILLATION: {
    description: 'Sustained 4 Hz multi-axis oscillation (experimental target pattern).',
    value: (t) => {
      const p = (2 * Math.PI * 4 * t) / 1000;
      return {
        ax: Math.sin(p) * 3.6,
        ay: 9.81 + Math.cos(p) * 3.4,
        az: Math.sin(p * 0.9) * 2.8,
      };
    },
  },
  NOISY: {
    description: 'Stationary phone with heavy random sensor noise.',
    value: (t) => ({
      ax: Math.sin(t * 1.7) * 1.2 + Math.cos(t * 0.31) * 0.8,
      ay: 9.81 + Math.sin(t * 2.3) * 1.1,
      az: Math.cos(t * 1.1) * 1.3,
    }),
  },
  INTERRUPTED: {
    description: 'Motion with a gap in the sensor stream.',
    value: (t) => {
      if (t > 1400 && t < 2400) return { ax: 0, ay: 9.81, az: 0 };
      const p = (2 * Math.PI * 4 * t) / 1000;
      return { ax: Math.sin(p) * 3.4, ay: Math.cos(p) * 3.2, az: 0 };
    },
  },
  IRREGULAR: {
    description: 'Short, irregular bursts with orientation changes.',
    value: (t) => {
      const burst = t % 700 < 180 ? Math.sin(t) * 2.4 : 0;
      return { ax: burst, ay: 9.81 + burst * 0.4, az: 0, gz: burst * 1.5 };
    },
  },
};

export const DATASET_NAMES = Object.keys(GENERATORS) as DatasetName[];

export function generateDataset(name: DatasetName, count = COUNT): SimulatedDataset {
  const generator = GENERATORS[name];
  const samples: MotionSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * DT;
    const v = generator.value(t, i);
    samples.push({
      timestampMs: t,
      ax: v.ax,
      ay: v.ay,
      az: v.az,
      ...(v.gx !== undefined ? { gx: v.gx } : {}),
      ...(v.gy !== undefined ? { gy: v.gy } : {}),
      ...(v.gz !== undefined ? { gz: v.gz } : {}),
      linear: false,
      source: 'simulated',
    });
  }
  return { name, description: generator.description, samples };
}

export function generateAllDatasets(): SimulatedDataset[] {
  return DATASET_NAMES.map((name) => generateDataset(name));
}
