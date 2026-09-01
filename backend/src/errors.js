export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR:'VALIDATION_ERROR',
  UNAUTHORIZED:'UNAUTHORIZED',
  FORBIDDEN:'FORBIDDEN',
  NOT_FOUND:'NOT_FOUND',
  CONFLICT:'CONFLICT',
  INTERNAL_ERROR:'INTERNAL_ERROR'
});

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const validationError = (message, details) => new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
export const unauthorizedError = (message = '認証が必要です。') => new ApiError(401, ERROR_CODES.UNAUTHORIZED, message);
export const forbiddenError = (message = 'この操作を行う権限がありません。') => new ApiError(403, ERROR_CODES.FORBIDDEN, message);
export const notFoundError = (message = '対象データが見つかりません。') => new ApiError(404, ERROR_CODES.NOT_FOUND, message);
export const conflictError = (message, details) => new ApiError(409, ERROR_CODES.CONFLICT, message, details);
