import { app } from 'electron';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const SANDBOX_ROOT_DIRNAME = 'Auto-iFlow-Sandboxes';

const slugifyTitle = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || 'sandbox';
};

export const getSandboxRootPath = (): string =>
  path.join(app.getPath('documents'), SANDBOX_ROOT_DIRNAME);

export const createSandboxProjectDirectory = (title: string): { path: string; name: string } => {
  const rootPath = getSandboxRootPath();
  if (!existsSync(rootPath)) {
    mkdirSync(rootPath, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${timestamp}-${slugifyTitle(title)}`;
  let candidateName = baseName;
  let candidatePath = path.join(rootPath, candidateName);
  let suffix = 1;

  while (existsSync(candidatePath)) {
    candidateName = `${baseName}-${suffix}`;
    candidatePath = path.join(rootPath, candidateName);
    suffix += 1;
  }

  mkdirSync(candidatePath, { recursive: true });
  return { path: candidatePath, name: candidateName };
};
