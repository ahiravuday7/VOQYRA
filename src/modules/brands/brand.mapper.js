/*
|--------------------------------------------------------------------------
| Normalize Brand Document
|--------------------------------------------------------------------------
|
| Supports both:
|
| - Mongoose documents
| - lean() query results
|--------------------------------------------------------------------------
*/

const normalizeBrandDocument = (brand) => {
  if (!brand) {
    return null;
  }

  if (typeof brand.toObject === "function") {
    return brand.toObject({
      virtuals: true,
    });
  }

  return brand;
};

/*
|--------------------------------------------------------------------------
| Map ObjectId
|--------------------------------------------------------------------------
*/

const mapObjectId = (value) => {
  if (!value) {
    return null;
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map Brand Logo
|--------------------------------------------------------------------------
*/

const mapBrandLogo = (logo) => {
  if (!logo) {
    return {
      url: "",
      publicId: "",
      altText: "",
    };
  }

  return {
    url: logo.url ?? "",
    publicId: logo.publicId ?? "",
    altText: logo.altText ?? "",
  };
};

/*
|--------------------------------------------------------------------------
| Public Brand Mapper
|--------------------------------------------------------------------------
|
| Public APIs must expose only customer-safe fields.
|
| Never expose:
|
| - createdBy
| - updatedBy
| - deletedBy
| - deletedAt
| - internal audit information
|--------------------------------------------------------------------------
*/

export const mapPublicBrand = (brand) => {
  const document = normalizeBrandDocument(brand);

  if (!document) {
    return null;
  }

  return {
    id: mapObjectId(document._id),

    name: document.name,

    slug: document.slug,

    description: document.description ?? "",

    logo: mapBrandLogo(document.logo),

    isFeatured: Boolean(document.isFeatured),

    sortOrder: document.sortOrder ?? 0,
  };
};

/*
|--------------------------------------------------------------------------
| Public Brand List Mapper
|--------------------------------------------------------------------------
*/

export const mapPublicBrands = (brands = []) => {
  return brands.map(mapPublicBrand);
};

/*
|--------------------------------------------------------------------------
| Admin Brand Mapper
|--------------------------------------------------------------------------
|
| Admin APIs can expose management and audit information.
|--------------------------------------------------------------------------
*/

export const mapAdminBrand = (brand) => {
  const document = normalizeBrandDocument(brand);

  if (!document) {
    return null;
  }

  return {
    id: mapObjectId(document._id),

    name: document.name,

    slug: document.slug,

    description: document.description ?? "",

    logo: mapBrandLogo(document.logo),

    status: document.status,

    isFeatured: Boolean(document.isFeatured),

    sortOrder: document.sortOrder ?? 0,

    isDeleted: Boolean(document.deletedAt),

    createdBy: mapObjectId(document.createdBy),

    updatedBy: mapObjectId(document.updatedBy),

    deletedBy: mapObjectId(document.deletedBy),

    deletedAt: document.deletedAt ?? null,

    createdAt: document.createdAt ?? null,

    updatedAt: document.updatedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Brand List Mapper
|--------------------------------------------------------------------------
*/

export const mapAdminBrands = (brands = []) => {
  return brands.map(mapAdminBrand);
};
