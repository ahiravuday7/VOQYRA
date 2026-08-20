import * as z from "zod";

import {
  PRODUCT_CURRENCY_VALUES,
  PRODUCT_LIMITS,
  PRODUCT_STATUS_VALUES,
} from "../../shared/constants/product.constants.js";

import {
  PRODUCT_INVENTORY_ADJUSTMENT_REASON_VALUES,
  PRODUCT_INVENTORY_OPERATION_VALUES,
} from "../../shared/constants/product-inventory.constants.js";

/*
|--------------------------------------------------------------------------
| Admin Product List Values
|--------------------------------------------------------------------------
*/

const PRODUCT_STOCK_STATUS_VALUES = Object.freeze([
  "in-stock",
  "low-stock",
  "out-of-stock",
]);

const PRODUCT_DELETED_FILTER_VALUES = Object.freeze([
  "exclude",
  "include",
  "only",
]);

const PRODUCT_SORT_FIELD_VALUES = Object.freeze([
  "createdAt",
  "updatedAt",
  "name",
  "brand",
  "status",
  "publishedAt",
]);

const SORT_DIRECTION_VALUES = Object.freeze(["asc", "desc"]);

/*
|--------------------------------------------------------------------------
| Product Inventory Values
|--------------------------------------------------------------------------
*/

const MAX_INVENTORY_OPERATION_QUANTITY = 1_000_000;

/*
|--------------------------------------------------------------------------
| Public Product Sort Values
|--------------------------------------------------------------------------
*/

const PUBLIC_PRODUCT_SORT_VALUES = Object.freeze([
  "newest",
  "oldest",
  "price-low-to-high",
  "price-high-to-low",
  "name-asc",
  "name-desc",
]);

/*
|--------------------------------------------------------------------------
| Reusable Utility Schemas
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

const createObjectIdSchema = (fieldName) => {
  return z
    .string({
      error: `${fieldName} is required`,
    })
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, {
      error: `${fieldName} must be a valid MongoDB ObjectId`,
    })
    .toLowerCase();
};

const productIdSchema = createObjectIdSchema("Product ID");

const categoryIdSchema = createObjectIdSchema("Product category ID");

const brandIdSchema = createObjectIdSchema("Product brand ID");

const sizeGuideIdSchema = createObjectIdSchema("Product size guide ID");

const collectionIdSchema = createObjectIdSchema("Product collection ID");

const variantIdSchema = createObjectIdSchema("Product variant ID");

const actorIdSchema = createObjectIdSchema("Actor ID");

/*
|--------------------------------------------------------------------------
| Product Collections
|--------------------------------------------------------------------------
*/

const MAX_PRODUCT_COLLECTIONS = 50;

const productCollectionsSchema = z
  .array(collectionIdSchema, {
    error: "Product collections must be an array",
  })
  .max(MAX_PRODUCT_COLLECTIONS, {
    error: `Product cannot belong to more than ${MAX_PRODUCT_COLLECTIONS} collections`,
  })
  .superRefine((collectionIds, context) => {
    const seen = new Set();

    collectionIds.forEach((collectionId, index) => {
      if (seen.has(collectionId)) {
        context.addIssue({
          code: "custom",

          message:
            "Product collections cannot contain duplicate Collection IDs",

          path: [index],
        });

        return;
      }

      seen.add(collectionId);
    });
  });

/*
|--------------------------------------------------------------------------
| Query Integer
|--------------------------------------------------------------------------
|
| Express query values arrive as strings.
|
| Examples:
|
| "1"  → 1
| "20" → 20
|--------------------------------------------------------------------------
*/

const createQueryIntegerSchema = ({ fieldName, minimum, maximum }) => {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const normalizedValue = value.trim();

      if (!/^\d+$/.test(normalizedValue)) {
        return Number.NaN;
      }

      return Number(normalizedValue);
    },

    z
      .number({
        error: `${fieldName} must be a number`,
      })
      .int({
        error: `${fieldName} must be a whole number`,
      })
      .min(minimum, {
        error: `${fieldName} must be at least ${minimum}`,
      })
      .max(maximum, {
        error: `${fieldName} cannot exceed ${maximum}`,
      }),
  );
};

/*
|--------------------------------------------------------------------------
| Query Number
|--------------------------------------------------------------------------
|
| Used for Product price filtering.
|--------------------------------------------------------------------------
*/

const createQueryNumberSchema = ({ fieldName, minimum, maximum }) => {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const normalizedValue = value.trim();

      if (normalizedValue === "") {
        return Number.NaN;
      }

      return Number(normalizedValue);
    },

    z
      .number({
        error: `${fieldName} must be a number`,
      })
      .finite({
        error: `${fieldName} must be a finite number`,
      })
      .min(minimum, {
        error: `${fieldName} cannot be less than ${minimum}`,
      })
      .max(maximum, {
        error: `${fieldName} cannot exceed ${maximum}`,
      }),
  );
};

/*
|--------------------------------------------------------------------------
| Query Boolean
|--------------------------------------------------------------------------
|
| Only the strings "true" and "false" are accepted.
|--------------------------------------------------------------------------
*/

const queryBooleanSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }

    return value;
  },

  z.boolean({
    error: "Value must be true or false",
  }),
);

/*
|--------------------------------------------------------------------------
| Normalized Query Enum
|--------------------------------------------------------------------------
*/

const createQueryEnumSchema = (values, errorMessage) => {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      return value.trim().toLowerCase();
    },

    z.enum(values, {
      error: errorMessage,
    }),
  );
};

/*
|--------------------------------------------------------------------------
| Query Date
|--------------------------------------------------------------------------
|
| Accepted formats:
|
| 2026-07-01
| 2026-07-01T10:30:00Z
| 2026-07-01T16:00:00+05:30
|
| Date-only "from" values use the start of the UTC day.
| Date-only "to" values use the end of the UTC day.
|--------------------------------------------------------------------------
*/

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const createQueryDateSchema = ({ fieldName, endOfDay = false }) => {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const normalizedValue = value.trim();

      if (ISO_DATE_ONLY_PATTERN.test(normalizedValue)) {
        const timeSuffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";

        const parsedDate = new Date(`${normalizedValue}${timeSuffix}`);

        /*
         * Reject impossible dates such as:
         * 2026-02-30
         */
        if (parsedDate.toISOString().slice(0, 10) !== normalizedValue) {
          return new Date(Number.NaN);
        }

        return parsedDate;
      }

      if (!ISO_DATE_TIME_PATTERN.test(normalizedValue)) {
        return new Date(Number.NaN);
      }

      return new Date(normalizedValue);
    },

    z.date({
      error: `${fieldName} must be a valid ISO date or date-time`,
    }),
  );
};
/*
|--------------------------------------------------------------------------
| Product Name
|--------------------------------------------------------------------------
*/

const productNameSchema = z
  .string({
    error: "Product name is required",
  })
  .trim()
  .min(3, {
    error: "Product name must contain at least 3 characters",
  })
  .max(200, {
    error: "Product name cannot exceed 200 characters",
  });

/*
|--------------------------------------------------------------------------
| Product Slug
|--------------------------------------------------------------------------
*/

const productSlugSchema = z
  .string({
    error: "Product slug is required",
  })
  .trim()
  .toLowerCase()
  .min(3, {
    error: "Product slug must contain at least 3 characters",
  })
  .max(220, {
    error: "Product slug cannot exceed 220 characters",
  })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error:
      "Product slug can contain lowercase letters, numbers and hyphens only",
  });

/*
|--------------------------------------------------------------------------
| HTTP or HTTPS URL
|--------------------------------------------------------------------------
*/

const imageUrlSchema = z
  .string({
    error: "Product image URL is required",
  })
  .trim()
  .min(1, {
    error: "Product image URL is required",
  })
  .max(2048, {
    error: "Product image URL cannot exceed 2048 characters",
  })
  .refine(
    (value) => {
      try {
        const url = new URL(value);

        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    {
      error: "Product image URL must be a valid HTTP or HTTPS URL",
    },
  );

/*
|--------------------------------------------------------------------------
| Product Image
|--------------------------------------------------------------------------
*/

const productImageSchema = z.strictObject({
  url: imageUrlSchema,

  publicId: z
    .string()
    .trim()
    .max(300, {
      error: "Product image public ID cannot exceed 300 characters",
    })
    .optional(),

  altText: z
    .string()
    .trim()
    .max(150, {
      error: "Product image alt text cannot exceed 150 characters",
    })
    .optional(),

  sortOrder: z
    .number({
      error: "Image sort order must be a number",
    })
    .int({
      error: "Image sort order must be a whole number",
    })
    .min(0, {
      error: "Image sort order cannot be negative",
    })
    .optional(),

  isPrimary: z
    .boolean({
      error: "Image primary status must be true or false",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Product Images
|--------------------------------------------------------------------------
*/

const productImagesSchema = z
  .array(productImageSchema)
  .max(PRODUCT_LIMITS.MAX_IMAGES, {
    error: `Product cannot contain more than ${PRODUCT_LIMITS.MAX_IMAGES} images`,
  })
  .superRefine((images, context) => {
    const primaryImageCount = images.filter(
      (image) => image.isPrimary === true,
    ).length;

    if (primaryImageCount > 1) {
      context.addIssue({
        code: "custom",

        message: "Product can contain only one primary image",

        path: [],
      });
    }
  });

/*
|--------------------------------------------------------------------------
| Variant Colour
|--------------------------------------------------------------------------
*/

const productColorSchema = z.strictObject({
  name: z
    .string({
      error: "Variant colour name is required",
    })
    .trim()
    .min(1, {
      error: "Variant colour name is required",
    })
    .max(50, {
      error: "Variant colour name cannot exceed 50 characters",
    }),

  code: z
    .string({
      error: "Variant colour code is required",
    })
    .trim()
    .toUpperCase()
    .regex(/^#[0-9A-F]{6}$/, {
      error: "Variant colour code must use the format #RRGGBB",
    }),
});

/*
|--------------------------------------------------------------------------
| Variant Pricing
|--------------------------------------------------------------------------
*/

const variantPricingSchema = z
  .strictObject({
    buyingPrice: z
      .number({
        error: "Variant buying price must be a number",
      })
      .min(0, {
        error: "Buying price cannot be negative",
      }),

    sellingPrice: z
      .number({
        error: "Variant selling price must be a number",
      })
      .min(0, {
        error: "Selling price cannot be negative",
      }),

    discountPrice: z
      .number({
        error: "Variant discount price must be a number",
      })
      .min(0, {
        error: "Discount price cannot be negative",
      })
      .nullable()
      .optional(),

    currency: z
      .enum(PRODUCT_CURRENCY_VALUES, {
        error: "Unsupported product currency",
      })
      .optional(),
  })
  .superRefine((pricing, context) => {
    if (pricing.discountPrice === null || pricing.discountPrice === undefined) {
      return;
    }

    if (pricing.discountPrice > pricing.sellingPrice) {
      context.addIssue({
        code: "custom",

        message: "Discount price cannot exceed the selling price",

        path: ["discountPrice"],
      });
    }
  });

/*
|--------------------------------------------------------------------------
| Variant Inventory
|--------------------------------------------------------------------------
*/

const variantInventorySchema = z
  .strictObject({
    stock: z
      .number({
        error: "Variant stock must be a number",
      })
      .int({
        error: "Variant stock must be a whole number",
      })
      .min(0, {
        error: "Variant stock cannot be negative",
      })
      .default(0),

    reservedStock: z
      .number({
        error: "Reserved stock must be a number",
      })
      .int({
        error: "Reserved stock must be a whole number",
      })
      .min(0, {
        error: "Reserved stock cannot be negative",
      })
      .default(0),

    lowStockThreshold: z
      .number({
        error: "Low-stock threshold must be a number",
      })
      .int({
        error: "Low-stock threshold must be a whole number",
      })
      .min(0, {
        error: "Low-stock threshold cannot be negative",
      })
      .default(5),
  })
  .superRefine((inventory, context) => {
    if (inventory.reservedStock > inventory.stock) {
      context.addIssue({
        code: "custom",

        message: "Reserved stock cannot exceed total stock",

        path: ["reservedStock"],
      });
    }
  });

/*
|--------------------------------------------------------------------------
| Package Dimensions
|--------------------------------------------------------------------------
*/

const packageDimensionsSchema = z.strictObject({
  lengthCm: z
    .number({
      error: "Package length must be a number",
    })
    .min(0, {
      error: "Package length cannot be negative",
    })
    .optional(),

  widthCm: z
    .number({
      error: "Package width must be a number",
    })
    .min(0, {
      error: "Package width cannot be negative",
    })
    .optional(),

  heightCm: z
    .number({
      error: "Package height must be a number",
    })
    .min(0, {
      error: "Package height cannot be negative",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Variant Shipping
|--------------------------------------------------------------------------
*/

const variantShippingSchema = z.strictObject({
  weightInGrams: z
    .number({
      error: "Variant weight must be a number",
    })
    .min(0, {
      error: "Variant weight cannot be negative",
    })
    .optional(),

  dimensions: packageDimensionsSchema.optional(),
});

/*
|--------------------------------------------------------------------------
| Product Variant
|--------------------------------------------------------------------------
*/

const productVariantSchema = z.strictObject({
  sku: z
    .string({
      error: "Variant SKU is required",
    })
    .trim()
    .toUpperCase()
    .min(3, {
      error: "Variant SKU must contain at least 3 characters",
    })
    .max(100, {
      error: "Variant SKU cannot exceed 100 characters",
    })
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, {
      error:
        "Variant SKU can contain uppercase letters, numbers and hyphens only",
    }),

  barcode: z
    .string()
    .trim()
    .max(100, {
      error: "Variant barcode cannot exceed 100 characters",
    })
    .optional(),

  size: z
    .string({
      error: "Variant size is required",
    })
    .trim()
    .min(1, {
      error: "Variant size is required",
    })
    .max(30, {
      error: "Variant size cannot exceed 30 characters",
    }),

  color: productColorSchema,

  pricing: variantPricingSchema,

  inventory: variantInventorySchema.optional(),

  shipping: variantShippingSchema.optional(),

  isActive: z
    .boolean({
      error: "Variant active status must be true or false",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Product Variants
|--------------------------------------------------------------------------
*/

const productVariantsSchema = z
  .array(productVariantSchema)
  .min(1, {
    error: "Product must contain at least one variant",
  })
  .max(PRODUCT_LIMITS.MAX_VARIANTS, {
    error: `Product cannot contain more than ${PRODUCT_LIMITS.MAX_VARIANTS} variants`,
  })
  .superRefine((variants, context) => {
    /*
      |--------------------------------------------------------------------------
      | Duplicate SKU
      |--------------------------------------------------------------------------
      */

    const skuIndexes = new Map();

    variants.forEach((variant, index) => {
      const normalizedSku = variant.sku.trim().toUpperCase();

      if (skuIndexes.has(normalizedSku)) {
        context.addIssue({
          code: "custom",

          message: "Product variants cannot contain duplicate SKUs",

          path: [index, "sku"],
        });

        return;
      }

      skuIndexes.set(normalizedSku, index);
    });

    /*
      |--------------------------------------------------------------------------
      | Duplicate Size and Colour Combination
      |--------------------------------------------------------------------------
      */

    const combinationIndexes = new Map();

    variants.forEach((variant, index) => {
      const combination = [
        variant.size.trim().toLowerCase(),

        variant.color.name.trim().toLowerCase(),

        variant.color.code.trim().toUpperCase(),
      ].join("|");

      if (combinationIndexes.has(combination)) {
        context.addIssue({
          code: "custom",

          message:
            "Product variants cannot contain duplicate size and colour combinations",

          path: [index],
        });

        return;
      }

      combinationIndexes.set(combination, index);
    });
  });

/*
|--------------------------------------------------------------------------
| Product Attribute
|--------------------------------------------------------------------------
*/

const productAttributeSchema = z.strictObject({
  name: z
    .string({
      error: "Product attribute name is required",
    })
    .trim()
    .min(1, {
      error: "Product attribute name is required",
    })
    .max(80, {
      error: "Product attribute name cannot exceed 80 characters",
    }),

  value: z
    .string({
      error: "Product attribute value is required",
    })
    .trim()
    .min(1, {
      error: "Product attribute value is required",
    })
    .max(200, {
      error: "Product attribute value cannot exceed 200 characters",
    }),
});

/*
|--------------------------------------------------------------------------
| String Array Items
|--------------------------------------------------------------------------
*/

const materialSchema = z
  .string()
  .trim()
  .min(1, {
    error: "Product material cannot be empty",
  })
  .max(100, {
    error: "Product material cannot exceed 100 characters",
  });

const careInstructionSchema = z
  .string()
  .trim()
  .min(1, {
    error: "Care instruction cannot be empty",
  })
  .max(200, {
    error: "Care instruction cannot exceed 200 characters",
  });

const productTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, {
    error: "Product tag cannot be empty",
  })
  .max(80, {
    error: "Product tag cannot exceed 80 characters",
  });

/*
|--------------------------------------------------------------------------
| SEO
|--------------------------------------------------------------------------
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

const productSeoSchema = z.strictObject({
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
    .max(PRODUCT_LIMITS.MAX_TAGS, {
      error: `SEO keywords cannot contain more than ${PRODUCT_LIMITS.MAX_TAGS} values`,
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Product ID Parameters
|--------------------------------------------------------------------------
*/

const productIdParamsSchema = z.strictObject({
  productId: productIdSchema,
});

/*
|--------------------------------------------------------------------------
| Product Variant Parameters
|--------------------------------------------------------------------------
*/

const productVariantParamsSchema = z.strictObject({
  productId: productIdSchema,

  variantId: variantIdSchema,
});

/*
|--------------------------------------------------------------------------
| Inventory Adjustment Body
|--------------------------------------------------------------------------
|
| Positive quantityDelta:
| Adds physical stock.
|
| Negative quantityDelta:
| Removes physical stock.
|
| Examples:
|
|  10 → Add 10 units
|  -3 → Remove 3 units
|--------------------------------------------------------------------------
*/

const inventoryAdjustmentBodySchema = z.strictObject({
  quantityDelta: z
    .number({
      error: "Inventory quantity delta must be a number",
    })
    .int({
      error: "Inventory quantity delta must be a whole number",
    })
    .min(-MAX_INVENTORY_OPERATION_QUANTITY, {
      error: `Inventory quantity delta cannot be less than -${MAX_INVENTORY_OPERATION_QUANTITY}`,
    })
    .max(MAX_INVENTORY_OPERATION_QUANTITY, {
      error: `Inventory quantity delta cannot exceed ${MAX_INVENTORY_OPERATION_QUANTITY}`,
    })
    .refine(
      (value) => {
        return value !== 0;
      },
      {
        error: "Inventory quantity delta cannot be zero",
      },
    ),

  reason: z.enum(PRODUCT_INVENTORY_ADJUSTMENT_REASON_VALUES, {
    error: "Invalid inventory adjustment reason",
  }),

  note: z
    .string()
    .trim()
    .min(1, {
      error: "Inventory adjustment note cannot be empty",
    })
    .max(300, {
      error: "Inventory adjustment note cannot exceed 300 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Inventory Quantity Body
|--------------------------------------------------------------------------
|
| Reused for:
|
| - Reserve stock
| - Release reservation
| - Commit reserved stock
|--------------------------------------------------------------------------
*/

const inventoryQuantityBodySchema = z.strictObject({
  quantity: z
    .number({
      error: "Inventory quantity must be a number",
    })
    .int({
      error: "Inventory quantity must be a whole number",
    })
    .min(1, {
      error: "Inventory quantity must be at least 1",
    })
    .max(MAX_INVENTORY_OPERATION_QUANTITY, {
      error: `Inventory quantity cannot exceed ${MAX_INVENTORY_OPERATION_QUANTITY}`,
    }),

  referenceId: z
    .string()
    .trim()
    .min(1, {
      error: "Inventory reference ID cannot be empty",
    })
    .max(120, {
      error: "Inventory reference ID cannot exceed 120 characters",
    })
    .optional(),
});
/*
|--------------------------------------------------------------------------
| Public Product Slug Parameters
|--------------------------------------------------------------------------
*/

const publicProductSlugParamsSchema = z.strictObject({
  slug: productSlugSchema,
});

/*
|--------------------------------------------------------------------------
| Create Product Body
|--------------------------------------------------------------------------
*/

const createProductBodySchema = z.strictObject({
  name: productNameSchema,

  slug: productSlugSchema,

  shortDescription: z
    .string()
    .trim()
    .max(300, {
      error: "Product short description cannot exceed 300 characters",
    })
    .optional(),

  description: z
    .string()
    .trim()
    .max(5000, {
      error: "Product description cannot exceed 5000 characters",
    })
    .optional(),

  /*
|--------------------------------------------------------------------------
| Master Data Dependencies
|--------------------------------------------------------------------------
*/

  category: categoryIdSchema,

  brand: brandIdSchema,

  sizeGuide: sizeGuideIdSchema.nullable().optional(),

  collections: productCollectionsSchema.optional(),

  attributes: z
    .array(productAttributeSchema)
    .max(PRODUCT_LIMITS.MAX_ATTRIBUTES, {
      error: `Product cannot contain more than ${PRODUCT_LIMITS.MAX_ATTRIBUTES} attributes`,
    })
    .optional(),

  materials: z
    .array(materialSchema)
    .max(30, {
      error: "Product cannot contain more than 30 materials",
    })
    .optional(),

  careInstructions: z
    .array(careInstructionSchema)
    .max(PRODUCT_LIMITS.MAX_CARE_INSTRUCTIONS, {
      error: `Product cannot contain more than ${PRODUCT_LIMITS.MAX_CARE_INSTRUCTIONS} care instructions`,
    })
    .optional(),

  countryOfOrigin: z
    .string()
    .trim()
    .min(1, {
      error: "Country of origin cannot be empty",
    })
    .max(100, {
      error: "Country of origin cannot exceed 100 characters",
    })
    .optional(),

  tags: z
    .array(productTagSchema)
    .max(PRODUCT_LIMITS.MAX_TAGS, {
      error: `Product cannot contain more than ${PRODUCT_LIMITS.MAX_TAGS} tags`,
    })
    .optional(),

  images: productImagesSchema.optional(),

  variants: productVariantsSchema,

  seo: productSeoSchema.optional(),

  status: z
    .enum(PRODUCT_STATUS_VALUES, {
      error: "Invalid product status",
    })
    .optional(),

  isFeatured: z
    .boolean({
      error: "isFeatured must be true or false",
    })
    .optional(),

  isNewArrival: z
    .boolean({
      error: "isNewArrival must be true or false",
    })
    .optional(),

  isBestSeller: z
    .boolean({
      error: "isBestSeller must be true or false",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Update Product Body
|--------------------------------------------------------------------------
*/

const updateProductBodySchema = createProductBodySchema.partial().refine(
  (body) => {
    return Object.keys(body).length > 0;
  },
  {
    error: "At least one product field must be provided",
  },
);

/*
|--------------------------------------------------------------------------
| Admin Product List Query
|--------------------------------------------------------------------------
*/

const adminProductListQuerySchema = z.strictObject({
  /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

  page: createQueryIntegerSchema({
    fieldName: "Page",
    minimum: 1,
    maximum: 100000,
  })
    .optional()
    .default(1),

  limit: createQueryIntegerSchema({
    fieldName: "Limit",
    minimum: 1,
    maximum: 100,
  })
    .optional()
    .default(20),

  /*
|--------------------------------------------------------------------------
| Search
|--------------------------------------------------------------------------
|
| Search will eventually support:
|
| - Product name
| - Product slug
| - Product tags
| - Variant SKU
| - Brand name through Brand master-data lookup
|--------------------------------------------------------------------------
*/

  search: z
    .string({
      error: "Product search must be a string",
    })
    .trim()
    .min(1, {
      error: "Product search cannot be empty",
    })
    .max(100, {
      error: "Product search cannot exceed 100 characters",
    })
    .optional(),

  /*
|--------------------------------------------------------------------------
| Master Data Filters
|--------------------------------------------------------------------------
*/

  category: categoryIdSchema.optional(),

  brand: brandIdSchema.optional(),

  sizeGuide: sizeGuideIdSchema.optional(),

  collection: collectionIdSchema.optional(),

  /*
    |--------------------------------------------------------------------------
    | Product Status
    |--------------------------------------------------------------------------
    */

  status: createQueryEnumSchema(
    PRODUCT_STATUS_VALUES,
    "Invalid product status",
  ).optional(),

  /*
    |--------------------------------------------------------------------------
    | Product Flags
    |--------------------------------------------------------------------------
    */

  isFeatured: queryBooleanSchema.optional(),

  isNewArrival: queryBooleanSchema.optional(),

  isBestSeller: queryBooleanSchema.optional(),

  /*
    |--------------------------------------------------------------------------
    | Stock Status
    |--------------------------------------------------------------------------
    */

  stockStatus: createQueryEnumSchema(
    PRODUCT_STOCK_STATUS_VALUES,
    "Invalid product stock status",
  ).optional(),

  /*
    |--------------------------------------------------------------------------
    | Deleted State
    |--------------------------------------------------------------------------
    */

  deleted: createQueryEnumSchema(
    PRODUCT_DELETED_FILTER_VALUES,
    "Invalid deleted Product filter",
  )
    .optional()
    .default("exclude"),

  /*
    |--------------------------------------------------------------------------
    | Sorting
    |--------------------------------------------------------------------------
    */

  sortBy: createQueryEnumSchema(
    PRODUCT_SORT_FIELD_VALUES,
    "Invalid Product sorting field",
  )
    .optional()
    .default("createdAt"),

  sortDirection: createQueryEnumSchema(
    SORT_DIRECTION_VALUES,
    "Invalid sorting direction",
  )
    .optional()
    .default("desc"),
});

/*
|--------------------------------------------------------------------------
| Admin Product Inventory Ledger Query
|--------------------------------------------------------------------------
*/

const adminProductInventoryLedgerListQuerySchema = z
  .strictObject({
    /*
      |--------------------------------------------------------------------------
      | Pagination
      |--------------------------------------------------------------------------
      */

    page: createQueryIntegerSchema({
      fieldName: "Page",
      minimum: 1,
      maximum: 100000,
    })
      .optional()
      .default(1),

    limit: createQueryIntegerSchema({
      fieldName: "Limit",
      minimum: 1,
      maximum: 100,
    })
      .optional()
      .default(20),

    /*
      |--------------------------------------------------------------------------
      | Product and Variant
      |--------------------------------------------------------------------------
      */

    product: productIdSchema.optional(),

    variantId: variantIdSchema.optional(),

    /*
      |--------------------------------------------------------------------------
      | Inventory Operation
      |--------------------------------------------------------------------------
      */

    operation: createQueryEnumSchema(
      PRODUCT_INVENTORY_OPERATION_VALUES,
      "Invalid inventory operation",
    ).optional(),

    /*
      |--------------------------------------------------------------------------
      | Order or Business Reference
      |--------------------------------------------------------------------------
      */

    referenceId: z
      .string({
        error: "Inventory reference ID must be a string",
      })
      .trim()
      .min(1, {
        error: "Inventory reference ID cannot be empty",
      })
      .max(120, {
        error: "Inventory reference ID cannot exceed 120 characters",
      })
      .optional(),

    /*
      |--------------------------------------------------------------------------
      | Actor
      |--------------------------------------------------------------------------
      */

    actor: actorIdSchema.optional(),

    /*
      |--------------------------------------------------------------------------
      | Date Range
      |--------------------------------------------------------------------------
      */

    from: createQueryDateSchema({
      fieldName: "Inventory ledger from date",
    }).optional(),

    to: createQueryDateSchema({
      fieldName: "Inventory ledger to date",

      endOfDay: true,
    }).optional(),

    /*
      |--------------------------------------------------------------------------
      | Sorting
      |--------------------------------------------------------------------------
      */

    sortDirection: createQueryEnumSchema(
      SORT_DIRECTION_VALUES,
      "Inventory ledger sort direction must be asc or desc",
    )
      .optional()
      .default("desc"),
  })
  .refine(
    (query) => {
      if (!query.from || !query.to) {
        return true;
      }

      return query.from.getTime() <= query.to.getTime();
    },
    {
      error: "Inventory ledger from date cannot be later than the to date",

      path: ["to"],
    },
  );
/*
|--------------------------------------------------------------------------
| Public Product List Query
|--------------------------------------------------------------------------
|
| Public users cannot request:
|
| - Draft Products
| - Inactive Products
| - Archived Products
| - Deleted Products
|--------------------------------------------------------------------------
*/

const publicProductListQuerySchema = z
  .strictObject({
    page: createQueryIntegerSchema({
      fieldName: "Page",
      minimum: 1,
      maximum: 100000,
    })
      .optional()
      .default(1),

    limit: createQueryIntegerSchema({
      fieldName: "Limit",
      minimum: 1,
      maximum: 50,
    })
      .optional()
      .default(20),

    search: z
      .string({
        error: "Product search must be a string",
      })
      .trim()
      .min(1, {
        error: "Product search cannot be empty",
      })
      .max(100, {
        error: "Product search cannot exceed 100 characters",
      })
      .optional(),

    /*
|--------------------------------------------------------------------------
| Master Data Filters
|--------------------------------------------------------------------------
*/

    category: categoryIdSchema.optional(),

    brand: brandIdSchema.optional(),

    collection: collectionIdSchema.optional(),

    isFeatured: queryBooleanSchema.optional(),

    isNewArrival: queryBooleanSchema.optional(),

    isBestSeller: queryBooleanSchema.optional(),

    inStock: queryBooleanSchema.optional(),

    minPrice: createQueryNumberSchema({
      fieldName: "Minimum price",
      minimum: 0,
      maximum: 10000000,
    }).optional(),

    maxPrice: createQueryNumberSchema({
      fieldName: "Maximum price",
      minimum: 0,
      maximum: 10000000,
    }).optional(),

    sort: createQueryEnumSchema(
      PUBLIC_PRODUCT_SORT_VALUES,
      "Invalid public Product sorting option",
    )
      .optional()
      .default("newest"),
  })
  .superRefine((query, context) => {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      context.addIssue({
        code: "custom",

        message: "Minimum price cannot exceed maximum price",

        path: ["minPrice"],
      });
    }
  });

/*
|--------------------------------------------------------------------------
| Create Product Request
|--------------------------------------------------------------------------
*/

export const createProductRequestSchema = z.strictObject({
  body: createProductBodySchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Update Product Request
|--------------------------------------------------------------------------
*/

export const updateProductRequestSchema = z.strictObject({
  body: updateProductBodySchema,

  params: productIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Product-by-ID Request
|--------------------------------------------------------------------------
|
| This can later be reused for:
|
| GET    /admin/products/:productId
| DELETE /admin/products/:productId
|--------------------------------------------------------------------------
*/

export const productIdRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: productIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Product List Request
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/products
|--------------------------------------------------------------------------
*/

export const adminProductListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: adminProductListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Public Product List Request
|--------------------------------------------------------------------------
|
| GET /api/v1/products
|--------------------------------------------------------------------------
*/

export const publicProductListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: publicProductListQuerySchema,
});
/*
|--------------------------------------------------------------------------
| Public Product Details Request
|--------------------------------------------------------------------------
|
| GET /api/v1/products/:slug
|--------------------------------------------------------------------------
*/

export const publicProductDetailsRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: publicProductSlugParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Adjust Product Inventory Request
|--------------------------------------------------------------------------
|
| PATCH
| /api/v1/admin/products/:productId/variants/:variantId/inventory
|--------------------------------------------------------------------------
*/

export const adjustProductInventoryRequestSchema = z.strictObject({
  body: inventoryAdjustmentBodySchema,

  params: productVariantParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Reserve Product Inventory Request
|--------------------------------------------------------------------------
*/

export const reserveProductInventoryRequestSchema = z.strictObject({
  body: inventoryQuantityBodySchema,

  params: productVariantParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Release Product Inventory Request
|--------------------------------------------------------------------------
*/

export const releaseProductInventoryRequestSchema = z.strictObject({
  body: inventoryQuantityBodySchema,

  params: productVariantParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Commit Product Inventory Request
|--------------------------------------------------------------------------
|
| Converts reserved inventory into sold inventory.
|--------------------------------------------------------------------------
*/

export const commitProductInventoryRequestSchema = z.strictObject({
  body: inventoryQuantityBodySchema,

  params: productVariantParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Product Inventory Ledger List Request
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/products/inventory-ledger
|--------------------------------------------------------------------------
*/

export const adminProductInventoryLedgerListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: adminProductInventoryLedgerListQuerySchema,
});
