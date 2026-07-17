import AppError from "../shared/errors/app-error.js";

const notFoundMiddleware = (request, response, next) => {
  const error = new AppError(
    `Route ${request.method} ${request.originalUrl} was not found`,
    404,
    {
      errorCode: "ROUTE_NOT_FOUND",
    },
  );

  next(error);
};

export default notFoundMiddleware;
