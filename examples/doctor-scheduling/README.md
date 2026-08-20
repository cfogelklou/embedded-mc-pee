# Doctor Scheduling Example

A showcase example demonstrating:
- Mini state input (doctor slots, patient constraints)
- Deliberate conflict scenario
- TWO runs: feasible case → proposal, conflicting case → infeasible OR question
- Domain-specific payload validation (slot-fit invariants)

## Prompt

The agent receives scheduling constraints and attempts to allocate patients to doctor time slots:

```
You are a medical scheduler. Given doctor availability and patient requirements,
assign each patient to exactly one time slot. Return a JSON envelope with:
- state: "proposal" if feasible, "infeasible" if impossible, or "question" if you need clarification
- payload: { assignments: [{ patientId, slotId, ... }] } (only for proposals)

DOCTOR SLOTS:
{slots}

PATIENTS:
{patients}
```

## Expected Envelope Shapes

**Feasible case (proposal):**
```typescript
{
  envelope: { state: 'proposal' },
  payload: {
    assignments: Array<{
      patientId: string;
      slotId: string;
      doctorId: string;
      startTime: string;  // HH:MM format
      endTime: string;    // HH:MM format
    }>
  }
}
```

**Conflicting case (infeasible OR question):**
```typescript
// Infeasible path
{
  envelope: { state: 'infeasible', explanation: string }
}

// OR question path (model may legitimately ask)
{
  envelope: { state: 'question', questionText: string }
}
```

## Oracle

The test validates:
1. Feasible case: `state === 'proposal'`, assignments array present
2. Slot-fit invariants: no overlapping assignments for same doctor, within declared hours
3. Conflicting case: `state === 'infeasible'` OR `state === 'question'` (model choice is legitimate)
4. All assignments reference valid doctor and slot IDs from input

This demonstrates realistic constraint-satisfaction behavior with validation.
