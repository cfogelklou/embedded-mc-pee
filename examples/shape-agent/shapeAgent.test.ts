/**
 * Shape Agent Example Test
 *
 * Multi-turn conversation test: user gives feedback on work an agent is doing.
 * The agent "draws" shapes by outputting coordinates on a 100x100 canvas.
 * Each turn validates shape invariants and non-overlap with previous shapes.
 */

import { describe, beforeAll, it, expect } from 'vitest';
import { createHarness, createContract, dbg } from 'embedded-mc-pee';
import { createGeminiTransport, type GeminiTransportResult } from 'embedded-mc-pee/gemini';
import type { ContractManifest, ValidationFailureCode, AgentTurn, CreateHarnessResult } from 'embedded-mc-pee';

// ============================================================================
// Types
// ============================================================================

interface Point {
  x: number;
  y: number;
}

interface Shape {
  shapeId: string;
  kind: 'triangle' | 'square' | 'rectangle';
  points: Point[];
}

interface ShapePayload {
  shapes: Shape[];
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ============================================================================
// Geometric Validators (with tolerance for floating-point rounding)
// ============================================================================

/**
 * Tolerance values for geometric checks.
 * Models may output floating-point coordinates; we allow small rounding differences.
 */
const DISTANCE_TOLERANCE = 0.5;  // ±0.5 units for distance checks
const ANGLE_TOLERANCE_DEG = 5;   // ±5 degrees for angle checks

function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distancesEqual(d1: number, d2: number): boolean {
  return Math.abs(d1 - d2) <= DISTANCE_TOLERANCE;
}

/**
 * Calculate angle at point B formed by segments AB and BC.
 * Returns angle in degrees (0-180).
 */
function calculateAngle(a: Point, b: Point, c: Point): number {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);

  // Law of cosines: cos(B) = (AB² + BC² - AC²) / (2 * AB * BC)
  const cosB = (ab * ab + bc * bc - ac * ac) / (2 * ab * bc);
  const angleRad = Math.acos(Math.max(-1, Math.min(1, cosB))); // Clamp for floating-point errors
  const angleDeg = angleRad * (180 / Math.PI);
  return angleDeg;
}

function isRightAngle(angle: number): boolean {
  return Math.abs(angle - 90) <= ANGLE_TOLERANCE_DEG;
}

/**
 * Calculate triangle area using Heron's formula.
 * Returns 0 for degenerate triangles (collinear points).
 */
function triangleArea(p1: Point, p2: Point, p3: Point): number {
  const a = distance(p1, p2);
  const b = distance(p2, p3);
  const c = distance(p3, p1);
  const s = (a + b + c) / 2;
  const areaSquared = s * (s - a) * (s - b) * (s - c);
  return areaSquared > 0 ? Math.sqrt(areaSquared) : 0;
}

/**
 * Validate triangle invariants:
 * - Exactly 3 distinct points
 * - Non-degenerate (area > 0)
 */
function validateTriangle(shape: Shape):
  | { ok: true }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } }
{
  if (shape.points.length !== 3) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: `Triangle must have exactly 3 points, got ${shape.points.length}`,
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  const [p1, p2, p3] = shape.points;

  // Check distinct points
  if (distancesEqual(distance(p1, p2), 0)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Triangle points must be distinct (p1 == p2)',
        fieldPath: `$.shapes[${shape.shapeId}].points[0]`
      }
    };
  }
  if (distancesEqual(distance(p2, p3), 0)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Triangle points must be distinct (p2 == p3)',
        fieldPath: `$.shapes[${shape.shapeId}].points[1]`
      }
    };
  }
  if (distancesEqual(distance(p3, p1), 0)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Triangle points must be distinct (p3 == p1)',
        fieldPath: `$.shapes[${shape.shapeId}].points[2]`
      }
    };
  }

  // Check non-degenerate (area > 0)
  const area = triangleArea(p1, p2, p3);
  if (area <= 0.1) { // Small threshold for floating-point
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Triangle is degenerate (collinear points)',
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  return { ok: true };
}

/**
 * Validate square invariants:
 * - 4 points forming equal sides + right angles
 */
function validateSquare(shape: Shape):
  | { ok: true }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } }
{
  if (shape.points.length !== 4) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: `Square must have exactly 4 points, got ${shape.points.length}`,
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  const pts = shape.points;

  // Check distinct points
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (distancesEqual(distance(pts[i], pts[j]), 0)) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid' as ValidationFailureCode,
            message: `Square points must be distinct (p${i} == p${j})`,
            fieldPath: `$.shapes[${shape.shapeId}].points[${i}]`
          }
        };
      }
    }
  }

  // Find side lengths (convex hull approach: assume model orders vertices)
  // For a square, we expect 4 equal sides and 2 equal diagonals
  const allDistances: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      allDistances.push(distance(pts[i], pts[j]));
    }
  }
  allDistances.sort((a, b) => a - b);

  // Smallest 4 should be equal (sides), largest 2 should be equal (diagonals)
  const side1 = allDistances[0];
  const side2 = allDistances[1];
  const side3 = allDistances[2];
  const side4 = allDistances[3];
  const diag1 = allDistances[4];
  const diag2 = allDistances[5];

  // Check 4 equal sides
  if (!distancesEqual(side1, side2) || !distancesEqual(side2, side3) || !distancesEqual(side3, side4)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Square must have 4 equal sides',
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  // Check 2 equal diagonals
  if (!distancesEqual(diag1, diag2)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Square must have 2 equal diagonals',
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  // Check right angles (at each vertex)
  // Need to determine vertex order - assume model provides them in order
  const angles: number[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const curr = pts[i];
    const next = pts[(i + 1) % 4];
    angles.push(calculateAngle(prev, curr, next));
  }

  const rightAngleCount = angles.filter(a => isRightAngle(a)).length;
  if (rightAngleCount < 4) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: `Square must have 4 right angles, found ${rightAngleCount}`,
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  return { ok: true };
}

/**
 * Validate rectangle invariants:
 * - 4 points with opposite sides equal + right angles
 */
function validateRectangle(shape: Shape):
  | { ok: true }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } }
{
  if (shape.points.length !== 4) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: `Rectangle must have exactly 4 points, got ${shape.points.length}`,
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  const pts = shape.points;

  // Check distinct points
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (distancesEqual(distance(pts[i], pts[j]), 0)) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid' as ValidationFailureCode,
            message: `Rectangle points must be distinct (p${i} == p${j})`,
            fieldPath: `$.shapes[${shape.shapeId}].points[${i}]`
          }
        };
      }
    }
  }

  // For a rectangle, we expect 2 pairs of equal sides and equal diagonals
  const allDistances: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      allDistances.push(distance(pts[i], pts[j]));
    }
  }
  allDistances.sort((a, b) => a - b);

  // Smallest 4 are sides (2 pairs of equal), largest 2 are diagonals (equal)
  const side1 = allDistances[0];
  const side2 = allDistances[1];
  const side3 = allDistances[2];
  const side4 = allDistances[3];
  const diag1 = allDistances[4];
  const diag2 = allDistances[5];

  // Check 2 pairs of equal sides (side1 == side2, side3 == side4)
  if (!distancesEqual(side1, side2) || !distancesEqual(side3, side4)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Rectangle must have 2 pairs of equal sides',
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  // Check equal diagonals
  if (!distancesEqual(diag1, diag2)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: 'Rectangle must have equal diagonals',
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  // Check right angles (at each vertex)
  const angles: number[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const curr = pts[i];
    const next = pts[(i + 1) % 4];
    angles.push(calculateAngle(prev, curr, next));
  }

  const rightAngleCount = angles.filter(a => isRightAngle(a)).length;
  if (rightAngleCount < 4) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid' as ValidationFailureCode,
        message: `Rectangle must have 4 right angles, found ${rightAngleCount}`,
        fieldPath: `$.shapes[${shape.shapeId}].points`
      }
    };
  }

  return { ok: true };
}

// ============================================================================
// Bounding Box & Overlap Check
// ============================================================================

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function getBoundingBox(shape: Shape): BoundingBox {
  const xs = shape.points.map(p => p.x);
  const ys = shape.points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

/**
 * Check if two bounding boxes are disjoint (no overlap).
 * Uses strict inequality to allow touching edges.
 */
function boundingBoxesDisjoint(box1: BoundingBox, box2: BoundingBox): boolean {
  return (
    box1.maxX < box2.minX ||
    box2.maxX < box1.minX ||
    box1.maxY < box2.minY ||
    box2.maxY < box1.minY
  );
}

// ============================================================================
// Manifest
// ============================================================================

const shapeManifest: ContractManifest = {
  payload: {
    type: 'object',
    properties: {
      shapes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            shapeId: { type: 'string' },
            kind: { type: 'string', enum: ['triangle', 'square', 'rectangle'] },
            points: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number', minimum: 0, maximum: 100 },
                  y: { type: 'number', minimum: 0, maximum: 100 }
                },
                required: ['x', 'y']
              }
            }
          },
          required: ['shapeId', 'kind', 'points']
        }
      }
    },
    required: ['shapes']
  },
  envelope: {
    states: ['proposal']
  }
};

// ============================================================================
// Payload Validator Factory
// ============================================================================

function createShapeValidator(previousShapes: Shape[]): (payload: unknown) =>
  | { ok: true; value: ShapePayload }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } }
{
  return (payload: unknown):
    | { ok: true; value: ShapePayload }
    | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } } => {
    if (typeof payload !== 'object' || payload === null) {
      return {
        ok: false,
        failure: {
          code: 'schema_invalid' as ValidationFailureCode,
          message: 'Payload must be an object',
          fieldPath: '$.payload'
        }
      };
    }

    const p = payload as Record<string, unknown>;

    if (!Array.isArray(p.shapes)) {
      return {
        ok: false,
        failure: {
          code: 'missing_required_field' as ValidationFailureCode,
          message: 'shapes must be an array',
          fieldPath: '$.payload.shapes'
        }
      };
    }

    // Validate each shape
    for (let idx = 0; idx < p.shapes.length; idx++) {
      const shape = p.shapes[idx];
      if (typeof shape !== 'object' || shape === null) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid' as ValidationFailureCode,
            message: `Shape at index ${idx} is not an object`,
            fieldPath: `$.payload.shapes[${idx}]`
          }
        };
      }

      const s = shape as Record<string, unknown>;

      if (typeof s.shapeId !== 'string') {
        return {
          ok: false,
          failure: {
            code: 'missing_required_field' as ValidationFailureCode,
            message: `Shape ${idx} missing shapeId`,
            fieldPath: `$.payload.shapes[${idx}].shapeId`
          }
        };
      }

      if (typeof s.kind !== 'string' || !['triangle', 'square', 'rectangle'].includes(s.kind)) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid' as ValidationFailureCode,
            message: `Shape ${idx} has invalid kind: ${s.kind}`,
            fieldPath: `$.payload.shapes[${idx}].kind`
          }
        };
      }

      if (!Array.isArray(s.points)) {
        return {
          ok: false,
          failure: {
            code: 'missing_required_field' as ValidationFailureCode,
            message: `Shape ${idx} missing points array`,
            fieldPath: `$.payload.shapes[${idx}].points`
          }
        };
      }

      const typedShape: Shape = {
        shapeId: s.shapeId as string,
        kind: s.kind as Shape['kind'],
        points: s.points as Point[]
      };

      // Check coordinates are in range
      for (let pIdx = 0; pIdx < typedShape.points.length; pIdx++) {
        const pt = typedShape.points[pIdx];
        if (typeof pt.x !== 'number' || typeof pt.y !== 'number') {
          return {
            ok: false,
            failure: {
              code: 'schema_invalid' as ValidationFailureCode,
              message: `Point ${pIdx} must have numeric x and y`,
              fieldPath: `$.payload.shapes[${idx}].points[${pIdx}]`
            }
          };
        }
        if (pt.x < 0 || pt.x > 100 || pt.y < 0 || pt.y > 100) {
          return {
            ok: false,
            failure: {
              code: 'schema_invalid' as ValidationFailureCode,
              message: `Point ${pIdx} coordinates must be 0-100, got (${pt.x}, ${pt.y})`,
              fieldPath: `$.payload.shapes[${idx}].points[${pIdx}]`
            }
          };
        }
      }

      // Validate geometric invariants for this shape kind
      let geomResult:
        | { ok: true }
        | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } };
      switch (typedShape.kind) {
        case 'triangle':
          geomResult = validateTriangle(typedShape);
          break;
        case 'square':
          geomResult = validateSquare(typedShape);
          break;
        case 'rectangle':
          geomResult = validateRectangle(typedShape);
          break;
        default:
          // Exhaustive switch guard - TypeScript doesn't know we filtered above
          const _exhaustive: never = typedShape.kind;
          return {
            ok: false,
            failure: {
              code: 'schema_invalid' as ValidationFailureCode,
              message: `Unknown shape kind: ${_exhaustive}`,
              fieldPath: `$.payload.shapes[${idx}].kind`
            }
          };
      }

      if (!geomResult.ok) {
        return geomResult;
      }

      // Check no overlap with previous shapes
      const newBox = getBoundingBox(typedShape);
      for (const prevShape of previousShapes) {
        const prevBox = getBoundingBox(prevShape);
        if (!boundingBoxesDisjoint(newBox, prevBox)) {
          return {
            ok: false,
            failure: {
              code: 'schema_invalid' as ValidationFailureCode,
              message: `Shape ${typedShape.shapeId} overlaps with previous shape ${prevShape.shapeId}`,
              fieldPath: `$.payload.shapes[${idx}]`
            }
          };
        }
      }
    }

    return {
      ok: true,
      value: { shapes: p.shapes as Shape[] }
    };
  };
}

// ============================================================================
// Conversation History Helper
// ============================================================================

function formatConversationHistory(history: ConversationTurn[]): string {
  if (history.length === 0) {
    return '';
  }

  const lines: string[] = ['CONVERSATION HISTORY:'];
  for (const turn of history) {
    const speaker = turn.role === 'user' ? 'USER' : 'ASSISTANT';
    lines.push(`${speaker}: ${turn.content}`);
  }
  lines.push('END OF HISTORY');
  return lines.join('\n');
}

// ============================================================================
// Test Suite
// ============================================================================

describe('shape-agent example', () => {
  let transportResult: GeminiTransportResult | null = null;
  let hasKey = false;
  const allShapes: Shape[] = []; // Accumulates across turns

  beforeAll(async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return;
    }
    hasKey = true;

    const result = createGeminiTransport({ apiKey });
    transportResult = result;
    if (!result.ok) {
      throw new Error(`Gemini transport config failed: ${JSON.stringify(result.failures)}`);
    }
    dbg.log('✓ Gemini transport created successfully');
  });

  describe('multi-turn conversation', () => {
    const conversationHistory: ConversationTurn[] = [];

    it('turn 1: should draw a triangle', () => {
      if (!hasKey || !transportResult) {
        return;
      }

      if (!transportResult.ok) {
        throw new Error('Setup failed');
      }

      // Validator checks against empty previous shapes
      const contractResult = createContract<ShapePayload>(
        shapeManifest,
        createShapeValidator(allShapes)
      );

      if (!contractResult.ok) {
        throw new Error(`Contract creation failed: ${JSON.stringify(contractResult.failures)}`);
      }

      const harnessResult: CreateHarnessResult<ShapePayload> = createHarness({
        transport: transportResult.transport,
        models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
        maxIterations: 1,
        perModelTimeoutMs: 20_000,
        totalBudgetMs: 40_000,
      }, contractResult.contract);

      if (!harnessResult.ok) {
        throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
      }

      const systemInstruction = 'You are a shape drawing agent. Draw shapes on a 100x100 canvas by outputting coordinates. Return ONLY a valid JSON envelope.';
      const promptText = `You are a shape drawing agent. You "draw" shapes on a 100x100 canvas by outputting their coordinates.

CANVAS: 100x100 units. Coordinates are 0-100 for both x and y.

${formatConversationHistory(conversationHistory)}

USER REQUEST: Draw a triangle anywhere on the canvas.

IMPORTANT: You MUST return ONLY a valid JSON envelope with this exact structure:
{
  "state": "proposal",
  "payload": {
    "shapes": [
      {
        "shapeId": "<unique id>",
        "kind": "triangle",
        "points": [
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>}
        ]
      }
    ]
  }
}

Triangle requirements:
- Exactly 3 points
- All points must be distinct (no duplicates)
- Points must not be collinear (must form a valid triangle)
- Coordinates 0-100

Return ONLY the JSON. No explanations.`;

      return harnessResult.harness.runTurn({
        systemInstruction,
        promptText,
      }).then(result => {
        if (!result.ok) {
          dbg.log('Shape turn 1 - Harness result failure kind:', result.kind);
          dbg.log('Shape turn 1 - Turn envelope state:', result.turn.envelope.state);
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.turn.envelope.state).toBe('proposal');
        expect(result.turn.payload).toBeDefined();

        const turn = result.turn as AgentTurn<ShapePayload>;
        expect(turn.payload?.shapes).toBeDefined();
        expect(Array.isArray(turn.payload?.shapes)).toBe(true);
        expect(turn.payload?.shapes.length).toBeGreaterThanOrEqual(1);

        // Verify triangle invariants
        const shapes = turn.payload?.shapes ?? [];
        const triangle = shapes.find(s => s.kind === 'triangle');
        expect(triangle).toBeDefined();
        if (triangle) {
          const validationResult = validateTriangle(triangle);
          expect(validationResult.ok).toBe(true);

          // Add to global collection for next turn
          allShapes.push(triangle);
          conversationHistory.push({ role: 'user', content: 'Draw a triangle anywhere on the canvas.' });
          conversationHistory.push({ role: 'assistant', content: `Drew triangle ${triangle.shapeId} with points: ${JSON.stringify(triangle.points)}` });
        }
      });
    });

    it('turn 2: should draw a square next to the triangle (no overlap)', () => {
      if (!hasKey || !transportResult) {
        return;
      }

      if (!transportResult.ok) {
        throw new Error('Setup failed');
      }

      // Validator checks overlap with turn 1 triangle
      const contractResult = createContract<ShapePayload>(
        shapeManifest,
        createShapeValidator(allShapes)
      );

      if (!contractResult.ok) {
        throw new Error(`Contract creation failed: ${JSON.stringify(contractResult.failures)}`);
      }

      const harnessResult: CreateHarnessResult<ShapePayload> = createHarness({
        transport: transportResult.transport,
        models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
        maxIterations: 1,
        perModelTimeoutMs: 20_000,
        totalBudgetMs: 40_000,
      }, contractResult.contract);

      if (!harnessResult.ok) {
        throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
      }

      const systemInstruction = 'You are a shape drawing agent. Draw shapes on a 100x100 canvas by outputting coordinates. Return ONLY a valid JSON envelope.';
      const promptText = `You are a shape drawing agent. You "draw" shapes on a 100x100 canvas by outputting their coordinates.

CANVAS: 100x100 units. Coordinates are 0-100 for both x and y.

${formatConversationHistory(conversationHistory)}

USER REQUEST: Now draw a square next to the triangle (not overlapping it).

IMPORTANT: You MUST return ONLY a valid JSON envelope with this exact structure:
{
  "state": "proposal",
  "payload": {
    "shapes": [
      {
        "shapeId": "<unique id>",
        "kind": "square",
        "points": [
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>}
        ]
      }
    ]
  }
}

Square requirements:
- Exactly 4 points
- All points must be distinct
- 4 equal sides
- 4 right angles (90 degrees)
- Coordinates 0-100
- Must NOT overlap the existing triangle ${allShapes[0].shapeId}

Return ONLY the JSON. No explanations.`;

      return harnessResult.harness.runTurn({
        systemInstruction,
        promptText,
      }).then(result => {
        if (!result.ok) {
          dbg.log('Shape turn 2 - Harness result failure kind:', result.kind);
          dbg.log('Shape turn 2 - Turn envelope state:', result.turn.envelope.state);
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.turn.envelope.state).toBe('proposal');
        expect(result.turn.payload).toBeDefined();

        const turn = result.turn as AgentTurn<ShapePayload>;
        expect(turn.payload?.shapes).toBeDefined();
        expect(Array.isArray(turn.payload?.shapes)).toBe(true);

        // Verify square invariants
        const shapes = turn.payload?.shapes ?? [];
        const square = shapes.find(s => s.kind === 'square');
        expect(square).toBeDefined();
        if (square) {
          const validationResult = validateSquare(square);
          expect(validationResult.ok).toBe(true);

          // Verify no overlap with triangle
          const triangleBox = getBoundingBox(allShapes[0]);
          const squareBox = getBoundingBox(square);
          expect(boundingBoxesDisjoint(triangleBox, squareBox)).toBe(true);

          // Add to collection
          allShapes.push(square);
          conversationHistory.push({ role: 'user', content: 'Now draw a square next to the triangle (not overlapping it).' });
          conversationHistory.push({ role: 'assistant', content: `Drew square ${square.shapeId} with points: ${JSON.stringify(square.points)}` });
        }
      });
    });

    it('turn 3: should draw two rectangles below those shapes (no overlap)', () => {
      if (!hasKey || !transportResult) {
        return;
      }

      if (!transportResult.ok) {
        throw new Error('Setup failed');
      }

      // Validator checks overlap with turn 1 triangle + turn 2 square
      const contractResult = createContract<ShapePayload>(
        shapeManifest,
        createShapeValidator(allShapes)
      );

      if (!contractResult.ok) {
        throw new Error(`Contract creation failed: ${JSON.stringify(contractResult.failures)}`);
      }

      const harnessResult: CreateHarnessResult<ShapePayload> = createHarness({
        transport: transportResult.transport,
        models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
        maxIterations: 1,
        perModelTimeoutMs: 20_000,
        totalBudgetMs: 40_000,
      }, contractResult.contract);

      if (!harnessResult.ok) {
        throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
      }

      const systemInstruction = 'You are a shape drawing agent. Draw shapes on a 100x100 canvas by outputting coordinates. Return ONLY a valid JSON envelope.';
      const promptText = `You are a shape drawing agent. You "draw" shapes on a 100x100 canvas by outputting their coordinates.

CANVAS: 100x100 units. Coordinates are 0-100 for both x and y.

${formatConversationHistory(conversationHistory)}

USER REQUEST: Draw two rectangles below the triangle and square (not overlapping any existing shapes).

IMPORTANT: You MUST return ONLY a valid JSON envelope with this exact structure:
{
  "state": "proposal",
  "payload": {
    "shapes": [
      {
        "shapeId": "<unique id 1>",
        "kind": "rectangle",
        "points": [
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>}
        ]
      },
      {
        "shapeId": "<unique id 2>",
        "kind": "rectangle",
        "points": [
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>},
          {"x": <number>, "y": <number>}
        ]
      }
    ]
  }
}

Rectangle requirements:
- Exactly 4 points
- All points must be distinct
- 2 pairs of equal sides
- 4 right angles (90 degrees)
- Coordinates 0-100
- Must NOT overlap existing shapes: ${allShapes.map(s => s.shapeId).join(', ')}

Return ONLY the JSON. No explanations.`;

      return harnessResult.harness.runTurn({
        systemInstruction,
        promptText,
      }).then(result => {
        if (!result.ok) {
          dbg.log('Shape turn 3 - Harness result failure kind:', result.kind);
          dbg.log('Shape turn 3 - Turn envelope state:', result.turn.envelope.state);
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.turn.envelope.state).toBe('proposal');
        expect(result.turn.payload).toBeDefined();

        const turn = result.turn as AgentTurn<ShapePayload>;
        expect(turn.payload?.shapes).toBeDefined();
        expect(Array.isArray(turn.payload?.shapes)).toBe(true);
        expect(turn.payload?.shapes.length).toBeGreaterThanOrEqual(2);

        // Verify rectangle invariants
        const shapes = turn.payload?.shapes ?? [];
        const rectangles = shapes.filter(s => s.kind === 'rectangle');
        expect(rectangles.length).toBeGreaterThanOrEqual(2);

        for (const rect of rectangles) {
          const validationResult = validateRectangle(rect);
          expect(validationResult.ok).toBe(true);

          // Verify no overlap with any previous shape
          const rectBox = getBoundingBox(rect);
          for (const prevShape of allShapes) {
            const prevBox = getBoundingBox(prevShape);
            expect(boundingBoxesDisjoint(rectBox, prevBox)).toBe(true);
          }

          // Add to collection
          allShapes.push(rect);
        }

        conversationHistory.push({ role: 'user', content: 'Draw two rectangles below the triangle and square (not overlapping any existing shapes).' });
        conversationHistory.push({ role: 'assistant', content: `Drew ${rectangles.length} rectangles with points: ${JSON.stringify(rectangles.map(r => ({ shapeId: r.shapeId, points: r.points })))}` });

        dbg.log('Total shapes drawn:', allShapes.length);
      });
    });
  });
});
