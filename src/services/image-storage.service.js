import cloudinary from "../config/cloudinary.js";

import AppError from "../shared/errors/app-error.js";

/*
|--------------------------------------------------------------------------
| Image Storage
|--------------------------------------------------------------------------
|
| Product/business code should not call Cloudinary directly.
|
| This service provides a small storage abstraction:
|
| uploadImage()
| deleteImage()
|
| If we replace Cloudinary later, Product code should require
| minimal or no changes.
|
*/

/*
|--------------------------------------------------------------------------
| Upload Image
|--------------------------------------------------------------------------
|
| Input:
|
| buffer
| → image bytes from Multer memoryStorage()
|
| folder
| → destination folder inside Cloudinary
|
| Output:
|
| provider-neutral image information.
|
*/

const uploadImage = async ({
  buffer,

  folder,
}) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new AppError("Image buffer is required", 500, {
      errorCode: "IMAGE_STORAGE_BUFFER_REQUIRED",
    });
  }

  if (typeof folder !== "string" || !folder.trim()) {
    throw new AppError("Image storage folder is required", 500, {
      errorCode: "IMAGE_STORAGE_FOLDER_REQUIRED",
    });
  }

  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "image",

          folder: folder.trim(),

          /*
           * Let Cloudinary generate a unique
           * public ID for every upload.
           */
          unique_filename: true,

          use_filename: false,

          overwrite: false,
        },

        (error, result) => {
          if (error) {
            reject(error);

            return;
          }

          if (!result) {
            reject(new Error("Cloudinary returned no upload result"));

            return;
          }

          resolve(result);
        },
      );

      /*
       * Multer memoryStorage gives us:
       *
       * request.file.buffer
       */
      uploadStream.end(buffer);
    });

    return {
      url: uploadResult.secure_url,

      publicId: uploadResult.public_id,

      width: uploadResult.width ?? null,

      height: uploadResult.height ?? null,

      format: uploadResult.format ?? null,

      bytes: uploadResult.bytes ?? null,
    };
  } catch (error) {
    throw new AppError("Image could not be uploaded", 502, {
      errorCode: "IMAGE_STORAGE_UPLOAD_FAILED",

      details: {
        provider: "cloudinary",

        providerMessage: error?.message ?? "Unknown Cloudinary upload error",
      },
    });
  }
};

/*
|--------------------------------------------------------------------------
| Delete Image
|--------------------------------------------------------------------------
|
| publicId is the Cloudinary public ID stored with the Product image.
|
| "not found" is treated as success.
|
| Why?
|
| Delete should be idempotent:
|
| Delete once  → success
| Delete again → asset already absent, still okay
|
*/

const deleteImage = async (publicId) => {
  if (typeof publicId !== "string" || !publicId.trim()) {
    throw new AppError("Image public ID is required", 500, {
      errorCode: "IMAGE_STORAGE_PUBLIC_ID_REQUIRED",
    });
  }

  try {
    const result = await cloudinary.uploader.destroy(
      publicId.trim(),

      {
        resource_type: "image",

        /*
         * Ask Cloudinary to invalidate
         * cached CDN copies as well.
         */
        invalidate: true,
      },
    );

    if (result?.result !== "ok" && result?.result !== "not found") {
      throw new Error(
        `Unexpected Cloudinary delete result: ${result?.result ?? "unknown"}`,
      );
    }

    return {
      deleted: result.result === "ok",

      alreadyMissing: result.result === "not found",
    };
  } catch (error) {
    /*
     * Preserve an AppError created above rather
     * than wrapping it a second time.
     */
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Image could not be deleted from storage", 502, {
      errorCode: "IMAGE_STORAGE_DELETE_FAILED",

      details: {
        provider: "cloudinary",

        providerMessage: error?.message ?? "Unknown Cloudinary delete error",
      },
    });
  }
};

export { uploadImage, deleteImage };
