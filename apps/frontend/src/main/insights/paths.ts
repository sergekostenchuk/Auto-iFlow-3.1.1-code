import path from 'path';
import { DEFAULT_AUTO_BUILD_PATH } from '../../shared/constants';

const SESSIONS_DIR = 'sessions';
const CURRENT_SESSION_FILE = 'current_session.json';

/**
 * Path utilities for insights service
 * Provides consistent path resolution for sessions and insights data
 */
export class InsightsPaths {
  private resolveDataDir(projectPath: string): string {
    return DEFAULT_AUTO_BUILD_PATH;
  }

  /**
   * Get insights directory path for a project
   */
  getInsightsDir(projectPath: string): string {
    return path.join(projectPath, this.resolveDataDir(projectPath), 'insights');
  }

  /**
   * Get sessions directory path for a project
   */
  getSessionsDir(projectPath: string): string {
    return path.join(this.getInsightsDir(projectPath), SESSIONS_DIR);
  }

  /**
   * Get session file path for a specific session
   */
  getSessionPath(projectPath: string, sessionId: string): string {
    return path.join(this.getSessionsDir(projectPath), `${sessionId}.json`);
  }

  /**
   * Get current session pointer file path
   */
  getCurrentSessionPath(projectPath: string): string {
    return path.join(this.getInsightsDir(projectPath), CURRENT_SESSION_FILE);
  }

  /**
   * Get old session path for migration
   */
  getOldSessionPath(projectPath: string): string {
    return path.join(this.getInsightsDir(projectPath), 'session.json');
  }
}
