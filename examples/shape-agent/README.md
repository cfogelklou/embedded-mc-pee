# Shape Agent Example

Multi-turn conversation test where a user gives feedback on work an agent is doing. The agent "draws" shapes by outputting coordinates on a 100x100 canvas.

## What it demonstrates

- **Conversation flow**: Host maintains conversation history across multiple turns
- **Geometric validation**: Validators check shape invariants (triangles, squares, rectangles)
- **Context accumulation**: Each turn includes prior user messages and agent proposals
- **Spatial reasoning**: Agent tracks and avoids overlap with previously drawn shapes

## Contract

The agent responds with a shape (or array of shapes) following this schema:

```typescript
interface Point {
  x: number;  // 0-100
  y: number;  // 0-100
}

interface Shape {
  shapeId: string;
  kind: 'triangle' | 'square' | 'rectangle';
  points: Point[];
}

interface ShapePayload {
  shapes: Shape[];
}
```

## Geometric validators

Each shape type has specific invariant checks (with numeric tolerance for floating-point rounding):

- **Triangle**: Exactly 3 distinct points, non-degenerate (area > 0)
- **Square**: 4 points forming equal sides + right angles
- **Rectangle**: 4 points with opposite sides equal + right angles

Tolerance values: distance checks use ±0.5, angle checks use ±5 degrees.

## Conversation flow

1. Turn 1: User asks "draw a triangle"
2. Turn 2: User asks "now draw a square next to it" — shapes must not overlap
3. Turn 3: User asks "draw two rectangles below those" — no overlap with any prior shape

Each turn validates:
- Valid `proposal` envelope
- Geometric invariants hold for the new shapes
- Bounding-box disjointness: new shapes don't overlap previously drawn shapes

## Running the test

```bash
# From package root
npm run test:examples

# Or directly
npx vitest run --config examples/vitest.config.ts
```

Requires `GEMINI_API_KEY` in `.env` (gitignored).
