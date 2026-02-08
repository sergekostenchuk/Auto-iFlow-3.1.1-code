/**
 * Tetris Game Board Component
 * Renders the game board grid with cells and pieces using HTML/CSS grid
 */

import { useMemo } from 'react';
import type { Board, Piece } from './types';
import { cn } from '../../lib/utils';

/**
 * GameBoard Component Props
 */
interface GameBoardProps {
  /**
   * The game board state
   */
  board: Board;
  /**
   * The current piece being played
   */
  currentPiece?: Piece | null;
  /**
   * The ghost piece showing drop preview
   */
  ghostPiece?: Piece | null;
  /**
   * Cell size in pixels
   */
  cellSize?: number;
  /**
   * Whether to show grid lines
   */
  showGrid?: boolean;
  /**
   * Whether to show the ghost piece
   */
  showGhost?: boolean;
  /**
   * Custom class name for styling
   */
  className?: string;
}

/**
 * Cell Component
 * Renders a single cell on the game board
 */
interface CellProps {
  filled: boolean;
  color: string;
  isGhost?: boolean;
  size: number;
  showGrid: boolean;
}

function Cell({ filled, color, isGhost, size, showGrid }: CellProps) {
  const cellStyle: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    backgroundColor: filled ? (isGhost ? `${color}40` : color) : 'transparent',
    border: showGrid ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
    boxShadow: filled && !isGhost ? `inset 0 -2px 4px rgba(0, 0, 0, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.2)` : 'none',
    transition: 'background-color 0.1s ease',
    borderRadius: '2px'
  };

  return <div style={cellStyle} />;
}

/**
 * GameBoard Component
 *
 * Renders the Tetris game board using a CSS grid layout.
 * Features:
 * - Responsive grid based on board dimensions
 * - Renders filled cells with colors
 * - Shows ghost piece preview
 * - Optional grid lines for visual clarity
 * - Smooth transitions for cell state changes
 */
export function GameBoard({
  board,
  currentPiece,
  ghostPiece,
  cellSize = 30,
  showGrid = true,
  showGhost = true,
  className = ''
}: GameBoardProps) {
  /**
   * Creates a combined board with current piece and ghost piece rendered
   */
  const combinedBoard = useMemo(() => {
    const width = board[0]?.length || 0;
    const height = board.length;

    const combined: Array<{ filled: boolean; color: string; isGhost?: boolean }> = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = board[y]?.[x];
        const filled = cell?.filled || false;
        const color = cell?.color || '';

        combined.push({
          filled,
          color,
          isGhost: false
        });
      }
    }

    if (ghostPiece && showGhost) {
      const { shape, position, color } = ghostPiece;

      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            const boardX = position.x + x;
            const boardY = position.y + y;

            if (boardX >= 0 && boardX < width && boardY >= 0 && boardY < height) {
              const index = boardY * width + boardX;
              if (!combined[index].filled) {
                combined[index] = {
                  filled: true,
                  color,
                  isGhost: true
                };
              }
            }
          }
        }
      }
    }

    if (currentPiece) {
      const { shape, position, color } = currentPiece;

      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            const boardX = position.x + x;
            const boardY = position.y + y;

            if (boardX >= 0 && boardX < width && boardY >= 0 && boardY < height) {
              const index = boardY * width + boardX;
              combined[index] = {
                filled: true,
                color,
                isGhost: false
              };
            }
          }
        }
      }
    }

    return combined;
  }, [board, currentPiece, ghostPiece, showGhost]);

  const width = board[0]?.length || 0;
  const height = board.length;

  const boardStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${height}, ${cellSize}px)`,
    gap: showGrid ? '0' : '0',
    backgroundColor: 'var(--color-background-primary)',
    border: '2px solid var(--color-border-default)',
    borderRadius: '8px',
    padding: '4px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)'
  };

  return (
    <div
      className={cn('inline-block', className)}
      style={boardStyle}
      role="grid"
      aria-label="Tetris game board"
    >
      {combinedBoard.map((cell, index) => (
        <Cell
          key={index}
          filled={cell.filled}
          color={cell.color}
          isGhost={cell.isGhost}
          size={cellSize}
          showGrid={showGrid}
        />
      ))}
    </div>
  );
}

export default GameBoard;