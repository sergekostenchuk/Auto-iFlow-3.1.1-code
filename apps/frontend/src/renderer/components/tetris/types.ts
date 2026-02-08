/**
 * Tetris Game Types and Interfaces
 */

/**
 * Represents a 2D position on the game board
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Represents a cell in the game board
 */
export interface Cell {
  filled: boolean;
  color: string;
}

/**
 * Represents the game board as a 2D grid
 */
export type Board = Cell[][];

/**
 * Represents the shape of a Tetris piece as a 2D boolean array
 * true = block present, false = empty space
 */
export type PieceShape = boolean[][];

/**
 * Represents all 7 standard Tetris piece types
 */
export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/**
 * Represents a Tetris piece with its properties
 */
export interface Piece {
  type: PieceType;
  shape: PieceShape;
  color: string;
  position: Position;
  rotation: number;
}

/**
 * Represents the current game state
 */
export interface GameState {
  board: Board;
  currentPiece: Piece | null;
  nextPiece: Piece | null;
  score: number;
  level: number;
  lines: number;
  isGameOver: boolean;
  isPaused: boolean;
  isPlaying: boolean;
}

/**
 * Represents the game configuration
 */
export interface GameConfig {
  boardWidth: number;
  boardHeight: number;
  initialSpeed: number;
  speedIncrement: number;
  pointsPerLine: number;
  pointsPerMultipleLines: number;
}

/**
 * Represents a move direction for piece movement
 */
export type MoveDirection = 'left' | 'right' | 'down';

/**
 * Represents the result of a collision check
 */
export interface CollisionResult {
  collides: boolean;
  reason?: 'wall' | 'floor' | 'piece' | 'boundary';
}

/**
 * Represents the result of a line clear operation
 */
export interface LineClearResult {
  linesCleared: number;
  newBoard: Board;
  scoreGained: number;
}

/**
 * Represents the possible game actions
 */
export type GameAction =
  | { type: 'START_GAME' }
  | { type: 'PAUSE_GAME' }
  | { type: 'RESUME_GAME' }
  | { type: 'RESTART_GAME' }
  | { type: 'MOVE_PIECE'; direction: MoveDirection }
  | { type: 'ROTATE_PIECE' }
  | { type: 'DROP_PIECE' }
  | { type: 'HARD_DROP' }
  | { type: 'GAME_OVER' }
  | { type: 'UPDATE_SCORE'; points: number }
  | { type: 'UPDATE_LEVEL'; level: number }
  | { type: 'UPDATE_LINES'; lines: number }
  | { type: 'SPAWN_PIECE'; piece: Piece }
  | { type: 'CLEAR_LINES'; result: LineClearResult };