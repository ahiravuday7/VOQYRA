import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import request from "../helpers/api-request.helper.js";

const storageMocks = vi.hoisted(() => ({
  uploadStream: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("../../src/config/cloudinary.js", () => ({
  default: {
    uploader: {
      upload_stream: storageMocks.uploadStream,
      destroy: storageMocks.destroy,
    },
  },
}));

import {
  uploadImage,
  deleteImage,
} from "../../src/services/image-storage.service.js";

import errorMiddleware from "../../src/middlewares/error.middleware.js";

const IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

const FOLDER = "clothing-commerce/products/security-test";
const PUBLIC_ID = `${FOLDER}/image`;

const createApp = () => {
  const app = express();

  app.post("/upload", async (req, res, next) => {
    try {
      const image = await uploadImage({
        buffer: IMAGE_BUFFER,
        folder: FOLDER,
      });

      res.status(201).json({ success: true, data: image });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/image", async (req, res, next) => {
    try {
      const result = await deleteImage(PUBLIC_ID);

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.use(errorMiddleware);

  return app;
};

describe("Image storage security", () => {
  beforeEach(() => {
    storageMocks.uploadStream.mockReset();
    storageMocks.destroy.mockReset();
  });

  it("restricts upload formats and preserves image metadata", async () => {
    const end = vi.fn();

    storageMocks.uploadStream.mockImplementation((options, callback) => {
      end.mockImplementation(() => {
        callback(null, {
          secure_url: "https://images.example.test/product.png",
          public_id: PUBLIC_ID,
          width: 1,
          height: 1,
          format: "png",
          bytes: IMAGE_BUFFER.length,
        });
      });

      return { end };
    });

    const response = await request(createApp()).post("/upload");

    expect(response.status).toBe(201);

    const [options] = storageMocks.uploadStream.mock.calls[0];

    expect(options).toMatchObject({
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      folder: FOLDER,
      unique_filename: true,
      use_filename: false,
      overwrite: false,
    });

    // A conversion option would change rejection behavior.
    expect(options).not.toHaveProperty("format");
    expect(end).toHaveBeenCalledWith(IMAGE_BUFFER);

    expect(response.body.data).toEqual({
      url: "https://images.example.test/product.png",
      publicId: PUBLIC_ID,
      width: 1,
      height: 1,
      format: "png",
      bytes: IMAGE_BUFFER.length,
    });
  });

  it("does not expose provider details when upload fails", async () => {
    const privateMessage = "PRIVATE_UPLOAD_PROVIDER_DETAIL_2225";

    storageMocks.uploadStream.mockImplementation((options, callback) => ({
      end() {
        callback(new Error(privateMessage));
      },
    }));

    const response = await request(createApp()).post("/upload");

    expect(response.status).toBe(502);

    expect(response.body).toMatchObject({
      success: false,
      message: "Image could not be uploaded",
      errorCode: "IMAGE_STORAGE_UPLOAD_FAILED",
      details: {
        provider: "cloudinary",
      },
    });

    expect(response.body.details).not.toHaveProperty("providerMessage");
    expect(response.text).not.toContain(privateMessage);
  });

  it("does not expose provider details when deletion fails", async () => {
    const privateMessage = "PRIVATE_DELETE_PROVIDER_DETAIL_2225";

    storageMocks.destroy.mockRejectedValue(new Error(privateMessage));

    const response = await request(createApp()).delete("/image");

    expect(response.status).toBe(502);

    expect(response.body).toMatchObject({
      success: false,
      message: "Image could not be deleted from storage",
      errorCode: "IMAGE_STORAGE_DELETE_FAILED",
      details: {
        provider: "cloudinary",
      },
    });

    expect(response.body.details).not.toHaveProperty("providerMessage");
    expect(response.text).not.toContain(privateMessage);
  });

  it.each([
    ["ok", { deleted: true, alreadyMissing: false }],
    ["not found", { deleted: false, alreadyMissing: true }],
  ])(
    "preserves deletion behavior for provider result %s",
    async (result, expected) => {
      storageMocks.destroy.mockResolvedValue({ result });

      const response = await request(createApp()).delete("/image");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(expected);

      expect(storageMocks.destroy).toHaveBeenCalledWith(PUBLIC_ID, {
        resource_type: "image",
        invalidate: true,
      });
    },
  );
});
