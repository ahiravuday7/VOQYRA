import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import mongoose from "mongoose";

import env from "../config/environment.js";

/*
|--------------------------------------------------------------------------
| Disable Automatic Database Setup Before Loading Models
|--------------------------------------------------------------------------
*/

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const modulesDirectory = fileURLToPath(new URL("../modules/", import.meta.url));

const findModelFiles = async (directory) => {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findModelFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".model.js")) {
      files.push(entryPath);
    }
  }

  return files.sort();
};

const summarizeDatabaseIndex = (index) => ({
  name: index.name,
  key: index.key,
  unique: index.name === "_id_" || index.unique === true,
  sparse: index.sparse === true,
  hidden: index.hidden === true,
  expireAfterSeconds: index.expireAfterSeconds ?? null,
  partialFilterExpression: index.partialFilterExpression ?? null,
  collation: index.collation ?? null,
  weights: index.weights ?? null,
  defaultLanguage: index.default_language ?? null,
  languageOverride: index.language_override ?? null,
});

/*
|--------------------------------------------------------------------------
| Audit Model
|--------------------------------------------------------------------------
*/

const auditModel = async (model) => {
  const collectionName = model.collection.name;

  const collectionExists = await mongoose.connection.db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();

  const declaredIndexes = model.schema.indexes();

  if (!collectionExists) {
    return {
      model: model.modelName,
      collection: collectionName,
      collectionExists: false,
      declaredIndexCount: declaredIndexes.length,
      databaseIndexCount: 0,

      missingOrDifferentIndexes: declaredIndexes.map(([key, options]) => ({
        key,
        options,
      })),

      existingIndexesForReview: [],
      hiddenIndexNames: [],

      status: "needs-attention",
      findings: ["Collection and its declared indexes are absent."],
    };
  }

  const databaseIndexes = await mongoose.connection.db
    .collection(collectionName)
    .indexes();

  /*
   * diffIndexes reads index definitions.
   * It does not create, change, or drop indexes.
   */
  const difference = await model.diffIndexes({
    indexOptionsToCreate: true,
  });

  const missingOrDifferentIndexes = difference.toCreate.map(
    ([key, options]) => ({
      key,
      options,
    }),
  );

  /*
   * Mongoose calls these "toDrop".
   * We report them for review without performing that action.
   */
  const existingIndexesForReview = databaseIndexes
    .filter((index) => difference.toDrop.includes(index.name))
    .map(summarizeDatabaseIndex);

  const hiddenIndexNames = databaseIndexes
    .filter((index) => index.hidden === true)
    .map((index) => index.name);

  const findings = [];

  if (missingOrDifferentIndexes.length > 0) {
    findings.push(
      "Some declared indexes are missing or have different options.",
    );
  }

  if (existingIndexesForReview.length > 0) {
    findings.push(
      "Some database indexes are extra or differ from the model declarations.",
    );
  }

  if (hiddenIndexNames.length > 0) {
    findings.push(
      "Hidden indexes require review because queries cannot use them.",
    );
  }

  return {
    model: model.modelName,
    collection: collectionName,
    collectionExists: true,
    declaredIndexCount: declaredIndexes.length,
    databaseIndexCount: databaseIndexes.length,

    missingOrDifferentIndexes,
    existingIndexesForReview,
    hiddenIndexNames,

    status: findings.length === 0 ? "pass" : "needs-attention",
    findings,
  };
};

/*
|--------------------------------------------------------------------------
| Run Read-Only Audit
|--------------------------------------------------------------------------
*/

const runAudit = async () => {
  let stage = "load-models";
  let activeModel = null;

  try {
    const modelFiles = await findModelFiles(modulesDirectory);

    for (const modelFile of modelFiles) {
      await import(pathToFileURL(modelFile).href);
    }

    const models = mongoose
      .modelNames()
      .sort()
      .map((name) => mongoose.model(name));

    if (models.length === 0) {
      throw new Error("No models were discovered");
    }

    // Also disable any explicit schema-level automatic setup.
    for (const model of models) {
      model.schema.set("autoIndex", false);
      model.schema.set("autoCreate", false);
    }

    stage = "connect";

    await mongoose.connect(env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
      readPreference: "primary",
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 2,
    });

    stage = "audit-indexes";

    const results = [];

    for (const model of models) {
      activeModel = model.modelName;
      results.push(await auditModel(model));
    }

    const summary = {
      modelFilesLoaded: modelFiles.length,
      modelsAudited: results.length,

      modelsPassed: results.filter((result) => result.status === "pass").length,

      modelsNeedingAttention: results.filter(
        (result) => result.status !== "pass",
      ).length,

      missingCollections: results.filter((result) => !result.collectionExists)
        .length,

      missingOrDifferentIndexes: results.reduce(
        (total, result) => total + result.missingOrDifferentIndexes.length,
        0,
      ),

      existingIndexesForReview: results.reduce(
        (total, result) => total + result.existingIndexesForReview.length,
        0,
      ),

      hiddenIndexes: results.reduce(
        (total, result) => total + result.hiddenIndexNames.length,
        0,
      ),
    };

    const passed = summary.modelsNeedingAttention === 0;

    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          database: mongoose.connection.name,
          mongooseVersion: mongoose.version,
          status: passed ? "pass" : "needs-attention",
          summary,
          results,
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
          model: activeModel,
          errorName: error.name,
          errorCode: error.code ?? null,
          message:
            "The audit could not complete. Check model imports, database connectivity, and index-read permissions.",
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
};

await runAudit();
