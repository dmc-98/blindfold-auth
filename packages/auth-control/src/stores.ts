import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Control-plane persistence is a tiny load()/save() document store. Two
 * implementations ship: in-memory (tests) and file-backed (real use). Both
 * round-trip a single JSON document: { projects: {...}, keys: {...} }.
 */
export interface ControlDoc {
  projects: Record<string, any>;
  keys: Record<string, any>;
}

export interface ControlStore {
  load(): ControlDoc;
  save(next: ControlDoc): void;
}

const EMPTY = (): ControlDoc => ({ projects: {}, keys: {} });

export function createMemoryStore(initial?: ControlDoc): ControlStore {
  let doc: ControlDoc = initial ? structuredClone(initial) : EMPTY();
  return {
    load() {
      return structuredClone(doc);
    },
    save(next: ControlDoc) {
      doc = structuredClone(next);
    }
  };
}

export function createFileStore(filePath: string): ControlStore {
  if (!filePath) {
    throw new Error("createFileStore requires a filePath");
  }
  return {
    load() {
      if (!existsSync(filePath)) {
        return EMPTY();
      }
      try {
        return { ...EMPTY(), ...JSON.parse(readFileSync(filePath, "utf8")) };
      } catch {
        return EMPTY();
      }
    },
    save(next: ControlDoc) {
      const dir = dirname(filePath);
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, JSON.stringify(next, null, 2));
    }
  };
}
