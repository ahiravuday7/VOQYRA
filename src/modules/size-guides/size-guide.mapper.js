/*
|--------------------------------------------------------------------------
| Normalize SizeGuide Document
|--------------------------------------------------------------------------
|
| Supports:
|
| - Mongoose documents
| - lean() query results
|--------------------------------------------------------------------------
*/

const normalizeSizeGuideDocument = (sizeGuide) => {
  if (!sizeGuide) {
    return null;
  }

  if (typeof sizeGuide.toObject === "function") {
    return sizeGuide.toObject({
      virtuals: true,
    });
  }

  return sizeGuide;
};

/*
|--------------------------------------------------------------------------
| Map ObjectId / Reference
|--------------------------------------------------------------------------
|
| Supports:
|
| ObjectId
|
| OR a populated object such as:
|
| {
|   _id: "...",
|   name: "T-Shirts"
| }
|--------------------------------------------------------------------------
*/

const mapReferenceId = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map SizeGuide Columns
|--------------------------------------------------------------------------
*/

const mapColumns = (columns = []) => {
  return columns.map((column) => ({
    key: column.key,

    label: column.label,

    sortOrder: column.sortOrder ?? 0,
  }));
};

/*
|--------------------------------------------------------------------------
| Map Measurements
|--------------------------------------------------------------------------
*/

const mapMeasurements = (measurements = []) => {
  return measurements.map((measurement) => ({
    key: measurement.key,

    value: measurement.value,
  }));
};

/*
|--------------------------------------------------------------------------
| Map SizeGuide Rows
|--------------------------------------------------------------------------
*/

const mapRows = (rows = []) => {
  return rows.map((row) => ({
    size: row.size,

    measurements: mapMeasurements(row.measurements),

    sortOrder: row.sortOrder ?? 0,
  }));
};

/*
|--------------------------------------------------------------------------
| Public SizeGuide Mapper
|--------------------------------------------------------------------------
|
| Public API deliberately excludes:
|
| - status
| - createdBy
| - updatedBy
| - deletedBy
| - deletedAt
| - internal audit information
|--------------------------------------------------------------------------
*/

export const mapPublicSizeGuide = (sizeGuide) => {
  const document = normalizeSizeGuideDocument(sizeGuide);

  if (!document) {
    return null;
  }

  return {
    id: mapReferenceId(document._id),

    name: document.name,

    slug: document.slug,

    description: document.description ?? "",

    category: mapReferenceId(document.category),

    unit: document.unit,

    columns: mapColumns(document.columns),

    rows: mapRows(document.rows),

    howToMeasure: document.howToMeasure ?? "",

    fitNote: document.fitNote ?? "",

    sortOrder: document.sortOrder ?? 0,
  };
};

/*
|--------------------------------------------------------------------------
| Public SizeGuide List Mapper
|--------------------------------------------------------------------------
*/

export const mapPublicSizeGuides = (sizeGuides = []) => {
  return sizeGuides.map(mapPublicSizeGuide);
};

/*
|--------------------------------------------------------------------------
| Admin SizeGuide Mapper
|--------------------------------------------------------------------------
|
| Admin responses include management and audit information.
|--------------------------------------------------------------------------
*/

export const mapAdminSizeGuide = (sizeGuide) => {
  const document = normalizeSizeGuideDocument(sizeGuide);

  if (!document) {
    return null;
  }

  return {
    id: mapReferenceId(document._id),

    name: document.name,

    slug: document.slug,

    description: document.description ?? "",

    category: mapReferenceId(document.category),

    unit: document.unit,

    columns: mapColumns(document.columns),

    rows: mapRows(document.rows),

    howToMeasure: document.howToMeasure ?? "",

    fitNote: document.fitNote ?? "",

    status: document.status,

    sortOrder: document.sortOrder ?? 0,

    isDeleted: Boolean(document.deletedAt),

    createdBy: mapReferenceId(document.createdBy),

    updatedBy: mapReferenceId(document.updatedBy),

    deletedBy: mapReferenceId(document.deletedBy),

    deletedAt: document.deletedAt ?? null,

    createdAt: document.createdAt ?? null,

    updatedAt: document.updatedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Admin SizeGuide List Mapper
|--------------------------------------------------------------------------
*/

export const mapAdminSizeGuides = (sizeGuides = []) => {
  return sizeGuides.map(mapAdminSizeGuide);
};
