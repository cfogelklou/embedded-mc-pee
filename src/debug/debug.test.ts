/**
 * Debug & Assertion Utilities Tests
 *
 * Ported from courtpuzzle/src/common/__tests__/debug.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assert,
  dbg,
  isDebug,
  setDebug,
  AssertionError,
  DEFAULT_DEBUG_SINK,
  getDebugSink,
  setDebugSink,
  type DebugLevel,
  type DebugSink
} from './debug';

describe('debug', () => {
  beforeEach(() => {
    setDebug(false);
  });

  describe('assert', () => {
    it('does not throw and does not log when condition is truthy', () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(() => assert(true)).not.toThrow();
        expect(() => assert(1)).not.toThrow();
        expect(() => assert('non-empty')).not.toThrow();
        expect(() => assert({})).not.toThrow();
        expect(spyError).not.toHaveBeenCalled();
      } finally {
        spyError.mockRestore();
      }
    });

    it('throws AssertionError with stack trace when condition is falsy and isDebug is true', () => {
      setDebug(true);
      try {
        expect(() => assert(false, 'Condition must be true')).toThrow(AssertionError);
        expect(() => assert(null, 'Must not be null')).toThrowError('[AssertionError] Must not be null');
        expect(() => assert(undefined)).toThrowError('[AssertionError] Assertion failed');
        expect(() => assert(0, () => 'Lazy message')).toThrowError('[AssertionError] Lazy message');

        try {
          assert(false, 'Stack check');
          expect.unreachable('Should have thrown');
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AssertionError);
          const aErr = err as AssertionError;
          expect(aErr.message).toBe('[AssertionError] Stack check');
          expect(aErr.stack).toBeDefined();
          expect(aErr.stack).toContain('debug.test.ts');
        }
      } finally {
        setDebug(false);
      }
    });

    it('logs AssertionError instance to console.error when condition is falsy and isDebug is false', () => {
      setDebug(false);
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(() => assert(false, 'Production invariant failure')).not.toThrow();
        expect(spyError).toHaveBeenCalledTimes(1);

        const loggedArg = spyError.mock.calls[0][0];
        expect(loggedArg).toBeInstanceOf(AssertionError);
        expect(loggedArg.message).toBe('[AssertionError] Production invariant failure');
        expect(loggedArg.stack).toBeDefined();
        expect(loggedArg.stack).toContain('debug.test.ts');
      } finally {
        spyError.mockRestore();
      }
    });

    it('evaluates lazy message function only on assertion failure', () => {
      const messageFn = vi.fn(() => 'Lazy evaluated');
      assert(true, messageFn);
      expect(messageFn).not.toHaveBeenCalled();

      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        assert(false, messageFn);
        expect(messageFn).toHaveBeenCalledTimes(1);
      } finally {
        spyError.mockRestore();
      }
    });

    it('narrows types correctly in TypeScript', () => {
      const val: string | null = 'hello';
      assert(val !== null);
      const len: number = val.length;
      expect(len).toBe(5);
    });
  });

  describe('dbg and isDebug', () => {
    it('starts DISABLED even in test environment (proves no environment sniffing)', () => {
      // In vitest, NODE_ENV is typically 'test'. If this module were still
      // sniffing process.env.NODE_ENV, it would auto-enable. This test proves
      // we removed that behavior.
      expect(isDebug()).toBe(false);
    });

    it('reflects setDebug state', () => {
      expect(isDebug()).toBe(false);
      setDebug(true);
      expect(isDebug()).toBe(true);
      setDebug(false);
      expect(isDebug()).toBe(false);
    });

    it('suppresses output when isDebug is false', () => {
      const spyLog = vi.spyOn(console, 'log');
      const spyWarn = vi.spyOn(console, 'warn');
      const spyError = vi.spyOn(console, 'error');

      setDebug(false);
      dbg.log('Should not log');
      dbg.warn('Should not warn');
      dbg.error('Should not error');
      dbg.logObj('Should not log obj', { a: 1 });

      expect(spyLog).not.toHaveBeenCalled();
      expect(spyWarn).not.toHaveBeenCalled();
      expect(spyError).not.toHaveBeenCalled();

      spyLog.mockRestore();
      spyWarn.mockRestore();
      spyError.mockRestore();
    });

    it('outputs logs when isDebug is true', () => {
      const spyLog = vi.spyOn(console, 'log');
      const spyWarn = vi.spyOn(console, 'warn');
      const spyError = vi.spyOn(console, 'error');

      setDebug(true);
      dbg.log('Test message', { key: 'value' });
      dbg.log(() => 'Evaluated message');
      dbg.warn('Test warning');
      dbg.error('Test error');

      expect(spyLog).toHaveBeenCalledTimes(2);
      expect(spyWarn).toHaveBeenCalledTimes(1);
      expect(spyError).toHaveBeenCalledTimes(1);

      spyLog.mockRestore();
      spyWarn.mockRestore();
      spyError.mockRestore();
      setDebug(false);
    });

    it('handles circular references in logObj gracefully', () => {
      const spyLog = vi.spyOn(console, 'log');
      setDebug(true);

      const circular: Record<string, unknown> = { name: 'circular' };
      circular.self = circular;

      expect(() => dbg.logObj('Circular test', circular)).not.toThrow();
      expect(spyLog).toHaveBeenCalled();

      spyLog.mockRestore();
      setDebug(false);
    });

    it('includes timestamp in debug output', () => {
      const spyLog = vi.spyOn(console, 'log');
      setDebug(true);

      dbg.log('Test');
      const timestamp = spyLog.mock.calls[0][0];
      expect(typeof timestamp).toBe('string');
      expect(timestamp).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);

      spyLog.mockRestore();
      setDebug(false);
    });
  });

  describe('debug sink', () => {
    interface RecordedCall {
      level: DebugLevel;
      message: string;
    }

    function makeRecordingSink(): { sink: DebugSink; calls: RecordedCall[] } {
      const calls: RecordedCall[] = [];
      const sink: DebugSink = (level, message) => {
        calls.push({ level, message });
      };
      return { sink, calls };
    }

    afterEach(() => {
      setDebugSink(null);
      setDebug(false);
    });

    it('routes log/warn/error to the installed sink with correct level and message', () => {
      const { sink, calls } = makeRecordingSink();
      setDebugSink(sink);
      setDebug(true);

      dbg.log('Info message');
      dbg.warn('Warning message');
      dbg.error('Error message');

      expect(calls.map((c) => c.level)).toEqual(['log', 'warn', 'error']);
      expect(calls[0].message).toContain('Info message');
      expect(calls[1].message).toContain('Warning message');
      expect(calls[2].message).toContain('Error message');
      // Every message is prefixed with the timestamp
      for (const call of calls) {
        expect(call.message).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
      }
    });

    it('does not call the sink when debug is disabled (zero overhead)', () => {
      const { sink, calls } = makeRecordingSink();
      setDebugSink(sink);
      setDebug(false);

      dbg.log('Suppressed');
      dbg.warn('Suppressed');
      dbg.error('Suppressed');
      dbg.logObj('Suppressed', { a: 1 });
      dbg.log(() => {
        throw new Error('lazy message must not be evaluated when disabled');
      });

      expect(calls).toHaveLength(0);
    });

    it('renders objects for logObj and emits at level log', () => {
      const { sink, calls } = makeRecordingSink();
      setDebugSink(sink);
      setDebug(true);

      dbg.logObj('Label', { a: 1 });

      expect(calls).toHaveLength(1);
      expect(calls[0].level).toBe('log');
      expect(calls[0].message).toContain('Label');
      expect(calls[0].message).toContain('"a": 1');
    });

    it('handles circular references in logObj via the sink without throwing', () => {
      const { sink, calls } = makeRecordingSink();
      setDebugSink(sink);
      setDebug(true);

      const circular: Record<string, unknown> = { name: 'circular' };
      circular.self = circular;

      expect(() => dbg.logObj('Circular', circular)).not.toThrow();
      expect(calls).toHaveLength(1);
      expect(calls[0].level).toBe('log');
      expect(calls[0].message).toContain('Circular');
    });

    it('restores the console-backed default sink on setDebugSink(null)', () => {
      const { sink, calls } = makeRecordingSink();
      setDebugSink(sink);
      expect(getDebugSink()).toBe(sink);

      const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        setDebugSink(null);
        expect(getDebugSink()).toBe(DEFAULT_DEBUG_SINK);

        setDebug(true);
        dbg.log('Via console');
        expect(calls).toHaveLength(0);
        expect(spyLog).toHaveBeenCalledTimes(1);
        expect(String(spyLog.mock.calls[0][0])).toContain('Via console');
      } finally {
        spyLog.mockRestore();
      }
    });

    it('throws AssertionError for a non-function sink argument', () => {
      expect(() => setDebugSink(42 as unknown as DebugSink)).toThrow(AssertionError);
      expect(() => setDebugSink('nope' as unknown as DebugSink)).toThrowError(
        /\[AssertionError\] setDebugSink expects a sink function or null/
      );
      // The previously installed sink is left untouched
      expect(getDebugSink()).toBe(DEFAULT_DEBUG_SINK);
    });

    it('getDebugSink returns the installed sink', () => {
      expect(getDebugSink()).toBe(DEFAULT_DEBUG_SINK);
      const { sink } = makeRecordingSink();
      setDebugSink(sink);
      expect(getDebugSink()).toBe(sink);
    });
  });
});
