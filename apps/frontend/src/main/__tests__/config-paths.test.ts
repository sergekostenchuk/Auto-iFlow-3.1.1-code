import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { getMemoriesDir } from '../config-paths';

describe('getMemoriesDir', () => {
  const originalEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    APPIMAGE: process.env.APPIMAGE,
    SNAP: process.env.SNAP,
    FLATPAK_ID: process.env.FLATPAK_ID
  };
  const originalPlatform = process.platform;
  let tempDir = '';
  let defaultPath = '';

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'graphiti-paths-'));
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    defaultPath = path.join(tempDir, '.auto-iflow', 'graphs');

    delete process.env.XDG_DATA_HOME;
    delete process.env.APPIMAGE;
    delete process.env.SNAP;
    delete process.env.FLATPAK_ID;

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.env.HOME = originalEnv.HOME;
    process.env.USERPROFILE = originalEnv.USERPROFILE;
    process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME;
    process.env.APPIMAGE = originalEnv.APPIMAGE;
    process.env.SNAP = originalEnv.SNAP;
    process.env.FLATPAK_ID = originalEnv.FLATPAK_ID;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true
    });
  });

  it('returns auto-iflow graphs when present', () => {
    mkdirSync(defaultPath, { recursive: true });

    expect(getMemoriesDir()).toBe(defaultPath);
  });

  it('creates auto-iflow graphs when missing', () => {
    const resolved = getMemoriesDir();

    expect(resolved).toBe(defaultPath);
    expect(existsSync(defaultPath)).toBe(true);
  });
});
