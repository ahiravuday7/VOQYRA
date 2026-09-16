import AppError from "../shared/errors/app-error.js";

const notFoundMiddleware = (request, response, next) => {
  return next(
    new AppError("Requested route was not found", 404, {
      errorCode: "ROUTE_NOT_FOUND",
    }),
  );
};

export default notFoundMiddleware;
