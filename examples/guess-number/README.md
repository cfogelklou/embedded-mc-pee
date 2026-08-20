# Guess Number Example

A tool-loop example demonstrating:
- Model plays guessing game (number 1-100)
- Host tool `checkGuess(guess)` returns higher/lower/correct
- Multiple iterations with tool feedback (`maxIterations: 7`)
- Tool protocol validation (args validated before handler)
- Trace recording of every tool call

## Prompt

The agent guesses a secret number (1-100) and receives feedback via tool:

```
I'm thinking of a number between 1 and 100. Guess it!
Use the checkGuess tool to test your guesses.

Available tools:
- checkGuess(guess): returns "higher", "lower", or "correct"
```

## Expected Envelope Shape

```typescript
{
  envelope: { state: 'proposal' },
  payload: {
    secretNumber: number,  // The correctly guessed number
    attempts: number       // How many guesses it took
  }
}
```

## Tool Protocol

```typescript
interface CheckGuessInput {
  guess: number;  // Must be integer 1-100
}

interface CheckGuessResult {
  result: 'higher' | 'lower' | 'correct';
}
```

## Oracle

The test validates:
1. Terminates within `maxIterations: 7` (binary search ceiling)
2. Final envelope valid with `state === 'proposal'`
3. Payload contains `secretNumber` matching the actual secret
4. Each tool call validated via `validateToolArgs` before handler
5. Trace records every intermediate guess
6. Tool protocol correctness (args match schema, deterministic responses)

This demonstrates full agentic loop with deterministic tool behavior.
