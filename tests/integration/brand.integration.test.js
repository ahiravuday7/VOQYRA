import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

/*
|--------------------------------------------------------------------------
| Test Helpers
|--------------------------------------------------------------------------
*/

const adminBrandUrl = "/api/v1/admin/brands";

const publicBrandUrl = "/api/v1/brands";

const createBrandRequest = (agent, brandData) => {
  return agent.post(adminBrandUrl).send(brandData);
};

/*
|--------------------------------------------------------------------------
| Brand API Integration Tests
|--------------------------------------------------------------------------
*/

describe("Brand API integration", () => {
  /*
  |--------------------------------------------------------------------------
  | Admin Authentication
  |--------------------------------------------------------------------------
  */

  it("rejects an unauthenticated admin brand request", async () => {
    const response = await request(app)
      .post(adminBrandUrl)
      .send({
        name: "Nike",
        slug: "nike",
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");
  });

  /*
  |--------------------------------------------------------------------------
  | Admin Authorization
  |--------------------------------------------------------------------------
  */

  it("rejects a customer accessing admin brand routes", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await createBrandRequest(agent, {
      name: "Nike",
      slug: "nike",
    }).expect(403);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");
  });

  /*
  |--------------------------------------------------------------------------
  | Create Brand
  |--------------------------------------------------------------------------
  */

  it("creates a brand with admin and audit information", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const response = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      description: "Sportswear and lifestyle brand",

      logo: {
        url: "https://example.com/nike.png",

        publicId: "brands/nike",

        altText: "Nike logo",
      },

      status: "active",

      isFeatured: true,

      sortOrder: 1,
    }).expect(201);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Brand created successfully");

    const brand = response.body.data.brand;

    expect(brand.id).toBeDefined();

    expect(brand.name).toBe("Nike");

    expect(brand.slug).toBe("nike");

    expect(brand.description).toBe("Sportswear and lifestyle brand");

    expect(brand.logo).toEqual({
      url: "https://example.com/nike.png",

      publicId: "brands/nike",

      altText: "Nike logo",
    });

    expect(brand.status).toBe("active");

    expect(brand.isFeatured).toBe(true);

    expect(brand.sortOrder).toBe(1);

    expect(brand.isDeleted).toBe(false);

    expect(brand.createdBy).toBe(String(user._id));

    expect(brand.updatedBy).toBe(String(user._id));

    expect(brand.deletedBy).toBeNull();

    expect(brand.deletedAt).toBeNull();

    expect(brand.createdAt).toBeDefined();

    expect(brand.updatedAt).toBeDefined();
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Slug
  |--------------------------------------------------------------------------
  */

  it("rejects a duplicate brand slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createBrandRequest(agent, {
      name: "Nike",
      slug: "nike",
    }).expect(201);

    const response = await createBrandRequest(agent, {
      name: "Nike India",
      slug: "nike",
    }).expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("BRAND_SLUG_ALREADY_EXISTS");
  });

  /*
  |--------------------------------------------------------------------------
  | Create Brand Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid and protected brand creation fields", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Backend-Controlled Field
    |--------------------------------------------------------------------------
    */

    const protectedFieldResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      createdBy: String(user._id),
    }).expect(400);

    expect(protectedFieldResponse.body.success).toBe(false);

    expect(protectedFieldResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
    |--------------------------------------------------------------------------
    | Invalid Slug
    |--------------------------------------------------------------------------
    */

    const invalidSlugResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "Nike Sports",
    }).expect(400);

    expect(invalidSlugResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
    |--------------------------------------------------------------------------
    | Invalid Logo URL
    |--------------------------------------------------------------------------
    */

    const invalidUrlResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      logo: {
        url: "javascript:alert(1)",
      },
    }).expect(400);

    expect(invalidUrlResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
    |--------------------------------------------------------------------------
    | Negative Sort Order
    |--------------------------------------------------------------------------
    */

    const invalidSortResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      sortOrder: -1,
    }).expect(400);

    expect(invalidSortResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Update Brand
  |--------------------------------------------------------------------------
  */

  it("updates a brand and correctly changes its public slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      description: "Original description",

      logo: {
        url: "https://example.com/nike.png",

        publicId: "brands/nike",

        altText: "Nike",
      },
    }).expect(201);

    const brand = createResponse.body.data.brand;

    /*
    |--------------------------------------------------------------------------
    | Partial Update
    |--------------------------------------------------------------------------
    */

    const updateResponse = await agent
      .patch(`${adminBrandUrl}/${brand.id}`)
      .send({
        name: "Nike Sports",

        slug: "nike-sports",

        logo: {
          altText: "Official Nike logo",
        },
      })
      .expect(200);

    const updatedBrand = updateResponse.body.data.brand;

    expect(updatedBrand.id).toBe(brand.id);

    expect(updatedBrand.name).toBe("Nike Sports");

    expect(updatedBrand.slug).toBe("nike-sports");

    /*
     * Partial logo update must preserve
     * existing url and publicId.
     */
    expect(updatedBrand.logo).toEqual({
      url: "https://example.com/nike.png",

      publicId: "brands/nike",

      altText: "Official Nike logo",
    });

    /*
    |--------------------------------------------------------------------------
    | Old Public Slug Is Gone
    |--------------------------------------------------------------------------
    */

    const oldSlugResponse = await request(app)
      .get(`${publicBrandUrl}/nike`)
      .expect(404);

    expect(oldSlugResponse.body.errorCode).toBe("BRAND_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | New Public Slug Works
    |--------------------------------------------------------------------------
    */

    const newSlugResponse = await request(app)
      .get(`${publicBrandUrl}/nike-sports`)
      .expect(200);

    expect(newSlugResponse.body.data.brand.id).toBe(brand.id);

    expect(newSlugResponse.body.data.brand.slug).toBe("nike-sports");
  });

  /*
  |--------------------------------------------------------------------------
  | Empty Update Validation
  |--------------------------------------------------------------------------
  */

  it("rejects an empty brand update", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createBrandRequest(agent, {
      name: "Nike",
      slug: "nike",
    }).expect(201);

    const brand = createResponse.body.data.brand;

    const response = await agent
      .patch(`${adminBrandUrl}/${brand.id}`)
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Public Brand Visibility
  |--------------------------------------------------------------------------
  */

  it("returns only active brands publicly and hides admin fields", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
     * Featured active Brand.
     */
    const nikeResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      status: "active",

      isFeatured: true,

      sortOrder: 1,
    }).expect(201);

    /*
     * Normal active Brand.
     */
    await createBrandRequest(agent, {
      name: "Puma",

      slug: "puma",

      status: "active",

      isFeatured: false,

      sortOrder: 2,
    }).expect(201);

    /*
     * Inactive Brand.
     */
    await createBrandRequest(agent, {
      name: "Adidas",

      slug: "adidas",

      status: "inactive",

      isFeatured: true,

      sortOrder: 3,
    }).expect(201);

    /*
    |--------------------------------------------------------------------------
    | Public List
    |--------------------------------------------------------------------------
    */

    const publicResponse = await request(app).get(publicBrandUrl).expect(200);

    const publicBrands = publicResponse.body.data.brands;

    expect(publicBrands).toHaveLength(2);

    expect(publicBrands.map((brand) => brand.slug)).toEqual(["nike", "puma"]);

    const publicNike = publicBrands.find((brand) => brand.slug === "nike");

    expect(publicNike.id).toBe(nikeResponse.body.data.brand.id);

    /*
     * Public response must not expose
     * admin management fields.
     */
    expect(publicNike).not.toHaveProperty("status");

    expect(publicNike).not.toHaveProperty("createdBy");

    expect(publicNike).not.toHaveProperty("updatedBy");

    expect(publicNike).not.toHaveProperty("deletedBy");

    expect(publicNike).not.toHaveProperty("deletedAt");

    /*
    |--------------------------------------------------------------------------
    | Public Featured Filter
    |--------------------------------------------------------------------------
    */

    const featuredResponse = await request(app)
      .get(`${publicBrandUrl}?isFeatured=true`)
      .expect(200);

    expect(featuredResponse.body.data.brands).toHaveLength(1);

    expect(featuredResponse.body.data.brands[0].slug).toBe("nike");

    /*
    |--------------------------------------------------------------------------
    | Inactive Brand Is Not Public
    |--------------------------------------------------------------------------
    */

    const inactiveResponse = await request(app)
      .get(`${publicBrandUrl}/adidas`)
      .expect(404);

    expect(inactiveResponse.body.errorCode).toBe("BRAND_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Soft Delete and Restore
  |--------------------------------------------------------------------------
  */

  it("soft deletes and restores a brand while protecting public visibility", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",
    }).expect(201);

    const brand = createResponse.body.data.brand;

    /*
    |--------------------------------------------------------------------------
    | Brand Is Initially Public
    |--------------------------------------------------------------------------
    */

    await request(app).get(`${publicBrandUrl}/nike`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Delete Brand
    |--------------------------------------------------------------------------
    */

    const deleteResponse = await agent
      .delete(`${adminBrandUrl}/${brand.id}`)
      .expect(200);

    const deletedBrand = deleteResponse.body.data.brand;

    expect(deletedBrand.isDeleted).toBe(true);

    expect(deletedBrand.deletedAt).not.toBeNull();

    expect(deletedBrand.deletedBy).toBeDefined();

    /*
    |--------------------------------------------------------------------------
    | Deleted Brand Is No Longer Public
    |--------------------------------------------------------------------------
    */

    const hiddenResponse = await request(app)
      .get(`${publicBrandUrl}/nike`)
      .expect(404);

    expect(hiddenResponse.body.errorCode).toBe("BRAND_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Default Admin Detail Also Hides Deleted Brand
    |--------------------------------------------------------------------------
    */

    const defaultAdminResponse = await agent
      .get(`${adminBrandUrl}/${brand.id}`)
      .expect(404);

    expect(defaultAdminResponse.body.errorCode).toBe("BRAND_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Admin Can Explicitly Retrieve Deleted Brand
    |--------------------------------------------------------------------------
    */

    const deletedAdminResponse = await agent
      .get(`${adminBrandUrl}/${brand.id}?includeDeleted=true`)
      .expect(200);

    expect(deletedAdminResponse.body.data.brand.isDeleted).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Restore Brand
    |--------------------------------------------------------------------------
    */

    const restoreResponse = await agent
      .patch(`${adminBrandUrl}/${brand.id}/restore`)
      .expect(200);

    const restoredBrand = restoreResponse.body.data.brand;

    expect(restoredBrand.isDeleted).toBe(false);

    expect(restoredBrand.deletedAt).toBeNull();

    expect(restoredBrand.deletedBy).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Brand Is Public Again
    |--------------------------------------------------------------------------
    */

    await request(app).get(`${publicBrandUrl}/nike`).expect(200);
  });

  /*
  |--------------------------------------------------------------------------
  | Not Found Handling
  |--------------------------------------------------------------------------
  */

  it("returns BRAND_NOT_FOUND for an unknown brand", async () => {
    const { agent } = await createAuthenticatedAgent();

    const unknownBrandId = "507f1f77bcf86cd799439011";

    const adminResponse = await agent
      .get(`${adminBrandUrl}/${unknownBrandId}`)
      .expect(404);

    expect(adminResponse.body.errorCode).toBe("BRAND_NOT_FOUND");

    const publicResponse = await request(app)
      .get(`${publicBrandUrl}/unknown-brand`)
      .expect(404);

    expect(publicResponse.body.errorCode).toBe("BRAND_NOT_FOUND");
  });

  /*
|--------------------------------------------------------------------------
| Admin Brand Pagination, Search and Sorting
|--------------------------------------------------------------------------
*/

  it("lists brands with pagination, search and sorting", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
  |--------------------------------------------------------------------------
  | Create Brands
  |--------------------------------------------------------------------------
  */

    await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      description: "Sportswear and lifestyle brand",

      sortOrder: 3,
    }).expect(201);

    await createBrandRequest(agent, {
      name: "Adidas",

      slug: "adidas",

      description: "Football and sports brand",

      sortOrder: 1,
    }).expect(201);

    await createBrandRequest(agent, {
      name: "Puma",

      slug: "puma",

      description: "Fashion and footwear brand",

      sortOrder: 2,
    }).expect(201);

    await createBrandRequest(agent, {
      name: "Levi's",

      slug: "levis",

      description: "Denim clothing brand",

      sortOrder: 4,
    }).expect(201);

    /*
  |--------------------------------------------------------------------------
  | First Page — Alphabetical
  |--------------------------------------------------------------------------
  */

    const firstPageResponse = await agent
      .get(`${adminBrandUrl}?page=1&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    const firstPageData = firstPageResponse.body.data;

    expect(firstPageData.brands).toHaveLength(2);

    expect(firstPageData.brands.map((brand) => brand.name)).toEqual([
      "Adidas",
      "Levi's",
    ]);

    expect(firstPageData.pagination).toEqual({
      page: 1,

      limit: 2,

      totalItems: 4,

      totalPages: 2,

      hasPreviousPage: false,

      hasNextPage: true,
    });

    expect(firstPageData.filters.sortBy).toBe("name");

    expect(firstPageData.filters.sortDirection).toBe("asc");

    /*
  |--------------------------------------------------------------------------
  | Second Page
  |--------------------------------------------------------------------------
  */

    const secondPageResponse = await agent
      .get(`${adminBrandUrl}?page=2&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    const secondPageData = secondPageResponse.body.data;

    expect(secondPageData.brands.map((brand) => brand.name)).toEqual([
      "Nike",
      "Puma",
    ]);

    expect(secondPageData.pagination).toEqual({
      page: 2,

      limit: 2,

      totalItems: 4,

      totalPages: 2,

      hasPreviousPage: true,

      hasNextPage: false,
    });

    /*
  |--------------------------------------------------------------------------
  | Search by Description
  |--------------------------------------------------------------------------
  */

    const searchResponse = await agent
      .get(`${adminBrandUrl}?search=sports&sortBy=name&sortDirection=asc`)
      .expect(200);

    const searchedBrands = searchResponse.body.data.brands;

    expect(searchedBrands).toHaveLength(2);

    expect(searchedBrands.map((brand) => brand.slug)).toEqual([
      "adidas",
      "nike",
    ]);

    expect(searchResponse.body.data.filters.search).toBe("sports");

    /*
  |--------------------------------------------------------------------------
  | Search Treats Regex Characters as Text
  |--------------------------------------------------------------------------
  */

    const safeSearchResponse = await agent
      .get(`${adminBrandUrl}?search=Nike.*`)
      .expect(200);

    expect(safeSearchResponse.body.data.brands).toHaveLength(0);
  });

  /*
|--------------------------------------------------------------------------
| Admin Brand Filters
|--------------------------------------------------------------------------
*/

  it("filters brands by status and featured state", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",

      status: "active",

      isFeatured: true,
    }).expect(201);

    await createBrandRequest(agent, {
      name: "Puma",

      slug: "puma",

      status: "active",

      isFeatured: false,
    }).expect(201);

    await createBrandRequest(agent, {
      name: "Adidas",

      slug: "adidas",

      status: "inactive",

      isFeatured: true,
    }).expect(201);

    /*
  |--------------------------------------------------------------------------
  | Status Filter
  |--------------------------------------------------------------------------
  */

    const inactiveResponse = await agent
      .get(`${adminBrandUrl}?status=inactive`)
      .expect(200);

    expect(inactiveResponse.body.data.brands).toHaveLength(1);

    expect(inactiveResponse.body.data.brands[0].slug).toBe("adidas");

    expect(inactiveResponse.body.data.filters.status).toBe("inactive");

    /*
  |--------------------------------------------------------------------------
  | Featured Filter
  |--------------------------------------------------------------------------
  */

    const featuredResponse = await agent
      .get(`${adminBrandUrl}?isFeatured=true&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(
      featuredResponse.body.data.brands.map((brand) => brand.slug),
    ).toEqual(["adidas", "nike"]);

    expect(featuredResponse.body.data.filters.isFeatured).toBe(true);

    /*
  |--------------------------------------------------------------------------
  | Combined Filters
  |--------------------------------------------------------------------------
  */

    const combinedResponse = await agent
      .get(`${adminBrandUrl}?status=active&isFeatured=true`)
      .expect(200);

    expect(combinedResponse.body.data.brands).toHaveLength(1);

    expect(combinedResponse.body.data.brands[0].slug).toBe("nike");
  });

  /*
|--------------------------------------------------------------------------
| Deleted Brand List Filters
|--------------------------------------------------------------------------
*/

  it("supports exclude, only and include deleted brand filters", async () => {
    const { agent } = await createAuthenticatedAgent();

    const nikeResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",
    }).expect(201);

    const adidasResponse = await createBrandRequest(agent, {
      name: "Adidas",

      slug: "adidas",
    }).expect(201);

    const pumaResponse = await createBrandRequest(agent, {
      name: "Puma",

      slug: "puma",
    }).expect(201);

    const nike = nikeResponse.body.data.brand;

    const adidas = adidasResponse.body.data.brand;

    const puma = pumaResponse.body.data.brand;

    /*
  |--------------------------------------------------------------------------
  | Delete Two Brands
  |--------------------------------------------------------------------------
  */

    await agent.delete(`${adminBrandUrl}/${nike.id}`).expect(200);

    await agent.delete(`${adminBrandUrl}/${adidas.id}`).expect(200);

    /*
  |--------------------------------------------------------------------------
  | Default = Exclude Deleted
  |--------------------------------------------------------------------------
  */

    const defaultResponse = await agent.get(adminBrandUrl).expect(200);

    expect(defaultResponse.body.data.filters.deleted).toBe("exclude");

    expect(defaultResponse.body.data.brands).toHaveLength(1);

    expect(defaultResponse.body.data.brands[0].id).toBe(puma.id);

    expect(defaultResponse.body.data.brands[0].isDeleted).toBe(false);

    /*
  |--------------------------------------------------------------------------
  | Deleted Only
  |--------------------------------------------------------------------------
  */

    const deletedOnlyResponse = await agent
      .get(`${adminBrandUrl}?deleted=only`)
      .expect(200);

    expect(deletedOnlyResponse.body.data.filters.deleted).toBe("only");

    const deletedBrands = deletedOnlyResponse.body.data.brands;

    expect(deletedBrands).toHaveLength(2);

    expect(deletedBrands.every((brand) => brand.isDeleted === true)).toBe(true);

    expect(deletedBrands.map((brand) => brand.slug)).toEqual(
      expect.arrayContaining(["nike", "adidas"]),
    );

    /*
  |--------------------------------------------------------------------------
  | Include Deleted
  |--------------------------------------------------------------------------
  */

    const includeResponse = await agent
      .get(`${adminBrandUrl}?deleted=include`)
      .expect(200);

    expect(includeResponse.body.data.filters.deleted).toBe("include");

    expect(includeResponse.body.data.brands).toHaveLength(3);

    expect(includeResponse.body.data.brands.map((brand) => brand.slug)).toEqual(
      expect.arrayContaining(["nike", "adidas", "puma"]),
    );
  });

  /*
|--------------------------------------------------------------------------
| Deleted Brand Slug Reservation
|--------------------------------------------------------------------------
*/

  it("does not allow a soft-deleted brand slug to be reused", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",
    }).expect(201);

    const brand = createResponse.body.data.brand;

    /*
     * Soft delete Nike.
     */
    await agent.delete(`${adminBrandUrl}/${brand.id}`).expect(200);

    /*
     * nike remains globally reserved.
     */
    const duplicateResponse = await createBrandRequest(agent, {
      name: "New Nike",

      slug: "nike",
    }).expect(409);

    expect(duplicateResponse.body.success).toBe(false);

    expect(duplicateResponse.body.errorCode).toBe("BRAND_SLUG_ALREADY_EXISTS");
  });

  /*
|--------------------------------------------------------------------------
| Brand Slug Update Collision
|--------------------------------------------------------------------------
*/

  it("rejects changing a brand slug to another existing brand slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    const nikeResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",
    }).expect(201);

    await createBrandRequest(agent, {
      name: "Adidas",

      slug: "adidas",
    }).expect(201);

    const nike = nikeResponse.body.data.brand;

    const response = await agent
      .patch(`${adminBrandUrl}/${nike.id}`)
      .send({
        slug: "adidas",
      })
      .expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("BRAND_SLUG_ALREADY_EXISTS");
  });

  /*
|--------------------------------------------------------------------------
| Idempotent Brand Delete and Restore
|--------------------------------------------------------------------------
*/

  it("allows brand delete and restore operations to be repeated safely", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createBrandRequest(agent, {
      name: "Nike",

      slug: "nike",
    }).expect(201);

    const brand = createResponse.body.data.brand;

    /*
  |--------------------------------------------------------------------------
  | First Delete
  |--------------------------------------------------------------------------
  */

    const firstDeleteResponse = await agent
      .delete(`${adminBrandUrl}/${brand.id}`)
      .expect(200);

    const firstDeletedBrand = firstDeleteResponse.body.data.brand;

    expect(firstDeletedBrand.isDeleted).toBe(true);

    expect(firstDeletedBrand.deletedAt).not.toBeNull();

    expect(firstDeletedBrand.deletedBy).toBeDefined();

    const firstDeletedAt = firstDeletedBrand.deletedAt;

    const firstDeletedBy = firstDeletedBrand.deletedBy;

    /*
  |--------------------------------------------------------------------------
  | Repeated Delete
  |--------------------------------------------------------------------------
  */

    const secondDeleteResponse = await agent
      .delete(`${adminBrandUrl}/${brand.id}`)
      .expect(200);

    const secondDeletedBrand = secondDeleteResponse.body.data.brand;

    expect(secondDeletedBrand.isDeleted).toBe(true);

    /*
     * Repeated deletion must not overwrite
     * the original deletion metadata.
     */
    expect(secondDeletedBrand.deletedAt).toBe(firstDeletedAt);

    expect(secondDeletedBrand.deletedBy).toBe(firstDeletedBy);

    /*
  |--------------------------------------------------------------------------
  | First Restore
  |--------------------------------------------------------------------------
  */

    const firstRestoreResponse = await agent
      .patch(`${adminBrandUrl}/${brand.id}/restore`)
      .send({})
      .expect(200);

    const firstRestoredBrand = firstRestoreResponse.body.data.brand;

    expect(firstRestoredBrand.isDeleted).toBe(false);

    expect(firstRestoredBrand.deletedAt).toBeNull();

    expect(firstRestoredBrand.deletedBy).toBeNull();

    /*
  |--------------------------------------------------------------------------
  | Repeated Restore
  |--------------------------------------------------------------------------
  */

    const secondRestoreResponse = await agent
      .patch(`${adminBrandUrl}/${brand.id}/restore`)
      .send({})
      .expect(200);

    const secondRestoredBrand = secondRestoreResponse.body.data.brand;

    expect(secondRestoredBrand.isDeleted).toBe(false);

    expect(secondRestoredBrand.deletedAt).toBeNull();

    expect(secondRestoredBrand.deletedBy).toBeNull();

    /*
     * Brand remains publicly available.
     */
    await request(app).get(`${publicBrandUrl}/nike`).expect(200);
  });

  /*
|--------------------------------------------------------------------------
| Admin Brand List Query Validation
|--------------------------------------------------------------------------
*/

  it("rejects invalid admin brand list query parameters", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
  |--------------------------------------------------------------------------
  | Invalid Page
  |--------------------------------------------------------------------------
  */

    const pageResponse = await agent.get(`${adminBrandUrl}?page=0`).expect(400);

    expect(pageResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
  |--------------------------------------------------------------------------
  | Invalid Limit
  |--------------------------------------------------------------------------
  */

    const limitResponse = await agent
      .get(`${adminBrandUrl}?limit=101`)
      .expect(400);

    expect(limitResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
  |--------------------------------------------------------------------------
  | Invalid Status
  |--------------------------------------------------------------------------
  */

    const statusResponse = await agent
      .get(`${adminBrandUrl}?status=archived`)
      .expect(400);

    expect(statusResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
  |--------------------------------------------------------------------------
  | Invalid Featured Value
  |--------------------------------------------------------------------------
  */

    const featuredResponse = await agent
      .get(`${adminBrandUrl}?isFeatured=yes`)
      .expect(400);

    expect(featuredResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
  |--------------------------------------------------------------------------
  | Invalid Deleted Filter
  |--------------------------------------------------------------------------
  */

    const deletedResponse = await agent
      .get(`${adminBrandUrl}?deleted=true`)
      .expect(400);

    expect(deletedResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
  |--------------------------------------------------------------------------
  | Unknown Query Field
  |--------------------------------------------------------------------------
  */

    const unknownResponse = await agent
      .get(`${adminBrandUrl}?randomField=value`)
      .expect(400);

    expect(unknownResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });
});
