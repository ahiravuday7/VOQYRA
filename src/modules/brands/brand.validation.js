import * as z from "zod";

import { BRAND_STATUS_VALUES } from "../../shared/constants/brand.constants.js";

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

const objectIdSchema = z
  .string({
    error: "Brand ID is required",
  })
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, {
    error: "Brand ID must be a valid MongoDB ObjectId",
  })
  .toLowerCase();

/*
|--------------------------------------------------------------------------
| Brand Name
|--------------------------------------------------------------------------
*/

const brandNameSchema = z
  .string({
    error: "Brand name is required",
  })
  .trim()
  .min(2, {
    error: "Brand name must contain at least 2 characters",
  })
  .max(100, {
    error: "Brand name cannot exceed 100 characters",
  });

/*
|--------------------------------------------------------------------------
| Brand Slug
|--------------------------------------------------------------------------
*/

const brandSlugSchema = z
  .string({
    error: "Brand slug is required",
  })
  .trim()
  .toLowerCase()
  .min(2, {
    error: "Brand slug must contain at least 2 characters",
  })
  .max(150, {
    error: "Brand slug cannot exceed 150 characters",
  })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: "Brand slug can contain lowercase letters, numbers and hyphens only",
  });

/*
|--------------------------------------------------------------------------
| Optional URL
|--------------------------------------------------------------------------
*/

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2048, {
    error: "Brand logo URL cannot exceed 2048 characters",
  })
  .refine(
    (value) => {
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
      error: "Brand logo URL must be a valid HTTP or HTTPS URL",
    },
  );

/*
|--------------------------------------------------------------------------
| Brand Logo
|--------------------------------------------------------------------------
*/

const brandLogoSchema = z.strictObject({
  url: optionalUrlSchema.optional(),

  publicId: z
    .string()
    .trim()
    .max(300, {
      error: "Brand logo public ID cannot exceed 300 characters",
    })
    .optional(),

  altText: z
    .string()
    .trim()
    .max(150, {
      error: "Brand logo alt text cannot exceed 150 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Create Brand Body
|--------------------------------------------------------------------------
*/

const createBrandBodySchema = z.strictObject({
  name: brandNameSchema,

  slug: brandSlugSchema,

  description: z
    .string()
    .trim()
    .max(1000, {
      error: "Brand description cannot exceed 1000 characters",
    })
    .optional(),

  logo: brandLogoSchema.optional(),

  status: z
    .enum(BRAND_STATUS_VALUES, {
      error: "Brand status must be active or inactive",
    })
    .optional(),

  isFeatured: z
    .boolean({
      error: "isFeatured must be true or false",
    })
    .optional(),

  sortOrder: z
    .number({
      error: "Brand sort order must be a number",
    })
    .int({
      error: "Brand sort order must be a whole number",
    })
    .min(0, {
      error: "Brand sort order cannot be negative",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Update Brand Body
|--------------------------------------------------------------------------
|
| Every field is optional.
|
| At least one field must be supplied.
|--------------------------------------------------------------------------
*/

const updateBrandBodySchema = createBrandBodySchema.partial().refine(
  (body) => {
    return Object.keys(body).length > 0;
  },
  {
    error: "At least one brand field must be provided",
  },
);

/*
|--------------------------------------------------------------------------
| Brand ID Parameters
|--------------------------------------------------------------------------
*/

const brandIdParamsSchema = z.strictObject({
  brandId: objectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Brand Slug Parameters
|--------------------------------------------------------------------------
*/

const brandSlugParamsSchema = z.strictObject({
  slug: brandSlugSchema,
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
| Admin Brand List Query
|--------------------------------------------------------------------------
*/

const brandListQuerySchema = z.strictObject({
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
    .enum(BRAND_STATUS_VALUES, {
      error: "Brand status must be active or inactive",
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
      error: "Invalid brand sorting field",
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
| Public Brand List Query
|--------------------------------------------------------------------------
*/

const publicBrandListQuerySchema = z.strictObject({
  isFeatured: booleanQuerySchema.optional(),
});

/*
|--------------------------------------------------------------------------
| Get Brand Query
|--------------------------------------------------------------------------
*/

const getBrandQuerySchema = z.strictObject({
  includeDeleted: booleanQuerySchema.default(false),
});

/*
|--------------------------------------------------------------------------
| Create Brand Request
|--------------------------------------------------------------------------
*/

export const createBrandRequestSchema = z.strictObject({
  body: createBrandBodySchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Update Brand Request
|--------------------------------------------------------------------------
*/

export const updateBrandRequestSchema = z.strictObject({
  body: updateBrandBodySchema,

  params: brandIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Brand ID Request
|--------------------------------------------------------------------------
|
| Can later be reused for:
|
| DELETE /admin/brands/:brandId
|--------------------------------------------------------------------------
*/

export const brandIdRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: brandIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Get Brand Request
|--------------------------------------------------------------------------
|
| Admin lookup by ID.
|--------------------------------------------------------------------------
*/

export const getBrandRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: brandIdParamsSchema,

  query: getBrandQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Admin Brand List Request
|--------------------------------------------------------------------------
*/

export const brandListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: brandListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Brand List Request
|--------------------------------------------------------------------------
*/

export const publicBrandListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: publicBrandListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Brand By Slug Request
|--------------------------------------------------------------------------
*/

export const publicBrandBySlugRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: brandSlugParamsSchema,

  query: emptyObjectSchema,
});
