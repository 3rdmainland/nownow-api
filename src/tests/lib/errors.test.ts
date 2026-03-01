import { describe, it, expect, beforeEach, vi } from 'vitest';

// No need to mock anything - these are pure utility classes/functions
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  UnprocessableEntityError,
  InternalError,
  ServiceUnavailableError,
  DatabaseError,
  isOperationalError,
  formatErrorForLog,
  formatErrorForResponse,
  handleDatabaseError,
  assertExists,
  assertValid,
  assertNoConflict,
} from '../../lib/errors.js';

// ── Error Classes ─────────────────────────────────────────────────────────────

describe('Error Classes', () => {

  describe('AppError', () => {
    it('should set message, statusCode, and isOperational', () => {
      const error = new AppError('test error', 500, undefined, true);

      expect(error.message).toBe('test error');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeDefined();
    });

    it('should set context when provided', () => {
      const error = new AppError('test', 400, { field: 'email' });

      expect(error.context).toEqual({ field: 'email' });
    });

    it('should default isOperational to true', () => {
      const error = new AppError('test', 400);

      expect(error.isOperational).toBe(true);
    });

    it('should be an instance of Error', () => {
      const error = new AppError('test', 500);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('should have a stack trace', () => {
      const error = new AppError('test', 500);

      expect(error.stack).toBeDefined();
    });

    it('should have a valid ISO timestamp', () => {
      const error = new AppError('test', 500);

      const parsed = new Date(error.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  describe('ValidationError', () => {
    it('should have status 400 and name "ValidationError"', () => {
      const error = new ValidationError('Invalid input');

      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid input');
      expect(error.isOperational).toBe(true);
    });

    it('should use default message when none provided', () => {
      const error = new ValidationError();

      expect(error.message).toBe('Validation failed');
    });

    it('should accept context', () => {
      const error = new ValidationError('Bad email', { field: 'email' });

      expect(error.context).toEqual({ field: 'email' });
    });
  });

  describe('UnauthorizedError', () => {
    it('should have status 401 and name "UnauthorizedError"', () => {
      const error = new UnauthorizedError('Login required');

      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('UnauthorizedError');
      expect(error.message).toBe('Login required');
    });

    it('should use default message when none provided', () => {
      const error = new UnauthorizedError();

      expect(error.message).toBe('Authentication required');
    });
  });

  describe('ForbiddenError', () => {
    it('should have status 403 and name "ForbiddenError"', () => {
      const error = new ForbiddenError('Not allowed');

      expect(error.statusCode).toBe(403);
      expect(error.name).toBe('ForbiddenError');
    });

    it('should use default message when none provided', () => {
      const error = new ForbiddenError();

      expect(error.message).toBe('Access forbidden');
    });
  });

  describe('NotFoundError', () => {
    it('should have status 404 and name "NotFoundError"', () => {
      const error = new NotFoundError('Event not found');

      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('NotFoundError');
    });

    it('should use default message when none provided', () => {
      const error = new NotFoundError();

      expect(error.message).toBe('Resource not found');
    });
  });

  describe('ConflictError', () => {
    it('should have status 409 and name "ConflictError"', () => {
      const error = new ConflictError('Duplicate entry');

      expect(error.statusCode).toBe(409);
      expect(error.name).toBe('ConflictError');
    });

    it('should use default message when none provided', () => {
      const error = new ConflictError();

      expect(error.message).toBe('Resource conflict');
    });
  });

  describe('TooManyRequestsError', () => {
    it('should have status 429 and name "TooManyRequestsError"', () => {
      const error = new TooManyRequestsError('Rate limit exceeded');

      expect(error.statusCode).toBe(429);
      expect(error.name).toBe('TooManyRequestsError');
    });

    it('should use default message when none provided', () => {
      const error = new TooManyRequestsError();

      expect(error.message).toBe('Too many requests');
    });
  });

  describe('UnprocessableEntityError', () => {
    it('should have status 422 and name "UnprocessableEntityError"', () => {
      const error = new UnprocessableEntityError('Semantic error');

      expect(error.statusCode).toBe(422);
      expect(error.name).toBe('UnprocessableEntityError');
    });

    it('should use default message when none provided', () => {
      const error = new UnprocessableEntityError();

      expect(error.message).toBe('Unprocessable entity');
    });
  });

  describe('InternalError', () => {
    it('should have status 500, name "InternalError", and isOperational false', () => {
      const error = new InternalError('Server crashed');

      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('InternalError');
      expect(error.isOperational).toBe(false);
    });

    it('should use default message when none provided', () => {
      const error = new InternalError();

      expect(error.message).toBe('Internal server error');
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should have status 503 and name "ServiceUnavailableError"', () => {
      const error = new ServiceUnavailableError('Redis down');

      expect(error.statusCode).toBe(503);
      expect(error.name).toBe('ServiceUnavailableError');
    });

    it('should use default message when none provided', () => {
      const error = new ServiceUnavailableError();

      expect(error.message).toBe('Service temporarily unavailable');
    });
  });

  describe('DatabaseError', () => {
    it('should have status 500, name "DatabaseError", and isOperational false', () => {
      const originalError = { message: 'connection refused', code: 'ECONNREFUSED', details: 'timeout' };
      const error = new DatabaseError('DB failed', originalError, { table: 'orders' });

      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('DatabaseError');
      expect(error.isOperational).toBe(false);
      expect(error.context).toMatchObject({
        table: 'orders',
        originalError: 'connection refused',
        code: 'ECONNREFUSED',
        details: 'timeout',
      });
    });

    it('should handle originalError being undefined', () => {
      const error = new DatabaseError('DB failed');

      expect(error.context).toMatchObject({
        originalError: undefined,
        code: undefined,
        details: undefined,
      });
    });
  });
});

// ── Helper Functions ──────────────────────────────────────────────────────────

describe('Error Helper Functions', () => {

  describe('isOperationalError', () => {
    it('should return true for operational AppError subclasses', () => {
      expect(isOperationalError(new ValidationError('test'))).toBe(true);
      expect(isOperationalError(new NotFoundError('test'))).toBe(true);
      expect(isOperationalError(new UnauthorizedError('test'))).toBe(true);
      expect(isOperationalError(new ConflictError('test'))).toBe(true);
    });

    it('should return false for non-operational errors', () => {
      expect(isOperationalError(new InternalError('test'))).toBe(false);
      expect(isOperationalError(new DatabaseError('test'))).toBe(false);
    });

    it('should return false for plain Error instances', () => {
      expect(isOperationalError(new Error('generic error'))).toBe(false);
    });

    it('should return false for TypeError and other built-in errors', () => {
      expect(isOperationalError(new TypeError('type error'))).toBe(false);
    });
  });

  describe('formatErrorForLog', () => {
    it('should include basic error fields for a plain Error', () => {
      const error = new Error('test error');
      const logged = formatErrorForLog(error, 'req-123');

      expect(logged.timestamp).toBeDefined();
      expect(logged.requestId).toBe('req-123');
      expect(logged.name).toBe('Error');
      expect(logged.message).toBe('test error');
      expect(logged.stack).toBeDefined();
      expect(logged.statusCode).toBeUndefined();
    });

    it('should include AppError fields for an AppError', () => {
      const error = new NotFoundError('Not found', { id: '123' });
      const logged = formatErrorForLog(error);

      expect(logged.statusCode).toBe(404);
      expect(logged.context).toEqual({ id: '123' });
      expect(logged.isOperational).toBe(true);
      expect(logged.requestId).toBeUndefined();
    });
  });

  describe('formatErrorForResponse', () => {
    it('should return error message and timestamp for a plain Error', () => {
      const error = new Error('generic');
      const response = formatErrorForResponse(error);

      expect(response.error).toBe('generic');
      expect(response.timestamp).toBeDefined();
      expect(response.statusCode).toBeUndefined();
    });

    it('should include statusCode for AppError', () => {
      const error = new ValidationError('bad input');
      const response = formatErrorForResponse(error);

      expect(response.statusCode).toBe(400);
      expect(response.error).toBe('bad input');
    });

    it('should not include stack trace by default', () => {
      const error = new ValidationError('bad input');
      const response = formatErrorForResponse(error);

      expect(response.stack).toBeUndefined();
    });

    it('should not include context in test environment (NODE_ENV=test)', () => {
      const error = new ValidationError('bad', { field: 'email' });
      const response = formatErrorForResponse(error);

      // Context is only included in development
      expect(response.context).toBeUndefined();
    });
  });

  describe('handleDatabaseError', () => {
    it('should throw a DatabaseError with the operation name', () => {
      const originalError = { message: 'timeout' };

      expect(() => handleDatabaseError('insert order', originalError)).toThrow(DatabaseError);

      try {
        handleDatabaseError('insert order', originalError, { table: 'orders' });
      } catch (e: any) {
        expect(e.message).toBe('Database operation failed: insert order');
        expect(e.context?.table).toBe('orders');
        expect(e.context?.originalError).toBe('timeout');
      }
    });
  });

  describe('assertExists', () => {
    it('should not throw when value is defined', () => {
      expect(() => assertExists('hello', 'Should exist')).not.toThrow();
      expect(() => assertExists(0, 'Should exist')).not.toThrow();
      expect(() => assertExists(false, 'Should exist')).not.toThrow();
      expect(() => assertExists('', 'Should exist')).not.toThrow();
    });

    it('should throw NotFoundError when value is null', () => {
      expect(() => assertExists(null, 'Not found')).toThrow(NotFoundError);

      try {
        assertExists(null, 'Not found', { id: 'abc' });
      } catch (e: any) {
        expect(e.message).toBe('Not found');
        expect(e.context).toEqual({ id: 'abc' });
      }
    });

    it('should throw NotFoundError when value is undefined', () => {
      expect(() => assertExists(undefined, 'Not found')).toThrow(NotFoundError);
    });
  });

  describe('assertValid', () => {
    it('should not throw when condition is true', () => {
      expect(() => assertValid(true, 'Should be valid')).not.toThrow();
    });

    it('should throw ValidationError when condition is false', () => {
      expect(() => assertValid(false, 'Invalid input')).toThrow(ValidationError);

      try {
        assertValid(false, 'Invalid', { field: 'email' });
      } catch (e: any) {
        expect(e.message).toBe('Invalid');
        expect(e.statusCode).toBe(400);
        expect(e.context).toEqual({ field: 'email' });
      }
    });
  });

  describe('assertNoConflict', () => {
    it('should not throw when condition is true', () => {
      expect(() => assertNoConflict(true, 'No conflict')).not.toThrow();
    });

    it('should throw ConflictError when condition is false', () => {
      expect(() => assertNoConflict(false, 'Already exists')).toThrow(ConflictError);

      try {
        assertNoConflict(false, 'Duplicate', { email: 'test@test.com' });
      } catch (e: any) {
        expect(e.message).toBe('Duplicate');
        expect(e.statusCode).toBe(409);
        expect(e.context).toEqual({ email: 'test@test.com' });
      }
    });
  });
});
