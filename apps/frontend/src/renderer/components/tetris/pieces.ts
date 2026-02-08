/**
 * Tetris Piece Definitions
 * Defines all 7 standard Tetris pieces with their shapes and colors
 */

import type { Piece, PieceType, PieceShape } from './types';

/**
 * Standard Tetris colors for each piece type
 * Colors chosen to be visually distinct and follow classic Tetris conventions
 */
export const PIECE_COLORS: Record<PieceType, string> = {
  I: '#00f0f0',
  O: '#f0f000',
  T: '#a000f0',
  S: '#00f000',
  Z: '#f00000',
  J: '#0000f0',
  L: '#f0a000'
};

/**
 * Shape definitions for each Tetris piece
 * Each shape is represented as a 2D boolean array
 */
const PIECE_SHAPES: Record<PieceType, PieceShape> = {
  I: [
    [true, true, true, true]
  ],
  O: [
    [true, true],
    [true, true]
  ],
  T: [
    [false, true, false],
    [true, true, true]
  ],
  S: [
    [false, true, true],
    [true, true, false]
  ],
  Z: [
    [true, true, false],
    [false, true, true]
  ],
  J: [
    [true, false, false],
    [true, true, true]
  ],
  L: [
    [false, false, true],
    [true, true, true]
  ]
};

/**
 * Creates a new piece of the specified type
 * @param type - The type of piece to create
 * @param position - The initial position of the piece (default: centered at top)
 * @returns A new Piece object
 */
export function createPiece(
  type: PieceType,
  position?: { x: number; y: number }
): Piece {
  const defaultPosition = {
    x: type === 'I' ? 3 : 4,
    y: 0
  };

  return {
    type,
    shape: PIECE_SHAPES[type],
    color: PIECE_COLORS[type],
    position: position || defaultPosition,
    rotation: 0
  };
}

/**
 * Gets all available piece types
 * @returns Array of all piece types
 */
export function getPieceTypes(): PieceType[] {
  return Object.keys(PIECE_COLORS) as PieceType[];
}

/**
 * Gets a random piece type
 * @returns A random piece type
 */
export function getRandomPieceType(): PieceType {
  const types = getPieceTypes();
  const randomIndex = Math.floor(Math.random() * types.length);
  return types[randomIndex];
}

/**
 * Creates a random piece
 * @param position - The initial position of the piece
 * @returns A new random Piece object
 */
export function createRandomPiece(position?: { x: number; y: number }): Piece {
  const type = getRandomPieceType();
  return createPiece(type, position);
}

/**
 * Gets the shape of a piece type
 * @param type - The piece type
 * @returns The shape of the piece
 */
export function getPieceShape(type: PieceType): PieceShape {
  return PIECE_SHAPES[type];
}

/**
 * Gets the color of a piece type
 * @param type - The piece type
 * @returns The color of the piece
 */
export function getPieceColor(type: PieceType): string {
  return PIECE_COLORS[type];
}

/**
 * Gets the dimensions (width and height) of a piece shape
 * @param shape - The piece shape
 * @returns Object with width and height
 */
export function getPieceDimensions(shape: PieceShape): { width: number; height: number } {
  return {
    width: shape[0]?.length || 0,
    height: shape.length
  };
}

/**
 * Checks if a piece type is valid
 * @param type - The piece type to check
 * @returns True if the piece type is valid
 */
export function isValidPieceType(type: string): type is PieceType {
  return type in PIECE_COLORS;
}

/**
 * Gets the display name of a piece type
 * @param type - The piece type
 * @returns The display name of the piece
 */
export function getPieceDisplayName(type: PieceType): string {
  const names: Record<PieceType, string> = {
    I: 'I-Piece',
    O: 'O-Piece',
    T: 'T-Piece',
    S: 'S-Piece',
    Z: 'Z-Piece',
    J: 'J-Piece',
    L: 'L-Piece'
  };
  return names[type];
}