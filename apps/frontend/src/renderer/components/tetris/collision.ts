/**
 * Tetris Collision Detection
 * Handles collision detection for piece movement and rotation
 */

import type { Board, Piece, CollisionResult } from './types';
import { isValidPosition, isCellFilled } from './board';

/**
 * Checks if a piece collides with the board boundaries or other pieces
 * @param board - The game board
 * @param piece - The piece to check
 * @returns Collision result with details
 */
export function checkCollision(board: Board, piece: Piece): CollisionResult {
  const { shape, position } = piece;
  const width = board[0]?.length || 0;
  const height = board.length;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = position.x + x;
        const boardY = position.y + y;

        if (boardX < 0) {
          return { collides: true, reason: 'wall' };
        }

        if (boardX >= width) {
          return { collides: true, reason: 'wall' };
        }

        if (boardY >= height) {
          return { collides: true, reason: 'floor' };
        }

        if (boardY < 0) {
          return { collides: true, reason: 'boundary' };
        }

        if (isCellFilled(board, boardX, boardY)) {
          return { collides: true, reason: 'piece' };
        }
      }
    }
  }

  return { collides: false };
}

/**
 * Checks if a piece can move in a specific direction
 * @param board - The game board
 * @param piece - The piece to check
 * @param dx - X offset
 * @param dy - Y offset
 * @returns True if the piece can move
 */
export function canMove(board: Board, piece: Piece, dx: number, dy: number): boolean {
  const movedPiece: Piece = {
    ...piece,
    position: {
      x: piece.position.x + dx,
      y: piece.position.y + dy
    }
  };

  const result = checkCollision(board, movedPiece);
  return !result.collides;
}

/**
 * Checks if a piece can rotate
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece can rotate
 */
export function canRotate(board: Board, piece: Piece): boolean {
  const rotatedShape = rotateShape(piece.shape);
  const rotatedPiece: Piece = {
    ...piece,
    shape: rotatedShape
  };

  const result = checkCollision(board, rotatedPiece);
  return !result.collides;
}

/**
 * Rotates a piece shape 90 degrees clockwise
 * @param shape - The shape to rotate
 * @returns The rotated shape
 */
export function rotateShape(shape: boolean[][]): boolean[][] {
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
 * Tries to rotate a piece with wall kick support
 * @param board - The game board
 * @param piece - The piece to rotate
 * @returns The rotated piece if successful, or the original piece
 */
export function tryRotateWithWallKick(board: Board, piece: Piece): Piece {
  const rotatedShape = rotateShape(piece.shape);

  const kickOffsets = [
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 2, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 }
  ];

  for (const offset of kickOffsets) {
    const kickedPiece: Piece = {
      ...piece,
      shape: rotatedShape,
      position: {
        x: piece.position.x + offset.dx,
        y: piece.position.y + offset.dy
      }
    };

    const result = checkCollision(board, kickedPiece);
    if (!result.collides) {
      return kickedPiece;
    }
  }

  return piece;
}

/**
 * Checks if a piece has landed (cannot move down)
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece has landed
 */
export function hasLanded(board: Board, piece: Piece): boolean {
  return !canMove(board, piece, 0, 1);
}

/**
 * Gets the landing position of a piece (hard drop)
 * @param board - The game board
 * @param piece - The piece to drop
 * @returns The piece at its landing position
 */
export function getLandingPosition(board: Board, piece: Piece): Piece {
  let landingPiece = { ...piece };

  while (canMove(board, landingPiece, 0, 1)) {
    landingPiece = {
      ...landingPiece,
      position: {
        x: landingPiece.position.x,
        y: landingPiece.position.y + 1
      }
    };
  }

  return landingPiece;
}

/**
 * Checks if a piece position is valid for spawning
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece can spawn
 */
export function canSpawn(board: Board, piece: Piece): boolean {
  const result = checkCollision(board, piece);
  return !result.collides;
}

/**
 * Gets all valid positions for a piece
 * @param board - The game board
 * @param piece - The piece to check
 * @returns Array of valid positions
 */
export function getValidPositions(board: Board, piece: Piece): Array<{ x: number; y: number }> {
  const validPositions: Array<{ x: number; y: number }> = [];
  const width = board[0]?.length || 0;
  const height = board.length;

  for (let x = -2; x < width + 2; x++) {
    for (let y = -2; y < height; y++) {
      const testPiece: Piece = {
        ...piece,
        position: { x, y }
      };

      const result = checkCollision(board, testPiece);
      if (!result.collides) {
        validPositions.push({ x, y });
      }
    }
  }

  return validPositions;
}

/**
 * Checks if a piece is at the top of the board
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece is at the top
 */
export function isAtTop(board: Board, piece: Piece): boolean {
  const { shape, position } = piece;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        if (position.y + y <= 0) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks if a piece is partially outside the board
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece is partially outside
 */
export function isPartiallyOutside(board: Board, piece: Piece): boolean {
  const { shape, position } = piece;
  const width = board[0]?.length || 0;
  const height = board.length;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = position.x + x;
        const boardY = position.y + y;

        if (boardX < 0 || boardX >= width || boardY < 0 || boardY >= height) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Gets the distance to the nearest obstacle below a piece
 * @param board - The game board
 * @param piece - The piece to check
 * @returns The distance to the nearest obstacle
 */
export function getDistanceToFloor(board: Board, piece: Piece): number {
  let distance = 0;
  const testPiece = { ...piece };

  while (canMove(board, testPiece, 0, 1)) {
    testPiece.position.y += 1;
    distance++;
  }

  return distance;
}

/**
 * Checks if a piece can move left
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece can move left
 */
export function canMoveLeft(board: Board, piece: Piece): boolean {
  return canMove(board, piece, -1, 0);
}

/**
 * Checks if a piece can move right
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece can move right
 */
export function canMoveRight(board: Board, piece: Piece): boolean {
  return canMove(board, piece, 1, 0);
}

/**
 * Checks if a piece can move down
 * @param board - The game board
 * @param piece - The piece to check
 * @returns True if the piece can move down
 */
export function canMoveDown(board: Board, piece: Piece): boolean {
  return canMove(board, piece, 0, 1);
}