import * as z from "zod";

import {
  SIZE_GUIDE_STATUS_VALUES,
  SIZE_GUIDE_UNIT_VALUES,
} from "../../shared/constants/size-guide.constants.js";

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

const createObjectIdSchema = (requiredMessage, invalidMessage) =>
  z
    .string({
      error: requiredMessage,
    })
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, {
      error: invalidMessage,
    })
    .toLowerCase();

const sizeGuideObjectIdSchema = createObjectIdSchema(
  "Size guide ID is required",
  "Size guide ID must be a valid MongoDB ObjectId",
);

const categoryObjectIdSchema = createObjectIdSchema(
  "Category ID is required",
  "Category ID must be a valid MongoDB ObjectId",
);

/*
|--------------------------------------------------------------------------
| Optional Category
|--------------------------------------------------------------------------
|
| Accepted:
|
| undefined
| null
| ""
| MongoDB ObjectId
|
| null / "" mean the SizeGuide is not tied
| to one specific category.
|--------------------------------------------------------------------------
*/

const optionalCategorySchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return value;
  },

  categoryObjectIdSchema.nullable(),
);

/*
|--------------------------------------------------------------------------
| Size Guide Name
|--------------------------------------------------------------------------
*/

const sizeGuideNameSchema = z
  .string({
    error: "Size guide name is required",
  })
  .trim()
  .min(2, {
    error: "Size guide name must contain at least 2 characters",
  })
  .max(120, {
    error: "Size guide name cannot exceed 120 characters",
  });

/*
|--------------------------------------------------------------------------
| Size Guide Slug
|--------------------------------------------------------------------------
*/

const sizeGuideSlugSchema = z
  .string({
    error: "Size guide slug is required",
  })
  .trim()
  .toLowerCase()
  .min(2, {
    error: "Size guide slug must contain at least 2 characters",
  })
  .max(150, {
    error: "Size guide slug cannot exceed 150 characters",
  })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error:
      "Size guide slug can contain lowercase letters, numbers and hyphens only",
  });

/*
|--------------------------------------------------------------------------
| Measurement Key
|--------------------------------------------------------------------------
|
| Examples:
|
| chest
| waist
| sleeve-length
| foot-length
|--------------------------------------------------------------------------
*/

const measurementKeySchema = z
  .string({
    error: "Measurement key is required",
  })
  .trim()
  .toLowerCase()
  .min(1, {
    error: "Measurement key cannot be empty",
  })
  .max(50, {
    error: "Measurement key cannot exceed 50 characters",
  })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error:
      "Measurement key can contain lowercase letters, numbers and hyphens only",
  });

/*
|--------------------------------------------------------------------------
| Size Guide Column
|--------------------------------------------------------------------------
*/

const sizeGuideColumnSchema = z.strictObject({
  key: measurementKeySchema,

  label: z
    .string({
      error: "Size guide column label is required",
    })
    .trim()
    .min(1, {
      error: "Size guide column label cannot be empty",
    })
    .max(80, {
      error: "Size guide column label cannot exceed 80 characters",
    }),

  sortOrder: z
    .number({
      error: "Size guide column sort order must be a number",
    })
    .int({
      error: "Size guide column sort order must be a whole number",
    })
    .min(0, {
      error: "Size guide column sort order cannot be negative",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Size Guide Measurement
|--------------------------------------------------------------------------
*/

const sizeGuideMeasurementSchema = z.strictObject({
  key: measurementKeySchema,

  value: z
    .string({
      error: "Size guide measurement value is required",
    })
    .trim()
    .min(1, {
      error: "Size guide measurement value cannot be empty",
    })
    .max(50, {
      error: "Size guide measurement value cannot exceed 50 characters",
    }),
});

/*
|--------------------------------------------------------------------------
| Size Guide Row
|--------------------------------------------------------------------------
*/

const sizeGuideRowSchema = z
  .strictObject({
    size: z
      .string({
        error: "Size guide row size is required",
      })
      .trim()
      .min(1, {
        error: "Size guide row size cannot be empty",
      })
      .max(30, {
        error: "Size guide size cannot exceed 30 characters",
      }),

    measurements: z.array(sizeGuideMeasurementSchema).optional(),

    sortOrder: z
      .number({
        error: "Size guide row sort order must be a number",
      })
      .int({
        error: "Size guide row sort order must be a whole number",
      })
      .min(0, {
        error: "Size guide row sort order cannot be negative",
      })
      .optional(),
  })
  .superRefine((row, context) => {
    const measurements = row.measurements ?? [];

    const seenKeys = new Set();

    measurements.forEach((measurement, measurementIndex) => {
      if (seenKeys.has(measurement.key)) {
        context.addIssue({
          code: "custom",

          path: ["measurements", measurementIndex, "key"],

          message: `Size "${row.size}" contains duplicate measurement key "${measurement.key}"`,
        });

        return;
      }

      seenKeys.add(measurement.key);
    });
  });

/*
|--------------------------------------------------------------------------
| Size Guide Columns
|--------------------------------------------------------------------------
|
| Column keys must be unique.
|--------------------------------------------------------------------------
*/

const sizeGuideColumnsSchema = z
  .array(sizeGuideColumnSchema)
  .superRefine((columns, context) => {
    const seenKeys = new Set();

    columns.forEach((column, index) => {
      if (seenKeys.has(column.key)) {
        context.addIssue({
          code: "custom",

          path: [index, "key"],

          message: "Size guide column keys must be unique",
        });

        return;
      }

      seenKeys.add(column.key);
    });
  });

/*
|--------------------------------------------------------------------------
| Size Guide Rows
|--------------------------------------------------------------------------
|
| Sizes are unique case-insensitively.
|
| Example:
|
| M
| m
|
| are considered the same size.
|--------------------------------------------------------------------------
*/

const sizeGuideRowsSchema = z
  .array(sizeGuideRowSchema)
  .superRefine((rows, context) => {
    const seenSizes = new Set();

    rows.forEach((row, index) => {
      const normalizedSize = row.size.toLowerCase();

      if (seenSizes.has(normalizedSize)) {
        context.addIssue({
          code: "custom",

          path: [index, "size"],

          message: "Size guide row sizes must be unique",
        });

        return;
      }

      seenSizes.add(normalizedSize);
    });
  });

/*
|--------------------------------------------------------------------------
| Validate Row Measurement References
|--------------------------------------------------------------------------
|
| Every measurement used by a row must
| correspond to a defined column.
|--------------------------------------------------------------------------
*/

const validateMeasurementReferences = (body, context) => {
  if (!Array.isArray(body.rows)) {
    return;
  }

  const columns = Array.isArray(body.columns) ? body.columns : [];

  const columnKeys = new Set(columns.map((column) => column.key));

  body.rows.forEach((row, rowIndex) => {
    const measurements = row.measurements ?? [];

    measurements.forEach((measurement, measurementIndex) => {
      if (columnKeys.has(measurement.key)) {
        return;
      }

      context.addIssue({
        code: "custom",

        path: ["rows", rowIndex, "measurements", measurementIndex, "key"],

        message: `Size "${row.size}" uses unknown measurement key "${measurement.key}"`,
      });
    });
  });
};

/*
|--------------------------------------------------------------------------
| Size Guide Base Body
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Keep this schema free of refinements.
|
| Zod v4 does not allow:
|
| refinedObject.partial()
|
| Therefore:
|
| base schema
|    ├── create → superRefine()
|    └── update → partial() → refinements
|--------------------------------------------------------------------------
*/

const sizeGuideBaseBodySchema = z.strictObject({
  name: sizeGuideNameSchema,

  slug: sizeGuideSlugSchema,

  description: z
    .string()
    .trim()
    .max(1000, {
      error: "Size guide description cannot exceed 1000 characters",
    })
    .optional(),

  category: optionalCategorySchema.optional(),

  unit: z
    .enum(SIZE_GUIDE_UNIT_VALUES, {
      error: "Size guide unit must be cm or in",
    })
    .optional(),

  columns: sizeGuideColumnsSchema.optional(),

  rows: sizeGuideRowsSchema.optional(),

  howToMeasure: z
    .string()
    .trim()
    .max(2000, {
      error:
        "Size guide measurement instructions cannot exceed 2000 characters",
    })
    .optional(),

  fitNote: z
    .string()
    .trim()
    .max(500, {
      error: "Size guide fit note cannot exceed 500 characters",
    })
    .optional(),

  status: z
    .enum(SIZE_GUIDE_STATUS_VALUES, {
      error: "Size guide status must be active or inactive",
    })
    .optional(),

  sortOrder: z
    .number({
      error: "Size guide sort order must be a number",
    })
    .int({
      error: "Size guide sort order must be a whole number",
    })
    .min(0, {
      error: "Size guide sort order cannot be negative",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Create Size Guide Body
|--------------------------------------------------------------------------
*/

const createSizeGuideBodySchema = sizeGuideBaseBodySchema.superRefine(
  validateMeasurementReferences,
);

/*
|--------------------------------------------------------------------------
| Update Size Guide Body
|--------------------------------------------------------------------------
|
| All fields are optional.
|
| IMPORTANT:
|
| Cross-field measurement validation can only be performed here when BOTH
| columns and rows are supplied in the PATCH request.
|
| If only rows or only columns are supplied, the Service + Mongoose model
| will validate them against the existing persisted SizeGuide document.
|--------------------------------------------------------------------------
*/

const updateSizeGuideBodySchema = sizeGuideBaseBodySchema
  .partial()
  .superRefine((body, context) => {
    /*
     * At least one field must
     * be supplied.
     */
    if (Object.keys(body).length === 0) {
      context.addIssue({
        code: "custom",

        message: "At least one size guide field must be provided",
      });

      return;
    }

    /*
     * Request-level cross-field
     * validation is possible only
     * when both sides are present.
     */
    if (Array.isArray(body.columns) && Array.isArray(body.rows)) {
      validateMeasurementReferences(body, context);
    }
  });

/*
|--------------------------------------------------------------------------
| Size Guide ID Parameters
|--------------------------------------------------------------------------
*/

const sizeGuideIdParamsSchema = z.strictObject({
  sizeGuideId: sizeGuideObjectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Size Guide Slug Parameters
|--------------------------------------------------------------------------
*/

const sizeGuideSlugParamsSchema = z.strictObject({
  slug: sizeGuideSlugSchema,
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
| Admin Size Guide List Query
|--------------------------------------------------------------------------
*/

const sizeGuideListQuerySchema = z.strictObject({
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
    .enum(SIZE_GUIDE_STATUS_VALUES, {
      error: "Size guide status must be active or inactive",
    })
    .optional(),

  unit: z
    .enum(SIZE_GUIDE_UNIT_VALUES, {
      error: "Size guide unit must be cm or in",
    })
    .optional(),

  /*
   * category=CATEGORY_OBJECT_ID
   *
   * category=none
   *
   * "none" retrieves SizeGuides
   * where category is null.
   */
  category: z.union([categoryObjectIdSchema, z.literal("none")]).optional(),

  deleted: z
    .enum(["exclude", "only", "include"], {
      error: "Deleted filter must be exclude, only or include",
    })
    .default("exclude"),

  sortBy: z
    .enum(["sortOrder", "name", "unit", "createdAt", "updatedAt"], {
      error: "Invalid size guide sorting field",
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
| Public Size Guide List Query
|--------------------------------------------------------------------------
*/

const publicSizeGuideListQuerySchema = z.strictObject({
  category: z.union([categoryObjectIdSchema, z.literal("none")]).optional(),

  unit: z
    .enum(SIZE_GUIDE_UNIT_VALUES, {
      error: "Size guide unit must be cm or in",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Get Size Guide Query
|--------------------------------------------------------------------------
*/

const getSizeGuideQuerySchema = z.strictObject({
  includeDeleted: booleanQuerySchema.default(false),
});

/*
|--------------------------------------------------------------------------
| Create Size Guide Request
|--------------------------------------------------------------------------
*/

export const createSizeGuideRequestSchema = z.strictObject({
  body: createSizeGuideBodySchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Update Size Guide Request
|--------------------------------------------------------------------------
*/

export const updateSizeGuideRequestSchema = z.strictObject({
  body: updateSizeGuideBodySchema,

  params: sizeGuideIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Size Guide ID Request
|--------------------------------------------------------------------------
|
| Reusable later for:
|
| DELETE /admin/size-guides/:sizeGuideId
| PATCH  /admin/size-guides/:sizeGuideId/restore
|--------------------------------------------------------------------------
*/

export const sizeGuideIdRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: sizeGuideIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Get Size Guide Request
|--------------------------------------------------------------------------
*/

export const getSizeGuideRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: sizeGuideIdParamsSchema,

  query: getSizeGuideQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Admin Size Guide List Request
|--------------------------------------------------------------------------
*/

export const sizeGuideListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: sizeGuideListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Size Guide List Request
|--------------------------------------------------------------------------
*/

export const publicSizeGuideListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: publicSizeGuideListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Size Guide by Slug Request
|--------------------------------------------------------------------------
*/

export const publicSizeGuideBySlugRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: sizeGuideSlugParamsSchema,

  query: emptyObjectSchema,
});
