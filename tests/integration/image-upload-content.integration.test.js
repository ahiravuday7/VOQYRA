import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import request from "../helpers/api-request.helper.js";

import {
  TEST_JPEG_BUFFER,
  TEST_PNG_BUFFER,
  TEST_WEBP_BUFFER,
} from "../helpers/image-fixtures.helper.js";

import { uploadSingleProductImage } from "../../src/middlewares/image-upload.middleware.js";

import errorMiddleware from "../../src/middlewares/error.middleware.js";

describe("Product image content validation", () => {
  let app;
  let endpoint;

  beforeEach(() => {
    app = express();

    endpoint = vi.fn((req, res) => {
      res.status(200).json({
        success: true,
        data: {
          mimeType: req.file.mimetype,
          size: req.file.size,
          metadata: req.body,
        },
      });
    });

    app.post("/upload", uploadSingleProductImage, endpoint);
    app.use(errorMiddleware);
  });

  const attachImage = (buffer, contentType, filename = "image.bin") =>
    request(app).post("/upload").attach("image", buffer, {
      filename,
      contentType,
    });

  it.each([
    ["JPEG", TEST_JPEG_BUFFER, "image/jpeg", "image.jpg"],
    ["PNG", TEST_PNG_BUFFER, "image/png", "image.png"],
    ["WebP", TEST_WEBP_BUFFER, "image/webp", "image.webp"],
  ])(
    "accepts genuine %s content and preserves multipart metadata",
    async (name, buffer, contentType, filename) => {
      const response = await request(app)
        .post("/upload")
        .field("altText", "Product front view")
        .field("sortOrder", "2")
        .field("isPrimary", "true")
        .attach("image", buffer, {
          filename,
          contentType,
        });

      expect(response.status).toBe(200);
      expect(endpoint).toHaveBeenCalledTimes(1);

      expect(response.body.data).toEqual({
        mimeType: contentType,
        size: buffer.length,
        metadata: {
          altText: "Product front view",
          sortOrder: "2",
          isPrimary: "true",
        },
      });

      expect(endpoint.mock.calls[0][0].file.buffer).toEqual(buffer);
    },
  );

  it.each([
    ["plain text", Buffer.from("This is not an image")],
    [
      "SVG",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      ),
    ],
    ["PDF", Buffer.from("%PDF-1.7\nThis is a document\n%%EOF")],
    [
      "GIF",
      Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64",
      ),
    ],
  ])("rejects %s content declared as JPEG", async (name, buffer) => {
    const response = await attachImage(buffer, "image/jpeg", "disguised.jpg");

    expect(response.status).toBe(415);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: "PRODUCT_IMAGE_INVALID_CONTENT",
    });

    expect(endpoint).not.toHaveBeenCalled();
  });

  it.each([
    ["PNG declared as JPEG", TEST_PNG_BUFFER, "image/jpeg"],
    ["JPEG declared as PNG", TEST_JPEG_BUFFER, "image/png"],
  ])("rejects %s", async (name, buffer, contentType) => {
    const response = await attachImage(buffer, contentType);

    expect(response.status).toBe(415);
    expect(response.body.errorCode).toBe("PRODUCT_IMAGE_TYPE_MISMATCH");

    expect(endpoint).not.toHaveBeenCalled();
  });

  it("rejects an incomplete PNG header without an internal error", async () => {
    const response = await attachImage(
      TEST_PNG_BUFFER.subarray(0, 4),
      "image/png",
      "incomplete.png",
    );

    expect(response.status).toBe(415);
    expect(response.body.errorCode).toBe("PRODUCT_IMAGE_INVALID_CONTENT");

    expect(endpoint).not.toHaveBeenCalled();
  });

  it("rejects an empty uploaded image", async () => {
    const response = await attachImage(
      Buffer.alloc(0),
      "image/jpeg",
      "empty.jpg",
    );

    expect(response.status).toBe(415);
    expect(response.body.errorCode).toBe("PRODUCT_IMAGE_INVALID_CONTENT");

    expect(endpoint).not.toHaveBeenCalled();
  });

  it("preserves the missing-file error", async () => {
    const response = await request(app)
      .post("/upload")
      .field("altText", "No image attached");

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe("PRODUCT_IMAGE_REQUIRED");

    expect(endpoint).not.toHaveBeenCalled();
  });
});
