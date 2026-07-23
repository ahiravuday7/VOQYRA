import * as z from "zod";

import { CATEGORY_STATUS_VALUES } from "../../shared/constants/category.constants.js";

/*
| Reusable Schemas
*/

/*
 * MongoDB ObjectId string example:
 * 507f1f77bcf86cd799439011
 */
const objectIdSchema = z
  .string({
    error: "Category ID is required",
  })
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, {
    error: "Category ID must be a valid MongoDB ObjectId",
  })
  .toLowerCase();

/*
 * Empty parent value means root category.
 *
 * Accepted:
 * null
 * ""
 * undefined
 * "507f1f77bcf86cd799439011"
 */
const parentCategorySchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return value;
  },

  objectIdSchema.nullable(),
);

/*
| Category Name
*/

const categoryNameSchema = z
  .string({
    error: "Category name is required",
  })
  .trim()
  .min(2, {
    error: "Category name must contain at least 2 characters",
  })
  .max(100, {
    error: "Category name cannot exceed 100 characters",
  });

/*
| Category Slug
*/

const categorySlugSchema = z
  .string({
    error: "Category slug is required",
  })
  .trim()
  .toLowerCase()
  .min(2, {
    error: "Category slug must contain at least 2 characters",
  })
  .max(150, {
    error: "Category slug cannot exceed 150 characters",
  })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error:
      "Category slug can contain lowercase letters, numbers and hyphens only",
  });

/*
| Optional URL
*/

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2048, {
    error: "Image URL cannot exceed 2048 characters",
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
      error: "Image URL must be a valid HTTP or HTTPS URL",
    },
  );

/*
| Image Schema
*/

const categoryImageSchema = z.strictObject({
  url: optionalUrlSchema.optional(),

  publicId: z
    .string()
    .trim()
    .max(300, {
      error: "Image public ID cannot exceed 300 characters",
    })
    .optional(),

  altText: z
    .string()
    .trim()
    .max(150, {
      error: "Image alt text cannot exceed 150 characters",
    })
    .optional(),
});

/*
| SEO Keywords
*/

const seoKeywordSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, {
    error: "SEO keyword cannot be empty",
  })
  .max(80, {
    error: "SEO keyword cannot exceed 80 characters",
  });

/*
| SEO Schema
*/

const categorySeoSchema = z.strictObject({
  metaTitle: z
    .string()
    .trim()
    .max(70, {
      error: "SEO title cannot exceed 70 characters",
    })
    .optional(),

  metaDescription: z
    .string()
    .trim()
    .max(170, {
      error: "SEO description cannot exceed 170 characters",
    })
    .optional(),

  keywords: z
    .array(seoKeywordSchema)
    .max(20, {
      error: "SEO keywords cannot contain more than 20 values",
    })
    .optional(),
});

/*
| Create Category Body
*/

const createCategoryBodySchema = z.strictObject({
  name: categoryNameSchema,

  slug: categorySlugSchema,

  description: z
    .string()
    .trim()
    .max(1000, {
      error: "Category description cannot exceed 1000 characters",
    })
    .optional(),

  parent: parentCategorySchema.optional(),

  image: categoryImageSchema.optional(),

  bannerImage: categoryImageSchema.optional(),

  seo: categorySeoSchema.optional(),

  status: z
    .enum(CATEGORY_STATUS_VALUES, {
      error: "Category status must be active or inactive",
    })
    .optional(),

  isFeatured: z
    .boolean({
      error: "isFeatured must be true or false",
    })
    .optional(),

  sortOrder: z
    .number({
      error: "Category sort order must be a number",
    })
    .int({
      error: "Category sort order must be a whole number",
    })
    .min(0, {
      error: "Category sort order cannot be negative",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Update Category Body
|--------------------------------------------------------------------------
|
| Every field is optional, but at least one field
| must be supplied.
|--------------------------------------------------------------------------
*/

const updateCategoryBodySchema = createCategoryBodySchema.partial().refine(
  (body) => {
    return Object.keys(body).length > 0;
  },
  {
    error: "At least one category field must be provided",
  },
);

/*
|--------------------------------------------------------------------------
| Category ID Parameters
|--------------------------------------------------------------------------
*/

const categoryIdParamsSchema = z.strictObject({
  categoryId: objectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Empty Request Object
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({}),
);

/*
|--------------------------------------------------------------------------
| Create Category Request
|--------------------------------------------------------------------------
*/

export const createCategoryRequestSchema = z.strictObject({
  body: createCategoryBodySchema,
  params: emptyObjectSchema,
  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Update Category Request
|--------------------------------------------------------------------------
*/

export const updateCategoryRequestSchema = z.strictObject({
  body: updateCategoryBodySchema,
  params: categoryIdParamsSchema,
  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Category-by-ID Request
|--------------------------------------------------------------------------
|
| This can later be reused for:
|
| GET    /categories/:categoryId
| DELETE /categories/:categoryId
|--------------------------------------------------------------------------
*/

export const categoryIdRequestSchema = z.strictObject({
  body: emptyObjectSchema,
  params: categoryIdParamsSchema,
  query: emptyObjectSchema,
});
