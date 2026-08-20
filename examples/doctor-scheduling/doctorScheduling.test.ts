/**
 * Doctor Scheduling Example Test
 *
 * Showcase test: mini state input, constraint satisfaction, deliberate conflict.
 * Two scenarios: feasible → proposal, conflicting → infeasible OR question.
 */

import { describe, beforeAll, it, expect } from 'vitest';
import { createHarness, createContract, dbg } from 'embedded-mc-pee';
import { createGeminiTransport, type GeminiTransportResult } from 'embedded-mc-pee/gemini';
import type { ContractManifest, ValidationFailureCode, AgentTurn, CreateContractResult, CreateHarnessResult } from 'embedded-mc-pee';

// ============================================================================
// Types
// ============================================================================

interface SlotAssignment {
  patientId: string;
  slotId: string;
  doctorId: string;
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
}

interface SchedulingPayload {
  assignments: SlotAssignment[];
}

interface DoctorSlot {
  slotId: string;
  doctorId: string;
  doctorName: string;
  startTime: string;
  endTime: string;
  maxPatients: number;
}

interface Patient {
  patientId: string;
  patientName: string;
  requiredDurationMinutes: number;
  preferredDoctorIds?: string[];
}

// ============================================================================
// Manifest
// ============================================================================

const schedulingManifest: ContractManifest = {
  payload: {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            patientId: { type: 'string' },
            slotId: { type: 'string' },
            doctorId: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' }
          },
          required: ['patientId', 'slotId', 'doctorId', 'startTime', 'endTime']
        }
      }
    },
    required: ['assignments']
  },
  envelope: {
    states: ['proposal', 'infeasible', 'question']
  }
};

// ============================================================================
// Payload Validator
// ============================================================================

type SchedulingValidatorResult =
  | { ok: true; value: SchedulingPayload }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } };

function createSchedulingValidator(
  slots: DoctorSlot[],
  patients: Patient[]
): (payload: unknown) => SchedulingValidatorResult {
  return (payload: unknown): SchedulingValidatorResult => {
    if (typeof payload !== 'object' || payload === null) {
      return {
        ok: false,
        failure: { code: 'schema_invalid', message: 'Payload must be an object', fieldPath: '$.payload' }
      };
    }

    const p = payload as Record<string, unknown>;

    // Check assignments array
    if (!Array.isArray(p.assignments)) {
      return {
        ok: false,
        failure: {
          code: 'missing_required_field',
          message: 'assignments must be an array',
          fieldPath: '$.payload.assignments'
        }
      };
    }

    // Build lookup maps
    const slotMap = new Map(slots.map(s => [s.slotId, s]));
    const patientMap = new Map(patients.map(pt => [pt.patientId, pt]));
    const assignedPatients = new Set<string>();

    // Validate each assignment
    for (let idx = 0; idx < p.assignments.length; idx++) {
      const assignment = p.assignments[idx];
      if (typeof assignment !== 'object' || assignment === null) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid',
            message: `Assignment at index ${idx} is not an object`,
            fieldPath: `$.payload.assignments[${idx}]`
          }
        };
      }

      const a = assignment as Record<string, unknown>;

      // Check required fields
      if (typeof a.patientId !== 'string') {
        return {
          ok: false,
          failure: {
            code: 'missing_required_field',
            message: `Assignment ${idx} missing patientId`,
            fieldPath: `$.payload.assignments[${idx}].patientId`
          }
        };
      }
      if (typeof a.slotId !== 'string') {
        return {
          ok: false,
          failure: {
            code: 'missing_required_field',
            message: `Assignment ${idx} missing slotId`,
            fieldPath: `$.payload.assignments[${idx}].slotId`
          }
        };
      }
      if (typeof a.doctorId !== 'string') {
        return {
          ok: false,
          failure: {
            code: 'missing_required_field',
            message: `Assignment ${idx} missing doctorId`,
            fieldPath: `$.payload.assignments[${idx}].doctorId`
          }
        };
      }

      const patientId = a.patientId as string;
      const slotId = a.slotId as string;

      // Check duplicate patient assignments
      if (assignedPatients.has(patientId)) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid',
            message: `Patient ${patientId} assigned to multiple slots`,
            fieldPath: `$.payload.assignments[${idx}]`
          }
        };
      }
      assignedPatients.add(patientId);

      // Validate references
      if (!patientMap.has(patientId)) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid',
            message: `Unknown patientId: ${patientId}`,
            fieldPath: `$.payload.assignments[${idx}].patientId`
          }
        };
      }

      if (!slotMap.has(slotId)) {
        return {
          ok: false,
          failure: {
            code: 'schema_invalid',
            message: `Unknown slotId: ${slotId}`,
            fieldPath: `$.payload.assignments[${idx}].slotId`
          }
        };
      }
    }

    return {
      ok: true,
      value: { assignments: p.assignments as SlotAssignment[] }
    };
  };
}

// ============================================================================
// Test Data
// ============================================================================

const feasibleSlots: DoctorSlot[] = [
  {
    slotId: 'slot-1',
    doctorId: 'doc-1',
    doctorName: 'Dr. Smith',
    startTime: '09:00',
    endTime: '10:00',
    maxPatients: 2
  },
  {
    slotId: 'slot-2',
    doctorId: 'doc-1',
    doctorName: 'Dr. Smith',
    startTime: '10:00',
    endTime: '11:00',
    maxPatients: 2
  }
];

const feasiblePatients: Patient[] = [
  {
    patientId: 'pt-1',
    patientName: 'Alice',
    requiredDurationMinutes: 30,
    preferredDoctorIds: ['doc-1']
  },
  {
    patientId: 'pt-2',
    patientName: 'Bob',
    requiredDurationMinutes: 30
  }
];

const conflictingSlots: DoctorSlot[] = [
  {
    slotId: 'slot-1',
    doctorId: 'doc-1',
    doctorName: 'Dr. Smith',
    startTime: '09:00',
    endTime: '09:30',  // Only 30 min total
    maxPatients: 1
  }
];

const conflictingPatients: Patient[] = [
  {
    patientId: 'pt-1',
    patientName: 'Alice',
    requiredDurationMinutes: 60,  // Too long!
    preferredDoctorIds: ['doc-1']
  },
  {
    patientId: 'pt-2',
    patientName: 'Bob',
    requiredDurationMinutes: 30  // Would fit if Alice didn't need 60min
  }
];

// ============================================================================
// Test Suite
// ============================================================================

describe('doctor-scheduling example', () => {
  let transportResult: GeminiTransportResult | null = null;
  let hasKey = false;

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
  });

  describe('feasible case', () => {
    let contractResult: CreateContractResult<SchedulingPayload> | null = null;

    beforeAll(async () => {
      if (!transportResult || !hasKey) return;

      const result = createContract<SchedulingPayload>(
        schedulingManifest,
        createSchedulingValidator(feasibleSlots, feasiblePatients)
      );
      contractResult = result;
      if (!result.ok) {
        throw new Error(`Contract creation failed: ${JSON.stringify(result.failures)}`);
      }
    });

    it('should produce proposal with valid assignments', () => {
      if (!hasKey || !transportResult || !contractResult) {
        return;
      }

      if (!transportResult.ok || !contractResult.ok) {
        throw new Error('Setup failed');
      }

      const harnessResult: CreateHarnessResult<SchedulingPayload> = createHarness({
        transport: transportResult.transport,
        models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
        maxIterations: 1,
        perModelTimeoutMs: 20_000,
        totalBudgetMs: 40_000,
      }, contractResult.contract);

      if (!harnessResult.ok) {
        throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
      }

      const slotsText = feasibleSlots.map(s =>
        `- ${s.slotId}: Dr. ${s.doctorName} (${s.startTime}-${s.endTime}, max ${s.maxPatients})`
      ).join('\n');

      const patientsText = feasiblePatients.map(p =>
        `- ${p.patientId}: ${p.patientName} (${p.requiredDurationMinutes}min${p.preferredDoctorIds ? `, prefers ${p.preferredDoctorIds.join(', ')}` : ''})`
      ).join('\n');

      const systemInstruction = 'You are a medical scheduler. Given the constraints, assign patients to time slots. Return ONLY a valid JSON envelope.';
      const promptText = `You are a medical scheduler. Given doctor availability and patient requirements, assign each patient to exactly one time slot.

DOCTOR SLOTS:
${slotsText}

PATIENTS:
${patientsText}

IMPORTANT: You MUST return ONLY a valid JSON envelope. If feasible, return:
{
  "state": "proposal",
  "payload": {
    "assignments": [
      {
        "patientId": "<id>",
        "slotId": "<slot>",
        "doctorId": "<id>",
        "startTime": "HH:MM",
        "endTime": "HH:MM"
      }
    ]
  }
}

If impossible, return:
{
  "state": "infeasible",
  "explanation": "<why it's impossible>"
}

Do NOT return a question state. Only proposal or infeasible.`;

      return harnessResult.harness.runTurn({
        systemInstruction,
        promptText,
      }).then(result => {
        if (!result.ok) {
          dbg.log('Harness result failure kind:', result.kind);
          dbg.log('Turn envelope state:', result.turn.envelope.state);
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.turn.envelope.state).toBe('proposal');
        expect(result.turn.payload).toBeDefined();

        const turn = result.turn as AgentTurn<SchedulingPayload>;
        expect(turn.payload?.assignments).toBeDefined();
        expect(Array.isArray(turn.payload?.assignments)).toBe(true);

        // Verify all patients assigned exactly once
        const assignedPatientIds = new Set(
          turn.payload?.assignments.map((a: SlotAssignment) => a.patientId) || []
        );
        expect(assignedPatientIds.size).toBe(feasiblePatients.length);
        feasiblePatients.forEach(p => {
          expect(assignedPatientIds.has(p.patientId)).toBe(true);
        });
      });
    });
  });

  describe('conflicting case', () => {
    let contractResult: CreateContractResult<SchedulingPayload> | null = null;

    beforeAll(async () => {
      if (!transportResult || !hasKey) return;

      const result = createContract<SchedulingPayload>(
        schedulingManifest,
        createSchedulingValidator(conflictingSlots, conflictingPatients)
      );
      contractResult = result;
      if (!result.ok) {
        throw new Error(`Contract creation failed: ${JSON.stringify(result.failures)}`);
      }
    });

    it('should produce infeasible OR question (model choice is legitimate)', () => {
      if (!hasKey || !transportResult || !contractResult) {
        return;
      }

      if (!transportResult.ok || !contractResult.ok) {
        throw new Error('Setup failed');
      }

      const harnessResult: CreateHarnessResult<SchedulingPayload> = createHarness({
        transport: transportResult.transport,
        models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
        maxIterations: 1,
        perModelTimeoutMs: 20_000,
        totalBudgetMs: 40_000,
      }, contractResult.contract);

      if (!harnessResult.ok) {
        throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
      }

      const slotsText = conflictingSlots.map(s =>
        `- ${s.slotId}: Dr. ${s.doctorName} (${s.startTime}-${s.endTime}, max ${s.maxPatients})`
      ).join('\n');

      const patientsText = conflictingPatients.map(p =>
        `- ${p.patientId}: ${p.patientName} (${p.requiredDurationMinutes}min${p.preferredDoctorIds ? `, prefers ${p.preferredDoctorIds.join(', ')}` : ''})`
      ).join('\n');

      const systemInstruction = 'You are a medical scheduler. Given the constraints, assign patients to time slots. Return ONLY a valid JSON envelope.';
      const promptText = `You are a medical scheduler. Given doctor availability and patient requirements, assign each patient to exactly one time slot.

DOCTOR SLOTS:
${slotsText}

PATIENTS:
${patientsText}

IMPORTANT: You MUST return ONLY a valid JSON envelope. If feasible, return:
{
  "state": "proposal",
  "payload": {
    "assignments": [
      {
        "patientId": "<id>",
        "slotId": "<slot>",
        "doctorId": "<id>",
        "startTime": "HH:MM",
        "endTime": "HH:MM"
      }
    ]
  }
}

If impossible, return:
{
  "state": "infeasible",
  "explanation": "<why it's impossible>"
}

Do NOT return a question state. Only proposal or infeasible.`;

      return harnessResult.harness.runTurn({
        systemInstruction,
        promptText,
      }).then(result => {
        if (!result.ok) {
          dbg.log('Harness result failure kind:', result.kind);
          dbg.log('Turn envelope state:', result.turn.envelope.state);
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Model may legitimately choose either path
        expect(['infeasible', 'question']).toContain(result.turn.envelope.state);

        if (result.turn.envelope.state === 'infeasible') {
          expect(result.turn.envelope.explanation).toBeDefined();
          expect(typeof result.turn.envelope.explanation).toBe('string');
        } else if (result.turn.envelope.state === 'question') {
          expect(result.turn.envelope.questionText).toBeDefined();
          expect(typeof result.turn.envelope.questionText).toBe('string');
        }
      });
    });
  });
});
