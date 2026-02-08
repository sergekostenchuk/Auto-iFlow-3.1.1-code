/**
 * Score Panel Component
 * Displays game statistics including score, level, lines, and high score
 */

import { cn } from '../../lib/utils';
import { formatScore, getLinesToNextLevel, getLevelProgress } from './scoring';
import type { GameState } from './types';

/**
 * ScorePanel Component Props
 */
interface ScorePanelProps {
  /**
   * Current game state
   */
  gameState: GameState;
  /**
   * High score to display
   */
  highScore?: number;
  /**
   * Whether to show high score
   */
  showHighScore?: boolean;
  /**
   * Whether to show level progress
   */
  showLevelProgress?: boolean;
  /**
   * Whether to show lines to next level
   */
  showLinesToNextLevel?: boolean;
  /**
   * Custom class name for styling
   */
  className?: string;
}

/**
 * Stat Item Component
 * Displays a single statistic with label and value
 */
interface StatItemProps {
  label: string;
  value: string | number;
  variant?: 'default' | 'accent' | 'success' | 'warning';
  className?: string;
}

function StatItem({ label, value, variant = 'default', className = '' }: StatItemProps) {
  const variantStyles = {
    default: 'text-(--color-text-primary)',
    accent: 'text-(--color-accent-primary)',
    success: 'text-(--color-semantic-success)',
    warning: 'text-(--color-semantic-warning)'
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="text-label-small text-(--color-text-secondary)">
        {label}
      </div>
      <div className={cn('text-heading-large font-bold', variantStyles[variant])}>
        {value}
      </div>
    </div>
  );
}

/**
 * Progress Bar Component
 * Displays a progress bar for level progression
 */
interface ProgressBarProps {
  value: number;
  max: number;
  color?: string;
  className?: string;
}

function ProgressBar({ value, max, color = 'var(--color-accent-primary)', className = '' }: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className={cn('w-full h-2 bg-(--color-background-secondary) rounded-full overflow-hidden', className)}>
      <div
        className="h-full rounded-full transition-all duration-300 ease-out"
        style={{
          width: `${percentage}%`,
          backgroundColor: color
        }}
      />
    </div>
  );
}

/**
 * ScorePanel Component
 * 
 * Displays comprehensive game statistics in a clean, organized layout.
 * Features:
 * - Current score with formatted display
 * - Level indicator with progress tracking
 * - Lines cleared counter
 * - High score display
 * - Level progress bar
 * - Lines to next level indicator
 * - Consistent with design system styling
 */
export function ScorePanel({
  gameState,
  highScore = 0,
  showHighScore = true,
  showLevelProgress = true,
  showLinesToNextLevel = true,
  className = ''
}: ScorePanelProps) {
  const { score, level, lines } = gameState;

  const linesPerLevel = 10;
  const linesToNext = getLinesToNextLevel(lines, linesPerLevel);
  const levelProgress = getLevelProgress(lines, linesPerLevel);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatItem
          label="Score"
          value={formatScore(score)}
          variant="default"
        />
        <StatItem
          label="Level"
          value={level}
          variant="accent"
        />
        <StatItem
          label="Lines"
          value={lines}
          variant="default"
        />
        {showHighScore && (
          <StatItem
            label="High Score"
            value={formatScore(highScore)}
            variant="success"
          />
        )}
      </div>

      {/* Level Progress Section */}
      {showLevelProgress && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-label-small text-(--color-text-secondary)">
              Level Progress
            </div>
            {showLinesToNextLevel && (
              <div className="text-label-small text-(--color-text-tertiary)">
                {linesToNext} to next level
              </div>
            )}
          </div>
          <ProgressBar
            value={levelProgress}
            max={100}
            color="var(--color-accent-primary)"
          />
        </div>
      )}

      {/* Game Status Indicator */}
      {gameState.isPaused && (
        <div className="flex items-center gap-2 px-3 py-2 bg-(--color-semantic-warning-light) rounded-lg">
          <div className="w-2 h-2 rounded-full bg-(--color-semantic-warning) animate-pulse" />
          <div className="text-body-small text-(--color-semantic-warning)">
            Game Paused
          </div>
        </div>
      )}

      {gameState.isGameOver && (
        <div className="flex items-center gap-2 px-3 py-2 bg-(--color-semantic-error-light) rounded-lg">
          <div className="w-2 h-2 rounded-full bg-(--color-semantic-error)" />
          <div className="text-body-small text-(--color-semantic-error)">
            Game Over
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact Score Panel Component
 * A smaller version of the score panel for tight spaces
 */
interface CompactScorePanelProps {
  gameState: GameState;
  highScore?: number;
  className?: string;
}

export function CompactScorePanel({
  gameState,
  highScore = 0,
  className = ''
}: CompactScorePanelProps) {
  const { score, level, lines } = gameState;

  return (
    <div className={cn('flex gap-6', className)}>
      <div className="flex flex-col gap-1">
        <div className="text-label-small text-(--color-text-secondary)">Score</div>
        <div className="text-heading-medium font-bold text-(--color-text-primary)">
          {formatScore(score)}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-label-small text-(--color-text-secondary)">Level</div>
        <div className="text-heading-medium font-bold text-(--color-accent-primary)">
          {level}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-label-small text-(--color-text-secondary)">Lines</div>
        <div className="text-heading-medium font-bold text-(--color-text-primary)">
          {lines}
        </div>
      </div>
      {highScore > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-label-small text-(--color-text-secondary)">Best</div>
          <div className="text-heading-medium font-bold text-(--color-semantic-success)">
            {formatScore(highScore)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mini Score Badge Component
 * A minimal score display for inline use
 */
interface MiniScoreBadgeProps {
  score: number;
  className?: string;
}

export function MiniScoreBadge({ score, className = '' }: MiniScoreBadgeProps) {
  return (
    <div className={cn(
      'inline-flex items-center gap-2 px-3 py-1.5 bg-(--color-surface-card) rounded-lg border border-(--color-border-default)',
      className
    )}>
      <div className="w-2 h-2 rounded-full bg-(--color-accent-primary)" />
      <div className="text-label-medium text-(--color-text-secondary)">
        {formatScore(score)}
      </div>
    </div>
  );
}

export default ScorePanel;