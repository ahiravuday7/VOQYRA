import * as z from "zod";

import { COLLECTION_STATUS_VALUES } from "../../shared/constants/collection.constants.js";

/*
|--------------------------------------------------------------------------
| Reusable Schemas
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({}),
);

/*
|--------------------------------------------------------------------------
| MongoDB ObjectId
|--------------------------------------------------------------------------
*/

const collectionObjectIdSchema = z
  .string({
    error: "Collection ID is required",
  })
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, {
    error: "Collection ID must be a valid MongoDB ObjectId",
  })
  .toLowerCase();

/*
|--------------------------------------------------------------------------
| Collection Name
|--------------------------------------------------------------------------
*/

const collectionNameSchema = z
  .string({
    error: "Collection name is required",
  })
  .trim()
  .min(2, {
    error: "Collection name must contain at least 2 characters",
  })
  .max(120, {
    error: "Collection name cannot exceed 120 characters",
  });

/*
|--------------------------------------------------------------------------
| Collection Slug
|--------------------------------------------------------------------------
*/

const collectionSlugSchema = z
  .string({
    error: "Collection slug is required",
  })
  .trim()
  .toLowerCase()
  .min(2, {
    error: "Collection slug must contain at least 2 characters",
  })
  .max(150, {
    error: "Collection slug cannot exceed 150 characters",
  })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error:
      "Collection slug can contain lowercase letters, numbers and hyphens only",
  });

/*
|--------------------------------------------------------------------------
| Optional HTTP / HTTPS URL
|--------------------------------------------------------------------------
*/

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2048, {
    error: "Collection banner URL cannot exceed 2048 characters",
  })
  .refine(
    (value) => {
      /*
       * Empty URL is allowed because
       * Cloudinary upload is not
       * implemented yet.
       */
      if (!value) {
        return true;
      }

      try {
        const url = new URL(value);

        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    {
      error: "Collection banner URL must be a valid HTTP or HTTPS URL",
    },
  );

/*
|--------------------------------------------------------------------------
| Collection Banner
|--------------------------------------------------------------------------
*/

const collectionBannerSchema = z.strictObject({
  url: optionalUrlSchema.optional(),

  publicId: z
    .string()
    .trim()
    .max(300, {
      error: "Collection banner public ID cannot exceed 300 characters",
    })
    .optional(),

  altText: z
    .string()
    .trim()
    .max(150, {
      error: "Collection banner alt text cannot exceed 150 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Collection Base Body
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Keep this schema free from refinements.
|
| This allows us to safely derive:
|
| CREATE
|   ↓
| base schema
|
| UPDATE
|   ↓
| base.partial()
|
| without hitting Zod v4:
|
| ".partial() cannot be used on object schemas containing refinements"
|--------------------------------------------------------------------------
*/

const collectionBaseBodySchema = z.strictObject({
  name: collectionNameSchema,

  slug: collectionSlugSchema,

  description: z
    .string()
    .trim()
    .max(2000, {
      error: "Collection description cannot exceed 2000 characters",
    })
    .optional(),

  banner: collectionBannerSchema.optional(),

  status: z
    .enum(COLLECTION_STATUS_VALUES, {
      error: "Collection status must be active or inactive",
    })
    .optional(),

  isFeatured: z
    .boolean({
      error: "isFeatured must be true or false",
    })
    .optional(),

  sortOrder: z
    .number({
      error: "Collection sort order must be a number",
    })
    .int({
      error: "Collection sort order must be a whole number",
    })
    .min(0, {
      error: "Collection sort order cannot be negative",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Create Collection Body
|--------------------------------------------------------------------------
*/

const createCollectionBodySchema = collectionBaseBodySchema;

/*
|--------------------------------------------------------------------------
| Update Collection Body
|--------------------------------------------------------------------------
|
| Every field is optional.
|
| At least one field must be supplied.
|--------------------------------------------------------------------------
*/

const updateCollectionBodySchema = collectionBaseBodySchema
  .partial()
  .superRefine((body, context) => {
    if (Object.keys(body).length === 0) {
      context.addIssue({
        code: "custom",

        message: "At least one collection field must be provided",
      });
    }
  });

/*
|--------------------------------------------------------------------------
| Collection ID Parameters
|--------------------------------------------------------------------------
*/

const collectionIdParamsSchema = z.strictObject({
  collectionId: collectionObjectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Collection Slug Parameters
|--------------------------------------------------------------------------
*/

const collectionSlugParamsSchema = z.strictObject({
  slug: collectionSlugSchema,
});

/*
|--------------------------------------------------------------------------
| Pagination
|--------------------------------------------------------------------------
*/

const pageQuerySchema = z.preprocess(
  (value) => {
    return value === undefined || value === "" ? undefined : value;
  },

  z.coerce
    .number({
      error: "Page must be a number",
    })
    .int({
      error: "Page must be a whole number",
    })
    .min(1, {
      error: "Page must be at least 1",
    })
    .default(1),
);

const limitQuerySchema = z.preprocess(
  (value) => {
    return value === undefined || value === "" ? undefined : value;
  },

  z.coerce
    .number({
      error: "Limit must be a number",
    })
    .int({
      error: "Limit must be a whole number",
    })
    .min(1, {
      error: "Limit must be at least 1",
    })
    .max(100, {
      error: "Limit cannot exceed 100",
    })
    .default(20),
);

/*
|--------------------------------------------------------------------------
| Boolean Query
|--------------------------------------------------------------------------
*/

const booleanQuerySchema = z.stringbool({
  truthy: ["true"],

  falsy: ["false"],

  error: "Boolean filter must be true or false",
});

/*
|--------------------------------------------------------------------------
| Admin Collection List Query
|--------------------------------------------------------------------------
*/

const collectionListQuerySchema = z.strictObject({
  page: pageQuerySchema,

  limit: limitQuerySchema,

  search: z
    .string()
    .trim()
    .min(1, {
      error: "Search cannot be empty",
    })
    .max(100, {
      error: "Search cannot exceed 100 characters",
    })
    .optional(),

  status: z
    .enum(COLLECTION_STATUS_VALUES, {
      error: "Collection status must be active or inactive",
    })
    .optional(),

  isFeatured: booleanQuerySchema.optional(),

  deleted: z
    .enum(["exclude", "only", "include"], {
      error: "Deleted filter must be exclude, only or include",
    })
    .default("exclude"),

  sortBy: z
    .enum(["sortOrder", "name", "createdAt", "updatedAt"], {
      error: "Invalid collection sorting field",
    })
    .default("sortOrder"),

  sortDirection: z
    .enum(["asc", "desc"], {
      error: "Sort direction must be asc or desc",
    })
    .default("asc"),
});

/*
|--------------------------------------------------------------------------
| Public Collection List Query
|--------------------------------------------------------------------------
|
| For now public consumers only need:
|
| ?isFeatured=true
| ?isFeatured=false
|--------------------------------------------------------------------------
*/

const publicCollectionListQuerySchema = z.strictObject({
  isFeatured: booleanQuerySchema.optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Get Collection Query
|--------------------------------------------------------------------------
*/

const getCollectionQuerySchema = z.strictObject({
  includeDeleted: booleanQuerySchema.default(false),
});

/*
|--------------------------------------------------------------------------
| Create Collection Request
|--------------------------------------------------------------------------
*/

export const createCollectionRequestSchema = z.strictObject({
  body: createCollectionBodySchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Update Collection Request
|--------------------------------------------------------------------------
*/

export const updateCollectionRequestSchema = z.strictObject({
  body: updateCollectionBodySchema,

  params: collectionIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Collection ID Request
|--------------------------------------------------------------------------
|
| Reusable for:
|
| DELETE /admin/collections/:collectionId
|
| PATCH /admin/collections/:collectionId/restore
|--------------------------------------------------------------------------
*/

export const collectionIdRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: collectionIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Collection Detail Request
|--------------------------------------------------------------------------
*/

export const getCollectionRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: collectionIdParamsSchema,

  query: getCollectionQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Admin Collection List Request
|--------------------------------------------------------------------------
*/

export const collectionListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: collectionListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Collection List Request
|--------------------------------------------------------------------------
*/

export const publicCollectionListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: publicCollectionListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Collection By Slug Request
|--------------------------------------------------------------------------
*/

export const publicCollectionBySlugRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: collectionSlugParamsSchema,

  query: emptyObjectSchema,
});
