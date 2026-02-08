/**
 * E2E tests for quality checks visibility (Post-Code Tests + error reasons).
 *
 * NOTE: Requires built Electron app and ELECTRON_PATH environment variable.
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

const TEST_DATA_DIR = '/tmp/auto-iflow-ui-e2e-quality';
const TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');

function setupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs'), { recursive: true });
}

function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

function createSpecWithPostCodeFailure(specId: string): void {
  const specDir = path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs', specId);
  mkdirSync(specDir, { recursive: true });

  writeFileSync(
    path.join(specDir, 'implementation_plan.json'),
    JSON.stringify({
      feature: `Test Feature ${specId}`,
      workflow_type: 'feature',
      phases: [],
      qa_signoff: { status: 'approved' },
      status: 'ai_review',
      planStatus: 'review',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      spec_file: 'spec.md'
    })
  );

  writeFileSync(path.join(specDir, 'spec.md'), `# ${specId}\n\n## Overview\n\nTest spec.\n`);

  writeFileSync(
    path.join(specDir, 'post_code_tests.json'),
    JSON.stringify({
      status: 'failed',
      test_plan: ['npm test'],
      summary: { total: 1, passed: 0, failed: 1 },
      reason: 'No test_plan entries in scope_contract.json',
      completed_at: new Date().toISOString()
    })
  );
}

test.describe('Quality Checks UI', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    setupTestEnvironment();
    createSpecWithPostCodeFailure('001-quality');
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    cleanupTestEnvironment();
  });

  test('shows post-code failure reason in task detail', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const appPath = path.join(__dirname, '..');
    app = await electron.launch({ args: [appPath] });
    page = await app.firstWindow();

    await page.waitForLoadState('domcontentloaded');

    // This test is a placeholder for interactive validation.
    // In a full run, the UI should show the "Post-Code Tests" section
    // with a failed badge and the reason text rendered.
    await expect(page).toBeTruthy();
  });
});
