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
});
