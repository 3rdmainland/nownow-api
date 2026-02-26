/**
 * Centralized Error Handling System
 *
 * Usage:
 * - throw new NotFoundError('Event not found', { eventId: '123' });
 * - throw new ValidationError('Invalid email format');
 * - throw new ConflictError('Menu items already exist for this event');
 */

export interface ErrorContext {
    [key: string]: any;
}

/**
 * Base Application Error
 * All custom errors extend from this
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly context?: ErrorContext;
    public readonly timestamp: string;

    constructor(
        message: string,
        statusCode: number,
        context?: ErrorContext,
        isOperational: boolean = true
    ) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);

        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.context = context;
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this);
    }
}

/**
 * 400 Bad Request
 * Use for validation errors, malformed requests, invalid input
 */
export class ValidationError extends AppError {
    constructor(message: string = 'Validation failed', context?: ErrorContext) {
        super(message, 400, context);
        this.name = 'ValidationError';
    }
}

/**
 * 401 Unauthorized
 * Use for authentication failures
 */
export class UnauthorizedError extends AppError {
    constructor(message: string = 'Authentication required', context?: ErrorContext) {
        super(message, 401, context);
        this.name = 'UnauthorizedError';
    }
}

/**
 * 403 Forbidden
 * Use for authorization failures (authenticated but not allowed)
 */
export class ForbiddenError extends AppError {
    constructor(message: string = 'Access forbidden', context?: ErrorContext) {
        super(message, 403, context);
        this.name = 'ForbiddenError';
    }
}

/**
 * 404 Not Found
 * Use when a resource doesn't exist
 */
export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found', context?: ErrorContext) {
        super(message, 404, context);
        this.name = 'NotFoundError';
    }
}

/**
 * 409 Conflict
 * Use for conflicts like duplicate entries, existing orders preventing deletion
 */
export class ConflictError extends AppError {
    constructor(message: string = 'Resource conflict', context?: ErrorContext) {
        super(message, 409, context);
        this.name = 'ConflictError';
    }
}

/**
 * 429 Too Many Requests
 * Use for rate limiting
 */
export class TooManyRequestsError extends AppError {
    constructor(message: string = 'Too many requests', context?: ErrorContext) {
        super(message, 429, context);
        this.name = 'TooManyRequestsError';
    }
}

/**
 * 422 Unprocessable Entity
 * Use for semantic errors (valid format but logically incorrect)
 */
export class UnprocessableEntityError extends AppError {
    constructor(message: string = 'Unprocessable entity', context?: ErrorContext) {
        super(message, 422, context);
        this.name = 'UnprocessableEntityError';
    }
}

/**
 * 500 Internal Server Error
 * Use for unexpected errors, database failures, etc.
 */
export class InternalError extends AppError {
    constructor(message: string = 'Internal server error', context?: ErrorContext) {
        super(message, 500, context, false);
        this.name = 'InternalError';
    }
}

/**
 * 503 Service Unavailable
 * Use when external services are down
 */
export class ServiceUnavailableError extends AppError {
    constructor(message: string = 'Service temporarily unavailable', context?: ErrorContext) {
        super(message, 503, context);
        this.name = 'ServiceUnavailableError';
    }
}

/**
 * Database Error
 * Wraps Supabase/database errors with additional context
 */
export class DatabaseError extends AppError {
    constructor(message: string, originalError?: any, context?: ErrorContext) {
        const enhancedContext = {
            ...context,
            originalError: originalError?.message,
            code: originalError?.code,
            details: originalError?.details,
        };
        super(message, 500, enhancedContext, false);
        this.name = 'DatabaseError';
    }
}

/**
 * Error Helper Functions
 */

/**
 * Check if an error is an operational error (expected) vs programming error (bug)
 */
export function isOperationalError(error: Error): boolean {
    if (error instanceof AppError) {
        return error.isOperational;
    }
    return false;
}

/**
 * Format error for logging
 */
export function formatErrorForLog(error: Error | AppError, requestId?: string) {
    const baseLog: any = {
        timestamp: new Date().toISOString(),
        requestId,
        name: error.name,
        message: error.message,
        stack: error.stack,
    };

    if (error instanceof AppError) {
        baseLog.statusCode = error.statusCode;
        baseLog.context = error.context;
        baseLog.isOperational = error.isOperational;
    }

    return baseLog;
}

/**
 * Format error for API response
 */
export function formatErrorForResponse(error: Error | AppError, includeStack: boolean = false) {
    const response: any = {
        error: error.message,
        timestamp: new Date().toISOString(),
    };

    if (error instanceof AppError) {
        response.statusCode = error.statusCode;

        // Include context in development
        if (process.env.NODE_ENV === 'development' && error.context) {
            response.context = error.context;
        }
    }

    // Include stack trace only in development
    if (includeStack && process.env.NODE_ENV === 'development') {
        response.stack = error.stack;
    }

    return response;
}

/**
 * Wrap database errors with proper context
 */
export function handleDatabaseError(
    operation: string,
    error: any,
    context?: ErrorContext
): never {
    throw new DatabaseError(
        `Database operation failed: ${operation}`,
        error,
        context
    );
}

/**
 * Assert a condition and throw NotFoundError if false
 */
export function assertExists<T>(
    value: T | null | undefined,
    message: string,
    context?: ErrorContext
): asserts value is T {
    if (value === null || value === undefined) {
        throw new NotFoundError(message, context);
    }
}

/**
 * Assert a condition and throw ValidationError if false
 */
export function assertValid(
    condition: boolean,
    message: string,
    context?: ErrorContext
): asserts condition {
    if (!condition) {
        throw new ValidationError(message, context);
    }
}

/**
 * Assert no conflict and throw ConflictError if false
 */
export function assertNoConflict(
    condition: boolean,
    message: string,
    context?: ErrorContext
): asserts condition {
    if (!condition) {
        throw new ConflictError(message, context);
    }
}
