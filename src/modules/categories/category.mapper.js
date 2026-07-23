/*
|--------------------------------------------------------------------------
| Object ID Mapper
|--------------------------------------------------------------------------
|
| Supports:
| - MongoDB ObjectId
| - Mongoose document
| - Populated document
| - null or undefined
|--------------------------------------------------------------------------
*/

const mapObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Category Image Mapper
|--------------------------------------------------------------------------
*/

const mapCategoryImage = (image) => {
  return {
    url: image?.url ?? "",
    publicId: image?.publicId ?? "",
    altText: image?.altText ?? "",
  };
};

/*
|--------------------------------------------------------------------------
| Category SEO Mapper
|--------------------------------------------------------------------------
*/

const mapCategorySeo = (seo) => {
  return {
    metaTitle: seo?.metaTitle ?? "",
    metaDescription: seo?.metaDescription ?? "",
    keywords: seo?.keywords ?? [],
  };
};

/*
|--------------------------------------------------------------------------
| Admin Category Mapper
|--------------------------------------------------------------------------
|
| Returns category data allowed in admin responses.
|--------------------------------------------------------------------------
*/

export const toAdminCategory = (category) => {
  if (!category) {
    return null;
  }

  /*
   * Convert a Mongoose document into a plain object.
   */
  const categoryObject =
    typeof category.toObject === "function"
      ? category.toObject({
          virtuals: true,
        })
      : category;

  return {
    id: mapObjectId(categoryObject._id),

    name: categoryObject.name,
    slug: categoryObject.slug,

    description: categoryObject.description ?? "",

    parent: mapObjectId(categoryObject.parent),

    ancestors: (categoryObject.ancestors ?? []).map(mapObjectId),

    level: categoryObject.level,

    image: mapCategoryImage(categoryObject.image),

    bannerImage: mapCategoryImage(categoryObject.bannerImage),

    seo: mapCategorySeo(categoryObject.seo),

    status: categoryObject.status,

    isFeatured: categoryObject.isFeatured,

    sortOrder: categoryObject.sortOrder,

    isRoot: categoryObject.isRoot ?? !categoryObject.parent,

    isDeleted: categoryObject.isDeleted ?? Boolean(categoryObject.deletedAt),

    createdBy: mapObjectId(categoryObject.createdBy),

    updatedBy: mapObjectId(categoryObject.updatedBy),

    deletedAt: categoryObject.deletedAt ?? null,

    deletedBy: mapObjectId(categoryObject.deletedBy),

    createdAt: categoryObject.createdAt,

    updatedAt: categoryObject.updatedAt,
  };
};
