import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export interface SandboxRegistryEntry {
  taskId: string;
  projectId: string;
  projectPath: string;
  createdAt: string;
}

interface SandboxRegistryData {
  entries: SandboxRegistryEntry[];
}

export class SandboxRegistry {
  private storePath: string;
  private data: SandboxRegistryData;

  constructor() {
    const userDataPath = app.getPath('userData');
    const storeDir = path.join(userDataPath, 'store');

    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }

    this.storePath = path.join(storeDir, 'sandbox-registry.json');
    this.data = this.load();
  }

  private load(): SandboxRegistryData {
    if (existsSync(this.storePath)) {
      try {
        const content = readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(content) as SandboxRegistryData;
        if (Array.isArray(parsed.entries)) {
          return parsed;
        }
      } catch {
        // Ignore parse errors and fall back to empty registry.
      }
    }

    return { entries: [] };
  }

  private save(): void {
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2));
  }

  list(): SandboxRegistryEntry[] {
    return this.data.entries;
  }

  getByTaskId(taskId: string): SandboxRegistryEntry | undefined {
    return this.data.entries.find((entry) => entry.taskId === taskId);
  }

  getByProjectId(projectId: string): SandboxRegistryEntry | undefined {
    return this.data.entries.find((entry) => entry.projectId === projectId);
  }

  upsert(entry: SandboxRegistryEntry): void {
    const existingIndex = this.data.entries.findIndex((e) => e.taskId === entry.taskId);
    if (existingIndex >= 0) {
      this.data.entries[existingIndex] = entry;
    } else {
      this.data.entries.push(entry);
    }
    this.save();
  }

  removeByTaskId(taskId: string): void {
    const nextEntries = this.data.entries.filter((entry) => entry.taskId !== taskId);
    if (nextEntries.length === this.data.entries.length) {
      return;
    }
    this.data.entries = nextEntries;
    this.save();
  }

  removeByProjectId(projectId: string): void {
    const nextEntries = this.data.entries.filter((entry) => entry.projectId !== projectId);
    if (nextEntries.length === this.data.entries.length) {
      return;
    }
    this.data.entries = nextEntries;
    this.save();
  }
}

export const sandboxRegistry = new SandboxRegistry();
