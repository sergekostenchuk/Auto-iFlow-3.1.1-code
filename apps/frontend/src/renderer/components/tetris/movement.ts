/**
 * Tetris Piece Movement and Rotation Logic
 * Handles piece movement, rotation, and position updates
 */

import type { Board, Piece, MoveDirection } from './types';
import { checkCollision, canMove, canRotate, tryRotateWithWallKick } from './collision';

/**
 * Moves a piece in the specified direction
 * @param board - The game board
 * @param piece - The piece to move
 * @param direction - The direction to move
 * @returns The moved piece if successful, or the original piece
 */
export function movePiece(board: Board, piece: Piece, direction: MoveDirection): Piece {
  let dx = 0;
  let dy = 0;

  switch (direction) {
    case 'left':
      dx = -1;
      break;
    case 'right':
      dx = 1;
      break;
    case 'down':
      dy = 1;
      break;
  }

  if (canMove(board, piece, dx, dy)) {
    return {
      ...piece,
      position: {
        x: piece.position.x + dx,
        y: piece.position.y + dy
      }
    };
  }

  return piece;
}

/**
 * Rotates a piece 90 degrees clockwise
 * @param board - The game board
 * @param piece - The piece to rotate
 * @returns The rotated piece if successful, or the original piece
 */
export function rotatePiece(board: Board, piece: Piece): Piece {
  if (!canRotate(board, piece)) {
    return tryRotateWithWallKick(board, piece);
  }

  const rotatedShape = rotateClockwise(piece.shape);
  const newRotation = (piece.rotation + 1) % 4;

  return {
    ...piece,
    shape: rotatedShape,
    rotation: newRotation
  };
}

/**
 * Rotates a piece shape 90 degrees clockwise
 * @param shape - The shape to rotate
 * @returns The rotated shape
 */
export function rotateClockwise(shape: boolean[][]): boolean[][] {
  const rows = shape.length;
  const cols = shape[0]?.length || 0;
  const rotated: boolean[][] = [];

  for (let x = 0; x < cols; x++) {
    rotated[x] = [];
    for (let y = rows - 1; y >= 0; y--) {
      rotated[x][rows - 1 - y] = shape[y][x];
    }
  }

  return rotated;
}

/**
 * Rotates a piece shape 90 degrees counter-clockwise
 * @param shape - The shape to rotate
 * @returns The rotated shape
 */
export function rotateCounterClockwise(shape: boolean[][]): boolean[][] {
  const rows = shape.length;
  const cols = shape[0]?.length || 0;
  const rotated: boolean[][] = [];

  for (let x = cols - 1; x >= 0; x--) {
    rotated[cols - 1 - x] = [];
    for (let y = 0; y < rows; y++) {
      rotated[cols - 1 - x][y] = shape[y][x];
    }
  }

  return rotated;
}

/**
 * Performs a hard drop (instant drop to bottom)
 * @param board - The game board
 * @param piece - The piece to drop
 * @returns The piece at its landing position
 */
export function hardDrop(board: Board, piece: Piece): Piece {
  let droppedPiece = { ...piece };

  while (canMove(board, droppedPiece, 0, 1)) {
    droppedPiece = {
      ...droppedPiece,
      position: {
        x: droppedPiece.position.x,
        y: droppedPiece.position.y + 1
      }
    };
  }

  return droppedPiece;
}

/**
 * Performs a soft drop (move down one cell)
 * @param board - The game board
 * @param piece - The piece to drop
 * @returns The piece moved down one cell, or the original piece
 */
export function softDrop(board: Board, piece: Piece): Piece {
  return movePiece(board, piece, 'down');
}

/**
 * Gets the ghost piece position (where the piece would land)
 * @param board - The game board
 * @param piece - The piece to check
 * @returns The ghost piece at its landing position
 */
export function getGhostPiece(board: Board, piece: Piece): Piece {
  let ghostPiece = { ...piece };

  while (canMove(board, ghostPiece, 0, 1)) {
    ghostPiece = {
      ...ghostPiece,
      position: {
        x: ghostPiece.position.x,
        y: ghostPiece.position.y + 1
      }
    };
  }

  return ghostPiece;
}

/**
 * Checks if a piece can perform a hard drop
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece can hard drop
 */
export function canHardDrop(board: Board, piece: Piece): boolean {
  return canMove(board, piece, 0, 1);
}

/**
 * Gets the distance from a piece to its landing position
 * @param board - The game board
 * @param piece - The piece to check
 * @returns The number of cells to the landing position
 */
export function getDropDistance(board: Board, piece: Piece): number {
  let distance = 0;
  const testPiece = { ...piece };

  while (canMove(board, testPiece, 0, 1)) {
    testPiece.position.y += 1;
    distance++;
  }

  return distance;
}

/**
 * Tries to move a piece left with wall kick support
 * @param board - The game board
 * @param piece - The piece to move
 * @returns The moved piece if successful, or the original piece
 */
export function tryMoveLeft(board: Board, piece: Piece): Piece {
  return movePiece(board, piece, 'left');
}

/**
 * Tries to move a piece right with wall kick support
 * @param board - The game board
 * @param piece - The piece to move
 * @returns The moved piece if successful, or the original piece
 */
export function tryMoveRight(board: Board, piece: Piece): Piece {
  return movePiece(board, piece, 'right');
}

/**
 * Tries to move a piece down
 * @param board - The game board
 * @param piece - The piece to move
 * @returns The moved piece if successful, or the original piece
 */
export function tryMoveDown(board: Board, piece: Piece): Piece {
  return movePiece(board, piece, 'down');
}

/**
 * Checks if a piece is at the left boundary
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece is at the left boundary
 */
export function isAtLeftBoundary(board: Board, piece: Piece): boolean {
  const { shape, position } = piece;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] && position.x + x <= 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a piece is at the right boundary
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece is at the right boundary
 */
export function isAtRightBoundary(board: Board, piece: Piece): boolean {
  const { shape, position } = piece;
  const width = board[0]?.length || 0;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] && position.x + x >= width - 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a piece is at the bottom boundary
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece is at the bottom boundary
 */
export function isAtBottomBoundary(board: Board, piece: Piece): boolean {
  const { shape, position } = piece;
  const height = board.length;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] && position.y + y >= height - 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Gets all possible positions a piece can move to
 * @param board - The game board
 * @param piece - The piece to check
 * @returns Array of valid positions
 */
export function getPossibleMoves(board: Board, piece: Piece): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const width = board[0]?.length || 0;
  const height = board.length;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const testPiece: Piece = {
        ...piece,
        position: { x, y }
      };

      const result = checkCollision(board, testPiece);
      if (!result.collides) {
        positions.push({ x, y });
      }
    }
  }

  return positions;
}

/**
 * Gets the best move for a piece based on scoring
 * @param board - The game board
 * @param piece - The piece to evaluate
 * @param evaluatePosition - Function to evaluate a position's quality
 * @returns The best position for the piece
 */
export function getBestMove(
  board: Board,
  piece: Piece,
  evaluatePosition: (board: Board, piece: Piece) => number
): Piece {
  const possibleMoves = getPossibleMoves(board, piece);
  let bestPiece = piece;
  let bestScore = -Infinity;

  for (const pos of possibleMoves) {
    const testPiece: Piece = {
      ...piece,
      position: pos
    };

    const score = evaluatePosition(board, testPiece);
    if (score > bestScore) {
      bestScore = score;
      bestPiece = testPiece;
    }
  }

  return bestPiece;
}

/**
 * Creates a new piece with a specific rotation
 * @param piece - The piece to rotate
 * @param rotation - The desired rotation (0-3)
 * @returns The piece with the specified rotation
 */
export function setPieceRotation(piece: Piece, rotation: number): Piece {
  let newPiece = { ...piece };
  const rotationsNeeded = (rotation - piece.rotation + 4) % 4;

  for (let i = 0; i < rotationsNeeded; i++) {
    newPiece.shape = rotateClockwise(newPiece.shape);
  }

  newPiece.rotation = rotation;
  return newPiece;
}

/**
 * Gets the center position of a piece
 * @param piece - The piece
 * @returns The center position
 */
export function getPieceCenter(piece: Piece): { x: number; y: number } {
  const { shape, position } = piece;
  const width = shape[0]?.length || 0;
  const height = shape.length;

  return {
    x: position.x + width / 2,
    y: position.y + height / 2
  };
}

/**
 * Normalizes a piece position (ensures it's within bounds)
 * @param board - The game board
 * @param piece - The piece to normalize
 * @returns The normalized piece
 */
export function normalizePiecePosition(board: Board, piece: Piece): Piece {
  let normalizedPiece = { ...piece };
  const width = board[0]?.length || 0;
  const height = board.length;

  while (normalizedPiece.position.x < 0) {
    normalizedPiece = {
      ...normalizedPiece,
      position: { x: normalizedPiece.position.x + 1, y: normalizedPiece.position.y }
    };
  }

  while (normalizedPiece.position.x + (normalizedPiece.shape[0]?.length || 0) > width) {
    normalizedPiece = {
      ...normalizedPiece,
      position: { x: normalizedPiece.position.x - 1, y: normalizedPiece.position.y }
    };
  }

  while (normalizedPiece.position.y < 0) {
    normalizedPiece = {
      ...normalizedPiece,
      position: { x: normalizedPiece.position.x, y: normalizedPiece.position.y + 1 }
    };
  }

  while (normalizedPiece.position.y + normalizedPiece.shape.length > height) {
    normalizedPiece = {
      ...normalizedPiece,
      position: { x: normalizedPiece.position.x, y: normalizedPiece.position.y - 1 }
    };
  }

  return normalizedPiece;
}

/**
 * Checks if two pieces overlap
 * @param piece1 - The first piece
 * @param piece2 - The second piece
 * @returns True if the pieces overlap
 */
export function piecesOverlap(piece1: Piece, piece2: Piece): boolean {
  const { shape: shape1, position: pos1 } = piece1;
  const { shape: shape2, position: pos2 } = piece2;

  for (let y1 = 0; y1 < shape1.length; y1++) {
    for (let x1 = 0; x1 < shape1[y1].length; x1++) {
      if (shape1[y1][x1]) {
        const boardX1 = pos1.x + x1;
        const boardY1 = pos1.y + y1;

        for (let y2 = 0; y2 < shape2.length; y2++) {
          for (let x2 = 0; x2 < shape2[y2].length; x2++) {
            if (shape2[y2][x2]) {
              const boardX2 = pos2.x + x2;
              const boardY2 = pos2.y + y2;

              if (boardX1 === boardX2 && boardY1 === boardY2) {
                return true;
              }
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Gets the bounding box of a piece
 * @param piece - The piece
 * @returns The bounding box (minX, minY, maxX, maxY)
 */
export function getPieceBoundingBox(piece: Piece): { minX: number; minY: number; maxX: number; maxY: number } {
  const { shape, position } = piece;
  const width = shape[0]?.length || 0;
  const height = shape.length;

  return {
    minX: position.x,
    minY: position.y,
    maxX: position.x + width - 1,
    maxY: position.y + height - 1
  };
}