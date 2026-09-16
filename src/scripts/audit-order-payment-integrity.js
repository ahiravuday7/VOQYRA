import mongoose from "mongoose";

import env from "../config/environment.js";

const BATCH_SIZE = 100;
const SAMPLE_LIMIT = 20;
const MAX_TIME_MS = 30_000;

const isObjectId = (value) => value?._bsontype === "ObjectId";

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const createSummary = () => ({
  documentsScanned: 0,
  documentsWithIssues: 0,
  documentsByIssue: {},
});

const recordIssues = (report, section, document, issues) => {
  const summary = report.summary[section];

  summary.documentsScanned += 1;

  if (issues.size === 0) {
    return;
  }

  summary.documentsWithIssues += 1;

  for (const issue of issues) {
    summary.documentsByIssue[issue] =
      (summary.documentsByIssue[issue] ?? 0) + 1;
  }

  if (report.samples.length < SAMPLE_LIMIT) {
    report.samples.push({
      collection: section,
      documentId: isObjectId(document._id) ? document._id.toHexString() : null,
      issueCodes: [...issues].sort(),
    });
  } else {
    report.samplesTruncated = true;
  }
};

const loadByIds = async (collection, values, projection) => {
  const uniqueIds = new Map();

  for (const value of values) {
    if (isObjectId(value)) {
      uniqueIds.set(value.toHexString(), value);
    }
  }

  if (uniqueIds.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...uniqueIds.values()],
        },
      },
      {
        projection,
        maxTimeMS: MAX_TIME_MS,
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [document._id.toHexString(), document]),
  );
};

const scanInBatches = async (collection, projection, inspectBatch) => {
  const cursor = collection.find(
    {},
    {
      projection,
      batchSize: BATCH_SIZE,
      maxTimeMS: MAX_TIME_MS,
    },
  );

  try {
    let batch = [];

    for await (const document of cursor) {
      batch.push(document);

      if (batch.length === BATCH_SIZE) {
        await inspectBatch(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await inspectBatch(batch);
    }
  } finally {
    await cursor.close();
  }
};

const auditDatabase = async (database) => {
  const report = {
    mode: "read-only",
    database: database.databaseName,
    scope: "order-customer-and-payment-order-integrity",
    status: "pass",
    summary: {
      orders: createSummary(),
      paymenttransactions: createSummary(),
    },
    sampleLimit: SAMPLE_LIMIT,
    samplesTruncated: false,
    samples: [],
    findings: [],
  };

  const requiredCollections = ["users", "orders", "paymenttransactions"];

  for (const name of requiredCollections) {
    const exists = await database
      .listCollections({ name }, { nameOnly: true })
      .hasNext();

    if (!exists) {
      report.findings.push(`Required collection is absent: ${name}`);
    }
  }

  if (report.findings.length > 0) {
    report.status = "needs-attention";
    return report;
  }

  const users = database.collection("users");
  const orders = database.collection("orders");
  const payments = database.collection("paymenttransactions");

  await scanInBatches(
    orders,
    {
      _id: 1,
      customer: 1,
    },
    async (batch) => {
      const customers = await loadByIds(
        users,
        batch.map((order) => order.customer),
        { _id: 1 },
      );

      for (const order of batch) {
        const issues = new Set();

        if (!isObjectId(order.customer)) {
          issues.add("INVALID_CUSTOMER_REFERENCE");
        } else if (!customers.has(order.customer.toHexString())) {
          issues.add("CUSTOMER_NOT_FOUND");
        }

        recordIssues(report, "orders", order, issues);
      }
    },
  );

  await scanInBatches(
    payments,
    {
      _id: 1,
      order: 1,
      orderNumber: 1,
      customer: 1,
      amount: 1,
      currency: 1,
      attemptNumber: 1,
    },
    async (batch) => {
      const [referencedOrders, customers] = await Promise.all([
        loadByIds(
          orders,
          batch.map((payment) => payment.order),
          {
            _id: 1,
            customer: 1,
            orderNumber: 1,
            "payment.method": 1,
            "totals.grandTotal": 1,
            "totals.currency": 1,
          },
        ),
        loadByIds(
          users,
          batch.map((payment) => payment.customer),
          { _id: 1 },
        ),
      ]);

      for (const payment of batch) {
        const issues = new Set();

        const validOrderReference = isObjectId(payment.order);
        const validCustomerReference = isObjectId(payment.customer);

        if (!validOrderReference) {
          issues.add("INVALID_ORDER_REFERENCE");
        }

        if (!validCustomerReference) {
          issues.add("INVALID_CUSTOMER_REFERENCE");
        } else if (!customers.has(payment.customer.toHexString())) {
          issues.add("CUSTOMER_NOT_FOUND");
        }

        if (!isPositiveInteger(payment.attemptNumber)) {
          issues.add("INVALID_ATTEMPT_NUMBER");
        }

        if (!isPositiveInteger(payment.amount)) {
          issues.add("INVALID_PAYMENT_AMOUNT");
        }

        if (
          !isNonEmptyString(payment.currency) ||
          payment.currency !== payment.currency.trim().toUpperCase()
        ) {
          issues.add("INVALID_PAYMENT_CURRENCY");
        }

        if (!isNonEmptyString(payment.orderNumber)) {
          issues.add("INVALID_PAYMENT_ORDER_NUMBER");
        }

        const order = validOrderReference
          ? referencedOrders.get(payment.order.toHexString())
          : undefined;

        if (validOrderReference && !order) {
          issues.add("ORDER_NOT_FOUND");
        }

        if (order) {
          if (!isObjectId(order.customer)) {
            issues.add("ORDER_CUSTOMER_REFERENCE_INVALID");
          } else if (
            validCustomerReference &&
            !order.customer.equals(payment.customer)
          ) {
            issues.add("PAYMENT_CUSTOMER_DIFFERS_FROM_ORDER");
          }

          if (!isNonEmptyString(order.orderNumber)) {
            issues.add("REFERENCED_ORDER_NUMBER_INVALID");
          } else if (payment.orderNumber !== order.orderNumber) {
            issues.add("PAYMENT_ORDER_NUMBER_MISMATCH");
          }

          if (order.payment?.method !== "online") {
            issues.add("PAYMENT_REFERENCES_NON_ONLINE_ORDER");
          }

          const grandTotal = order.totals?.grandTotal;

          if (!isPositiveInteger(grandTotal)) {
            issues.add("REFERENCED_ORDER_PAYMENT_AMOUNT_INVALID");
          } else if (payment.amount !== grandTotal) {
            issues.add("PAYMENT_AMOUNT_DIFFERS_FROM_ORDER");
          }

          const orderCurrency = order.totals?.currency;

          if (!isNonEmptyString(orderCurrency)) {
            issues.add("REFERENCED_ORDER_CURRENCY_INVALID");
          } else if (payment.currency !== orderCurrency.trim().toUpperCase()) {
            issues.add("PAYMENT_CURRENCY_DIFFERS_FROM_ORDER");
          }
        }

        recordIssues(report, "paymenttransactions", payment, issues);
      }
    },
  );

  const affectedDocuments =
    report.summary.orders.documentsWithIssues +
    report.summary.paymenttransactions.documentsWithIssues;

  if (affectedDocuments > 0) {
    report.status = "needs-attention";
    report.findings.push(
      "Order or PaymentTransaction integrity issues require review.",
    );
  }

  return report;
};

let connection;

try {
  connection = mongoose.createConnection(env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 4,
  });

  await connection.asPromise();

  const report = await auditDatabase(connection.db);

  console.log(JSON.stringify(report, null, 2));

  process.exitCode = report.status === "pass" ? 0 : 1;
} catch {
  console.error(
    JSON.stringify(
      {
        mode: "read-only",
        status: "audit-failed",
        message:
          "The audit could not complete. Check database connectivity and read permissions.",
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
} finally {
  if (connection) {
    try {
      await connection.close();
    } catch {
      console.error("The audit database connection could not close cleanly.");
      process.exitCode = 2;
    }
  }
}
