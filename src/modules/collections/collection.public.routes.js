import { Router } from "express";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import {
  publicCollectionListRequestSchema,
  publicCollectionBySlugRequestSchema,
} from "./collection.validation.js";

import {
  listPublicCollectionsController,
  getPublicCollectionController,
} from "./collection.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| List Public Collections
|--------------------------------------------------------------------------
|
| GET /api/v1/collections
|
| Public endpoint.
| Authentication is not required.
|
| Optional filter:
|
| ?isFeatured=true
| ?isFeatured=false
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(publicCollectionListRequestSchema),
  listPublicCollectionsController,
);

/*
|--------------------------------------------------------------------------
| Get Public Collection by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/collections/:slug
|
| Examples:
|
| /api/v1/collections/new-arrivals
| /api/v1/collections/festive-collection
| /api/v1/collections/best-sellers
|--------------------------------------------------------------------------
*/

router.get(
  "/:slug",
  validateRequest(publicCollectionBySlugRequestSchema),
  getPublicCollectionController,
);

export default router;
