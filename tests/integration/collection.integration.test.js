import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

/*
|--------------------------------------------------------------------------
| Test URLs
|--------------------------------------------------------------------------
*/

const adminCollectionUrl = "/api/v1/admin/collections";

const publicCollectionUrl = "/api/v1/collections";

/*
|--------------------------------------------------------------------------
| Test Helpers
|--------------------------------------------------------------------------
*/

const createCollectionRequest = (agent, collectionData) => {
  return agent.post(adminCollectionUrl).send(collectionData);
};

/*
|--------------------------------------------------------------------------
| Collection API Integration
|--------------------------------------------------------------------------
*/

describe("Collection API integration", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("rejects an unauthenticated admin collection request", async () => {
    const response = await request(app)
      .post(adminCollectionUrl)
      .send({
        name: "New Arrivals",

        slug: "new-arrivals",
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");
  });

  /*
    |--------------------------------------------------------------------------
    | Authorization
    |--------------------------------------------------------------------------
    */

  it("rejects a customer accessing admin collection routes", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await createCollectionRequest(agent, {
      name: "New Arrivals",

      slug: "new-arrivals",
    }).expect(403);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");
  });

  /*
    |--------------------------------------------------------------------------
    | Create Collection
    |--------------------------------------------------------------------------
    */

  it("creates a collection with admin and audit information", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const response = await createCollectionRequest(agent, {
      name: "Festive Collection",

      slug: "festive-collection",

      description: "Styles curated for festive occasions.",

      banner: {
        url: "https://example.com/festive.jpg",

        publicId: "collections/festive",

        altText: "Festive Collection",
      },

      status: "active",

      isFeatured: true,

      sortOrder: 2,
    }).expect(201);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Collection created successfully");

    const collection = response.body.data.collection;

    expect(collection.id).toBeDefined();

    expect(collection.name).toBe("Festive Collection");

    expect(collection.slug).toBe("festive-collection");

    expect(collection.description).toBe(
      "Styles curated for festive occasions.",
    );

    expect(collection.banner).toEqual({
      url: "https://example.com/festive.jpg",

      publicId: "collections/festive",

      altText: "Festive Collection",
    });

    expect(collection.status).toBe("active");

    expect(collection.isFeatured).toBe(true);

    expect(collection.sortOrder).toBe(2);

    expect(collection.isDeleted).toBe(false);

    expect(collection.createdBy).toBe(String(user._id));

    expect(collection.updatedBy).toBe(String(user._id));

    expect(collection.deletedBy).toBeNull();

    expect(collection.deletedAt).toBeNull();

    expect(collection.createdAt).toBeDefined();

    expect(collection.updatedAt).toBeDefined();
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Slug
    |--------------------------------------------------------------------------
    */

  it("rejects a duplicate collection slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCollectionRequest(agent, {
      name: "New Arrivals",

      slug: "new-arrivals",
    }).expect(201);

    const response = await createCollectionRequest(agent, {
      name: "Latest Products",

      slug: "new-arrivals",
    }).expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("COLLECTION_SLUG_ALREADY_EXISTS");
  });

  /*
    |--------------------------------------------------------------------------
    | Protected / Invalid Fields
    |--------------------------------------------------------------------------
    */

  it("rejects invalid and backend-controlled collection fields", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
        |--------------------------------------------------------------------------
        | createdBy
        |--------------------------------------------------------------------------
        */

    const protectedFieldResponse = await createCollectionRequest(agent, {
      name: "Protected Collection",

      slug: "protected-collection",

      createdBy: String(user._id),
    }).expect(400);

    expect(protectedFieldResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
        |--------------------------------------------------------------------------
        | Invalid Banner URL
        |--------------------------------------------------------------------------
        */

    const invalidUrlResponse = await createCollectionRequest(agent, {
      name: "Invalid Banner",

      slug: "invalid-banner",

      banner: {
        url: "javascript:alert(1)",
      },
    }).expect(400);

    expect(invalidUrlResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
        |--------------------------------------------------------------------------
        | Negative sortOrder
        |--------------------------------------------------------------------------
        */

    const sortResponse = await createCollectionRequest(agent, {
      name: "Invalid Sort",

      slug: "invalid-sort",

      sortOrder: -1,
    }).expect(400);

    expect(sortResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Update + Partial Banner Merge
    |--------------------------------------------------------------------------
    */

  it("updates a collection and preserves untouched banner fields", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createCollectionRequest(agent, {
      name: "Summer Collection",

      slug: "summer-collection",

      description: "Original description",

      banner: {
        url: "https://example.com/summer.jpg",

        publicId: "collections/summer",

        altText: "Summer",
      },
    }).expect(201);

    const collection = createResponse.body.data.collection;

    const updateResponse = await agent
      .patch(`${adminCollectionUrl}/${collection.id}`)
      .send({
        name: "Summer Essentials",

        slug: "summer-essentials",

        banner: {
          altText: "Summer Essentials",
        },
      })
      .expect(200);

    const updatedCollection = updateResponse.body.data.collection;

    expect(updatedCollection.id).toBe(collection.id);

    expect(updatedCollection.name).toBe("Summer Essentials");

    expect(updatedCollection.slug).toBe("summer-essentials");

    expect(updatedCollection.banner).toEqual({
      url: "https://example.com/summer.jpg",

      publicId: "collections/summer",

      altText: "Summer Essentials",
    });

    /*
        |--------------------------------------------------------------------------
        | Old Slug
        |--------------------------------------------------------------------------
        */

    const oldSlugResponse = await request(app)
      .get(`${publicCollectionUrl}/summer-collection`)
      .expect(404);

    expect(oldSlugResponse.body.errorCode).toBe("COLLECTION_NOT_FOUND");

    /*
        |--------------------------------------------------------------------------
        | New Slug
        |--------------------------------------------------------------------------
        */

    const newSlugResponse = await request(app)
      .get(`${publicCollectionUrl}/summer-essentials`)
      .expect(200);

    expect(newSlugResponse.body.data.collection.slug).toBe("summer-essentials");
  });

  /*
    |--------------------------------------------------------------------------
    | Empty Update
    |--------------------------------------------------------------------------
    */

  it("rejects an empty collection update", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createCollectionRequest(agent, {
      name: "Best Sellers",

      slug: "best-sellers",
    }).expect(201);

    const collection = createResponse.body.data.collection;

    const response = await agent
      .patch(`${adminCollectionUrl}/${collection.id}`)
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Public Visibility
    |--------------------------------------------------------------------------
    */

  it("returns only active collections publicly and hides admin fields", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
     * Active featured.
     */
    const festiveResponse = await createCollectionRequest(agent, {
      name: "Festive Collection",

      slug: "festive-collection",

      status: "active",

      isFeatured: true,

      sortOrder: 1,
    }).expect(201);

    /*
     * Active normal.
     */
    await createCollectionRequest(agent, {
      name: "Office Wear",

      slug: "office-wear",

      status: "active",

      isFeatured: false,

      sortOrder: 2,
    }).expect(201);

    /*
     * Inactive.
     */
    await createCollectionRequest(agent, {
      name: "Draft Collection",

      slug: "draft-collection",

      status: "inactive",

      isFeatured: true,

      sortOrder: 3,
    }).expect(201);

    /*
        |--------------------------------------------------------------------------
        | Public List
        |--------------------------------------------------------------------------
        */

    const publicResponse = await request(app)
      .get(publicCollectionUrl)
      .expect(200);

    const collections = publicResponse.body.data.collections;

    expect(collections).toHaveLength(2);

    expect(collections.map((collection) => collection.slug)).toEqual([
      "festive-collection",
      "office-wear",
    ]);

    const festiveCollection = collections.find(
      (collection) => collection.slug === "festive-collection",
    );

    expect(festiveCollection.id).toBe(festiveResponse.body.data.collection.id);

    /*
     * Admin fields hidden.
     */
    expect(festiveCollection).not.toHaveProperty("status");

    expect(festiveCollection).not.toHaveProperty("createdBy");

    expect(festiveCollection).not.toHaveProperty("updatedBy");

    expect(festiveCollection).not.toHaveProperty("deletedBy");

    expect(festiveCollection).not.toHaveProperty("deletedAt");

    /*
        |--------------------------------------------------------------------------
        | Featured Filter
        |--------------------------------------------------------------------------
        */

    const featuredResponse = await request(app)
      .get(`${publicCollectionUrl}?isFeatured=true`)
      .expect(200);

    expect(featuredResponse.body.data.collections).toHaveLength(1);

    expect(featuredResponse.body.data.collections[0].slug).toBe(
      "festive-collection",
    );

    /*
        |--------------------------------------------------------------------------
        | Inactive Collection
        |--------------------------------------------------------------------------
        */

    const inactiveResponse = await request(app)
      .get(`${publicCollectionUrl}/draft-collection`)
      .expect(404);

    expect(inactiveResponse.body.errorCode).toBe("COLLECTION_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Soft Delete + Restore
    |--------------------------------------------------------------------------
    */

  it("soft deletes and restores a collection while controlling public visibility", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createCollectionRequest(agent, {
      name: "New Arrivals",

      slug: "new-arrivals",

      status: "active",
    }).expect(201);

    const collection = createResponse.body.data.collection;

    /*
     * Initially public.
     */
    await request(app).get(`${publicCollectionUrl}/new-arrivals`).expect(200);

    /*
        |--------------------------------------------------------------------------
        | Delete
        |--------------------------------------------------------------------------
        */

    const deleteResponse = await agent
      .delete(`${adminCollectionUrl}/${collection.id}`)
      .expect(200);

    const deletedCollection = deleteResponse.body.data.collection;

    expect(deletedCollection.isDeleted).toBe(true);

    expect(deletedCollection.deletedAt).not.toBeNull();

    expect(deletedCollection.deletedBy).not.toBeNull();

    /*
     * Publicly hidden.
     */
    await request(app).get(`${publicCollectionUrl}/new-arrivals`).expect(404);

    /*
     * Default admin detail hides deleted.
     */
    await agent.get(`${adminCollectionUrl}/${collection.id}`).expect(404);

    /*
     * includeDeleted allows access.
     */
    const deletedAdminResponse = await agent
      .get(`${adminCollectionUrl}/${collection.id}?includeDeleted=true`)
      .expect(200);

    expect(deletedAdminResponse.body.data.collection.isDeleted).toBe(true);

    /*
        |--------------------------------------------------------------------------
        | Restore
        |--------------------------------------------------------------------------
        */

    const restoreResponse = await agent
      .patch(`${adminCollectionUrl}/${collection.id}/restore`)
      .send({})
      .expect(200);

    const restoredCollection = restoreResponse.body.data.collection;

    expect(restoredCollection.isDeleted).toBe(false);

    expect(restoredCollection.deletedAt).toBeNull();

    expect(restoredCollection.deletedBy).toBeNull();

    /*
     * Public again.
     */
    await request(app).get(`${publicCollectionUrl}/new-arrivals`).expect(200);
  });

  /*
    |--------------------------------------------------------------------------
    | Unknown Collection
    |--------------------------------------------------------------------------
    */

  it("returns COLLECTION_NOT_FOUND for unknown collections", async () => {
    const { agent } = await createAuthenticatedAgent();

    const unknownId = "507f1f77bcf86cd799439011";

    const adminResponse = await agent
      .get(`${adminCollectionUrl}/${unknownId}`)
      .expect(404);

    expect(adminResponse.body.errorCode).toBe("COLLECTION_NOT_FOUND");

    const publicResponse = await request(app)
      .get(`${publicCollectionUrl}/unknown-collection`)
      .expect(404);

    expect(publicResponse.body.errorCode).toBe("COLLECTION_NOT_FOUND");
  });

  /*
|--------------------------------------------------------------------------
| Admin Pagination + Sorting
|--------------------------------------------------------------------------
*/

  it("supports admin collection pagination and sorting", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCollectionRequest(agent, {
      name: "Zulu Collection",
      slug: "zulu-collection",
      sortOrder: 30,
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Alpha Collection",
      slug: "alpha-collection",
      sortOrder: 10,
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Beta Collection",
      slug: "beta-collection",
      sortOrder: 20,
    }).expect(201);

    const response = await agent
      .get(`${adminCollectionUrl}?page=1&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    const { collections, pagination } = response.body.data;

    expect(collections).toHaveLength(2);

    expect(collections.map((collection) => collection.name)).toEqual([
      "Alpha Collection",
      "Beta Collection",
    ]);

    expect(pagination.page).toBe(1);

    expect(pagination.limit).toBe(2);

    expect(pagination.totalItems).toBe(3);

    expect(pagination.totalPages).toBe(2);

    expect(pagination.hasPreviousPage).toBe(false);

    expect(pagination.hasNextPage).toBe(true);

    const secondPageResponse = await agent
      .get(`${adminCollectionUrl}?page=2&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(secondPageResponse.body.data.collections).toHaveLength(1);

    expect(secondPageResponse.body.data.collections[0].name).toBe(
      "Zulu Collection",
    );

    expect(secondPageResponse.body.data.pagination.hasPreviousPage).toBe(true);

    expect(secondPageResponse.body.data.pagination.hasNextPage).toBe(false);
  });

  /*
|--------------------------------------------------------------------------
| Search
|--------------------------------------------------------------------------
*/

  it("searches collections by name, slug and description while treating regex characters literally", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCollectionRequest(agent, {
      name: "Summer Essentials",

      slug: "summer-essentials",

      description: "Lightweight clothing for summer.",
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Office Wear",

      slug: "professional-office",

      description: "Formal business styles.",
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Regex .* Collection",

      slug: "regex-collection",

      description: "Literal regular expression example.",
    }).expect(201);

    /*
     * Search by name.
     */
    const nameResponse = await agent
      .get(`${adminCollectionUrl}?search=summer`)
      .expect(200);

    expect(nameResponse.body.data.collections).toHaveLength(1);

    expect(nameResponse.body.data.collections[0].slug).toBe(
      "summer-essentials",
    );

    /*
     * Search by slug.
     */
    const slugResponse = await agent
      .get(`${adminCollectionUrl}?search=professional-office`)
      .expect(200);

    expect(slugResponse.body.data.collections).toHaveLength(1);

    expect(slugResponse.body.data.collections[0].name).toBe("Office Wear");

    /*
     * Search by description.
     */
    const descriptionResponse = await agent
      .get(`${adminCollectionUrl}?search=business`)
      .expect(200);

    expect(descriptionResponse.body.data.collections).toHaveLength(1);

    expect(descriptionResponse.body.data.collections[0].slug).toBe(
      "professional-office",
    );

    /*
     * Regex characters must be literal.
     *
     * If search were executed directly as regex,
     * .* would match almost everything.
     */
    const regexSearch = encodeURIComponent(".*");

    const regexResponse = await agent
      .get(`${adminCollectionUrl}?search=${regexSearch}`)
      .expect(200);

    expect(regexResponse.body.data.collections).toHaveLength(1);

    expect(regexResponse.body.data.collections[0].slug).toBe(
      "regex-collection",
    );
  });

  /*
|--------------------------------------------------------------------------
| Status + Featured Filters
|--------------------------------------------------------------------------
*/

  it("filters admin collections by status and featured state", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCollectionRequest(agent, {
      name: "Featured Active",

      slug: "featured-active",

      status: "active",

      isFeatured: true,
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Normal Active",

      slug: "normal-active",

      status: "active",

      isFeatured: false,
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Featured Draft",

      slug: "featured-draft",

      status: "inactive",

      isFeatured: true,
    }).expect(201);

    const activeResponse = await agent
      .get(`${adminCollectionUrl}?status=active`)
      .expect(200);

    expect(activeResponse.body.data.collections).toHaveLength(2);

    const inactiveResponse = await agent
      .get(`${adminCollectionUrl}?status=inactive`)
      .expect(200);

    expect(inactiveResponse.body.data.collections).toHaveLength(1);

    expect(inactiveResponse.body.data.collections[0].slug).toBe(
      "featured-draft",
    );

    const featuredResponse = await agent
      .get(`${adminCollectionUrl}?isFeatured=true`)
      .expect(200);

    expect(featuredResponse.body.data.collections).toHaveLength(2);

    const combinedResponse = await agent
      .get(`${adminCollectionUrl}?status=active&isFeatured=true`)
      .expect(200);

    expect(combinedResponse.body.data.collections).toHaveLength(1);

    expect(combinedResponse.body.data.collections[0].slug).toBe(
      "featured-active",
    );
  });

  /*
|--------------------------------------------------------------------------
| Public Featured Filters
|--------------------------------------------------------------------------
*/

  it("supports public featured and non-featured collection filters while excluding inactive collections", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCollectionRequest(agent, {
      name: "Featured Public",

      slug: "featured-public",

      status: "active",

      isFeatured: true,
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Normal Public",

      slug: "normal-public",

      status: "active",

      isFeatured: false,
    }).expect(201);

    await createCollectionRequest(agent, {
      name: "Hidden Featured",

      slug: "hidden-featured",

      status: "inactive",

      isFeatured: true,
    }).expect(201);

    const featuredResponse = await request(app)
      .get(`${publicCollectionUrl}?isFeatured=true`)
      .expect(200);

    expect(featuredResponse.body.data.collections).toHaveLength(1);

    expect(featuredResponse.body.data.collections[0].slug).toBe(
      "featured-public",
    );

    const normalResponse = await request(app)
      .get(`${publicCollectionUrl}?isFeatured=false`)
      .expect(200);

    expect(normalResponse.body.data.collections).toHaveLength(1);

    expect(normalResponse.body.data.collections[0].slug).toBe("normal-public");
  });

  /*
|--------------------------------------------------------------------------
| Deleted Filters
|--------------------------------------------------------------------------
*/

  it("supports exclude, only and include deleted collection filters", async () => {
    const { agent } = await createAuthenticatedAgent();

    const activeResponse = await createCollectionRequest(agent, {
      name: "Active Collection",

      slug: "active-collection",
    }).expect(201);

    const deletedCreateResponse = await createCollectionRequest(agent, {
      name: "Deleted Collection",

      slug: "deleted-collection",
    }).expect(201);

    await agent
      .delete(
        `${adminCollectionUrl}/${deletedCreateResponse.body.data.collection.id}`,
      )
      .expect(200);

    /*
     * Default = exclude.
     */
    const defaultResponse = await agent.get(adminCollectionUrl).expect(200);

    expect(defaultResponse.body.data.collections).toHaveLength(1);

    expect(defaultResponse.body.data.collections[0].id).toBe(
      activeResponse.body.data.collection.id,
    );

    /*
     * only
     */
    const onlyDeletedResponse = await agent
      .get(`${adminCollectionUrl}?deleted=only`)
      .expect(200);

    expect(onlyDeletedResponse.body.data.collections).toHaveLength(1);

    expect(onlyDeletedResponse.body.data.collections[0].slug).toBe(
      "deleted-collection",
    );

    expect(onlyDeletedResponse.body.data.collections[0].isDeleted).toBe(true);

    /*
     * include
     */
    const includeResponse = await agent
      .get(`${adminCollectionUrl}?deleted=include`)
      .expect(200);

    expect(includeResponse.body.data.collections).toHaveLength(2);
  });

  /*
|--------------------------------------------------------------------------
| Deleted Slug Reservation
|--------------------------------------------------------------------------
*/

  it("keeps a collection slug reserved after soft deletion", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createCollectionRequest(agent, {
      name: "Seasonal Collection",

      slug: "seasonal-collection",
    }).expect(201);

    await agent
      .delete(`${adminCollectionUrl}/${createResponse.body.data.collection.id}`)
      .expect(200);

    const duplicateResponse = await createCollectionRequest(agent, {
      name: "Another Seasonal Collection",

      slug: "seasonal-collection",
    }).expect(409);

    expect(duplicateResponse.body.errorCode).toBe(
      "COLLECTION_SLUG_ALREADY_EXISTS",
    );
  });

  /*
|--------------------------------------------------------------------------
| Update Slug Collision
|--------------------------------------------------------------------------
*/

  it("rejects changing a collection slug to another existing collection slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCollectionRequest(agent, {
      name: "New Arrivals",

      slug: "new-arrivals",
    }).expect(201);

    const secondResponse = await createCollectionRequest(agent, {
      name: "Latest Fashion",

      slug: "latest-fashion",
    }).expect(201);

    const response = await agent
      .patch(`${adminCollectionUrl}/${secondResponse.body.data.collection.id}`)
      .send({
        slug: "new-arrivals",
      })
      .expect(409);

    expect(response.body.errorCode).toBe("COLLECTION_SLUG_ALREADY_EXISTS");

    /*
     * Original slug must remain unchanged.
     */
    const detailResponse = await agent
      .get(`${adminCollectionUrl}/${secondResponse.body.data.collection.id}`)
      .expect(200);

    expect(detailResponse.body.data.collection.slug).toBe("latest-fashion");
  });

  /*
|--------------------------------------------------------------------------
| Idempotent Delete
|--------------------------------------------------------------------------
*/

  it("keeps original deletion metadata when deleting a collection repeatedly", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createCollectionRequest(agent, {
      name: "Temporary Collection",

      slug: "temporary-collection",
    }).expect(201);

    const collectionId = createResponse.body.data.collection.id;

    const firstDelete = await agent
      .delete(`${adminCollectionUrl}/${collectionId}`)
      .expect(200);

    const secondDelete = await agent
      .delete(`${adminCollectionUrl}/${collectionId}`)
      .expect(200);

    const firstCollection = firstDelete.body.data.collection;

    const secondCollection = secondDelete.body.data.collection;

    expect(secondCollection.isDeleted).toBe(true);

    expect(secondCollection.deletedAt).toBe(firstCollection.deletedAt);

    expect(secondCollection.deletedBy).toBe(firstCollection.deletedBy);
  });

  /*
|--------------------------------------------------------------------------
| Idempotent Restore
|--------------------------------------------------------------------------
*/

  it("allows restoring an already restored collection without changing deletion state", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createCollectionRequest(agent, {
      name: "Restore Collection",

      slug: "restore-collection",
    }).expect(201);

    const collectionId = createResponse.body.data.collection.id;

    await agent.delete(`${adminCollectionUrl}/${collectionId}`).expect(200);

    const firstRestore = await agent
      .patch(`${adminCollectionUrl}/${collectionId}/restore`)
      .send({})
      .expect(200);

    const secondRestore = await agent
      .patch(`${adminCollectionUrl}/${collectionId}/restore`)
      .send({})
      .expect(200);

    expect(firstRestore.body.data.collection.isDeleted).toBe(false);

    expect(secondRestore.body.data.collection.isDeleted).toBe(false);

    expect(secondRestore.body.data.collection.deletedAt).toBeNull();

    expect(secondRestore.body.data.collection.deletedBy).toBeNull();
  });

  /*
|--------------------------------------------------------------------------
| Query Validation
|--------------------------------------------------------------------------
*/

  it("rejects invalid admin and public collection query parameters", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
     * Invalid page.
     */
    const pageResponse = await agent
      .get(`${adminCollectionUrl}?page=0`)
      .expect(400);

    expect(pageResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
     * Invalid limit.
     */
    await agent.get(`${adminCollectionUrl}?limit=101`).expect(400);

    /*
     * Invalid status.
     */
    await agent.get(`${adminCollectionUrl}?status=archived`).expect(400);

    /*
     * Invalid featured boolean.
     */
    await agent.get(`${adminCollectionUrl}?isFeatured=1`).expect(400);

    /*
     * Invalid deleted mode.
     */
    await agent.get(`${adminCollectionUrl}?deleted=yes`).expect(400);

    /*
     * Unsupported sorting field.
     */
    await agent.get(`${adminCollectionUrl}?sortBy=slug`).expect(400);

    /*
     * Public schema is strict.
     *
     * status is intentionally not a public filter.
     */
    const publicResponse = await request(app)
      .get(`${publicCollectionUrl}?status=active`)
      .expect(400);

    expect(publicResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });
});
