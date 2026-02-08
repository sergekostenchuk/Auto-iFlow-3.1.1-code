/**
 * Keyboard Controls for Tetris Game
 * Handles all keyboard input and maps keys to game actions
 */

import type { GameState, MoveDirection } from './types';

/**
 * Keyboard key mapping configuration
 */
export interface KeyMapping {
  moveLeft: string;
  moveRight: string;
  softDrop: string;
  rotate: string;
  hardDrop: string;
  pause: string;
  start: string;
}

/**
 * Default keyboard key mappings
 */
export const DEFAULT_KEY_MAPPING: KeyMapping = {
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  softDrop: 'ArrowDown',
  rotate: 'ArrowUp',
  hardDrop: ' ',
  pause: 'p',
  start: 'Enter'
};

/**
 * Game action types triggered by keyboard input
 */
export type GameInputAction =
  | 'move_left'
  | 'move_right'
  | 'soft_drop'
  | 'rotate'
  | 'hard_drop'
  | 'pause'
  | 'start'
  | 'restart';

/**
 * Input handler configuration
 */
export interface InputHandlerConfig {
  /**
   * Custom key mappings (optional, uses defaults if not provided)
   */
  keyMapping?: Partial<KeyMapping>;
  /**
   * Whether to prevent default browser behavior for mapped keys
   */
  preventDefault?: boolean;
}

/**
 * Maps a keyboard event to a game action
 * 
 * @param event - Keyboard event to map
 * @param config - Input handler configuration
 * @returns Game action or null if key is not mapped
 */
export function mapKeyToAction(
  event: KeyboardEvent,
  config: InputHandlerConfig = {}
): GameInputAction | null {
  const keyMapping = { ...DEFAULT_KEY_MAPPING, ...config.keyMapping };
  const key = event.key;

  switch (key) {
    case keyMapping.moveLeft:
      return 'move_left';
    case keyMapping.moveRight:
      return 'move_right';
    case keyMapping.softDrop:
      return 'soft_drop';
    case keyMapping.rotate:
      return 'rotate';
    case keyMapping.hardDrop:
      return 'hard_drop';
    case keyMapping.pause:
    case keyMapping.pause.toUpperCase():
      return 'pause';
    case keyMapping.start:
      return 'start';
    default:
      return null;
  }
}

/**
 * Checks if an event should be ignored (e.g., input in text fields)
 * 
 * @param event - Keyboard event to check
 * @returns True if event should be ignored
 */
export function shouldIgnoreEvent(event: KeyboardEvent): boolean {
  return (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  );
}

/**
 * Determines if a game action is valid for the current game state
 * 
 * @param action - Game action to check
 * @param gameState - Current game state
 * @returns True if action is valid
 */
export function isActionValid(
  action: GameInputAction,
  gameState: GameState
): boolean {
  switch (action) {
    case 'move_left':
    case 'move_right':
    case 'soft_drop':
    case 'rotate':
    case 'hard_drop':
      return gameState.isPlaying && !gameState.isPaused && !gameState.isGameOver;
    case 'pause':
      return gameState.isPlaying || gameState.isPaused;
    case 'start':
      return !gameState.isPlaying && !gameState.isGameOver;
    case 'restart':
      return gameState.isGameOver;
    default:
      return false;
  }
}

/**
 * Keyboard event handler callback interface
 */
export interface KeyboardEventHandlers {
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onSoftDrop: () => void;
  onRotate: () => void;
  onHardDrop: () => void;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onRestart: () => void;
}

/**
 * Creates a keyboard event handler for the Tetris game
 * 
 * @param handlers - Callback functions for each game action
 * @param gameState - Current game state
 * @param config - Input handler configuration
 * @returns Keyboard event handler function
 */
export function createKeyboardHandler(
  handlers: KeyboardEventHandlers,
  gameState: GameState,
  config: InputHandlerConfig = {}
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (shouldIgnoreEvent(event)) {
      return;
    }

    const action = mapKeyToAction(event, config);

    if (action === null) {
      return;
    }

    if (!isActionValid(action, gameState)) {
      return;
    }

    if (config.preventDefault !== false) {
      event.preventDefault();
    }

    switch (action) {
      case 'move_left':
        handlers.onMoveLeft();
        break;
      case 'move_right':
        handlers.onMoveRight();
        break;
      case 'soft_drop':
        handlers.onSoftDrop();
        break;
      case 'rotate':
        handlers.onRotate();
        break;
      case 'hard_drop':
        handlers.onHardDrop();
        break;
      case 'pause':
        if (gameState.isPaused) {
          handlers.onResume();
        } else {
          handlers.onPause();
        }
        break;
      case 'start':
        handlers.onStart();
        break;
      case 'restart':
        handlers.onRestart();
        break;
    }
  };
}

/**
 * Converts a game input action to move direction
 * 
 * @param action - Game input action
 * @returns Move direction or null if not a move action
 */
export function actionToMoveDirection(action: GameInputAction): MoveDirection | null {
  switch (action) {
    case 'move_left':
      return 'left';
    case 'move_right':
      return 'right';
    case 'soft_drop':
      return 'down';
    default:
      return null;
  }
}

/**
 * Gets a human-readable description of keyboard controls
 * 
 * @param keyMapping - Key mapping to describe (uses defaults if not provided)
 * @returns Object with control descriptions
 */
export function getControlDescriptions(keyMapping: Partial<KeyMapping> = {}): Record<string, string> {
  const mapping = { ...DEFAULT_KEY_MAPPING, ...keyMapping };

  return {
    moveLeft: `Move Left: ${mapping.moveLeft}`,
    moveRight: `Move Right: ${mapping.moveRight}`,
    softDrop: `Soft Drop: ${mapping.softDrop}`,
    rotate: `Rotate: ${mapping.rotate}`,
    hardDrop: `Hard Drop: ${mapping.hardDrop === ' ' ? 'Space' : mapping.hardDrop}`,
    pause: `Pause/Resume: ${mapping.pause.toUpperCase()}`,
    start: `Start/Restart: ${mapping.start}`
  };
}