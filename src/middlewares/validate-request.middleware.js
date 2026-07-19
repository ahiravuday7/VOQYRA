import AppError from "../shared/errors/app-error.js";

/*
| Format Zod Validation Issues
*/

const formatValidationIssues = (issues) => {
  return issues.map((issue) => {
    const [source, ...fieldPath] = issue.path;

    return {
      source: source ?? "request",
      field: fieldPath.join(".") || null,
      message: issue.message,
      code: issue.code,
    };
  });
};

/*
| Request Validation Middleware
*/

const validateRequest = (schema) => {
  return async (request, response, next) => {
    const validationResult = await schema.safeParseAsync({
      body: request.body,
      params: request.params,
      query: request.query,
    });

    if (!validationResult.success) {
      return next(
        new AppError("Request validation failed", 400, {
          errorCode: "REQUEST_VALIDATION_FAILED",

          details: formatValidationIssues(validationResult.error.issues),
        }),
      );
    }

    /*
     * Controllers should use request.validated
     * instead of directly trusting request.body,
     * request.params or request.query.
     */
    request.validated = validationResult.data;

    return next();
  };
};

export default validateRequest;
