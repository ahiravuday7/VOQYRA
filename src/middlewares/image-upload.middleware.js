import multer from "multer";

import AppError from "../shared/errors/app-error.js";

/*
|--------------------------------------------------------------------------
| Product Image Upload Limits
|--------------------------------------------------------------------------
*/

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/*
|--------------------------------------------------------------------------
| Multer Storage
|--------------------------------------------------------------------------
|
| Images are kept only in memory.
|
| Multer exposes the uploaded image as:
|
| request.file.buffer
|
| We do not write temporary files to the local filesystem.
|
*/

const storage = multer.memoryStorage();

/*
|--------------------------------------------------------------------------
| Image File Filter
|--------------------------------------------------------------------------
|
| Keep this filter synchronous.
|
| Cloudinary will perform the actual image upload later.
|
*/

const imageFileFilter = (request, file, callback) => {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    return callback(
      new AppError("Only JPEG, PNG and WebP images are allowed", 415, {
        errorCode: "PRODUCT_IMAGE_UNSUPPORTED_TYPE",

        details: {
          allowedMimeTypes: Array.from(ALLOWED_IMAGE_MIME_TYPES),

          receivedMimeType: file.mimetype,
        },
      }),
    );
  }

  return callback(null, true);
};

/*
|--------------------------------------------------------------------------
| Multer Configuration
|--------------------------------------------------------------------------
|
| Expected multipart request:
|
| image      -> one image file
| altText    -> optional text
| sortOrder  -> optional text value
| isPrimary  -> optional text value
|
*/

const imageUpload = multer({
  storage,

  fileFilter: imageFileFilter,

  limits: {
    /*
     * Maximum image size:
     * 5 MB.
     */
    fileSize: MAX_IMAGE_FILE_SIZE,

    /*
     * Exactly one uploaded file.
     */
    files: 1,

    /*
     * Product image metadata:
     *
     * altText
     * sortOrder
     * isPrimary
     */
    fields: 3,

    /*
     * One file + three fields.
     *
     * Multer/Busboy triggers the parts
     * limit when the configured limit
     * is reached, so allow one additional
     * boundary slot.
     */
    parts: 5,

    /*
     * No array-style multipart fields
     * are required by this endpoint.
     */
    fieldArrayIndexLimit: 0,
  },
});

/*
|--------------------------------------------------------------------------
| Normalize Multer Errors
|--------------------------------------------------------------------------
|
| Our global error middleware expects AppError-style
| statusCode and errorCode values.
|
*/

const normalizeMulterError = (error) => {
  if (!(error instanceof multer.MulterError)) {
    return error;
  }

  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return new AppError("Product image must not exceed 5 MB", 413, {
        errorCode: "PRODUCT_IMAGE_TOO_LARGE",
      });

    case "LIMIT_UNEXPECTED_FILE":
      return new AppError(
        'Upload exactly one file using the "image" field',
        400,
        {
          errorCode: "PRODUCT_IMAGE_UNEXPECTED_FILE",
        },
      );

    case "LIMIT_FILE_COUNT":
      return new AppError(
        "Only one Product image may be uploaded per request",
        400,
        {
          errorCode: "PRODUCT_IMAGE_FILE_LIMIT",
        },
      );

    case "LIMIT_FIELD_COUNT":
    case "LIMIT_PART_COUNT":
    case "LIMIT_FIELD_KEY":
    case "LIMIT_FIELD_VALUE":
      return new AppError(
        "Product image upload contains too many or invalid multipart fields",
        400,
        {
          errorCode: "PRODUCT_IMAGE_MULTIPART_INVALID",
        },
      );

    default:
      return new AppError("Product image upload could not be processed", 400, {
        errorCode: "PRODUCT_IMAGE_UPLOAD_INVALID",

        details: {
          multerCode: error.code ?? null,
        },
      });
  }
};

/*
|--------------------------------------------------------------------------
| Single Product Image Middleware
|--------------------------------------------------------------------------
*/

const uploadSingleProductImage = (request, response, next) => {
  const upload = imageUpload.single("image");

  upload(request, response, (error) => {
    if (error) {
      return next(normalizeMulterError(error));
    }

    /*
     * .single() does not fail when the
     * request contains no file.
     *
     * Our Product image endpoint requires one.
     */
    if (!request.file) {
      return next(
        new AppError("Product image file is required", 400, {
          errorCode: "PRODUCT_IMAGE_REQUIRED",
        }),
      );
    }

    return next();
  });
};

export {
  MAX_IMAGE_FILE_SIZE,
  ALLOWED_IMAGE_MIME_TYPES,
  uploadSingleProductImage,
};
