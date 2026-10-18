import type { z } from "zod";
export interface StudioNode {
  id: string;
  parentId: string | null;
  name: string;
  className: string;
  scriptPath?: string;
  source?: string;
  readable?: boolean;
  properties: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    size?: [number, number, number];
    color?: string;
    anchored?: boolean;
    shape?: "Block" | "Ball" | "Cylinder";
  };
}
export interface StudioSnapshot {
  version: 1;
  snapshotId: string;
  placeId: string;
  nodes: StudioNode[];
}
export interface StudioBundle {
  version: 1;
  id: string;
  baseSnapshotId: string;
  placeId: string;
  changes: (
    { op: "create" | "update"; node: StudioNode } | { op: "delete"; id: string }
  )[];
}
export const STUDIO_PLUGIN: {
  version: string;
  file: string;
  bundle: string;
  name: string;
  limits: {
    nodes: number;
    scripts: number;
    sourceBytes: number;
    snapshotBytes: number;
    changes: number;
    sceneObjects: number;
  };
};
export const editableClasses: string[];
export const snapshotSchema: z.ZodType<StudioSnapshot>;
export const studioNodeSchema: z.ZodType<StudioNode>;
export const bundleSchema: z.ZodType<StudioBundle>;
export function canonical(value: unknown): string;
export function buildBundle(
  snapshot: StudioSnapshot,
  desired: StudioSnapshot,
  files: Record<string, string>,
): StudioBundle;
export function validateBundle(
  snapshot: StudioSnapshot,
  bundle: StudioBundle,
): StudioBundle;
