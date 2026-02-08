#!/usr/bin/env node
/**
 * Cross-platform backend test runner script
 * Runs pytest using the correct virtual environment path for Windows/Mac/Linux
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWindows = os.platform() === 'win32';
const rootDir = path.join(__dirname, '..');
const backendDir = path.join(rootDir, 'apps', 'backend');
const testsDir = path.join(rootDir, 'tests');
const venvDir = path.join(backendDir, '.venv');
const backendRequirementsPath = path.join(backendDir, 'requirements.txt');
const testRequirementsCandidates = [
  path.join(rootDir, 'tests', 'requirements-test.txt'),
  path.join(backendDir, 'tests', 'requirements-test.txt')
];
const testRequirementsPath = testRequirementsCandidates.find((candidate) => fs.existsSync(candidate));

// Get venv Python path based on platform
const pythonPath = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
const pipCommand = `"${pythonPath}" -m pip`;

// Check if venv exists
if (!fs.existsSync(venvDir)) {
  console.error('Virtual environment not found. Running "npm run install:backend"...');
  try {
    execSync('npm run install:backend', { stdio: 'inherit', cwd: rootDir, shell: true });
  } catch (error) {
    console.error('Error: Failed to install backend dependencies.');
    process.exit(error.status || 1);
  }
  if (!fs.existsSync(venvDir)) {
    console.error('Error: Virtual environment still not found after install.');
    process.exit(1);
  }
}
if (!fs.existsSync(pythonPath)) {
  console.error(`Error: Python not found in virtual environment at ${pythonPath}`);
  process.exit(1);
}

// Ensure backend requirements are installed (pydantic is a core dependency)
if (!fs.existsSync(backendRequirementsPath)) {
  console.error(`Error: Backend requirements not found at ${backendRequirementsPath}`);
  process.exit(1);
}

try {
  execSync(`${pipCommand} show pydantic`, { stdio: 'ignore' });
} catch (error) {
  console.warn('Backend requirements missing. Installing...');
  try {
    execSync(`${pipCommand} install -r "${backendRequirementsPath}"`, { stdio: 'inherit', cwd: backendDir });
  } catch (installError) {
    console.error('Error: Failed to install backend requirements.');
    console.error(`Install manually: ${pipCommand} install -r "${backendRequirementsPath}"`);
    process.exit(installError.status || 1);
  }
}

const hasPytest = () => {
  try {
    execSync(`"${pythonPath}" -m pytest --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// Check if pytest is installed
if (!hasPytest()) {
  console.warn('Pytest not found in virtual environment. Installing test dependencies...');
  if (!testRequirementsPath) {
    console.error(
      'Error: Test requirements not found. Expected tests/requirements-test.txt in project root or apps/backend/tests.'
    );
    process.exit(1);
  }
  try {
    execSync(`${pipCommand} install -r "${testRequirementsPath}"`, { stdio: 'inherit', cwd: backendDir });
  } catch (error) {
    console.error('Error: Failed to install backend test dependencies.');
    console.error(`Install test dependencies manually: ${pipCommand} install -r "${testRequirementsPath}"`);
    process.exit(error.status || 1);
  }
  if (!hasPytest()) {
    console.error('Error: pytest still not found after installing test dependencies.');
    process.exit(1);
  }
}

// Get any additional args passed to the script
const args = process.argv.slice(2);
const testArgs = args.length > 0 ? args.join(' ') : '-v';

// Run pytest
const cmd = `"${pythonPath}" -m pytest "${testsDir}" ${testArgs}`;
console.log(`> ${cmd}\n`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
} catch (error) {
  process.exit(error.status || 1);
}
