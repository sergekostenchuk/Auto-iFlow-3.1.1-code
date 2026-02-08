import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';

// Game constants
const GRID_SIZE = 20;
const CELL_SIZE = 20;
const INITIAL_SPEED = 150;
const SCORE_INCREMENT = 10;

// Direction types
type Direction = 'up' | 'down' | 'left' | 'right';

// Position type
interface Position {
  x: number;
  y: number;
}

// Game state type
type GameState = 'start' | 'playing' | 'gameover';

export function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number | null>(null);
  const [gameState, setGameState] = useState<GameState>('start');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [snake, setSnake] = useState<Position[]>([]);
  const [food, setFood] = useState<Position>({ x: 0, y: 0 });
  const [direction, setDirection] = useState<Direction>('right');
  const [nextDirection, setNextDirection] = useState<Direction>('right');

  // Initialize game
  const initializeGame = useCallback(() => {
    const initialSnake: Position[] = [
      { x: 5, y: 10 },
      { x: 4, y: 10 },
      { x: 3, y: 10 }
    ];
    setSnake(initialSnake);
    setDirection('right');
    setNextDirection('right');
    setScore(0);
    generateFood(initialSnake);
  }, []);

  // Generate food at random position not on snake
  const generateFood = useCallback((currentSnake: Position[]) => {
    let newFood: Position = { x: 0, y: 0 };
    let isValidPosition = false;

    while (!isValidPosition) {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE)
      };

      // Check if food position overlaps with snake
      isValidPosition = !currentSnake.some(
        segment => segment.x === newFood.x && segment.y === newFood.y
      );
    }

    setFood(newFood);
  }, []);

  // Check collision with walls or self
  const checkCollision = useCallback((head: Position, currentSnake: Position[]): boolean => {
    // Wall collision
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
      return true;
    }

    // Self collision (skip head)
    for (let i = 1; i < currentSnake.length; i++) {
      if (head.x === currentSnake[i].x && head.y === currentSnake[i].y) {
        return true;
      }
    }

    return false;
  }, []);

  // Update game state
  const updateGame = useCallback(() => {
    if (gameState !== 'playing') return;

    setSnake((prevSnake) => {
      const head = prevSnake[0];
      let newHead: Position;

      // Apply next direction (prevents 180-degree turns within same frame)
      setDirection(nextDirection);
      const currentDir = nextDirection;

      // Calculate new head position based on direction
      switch (currentDir) {
        case 'up':
          newHead = { x: head.x, y: head.y - 1 };
          break;
        case 'down':
          newHead = { x: head.x, y: head.y + 1 };
          break;
        case 'left':
          newHead = { x: head.x - 1, y: head.y };
          break;
        case 'right':
          newHead = { x: head.x + 1, y: head.y };
          break;
      }

      // Check for collision
      if (checkCollision(newHead, prevSnake)) {
        setGameState('gameover');
        setHighScore((prevHigh) => Math.max(prevHigh, score));
        return prevSnake;
      }

      // Check if food is eaten
      const ateFood = newHead.x === food.x && newHead.y === food.y;
      const newSnake = [newHead, ...prevSnake];

      if (ateFood) {
        setScore((prevScore) => prevScore + SCORE_INCREMENT);
        generateFood(newSnake);
      } else {
        // Remove tail if no food eaten
        newSnake.pop();
      }

      return newSnake;
    });
  }, [gameState, nextDirection, food, checkCollision, generateFood, score]);

  // Draw game on canvas
  const drawGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid (optional, subtle)
    ctx.strokeStyle = '#252540';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(canvas.width, i * CELL_SIZE);
      ctx.stroke();
    }

    // Draw snake
    snake.forEach((segment, index) => {
      // Head is a different color
      if (index === 0) {
        ctx.fillStyle = '#4ade80';
      } else {
        // Gradient effect for body
        const opacity = 1 - (index / snake.length) * 0.5;
        ctx.fillStyle = `rgba(74, 222, 128, ${opacity})`;
      }

      ctx.fillRect(
        segment.x * CELL_SIZE + 1,
        segment.y * CELL_SIZE + 1,
        CELL_SIZE - 2,
        CELL_SIZE - 2
      );

      // Draw eyes on head
      if (index === 0) {
        ctx.fillStyle = '#1a1a2e';
        const eyeSize = 3;
        const eyeOffset = 5;

        let eye1X, eye1Y, eye2X, eye2Y;

        switch (direction) {
          case 'up':
            eye1X = segment.x * CELL_SIZE + eyeOffset;
            eye1Y = segment.y * CELL_SIZE + eyeOffset;
            eye2X = segment.x * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            eye2Y = segment.y * CELL_SIZE + eyeOffset;
            break;
          case 'down':
            eye1X = segment.x * CELL_SIZE + eyeOffset;
            eye1Y = segment.y * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            eye2X = segment.x * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            eye2Y = segment.y * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            break;
          case 'left':
            eye1X = segment.x * CELL_SIZE + eyeOffset;
            eye1Y = segment.y * CELL_SIZE + eyeOffset;
            eye2X = segment.x * CELL_SIZE + eyeOffset;
            eye2Y = segment.y * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            break;
          case 'right':
            eye1X = segment.x * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            eye1Y = segment.y * CELL_SIZE + eyeOffset;
            eye2X = segment.x * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            eye2Y = segment.y * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize;
            break;
        }

        ctx.fillRect(eye1X, eye1Y, eyeSize, eyeSize);
        ctx.fillRect(eye2X, eye2Y, eyeSize, eyeSize);
      }
    });

    // Draw food
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(
      food.x * CELL_SIZE + CELL_SIZE / 2,
      food.y * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE / 2 - 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Add shine to food
    ctx.fillStyle = '#fca5a5';
    ctx.beginPath();
    ctx.arc(
      food.x * CELL_SIZE + CELL_SIZE / 2 - 2,
      food.y * CELL_SIZE + CELL_SIZE / 2 - 2,
      3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }, [snake, food, direction]);

  // Handle keyboard input
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (gameState !== 'playing') return;

    // Prevent 180-degree turns
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        if (direction !== 'down') {
          setNextDirection('up');
        }
        e.preventDefault();
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        if (direction !== 'up') {
          setNextDirection('down');
        }
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        if (direction !== 'right') {
          setNextDirection('left');
        }
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        if (direction !== 'left') {
          setNextDirection('right');
        }
        e.preventDefault();
        break;
    }
  }, [gameState, direction]);

  // Start game
  const startGame = useCallback(() => {
    initializeGame();
    setGameState('playing');
  }, [initializeGame]);

  // Restart game
  const restartGame = useCallback(() => {
    initializeGame();
    setGameState('playing');
  }, [initializeGame]);

  // Game loop effect
  useEffect(() => {
    if (gameState === 'playing') {
      gameLoopRef.current = window.setInterval(() => {
        updateGame();
      }, INITIAL_SPEED);

      return () => {
        if (gameLoopRef.current) {
          clearInterval(gameLoopRef.current);
          gameLoopRef.current = null;
        }
      };
    }
  }, [gameState, updateGame]);

  // Draw effect
  useEffect(() => {
    drawGame();
  }, [drawGame]);

  // Keyboard event listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-8 h-full">
      <Card className="border border-border bg-card/50 backdrop-blur-sm p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Snake Game</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Use arrow keys or WASD to control
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Score</div>
            <div className="text-2xl font-bold text-foreground">{score}</div>
            <div className="text-xs text-muted-foreground mt-1">
              High Score: {highScore}
            </div>
          </div>
        </div>

        {/* Game Canvas */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={GRID_SIZE * CELL_SIZE}
            height={GRID_SIZE * CELL_SIZE}
            className="border-2 border-border rounded-lg"
          />

          {/* Start Screen */}
          {gameState === 'start' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
              <div className="text-center">
                <h3 className="text-xl font-bold text-foreground mb-2">Ready to Play?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Eat food to grow and score points!
                </p>
                <Button onClick={startGame} size="lg">
                  Start Game
                </Button>
              </div>
            </div>
          )}

          {/* Game Over Screen */}
          {gameState === 'gameover' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
              <div className="text-center">
                <h3 className="text-xl font-bold text-destructive mb-2">Game Over!</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Final Score: {score}
                </p>
                {score === highScore && score > 0 && (
                  <p className="text-sm text-success mb-4">New High Score!</p>
                )}
                <Button onClick={restartGame} size="lg">
                  Play Again
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-4 text-center text-sm text-muted-foreground">
          <p>
            <span className="font-medium">Controls:</span> Arrow Keys or WASD
          </p>
          <p className="mt-1">
            <span className="font-medium">Goal:</span> Eat food to grow and avoid walls and yourself
          </p>
        </div>
      </Card>
    </div>
  );
}