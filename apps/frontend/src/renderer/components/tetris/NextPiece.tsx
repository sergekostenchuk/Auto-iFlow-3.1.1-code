/**
 * Next Piece Preview Component
 * Displays the next Tetris piece that will spawn
 */

import { useEffect, useRef } from 'react';
import type { Piece } from './types';
import { cn } from '../../lib/utils';

/**
 * NextPiece Component Props
 */
interface NextPieceProps {
  /**
   * The piece to preview
   */
  piece: Piece | null;
  /**
   * Cell size in pixels
   */
  cellSize?: number;
  /**
   * Whether to show a title label
   */
  showLabel?: boolean;
  /**
   * Label text to display
   */
  labelText?: string;
  /**
   * Custom class name for styling
   */
  className?: string;
}

/**
 * NextPiece Component
 *
 * Renders a preview of the next Tetris piece.
 * Features:
 * - Displays piece shape and color
 * - Adjustable cell size
 * - Optional label
 * - Consistent with game board styling
 * - Canvas-based rendering for performance
 */
export function NextPiece({
  piece,
  cellSize = 20,
  showLabel = true,
  labelText = 'Next',
  className = ''
}: NextPieceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { shape, color } = piece || { shape: [], color: '' };

    canvas.width = shape[0]?.length * cellSize || cellSize * 4;
    canvas.height = shape.length * cellSize || cellSize * 4;

    ctx.fillStyle = 'var(--color-background-primary)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (piece && shape.length > 0) {
      shape.forEach((row, y) => {
        row.forEach((cell, x) => {
          if (cell) {
            ctx.fillStyle = color;
            ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 4);
          }
        });
      });
    }
  }, [piece, cellSize]);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  };

  const canvasStyle: React.CSSProperties = {
    borderRadius: '4px',
    imageRendering: 'pixelated',
    border: '2px solid var(--color-border-default)'
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '14px',
    color: 'var(--color-text-secondary)',
    fontWeight: '500'
  };

  return (
    <div className={cn('', className)} style={containerStyle}>
      {showLabel && (
        <div style={labelStyle}>{labelText}</div>
      )}
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        aria-label={`Next piece: ${piece?.type || 'None'}`}
      />
    </div>
  );
}

export default NextPiece;