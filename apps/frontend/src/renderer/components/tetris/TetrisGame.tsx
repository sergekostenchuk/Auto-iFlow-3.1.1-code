/**
 * Tetris Game Component
 * Main game component with Canvas rendering for the Tetris game
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Board, Piece, GameState, MoveDirection } from './types';
import { cn } from '../../lib/utils';
import {
  createEmptyBoard,
  placePiece,
  removePiece,
  clearLines,
  isGameOver as checkGameOver
} from './board';
import {
  createRandomPiece,
  getRandomPieceType
} from './pieces';
import {
  movePiece,
  rotatePiece,
  hardDrop,
  softDrop,
  getGhostPiece
} from './movement';
import { hasLanded } from './collision';
import {
  calculateLineClearScore,
  calculateLevel,
  calculateDropSpeed,
  formatScore,
  getHighScore,
  setHighScore,
  isNewHighScore
} from './scoring';
import {
  createKeyboardHandler,
  getControlDescriptions
} from './controls';

/**
 * TetrisGame Component Props
 */
interface TetrisGameProps {
  /**
   * Callback when game starts
   */
  onGameStart?: () => void;
  /**
   * Callback when game ends
   */
  onGameOver?: (score: number) => void;
  /**
   * Callback when score changes
   */
  onScoreChange?: (score: number) => void;
  /**
   * Board width in cells
   */
  boardWidth?: number;
  /**
   * Board height in cells
   */
  boardHeight?: number;
  /**
   * Initial drop speed in milliseconds
   */
  initialSpeed?: number;
  /**
   * Whether to show ghost piece
   */
  showGhostPiece?: boolean;
  /**
   * Whether to show next piece preview
   */
  showNextPiece?: boolean;
  /**
   * Custom class name for styling
   */
  className?: string;
}

/**
 * Default game configuration
 */
const DEFAULT_CONFIG = {
  boardWidth: 10,
  boardHeight: 20,
  initialSpeed: 1000,
  pointsPerLine: 100,
  pointsPerMultipleLines: 50,
  linesPerLevel: 10,
  speedIncrement: 0.1
};

/**
 * TetrisGame Component
 *
 * A complete Tetris game implementation with Canvas rendering.
 * Features:
 * - 10x20 game board
 * - All 7 standard Tetris pieces with distinct colors
 * - Piece rotation with wall kicks
 * - Line clearing and scoring
 * - Level progression
 * - Ghost piece preview
 * - Next piece preview
 * - Keyboard controls
 * - Game over detection
 * - High score tracking
 */
export function TetrisGame({
  onGameStart,
  onGameOver,
  onScoreChange,
  boardWidth = DEFAULT_CONFIG.boardWidth,
  boardHeight = DEFAULT_CONFIG.boardHeight,
  initialSpeed = DEFAULT_CONFIG.initialSpeed,
  showGhostPiece = true,
  showNextPiece = true,
  className = ''
}: TetrisGameProps) {
  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Game state
  const [gameState, setGameState] = useState<GameState>({
    board: createEmptyBoard(boardWidth, boardHeight),
    currentPiece: null,
    nextPiece: null,
    score: 0,
    level: 1,
    lines: 0,
    isGameOver: false,
    isPaused: false,
    isPlaying: false
  });

  // High score
  const [highScore, setHighScoreState] = useState<number>(getHighScore());

  // Game loop refs
  const gameLoopRef = useRef<number | null>(null);
  const lastDropTimeRef = useRef<number>(0);
  const dropSpeedRef = useRef<number>(initialSpeed);

  // Animation frame ref for rendering
  const animationFrameRef = useRef<number | null>(null);

  /**
   * Initialize game state
   */
  const initializeGame = useCallback(() => {
    const board = createEmptyBoard(boardWidth, boardHeight);
    const currentPiece = createRandomPiece();
    const nextPiece = createRandomPiece();

    setGameState({
      board,
      currentPiece,
      nextPiece,
      score: 0,
      level: 1,
      lines: 0,
      isGameOver: false,
      isPaused: false,
      isPlaying: true
    });

    dropSpeedRef.current = initialSpeed;
    lastDropTimeRef.current = performance.now();
  }, [boardWidth, boardHeight, initialSpeed]);

  /**
   * Start the game
   */
  const startGame = useCallback(() => {
    initializeGame();
    onGameStart?.();
  }, [initializeGame, onGameStart]);

  /**
   * Pause the game
   */
  const pauseGame = useCallback(() => {
    setGameState(prev => ({ ...prev, isPaused: true, isPlaying: false }));
  }, []);

  /**
   * Resume the game
   */
  const resumeGame = useCallback(() => {
    setGameState(prev => ({ ...prev, isPaused: false, isPlaying: true }));
  }, []);

  /**
   * Restart the game
   */
  const restartGame = useCallback(() => {
    initializeGame();
  }, [initializeGame]);

  /**
   * Handle piece movement
   */
  const handleMove = useCallback((direction: MoveDirection) => {
    setGameState(prev => {
      if (!prev.currentPiece || !prev.isPlaying || prev.isPaused) {
        return prev;
      }

      const movedPiece = movePiece(prev.board, prev.currentPiece, direction);
      return { ...prev, currentPiece: movedPiece };
    });
  }, []);

  /**
   * Handle piece rotation
   */
  const handleRotate = useCallback(() => {
    setGameState(prev => {
      if (!prev.currentPiece || !prev.isPlaying || prev.isPaused) {
        return prev;
      }

      const rotatedPiece = rotatePiece(prev.board, prev.currentPiece);
      return { ...prev, currentPiece: rotatedPiece };
    });
  }, []);

  /**
   * Handle hard drop
   */
  const handleHardDrop = useCallback(() => {
    setGameState(prev => {
      if (!prev.currentPiece || !prev.isPlaying || prev.isPaused) {
        return prev;
      }

      const droppedPiece = hardDrop(prev.board, prev.currentPiece);
      const boardWithPiece = placePiece(prev.board, droppedPiece);
      const clearResult = clearLines(boardWithPiece, DEFAULT_CONFIG.pointsPerLine, DEFAULT_CONFIG.pointsPerMultipleLines);

      const newLevel = calculateLevel(prev.level, prev.lines + clearResult.linesCleared, DEFAULT_CONFIG.linesPerLevel);
      const newScore = prev.score + clearResult.scoreGained;
      const newSpeed = calculateDropSpeed(newLevel, initialSpeed, DEFAULT_CONFIG.speedIncrement);

      dropSpeedRef.current = newSpeed;

      const newNextPiece = createRandomPiece();
      const newCurrentPiece = prev.nextPiece;

      const gameOver = checkGameOver(clearResult.newBoard, newCurrentPiece);

      if (gameOver) {
        onGameOver?.(newScore);
        if (isNewHighScore(newScore)) {
          setHighScore(newScore);
          setHighScoreState(newScore);
        }
      }

      onScoreChange?.(newScore);

      return {
        ...prev,
        board: clearResult.newBoard,
        currentPiece: newCurrentPiece,
        nextPiece: newNextPiece,
        score: newScore,
        level: newLevel,
        lines: prev.lines + clearResult.linesCleared,
        isGameOver: gameOver,
        isPlaying: !gameOver
      };
    });
  }, [initialSpeed, onGameOver, onScoreChange]);

  /**
   * Handle soft drop
   */
  const handleSoftDrop = useCallback(() => {
    setGameState(prev => {
      if (!prev.currentPiece || !prev.isPlaying || prev.isPaused) {
        return prev;
      }

      const droppedPiece = softDrop(prev.board, prev.currentPiece);
      return { ...prev, currentPiece: droppedPiece };
    });
  }, []);

  /**
   * Game loop - handles automatic piece dropping
   */
  const gameLoop = useCallback((timestamp: number) => {
    if (!gameState.isPlaying || gameState.isPaused || gameState.isGameOver) {
      return;
    }

    const timeSinceLastDrop = timestamp - lastDropTimeRef.current;

    if (timeSinceLastDrop >= dropSpeedRef.current) {
      lastDropTimeRef.current = timestamp;

      setGameState(prev => {
        if (!prev.currentPiece) {
          return prev;
        }

        const landed = hasLanded(prev.board, prev.currentPiece);

        if (landed) {
          const boardWithPiece = placePiece(prev.board, prev.currentPiece);
          const clearResult = clearLines(boardWithPiece, DEFAULT_CONFIG.pointsPerLine, DEFAULT_CONFIG.pointsPerMultipleLines);

          const newLevel = calculateLevel(prev.level, prev.lines + clearResult.linesCleared, DEFAULT_CONFIG.linesPerLevel);
          const newScore = prev.score + clearResult.scoreGained;
          const newSpeed = calculateDropSpeed(newLevel, initialSpeed, DEFAULT_CONFIG.speedIncrement);

          dropSpeedRef.current = newSpeed;

          const newNextPiece = createRandomPiece();
          const newCurrentPiece = prev.nextPiece;

          const gameOver = checkGameOver(clearResult.newBoard, newCurrentPiece);

          if (gameOver) {
            onGameOver?.(newScore);
            if (isNewHighScore(newScore)) {
              setHighScore(newScore);
              setHighScoreState(newScore);
            }
          }

          onScoreChange?.(newScore);

          return {
            ...prev,
            board: clearResult.newBoard,
            currentPiece: newCurrentPiece,
            nextPiece: newNextPiece,
            score: newScore,
            level: newLevel,
            lines: prev.lines + clearResult.linesCleared,
            isGameOver: gameOver,
            isPlaying: !gameOver
          };
        } else {
          const movedPiece = movePiece(prev.board, prev.currentPiece, 'down');
          return { ...prev, currentPiece: movedPiece };
        }
      });
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop);
  }, [gameState.isPlaying, gameState.isPaused, gameState.isGameOver, initialSpeed, onGameOver, onScoreChange]);

  /**
   * Render the game to canvas
   */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = canvas.width / boardWidth;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#2a2a4e';
    ctx.lineWidth = 1;

    for (let x = 0; x <= boardWidth; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellSize, 0);
      ctx.lineTo(x * cellSize, canvas.height);
      ctx.stroke();
    }

    for (let y = 0; y <= boardHeight; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellSize);
      ctx.lineTo(canvas.width, y * cellSize);
      ctx.stroke();
    }

    gameState.board.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell.filled) {
          ctx.fillStyle = cell.color;
          ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 4);
        }
      });
    });

    if (gameState.currentPiece) {
      const { shape, position, color } = gameState.currentPiece;

      if (showGhostPiece) {
        const ghostPiece = getGhostPiece(gameState.board, gameState.currentPiece);
        ctx.globalAlpha = 0.3;
        ghostPiece.shape.forEach((row, y) => {
          row.forEach((cell, x) => {
            if (cell) {
              ctx.fillStyle = color;
              ctx.fillRect(
                (ghostPiece.position.x + x) * cellSize + 1,
                (ghostPiece.position.y + y) * cellSize + 1,
                cellSize - 2,
                cellSize - 2
              );
            }
          });
        });
        ctx.globalAlpha = 1.0;
      }

      shape.forEach((row, y) => {
        row.forEach((cell, x) => {
          if (cell) {
            ctx.fillStyle = color;
            ctx.fillRect(
              (position.x + x) * cellSize + 1,
              (position.y + y) * cellSize + 1,
              cellSize - 2,
              cellSize - 2
            );

            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(
              (position.x + x) * cellSize + 1,
              (position.y + y) * cellSize + 1,
              cellSize - 2,
              4
            );
          }
        });
      });
    }

    if (gameState.isGameOver) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);

      ctx.font = '16px Arial';
      ctx.fillText(`Score: ${formatScore(gameState.score)}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.fillText('Press ENTER to restart', canvas.width / 2, canvas.height / 2 + 50);
    }

    if (gameState.isPaused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);

      ctx.font = '16px Arial';
      ctx.fillText('Press P to resume', canvas.width / 2, canvas.height / 2 + 40);
    }

    animationFrameRef.current = requestAnimationFrame(render);
  }, [gameState, boardWidth, boardHeight, showGhostPiece]);

  /**
   * Keyboard event handler
   */
  useEffect(() => {
    const keyboardHandler = createKeyboardHandler(
      {
        onMoveLeft: () => handleMove('left'),
        onMoveRight: () => handleMove('right'),
        onSoftDrop: handleSoftDrop,
        onRotate: handleRotate,
        onHardDrop: handleHardDrop,
        onPause: pauseGame,
        onResume: resumeGame,
        onStart: startGame,
        onRestart: restartGame
      },
      gameState,
      { preventDefault: true }
    );

    window.addEventListener('keydown', keyboardHandler);
    return () => window.removeEventListener('keydown', keyboardHandler);
  }, [gameState, handleMove, handleRotate, handleHardDrop, handleSoftDrop, pauseGame, resumeGame, restartGame, startGame]);

  /**
   * Game loop effect
   */
  useEffect(() => {
    if (gameState.isPlaying && !gameState.isPaused && !gameState.isGameOver) {
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState.isPlaying, gameState.isPaused, gameState.isGameOver, gameLoop]);

  /**
   * Render effect
   */
  useEffect(() => {
    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [render]);

  /**
   * Set canvas size
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 300;
      canvas.height = 600;
    }
  }, []);

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {/* Stats Display */}
      <div className="flex items-center gap-8">
        <div className="flex flex-col gap-2">
          <div className="text-label-small text-(--color-text-secondary)">Score</div>
          <div className="text-heading-large font-bold text-(--color-text-primary)">{formatScore(gameState.score)}</div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-label-small text-(--color-text-secondary)">Level</div>
          <div className="text-heading-large font-bold text-(--color-accent-primary)">{gameState.level}</div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-label-small text-(--color-text-secondary)">Lines</div>
          <div className="text-heading-large font-bold text-(--color-text-primary)">{gameState.lines}</div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-label-small text-(--color-text-secondary)">High Score</div>
          <div className="text-heading-large font-bold text-(--color-semantic-success)">{formatScore(highScore)}</div>
        </div>
      </div>

      {/* Game Board and Next Piece */}
      <div className="flex gap-4">
        <canvas
          ref={canvasRef}
          className="border-2 border-(--color-border-default) rounded-lg shadow-2xl"
          style={{ imageRendering: 'pixelated' }}
        />

        {showNextPiece && gameState.nextPiece && (
          <div className="flex flex-col gap-2">
            <div className="text-label-small text-(--color-text-secondary) text-center">Next</div>
            <div className="bg-(--color-background-secondary) border-2 border-(--color-border-default) rounded-lg p-4">
              <NextPiecePreview piece={gameState.nextPiece} />
            </div>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-2">
        {!gameState.isPlaying && !gameState.isGameOver && (
          <button
            onClick={startGame}
            className="px-6 py-2 bg-(--color-accent-primary) hover:bg-(--color-accent-primary-hover) text-(--color-surface-card) font-bold rounded-lg transition-colors"
          >
            Start Game
          </button>
        )}
        {gameState.isPlaying && !gameState.isPaused && (
          <button
            onClick={pauseGame}
            className="px-6 py-2 bg-(--color-semantic-warning) hover:bg-(--color-semantic-warning-dark) text-(--color-surface-card) font-bold rounded-lg transition-colors"
          >
            Pause
          </button>
        )}
        {gameState.isPaused && (
          <button
            onClick={resumeGame}
            className="px-6 py-2 bg-(--color-semantic-success) hover:bg-(--color-semantic-success-dark) text-(--color-surface-card) font-bold rounded-lg transition-colors"
          >
            Resume
          </button>
        )}
        {gameState.isGameOver && (
          <button
            onClick={restartGame}
            className="px-6 py-2 bg-(--color-semantic-error) hover:bg-(--color-semantic-error-dark) text-(--color-surface-card) font-bold rounded-lg transition-colors"
          >
            Restart
          </button>
        )}
      </div>

      {/* Controls Help */}
      <div className="text-label-small text-(--color-text-tertiary) text-center">
        <div className="font-semibold mb-1">Controls:</div>
        <div>← → : Move | ↓ : Soft Drop | ↑ : Rotate | Space : Hard Drop</div>
        <div>P : Pause | Enter : Start/Restart</div>
      </div>
    </div>
  );
}

/**
 * Next Piece Preview Component
 */
interface NextPiecePreviewProps {
  piece: Piece;
}

function NextPiecePreview({ piece }: NextPiecePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = 20;
    const { shape, color } = piece;

    canvas.width = shape[0].length * cellSize;
    canvas.height = shape.length * cellSize;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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
  }, [piece]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

export default TetrisGame;