/**
 * Tetris Game Board State Management
 * Handles board initialization, piece placement, and board operations
 */

import type { Board, Cell, Piece, LineClearResult } from './types';

/**
 * Default game board dimensions
 */
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;

/**
 * Creates an empty game board with specified dimensions
 * @param width - Width of the board (default: 10)
 * @param height - Height of the board (default: 20)
 * @returns A new empty board
 */
export function createEmptyBoard(width: number = BOARD_WIDTH, height: number = BOARD_HEIGHT): Board {
  const board: Board = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ filled: false, color: '' });
    }
    board.push(row);
  }
  return board;
}

/**
 * Checks if a board position is valid (within bounds)
 * @param board - The game board
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns True if position is valid
 */
export function isValidPosition(board: Board, x: number, y: number): boolean {
  const width = board[0]?.length || 0;
  const height = board.length;
  return x >= 0 && x < width && y >= 0 && y < height;
}

/**
 * Checks if a cell at a position is filled
 * @param board - The game board
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns True if the cell is filled
 */
export function isCellFilled(board: Board, x: number, y: number): boolean {
  if (!isValidPosition(board, x, y)) {
    return false;
  }
  return board[y][x].filled;
}

/**
 * Gets the color of a cell at a position
 * @param board - The game board
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns The color of the cell, or empty string if not filled
 */
export function getCellColor(board: Board, x: number, y: number): string {
  if (!isValidPosition(board, x, y)) {
    return '';
  }
  return board[y][x].color;
}

/**
 * Sets a cell at a position to a specific state
 * @param board - The game board
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param filled - Whether the cell should be filled
 * @param color - The color of the cell
 */
export function setCell(board: Board, x: number, y: number, filled: boolean, color: string): void {
  if (!isValidPosition(board, x, y)) {
    return;
  }
  board[y][x] = { filled, color };
}

/**
 * Places a piece onto the board at its current position
 * @param board - The game board
 * @param piece - The piece to place
 * @returns A new board with the piece placed
 */
export function placePiece(board: Board, piece: Piece): Board {
  const newBoard = board.map(row => row.map(cell => ({ ...cell })));

  const { shape, position, color } = piece;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = position.x + x;
        const boardY = position.y + y;
        if (isValidPosition(newBoard, boardX, boardY)) {
          setCell(newBoard, boardX, boardY, true, color);
        }
      }
    }
  }

  return newBoard;
}

/**
 * Removes a piece from the board at its current position
 * @param board - The game board
 * @param piece - The piece to remove
 * @returns A new board with the piece removed
 */
export function removePiece(board: Board, piece: Piece): Board {
  const newBoard = board.map(row => row.map(cell => ({ ...cell })));

  const { shape, position } = piece;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = position.x + x;
        const boardY = position.y + y;
        if (isValidPosition(newBoard, boardX, boardY)) {
          setCell(newBoard, boardX, boardY, false, '');
        }
      }
    }
  }

  return newBoard;
}

/**
 * Checks if a row is completely filled
 * @param board - The game board
 * @param y - Row index
 * @returns True if the row is completely filled
 */
export function isRowFilled(board: Board, y: number): boolean {
  if (y < 0 || y >= board.length) {
    return false;
  }
  return board[y].every(cell => cell.filled);
}

/**
 * Checks if a row is completely empty
 * @param board - The game board
 * @param y - Row index
 * @returns True if the row is completely empty
 */
export function isRowEmpty(board: Board, y: number): boolean {
  if (y < 0 || y >= board.length) {
    return false;
  }
  return board[y].every(cell => !cell.filled);
}

/**
 * Clears filled rows and moves pieces down
 * @param board - The game board
 * @param pointsPerLine - Points awarded per line cleared
 * @param pointsPerMultipleLines - Bonus multiplier for multiple lines
 * @returns Result containing cleared lines count, new board, and score gained
 */
export function clearLines(board: Board, pointsPerLine: number = 100, pointsPerMultipleLines: number = 50): LineClearResult {
  const rowsToClear: number[] = [];

  for (let y = board.length - 1; y >= 0; y--) {
    if (isRowFilled(board, y)) {
      rowsToClear.push(y);
    }
  }

  if (rowsToClear.length === 0) {
    return {
      linesCleared: 0,
      newBoard: board,
      scoreGained: 0
    };
  }

  const newBoard = createEmptyBoard(board[0]?.length || BOARD_WIDTH, board.length);
  let writeY = board.length - 1;

  for (let y = board.length - 1; y >= 0; y--) {
    if (!rowsToClear.includes(y)) {
      newBoard[writeY] = board[y].map(cell => ({ ...cell }));
      writeY--;
    }
  }

  const linesCleared = rowsToClear.length;
  const baseScore = linesCleared * pointsPerLine;
  const bonusScore = linesCleared > 1 ? (linesCleared - 1) * linesCleared * pointsPerMultipleLines : 0;
  const scoreGained = baseScore + bonusScore;

  return {
    linesCleared,
    newBoard,
    scoreGained
  };
}

/**
 * Gets the height of the highest filled cell in a column
 * @param board - The game board
 * @param x - Column index
 * @returns The height of the highest filled cell, or -1 if column is empty
 */
export function getColumnHeight(board: Board, x: number): number {
  if (x < 0 || x >= (board[0]?.length || 0)) {
    return -1;
  }

  for (let y = 0; y < board.length; y++) {
    if (board[y][x].filled) {
      return board.length - y;
    }
  }

  return 0;
}

/**
 * Gets the aggregate height of all columns
 * @param board - The game board
 * @returns The sum of all column heights
 */
export function getAggregateHeight(board: Board): number {
  const width = board[0]?.length || 0;
  let total = 0;
  for (let x = 0; x < width; x++) {
    total += getColumnHeight(board, x);
  }
  return total;
}

/**
 * Counts the number of holes in the board (empty cells below filled cells)
 * @param board - The game board
 * @returns The number of holes
 */
export function countHoles(board: Board): number {
  let holes = 0;
  const width = board[0]?.length || 0;
  const height = board.length;

  for (let x = 0; x < width; x++) {
    let foundBlock = false;
    for (let y = 0; y < height; y++) {
      if (board[y][x].filled) {
        foundBlock = true;
      } else if (foundBlock) {
        holes++;
      }
    }
  }

  return holes;
}

/**
 * Gets the number of complete lines (bumpiness) - difference in height between adjacent columns
 * @param board - The game board
 * @returns The sum of height differences between adjacent columns
 */
export function getBumpiness(board: Board): number {
  const width = board[0]?.length || 0;
  let bumpiness = 0;

  for (let x = 0; x < width - 1; x++) {
    const height1 = getColumnHeight(board, x);
    const height2 = getColumnHeight(board, x + 1);
    bumpiness += Math.abs(height1 - height2);
  }

  return bumpiness;
}

/**
 * Checks if the game is over (cannot spawn a new piece)
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the game is over
 */
export function isGameOver(board: Board, piece: Piece): boolean {
  const { shape, position } = piece;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = position.x + x;
        const boardY = position.y + y;

        if (!isValidPosition(board, boardX, boardY) || isCellFilled(board, boardX, boardY)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Creates a deep copy of the board
 * @param board - The game board
 * @returns A new board with the same state
 */
export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(cell => ({ ...cell })));
}

/**
 * Gets all filled cells on the board
 * @param board - The game board
 * @returns Array of filled cell positions and colors
 */
export function getFilledCells(board: Board): Array<{ x: number; y: number; color: string }> {
  const cells: Array<{ x: number; y: number; color: string }> = [];
  const width = board[0]?.length || 0;
  const height = board.length;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (board[y][x].filled) {
        cells.push({ x, y, color: board[y][x].color });
      }
    }
  }

  return cells;
}