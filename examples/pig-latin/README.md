# Pig Latin Example

A minimal canary example demonstrating:
- Single-turn transformation (no tools, `maxIterations: 1`)
- Simple text-to-text payload
- Fast-fail validation

## Prompt

The agent receives an input string and returns a pig-latin translation in a structured envelope:

```
Translate the following text into pig latin. Return ONLY a JSON envelope with:
- state: "proposal"
- payload: { translatedText: "<pig-latin translation>" }

Input: {input}
```

## Expected Envelope Shape

```typescript
{
  envelope: { state: 'proposal' },
  payload: { translatedText: string }
}
```

## Oracle

The test validates:
1. Envelope state is `'proposal'`
2. Payload contains `translatedText` field (string)
3. Translation is case-tolerant match (normalized before compare)

This is the cheapest, fastest-failing example — run it first when iterating on prompts.
