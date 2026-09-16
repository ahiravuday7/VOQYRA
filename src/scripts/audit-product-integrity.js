import mongoose from "mongoose";

import env from "../config/environment.js";

import { PRODUCT_LIMITS } from "../shared/constants/product.constants.js";

const BATCH_SIZE = 100;
const SAMPLE_LIMIT = 20;
const QUERY_TIMEOUT_MS = 30_000;

const REFERENCE_RULES = [
  {
    field: "category",
    collection: "categories",
    code: "CATEGORY",
    required: true,
  },
  {
    field: "brand",
    collection: "brands",
    code: "BRAND",
    required: true,
  },
  {
    field: "sizeGuide",
    collection: "sizeguides",
    code: "SIZE_GUIDE",
    required: false,
  },
  {
    field: "collections",
    collection: "collections",
    code: "COLLECTION",
    many: true,
  },
];

const isObjectId = (value) => {
  return value?._bsontype === "ObjectId";
};

const isRecord = (value) => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const isQuantity = (value) => {
  return Number.isSafeInteger(value) && value >= 0;
};

/*
|--------------------------------------------------------------------------
| Load Existing Reference IDs for One Product Batch
|--------------------------------------------------------------------------
*/

const loadReferences = async (database, products) => {
  const entries = await Promise.all(
    REFERENCE_RULES.map(async (rule) => {
      const requestedIds = new Map();

      for (const product of products) {
        const values = rule.many
          ? Array.isArray(product[rule.field])
            ? product[rule.field]
            : []
          : [product[rule.field]];

        for (const value of values) {
          if (isObjectId(value)) {
            requestedIds.set(String(value), value);
          }
        }
      }

      if (requestedIds.size === 0) {
        return [rule.field, new Set()];
      }

      // No status or deletedAt filter: check existence only.
      const records = await database
        .collection(rule.collection)
        .find(
          {
            _id: {
              $in: [...requestedIds.values()],
            },
          },
          {
            projection: { _id: 1 },
            maxTimeMS: QUERY_TIMEOUT_MS,
          },
        )
        .toArray();

      return [rule.field, new Set(records.map((record) => String(record._id)))];
    }),
  );

  return Object.fromEntries(entries);
};

/*
|--------------------------------------------------------------------------
| Inspect Direct Catalog References
|--------------------------------------------------------------------------
*/

const inspectReferences = (product, existingReferences, issues) => {
  for (const rule of REFERENCE_RULES) {
    const value = product[rule.field];

    if (rule.many) {
      // An absent optional collections field behaves as an empty array.
      const values = value === undefined ? [] : value;

      if (!Array.isArray(values)) {
        issues.add("COLLECTIONS_NOT_ARRAY");
        continue;
      }

      const seenIds = new Set();

      for (const id of values) {
        if (!isObjectId(id)) {
          issues.add("INVALID_COLLECTION_ID");
          continue;
        }

        const idString = String(id);

        if (seenIds.has(idString)) {
          issues.add("DUPLICATE_COLLECTION_REFERENCE");
        }

        seenIds.add(idString);

        if (!existingReferences[rule.field].has(idString)) {
          issues.add("MISSING_COLLECTION_RECORD");
        }
      }

      continue;
    }

    if (!rule.required && (value === undefined || value === null)) {
      continue;
    }

    if (!isObjectId(value)) {
      issues.add(`INVALID_${rule.code}_ID`);
      continue;
    }

    if (!existingReferences[rule.field].has(String(value))) {
      issues.add(`MISSING_${rule.code}_RECORD`);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Inspect Variants and Inventory
|--------------------------------------------------------------------------
*/

const inspectVariants = (product, issues) => {
  if (!Array.isArray(product.variants)) {
    issues.add("VARIANTS_NOT_ARRAY");
    return;
  }

  if (
    product.variants.length === 0 ||
    product.variants.length > PRODUCT_LIMITS.MAX_VARIANTS
  ) {
    issues.add("INVALID_VARIANT_COUNT");
  }

  const seenIds = new Set();
  const seenSkus = new Set();
  const seenCombinations = new Set();

  for (const variant of product.variants) {
    if (!isRecord(variant)) {
      issues.add("INVALID_VARIANT_STRUCTURE");
      continue;
    }

    if (!isObjectId(variant._id)) {
      issues.add("INVALID_VARIANT_ID");
    } else {
      const id = String(variant._id);

      if (seenIds.has(id)) {
        issues.add("DUPLICATE_VARIANT_ID");
      }

      seenIds.add(id);
    }

    if (
      typeof variant.sku !== "string" ||
      variant.sku.length < 3 ||
      variant.sku.length > 100 ||
      !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(variant.sku)
    ) {
      issues.add("INVALID_VARIANT_SKU");
    }

    if (typeof variant.sku === "string") {
      const normalizedSku = variant.sku.trim().toUpperCase();

      if (seenSkus.has(normalizedSku)) {
        issues.add("DUPLICATE_VARIANT_SKU");
      }

      seenSkus.add(normalizedSku);
    }

    const size = typeof variant.size === "string" ? variant.size.trim() : "";

    const colorName =
      typeof variant.color?.name === "string" ? variant.color.name.trim() : "";

    const colorCode =
      typeof variant.color?.code === "string" ? variant.color.code.trim() : "";

    if (!size || size.length > 30) {
      issues.add("INVALID_VARIANT_SIZE");
    }

    if (
      !colorName ||
      colorName.length > 50 ||
      !/^#[0-9A-F]{6}$/.test(colorCode)
    ) {
      issues.add("INVALID_VARIANT_COLOR");
    }

    if (size && colorName && colorCode) {
      const combination = JSON.stringify([
        size.toLowerCase(),
        colorName.toLowerCase(),
        colorCode.toUpperCase(),
      ]);

      if (seenCombinations.has(combination)) {
        issues.add("DUPLICATE_SIZE_COLOR_COMBINATION");
      }

      seenCombinations.add(combination);
    }

    if (typeof variant.isActive !== "boolean") {
      issues.add("INVALID_VARIANT_ACTIVE_FLAG");
    }

    if (!isRecord(variant.inventory)) {
      issues.add("INVALID_INVENTORY_STRUCTURE");
      continue;
    }

    const { stock, reservedStock, lowStockThreshold } = variant.inventory;

    if (!isQuantity(stock)) {
      issues.add("INVALID_STOCK");
    }

    if (!isQuantity(reservedStock)) {
      issues.add("INVALID_RESERVED_STOCK");
    }

    if (!isQuantity(lowStockThreshold)) {
      issues.add("INVALID_LOW_STOCK_THRESHOLD");
    }

    if (
      isQuantity(stock) &&
      isQuantity(reservedStock) &&
      reservedStock > stock
    ) {
      issues.add("RESERVED_STOCK_EXCEEDS_STOCK");
    }
  }
};

/*
|--------------------------------------------------------------------------
| Run Read-Only Audit
|--------------------------------------------------------------------------
*/

const runAudit = async () => {
  let connection;
  let stage = "connect";

  try {
    connection = mongoose.createConnection(env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
      readPreference: "primary",
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 4,
    });

    await connection.asPromise();

    const database = connection.db;

    stage = "check-collections";

    const requiredCollections = [
      "products",
      ...REFERENCE_RULES.map((rule) => rule.collection),
    ];

    const existingCollections = await database
      .listCollections({}, { nameOnly: true })
      .toArray();

    const collectionNames = new Set(
      existingCollections.map((entry) => entry.name),
    );

    const missingCollections = requiredCollections.filter(
      (name) => !collectionNames.has(name),
    );

    if (missingCollections.length > 0) {
      console.log(
        JSON.stringify(
          {
            mode: "read-only",
            database: connection.name,
            status: "needs-attention",
            missingCollections,
            findings: [
              "Required catalog collections are absent; the data audit was not run.",
            ],
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
      return;
    }

    stage = "scan-products";

    const summary = {
      productsScanned: 0,
      variantEntriesScanned: 0,
      productsWithIssues: 0,
      productsByIssue: {},
    };

    const samples = [];

    const inspectBatch = async (products) => {
      const references = await loadReferences(database, products);

      for (const product of products) {
        summary.productsScanned += 1;

        if (Array.isArray(product.variants)) {
          summary.variantEntriesScanned += product.variants.length;
        }

        const issues = new Set();

        if (!isObjectId(product._id)) {
          issues.add("INVALID_PRODUCT_ID");
        }

        inspectReferences(product, references, issues);
        inspectVariants(product, issues);

        if (issues.size === 0) {
          continue;
        }

        summary.productsWithIssues += 1;

        // Each issue code counts affected Products, not occurrences.
        for (const code of issues) {
          summary.productsByIssue[code] =
            (summary.productsByIssue[code] ?? 0) + 1;
        }

        if (samples.length < SAMPLE_LIMIT) {
          samples.push({
            productId: isObjectId(product._id) ? String(product._id) : null,

            issueCodes: [...issues].sort(),
          });
        }
      }
    };

    const cursor = database.collection("products").find(
      {},
      {
        projection: {
          _id: 1,
          category: 1,
          brand: 1,
          sizeGuide: 1,
          collections: 1,

          "variants._id": 1,
          "variants.sku": 1,
          "variants.size": 1,
          "variants.color": 1,
          "variants.isActive": 1,
          "variants.inventory": 1,
        },

        batchSize: BATCH_SIZE,
        maxTimeMS: QUERY_TIMEOUT_MS,
      },
    );

    let batch = [];

    for await (const product of cursor) {
      batch.push(product);

      if (batch.length >= BATCH_SIZE) {
        await inspectBatch(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await inspectBatch(batch);
    }

    const passed = summary.productsWithIssues === 0;

    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          database: connection.name,
          scope: "product-inventory-and-direct-catalog-references",
          status: passed ? "pass" : "needs-attention",
          summary,
          sampleLimit: SAMPLE_LIMIT,
          samplesTruncated: summary.productsWithIssues > samples.length,
          samples,
        },
        null,
        2,
      ),
    );

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "audit-failed",
          stage,
          errorName: error.name,
          errorCode: error.code ?? null,
          message:
            "The audit could not complete. Check connectivity, read permissions, and query time limits.",
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};

await runAudit();
