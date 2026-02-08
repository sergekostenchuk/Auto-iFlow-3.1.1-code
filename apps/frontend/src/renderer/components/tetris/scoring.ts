/**
 * Tetris Scoring System
 * Handles score calculation, level progression, and line clearing bonuses
 */

import type { Board, LineClearResult } from './types';

/**
 * Default scoring configuration
 */
export const DEFAULT_POINTS_PER_LINE = 100;
export const DEFAULT_POINTS_PER_MULTIPLE_LINES = 50;
export const DEFAULT_LEVEL_UP_LINES = 10;
export const DEFAULT_SPEED_INCREMENT = 0.1;

/**
 * Scoring multipliers for clearing multiple lines at once
 * Based on classic Tetris scoring
 */
export const LINE_CLEAR_MULTIPLIERS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 5,
  4: 8
};

/**
 * Calculates the score for clearing lines
 * @param linesCleared - Number of lines cleared
 * @param level - Current level (affects multiplier)
 * @param pointsPerLine - Base points per line
 * @returns The score gained from clearing lines
 */
export function calculateLineClearScore(
  linesCleared: number,
  level: number = 1,
  pointsPerLine: number = DEFAULT_POINTS_PER_LINE
): number {
  if (linesCleared === 0 || linesCleared > 4) {
    return 0;
  }

  const multiplier = LINE_CLEAR_MULTIPLIERS[linesCleared] || 1;
  const baseScore = linesCleared * pointsPerLine;
  const levelMultiplier = level;

  return baseScore * multiplier * levelMultiplier;
}

/**
 * Calculates the score gained from a line clear result
 * @param result - The line clear result
 * @param level - Current level
 * @returns The total score gained
 */
export function calculateScoreFromResult(
  result: LineClearResult,
  level: number = 1
): number {
  return result.scoreGained * level;
}

/**
 * Calculates the new level based on lines cleared
 * @param currentLevel - Current level
 * @param totalLines - Total lines cleared so far
 * @param linesPerLevel - Lines needed to advance to next level
 * @returns The new level
 */
export function calculateLevel(
  currentLevel: number,
  totalLines: number,
  linesPerLevel: number = DEFAULT_LEVEL_UP_LINES
): number {
  return Math.floor(totalLines / linesPerLevel) + 1;
}

/**
 * Calculates the drop speed based on level
 * @param level - Current level
 * @param initialSpeed - Initial drop speed in ms
 * @param speedIncrement - Speed increase per level
 * @returns The drop speed in milliseconds
 */
export function calculateDropSpeed(
  level: number = 1,
  initialSpeed: number = 1000,
  speedIncrement: number = DEFAULT_SPEED_INCREMENT
): number {
  const speed = initialSpeed - (level - 1) * (initialSpeed * speedIncrement);
  return Math.max(speed, 100);
}

/**
 * Calculates bonus points for hard drop
 * @param dropDistance - Number of cells dropped
 * @returns Bonus points for hard drop
 */
export function calculateHardDropBonus(dropDistance: number): number {
  return dropDistance * 2;
}

/**
 * Calculates bonus points for soft drop
 * @param dropDistance - Number of cells dropped
 * @returns Bonus points for soft drop
 */
export function calculateSoftDropBonus(dropDistance: number): number {
  return dropDistance * 1;
}

/**
 * Calculates the total score with bonuses
 * @param baseScore - Base score from line clears
 * @param hardDropDistance - Distance of hard drop
 * @param softDropDistance - Distance of soft drops
 * @returns Total score including bonuses
 */
export function calculateTotalScore(
  baseScore: number,
  hardDropDistance: number = 0,
  softDropDistance: number = 0
): number {
  const hardDropBonus = calculateHardDropBonus(hardDropDistance);
  const softDropBonus = calculateSoftDropBonus(softDropDistance);

  return baseScore + hardDropBonus + softDropBonus;
}

/**
 * Gets the number of lines needed to reach the next level
 * @param totalLines - Total lines cleared so far
 * @param linesPerLevel - Lines needed per level
 * @returns Lines needed to reach next level
 */
export function getLinesToNextLevel(
  totalLines: number,
  linesPerLevel: number = DEFAULT_LEVEL_UP_LINES
): number {
  const nextLevelLines = Math.ceil((totalLines + 1) / linesPerLevel) * linesPerLevel;
  return nextLevelLines - totalLines;
}

/**
 * Calculates the progress percentage towards the next level
 * @param totalLines - Total lines cleared so far
 * @param linesPerLevel - Lines needed per level
 * @returns Progress percentage (0-100)
 */
export function getLevelProgress(
  totalLines: number,
  linesPerLevel: number = DEFAULT_LEVEL_UP_LINES
): number {
  const progress = (totalLines % linesPerLevel) / linesPerLevel;
  return Math.round(progress * 100);
}

/**
 * Gets the scoring tier name based on lines cleared
 * @param linesCleared - Number of lines cleared
 * @returns The tier name (Single, Double, Triple, or Tetris)
 */
export function getScoringTierName(linesCleared: number): string {
  const tierNames: Record<number, string> = {
    1: 'Single',
    2: 'Double',
    3: 'Triple',
    4: 'Tetris'
  };

  return tierNames[linesCleared] || '';
}

/**
 * Checks if a line clear is a Tetris (4 lines)
 * @param linesCleared - Number of lines cleared
 * @returns True if it's a Tetris
 */
export function isTetris(linesCleared: number): boolean {
  return linesCleared === 4;
}

/**
 * Calculates the maximum possible score for a Tetris at a given level
 * @param level - Current level
 * @param pointsPerLine - Base points per line
 * @returns Maximum score for a Tetris
 */
export function getMaxTetrisScore(
  level: number = 1,
  pointsPerLine: number = DEFAULT_POINTS_PER_LINE
): number {
  return calculateLineClearScore(4, level, pointsPerLine);
}

/**
 * Calculates the score for a combo (consecutive line clears)
 * @param comboCount - Number of consecutive line clears
 * @param baseScore - Base score from the line clear
 * @returns Score with combo bonus
 */
export function calculateComboScore(comboCount: number, baseScore: number): number {
  if (comboCount <= 1) {
    return baseScore;
  }

  const comboMultiplier = 1 + (comboCount - 1) * 0.5;
  return Math.round(baseScore * comboMultiplier);
}

/**
 * Resets the combo counter
 * @returns Reset combo count
 */
export function resetCombo(): number {
  return 0;
}

/**
 * Increments the combo counter
 * @param currentCombo - Current combo count
 * @returns New combo count
 */
export function incrementCombo(currentCombo: number): number {
  return currentCombo + 1;
}

/**
 * Calculates the score based on the game state
 * @param board - The game board
 * @param level - Current level
 * @param pointsPerLine - Base points per line
 * @param pointsPerMultipleLines - Bonus points for multiple lines
 * @returns Score calculation result
 */
export function calculateGameStateScore(
  board: Board,
  level: number = 1,
  pointsPerLine: number = DEFAULT_POINTS_PER_LINE,
  pointsPerMultipleLines: number = DEFAULT_POINTS_PER_MULTIPLE_LINES
): {
  linesCleared: number;
  scoreGained: number;
  newBoard: Board;
} {
  const rowsToClear: number[] = [];

  for (let y = board.length - 1; y >= 0; y--) {
    if (board[y].every(cell => cell.filled)) {
      rowsToClear.push(y);
    }
  }

  if (rowsToClear.length === 0) {
    return {
      linesCleared: 0,
      scoreGained: 0,
      newBoard: board
    };
  }

  const newBoard = board.map(row => row.map(cell => ({ ...cell })));
  const width = board[0]?.length || 0;

  for (const rowY of rowsToClear) {
    newBoard.splice(rowY, 1);
    newBoard.unshift(Array(width).fill({ filled: false, color: '' }));
  }

  const linesCleared = rowsToClear.length;
  const scoreGained = calculateLineClearScore(linesCleared, level, pointsPerLine);

  return {
    linesCleared,
    scoreGained,
    newBoard
  };
}

/**
 * Gets a formatted score display
 * @param score - The score to format
 * @returns Formatted score string with commas
 */
export function formatScore(score: number): string {
  return score.toLocaleString();
}

/**
 * Gets a high score from local storage
 * @returns The high score, or 0 if not set
 */
export function getHighScore(): number {
  try {
    const stored = localStorage.getItem('tetris_high_score');
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Sets a new high score in local storage
 * @param score - The score to save
 * @returns True if the score was saved successfully
 */
export function setHighScore(score: number): boolean {
  try {
    const currentHigh = getHighScore();
    if (score > currentHigh) {
      localStorage.setItem('tetris_high_score', score.toString());
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks if a score is a new high score
 * @param score - The score to check
 * @returns True if it's a new high score
 */
export function isNewHighScore(score: number): boolean {
  return score > getHighScore();
}

/**
 * Resets the high score
 * @returns True if the high score was reset successfully
 */
export function resetHighScore(): boolean {
  try {
    localStorage.removeItem('tetris_high_score');
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the scoring statistics for a game session
 * @returns Empty statistics object
 */
export function createScoringStats(): {
  totalLinesCleared: number;
  totalTetrises: number;
  maxCombo: number;
  totalScore: number;
  piecesPlaced: number;
} {
  return {
    totalLinesCleared: 0,
    totalTetrises: 0,
    maxCombo: 0,
    totalScore: 0,
    piecesPlaced: 0
  };
}

/**
 * Updates scoring statistics with a new line clear
 * @param stats - Current statistics
 * @param linesCleared - Number of lines cleared
 * @param scoreGained - Score gained
 * @param combo - Current combo count
 * @returns Updated statistics
 */
export function updateScoringStats(
  stats: ReturnType<typeof createScoringStats>,
  linesCleared: number,
  scoreGained: number,
  combo: number
): ReturnType<typeof createScoringStats> {
  return {
    totalLinesCleared: stats.totalLinesCleared + linesCleared,
    totalTetrises: stats.totalTetrises + (isTetris(linesCleared) ? 1 : 0),
    maxCombo: Math.max(stats.maxCombo, combo),
    totalScore: stats.totalScore + scoreGained,
    piecesPlaced: stats.piecesPlaced + 1
  };
}