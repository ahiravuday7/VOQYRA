import { Router } from "express";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import {
  publicSizeGuideListRequestSchema,
  publicSizeGuideBySlugRequestSchema,
} from "./size-guide.validation.js";

import {
  listPublicSizeGuidesController,
  getPublicSizeGuideController,
} from "./size-guide.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| List Public SizeGuides
|--------------------------------------------------------------------------
|
| GET /api/v1/size-guides
|
| Public endpoint.
| Authentication is not required.
|
| Optional filters:
|
| ?category=CATEGORY_OBJECT_ID
| ?category=none
| ?unit=cm
| ?unit=in
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(publicSizeGuideListRequestSchema),
  listPublicSizeGuidesController,
);

/*
|--------------------------------------------------------------------------
| Get Public SizeGuide by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/size-guides/:slug
|
| Examples:
|
| /api/v1/size-guides/mens-tshirt-size-guide
| /api/v1/size-guides/womens-kurti-size-guide
|--------------------------------------------------------------------------
*/

router.get(
  "/:slug",
  validateRequest(publicSizeGuideBySlugRequestSchema),
  getPublicSizeGuideController,
);

export default router;
