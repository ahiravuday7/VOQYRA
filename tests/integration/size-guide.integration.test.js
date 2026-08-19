import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import Category from "../../src/modules/categories/category.model.js";

/*
|--------------------------------------------------------------------------
| Test URLs
|--------------------------------------------------------------------------
*/

const adminCategoryUrl = "/api/v1/admin/categories";

const adminSizeGuideUrl = "/api/v1/admin/size-guides";

const publicSizeGuideUrl = "/api/v1/size-guides";

/*
|--------------------------------------------------------------------------
| Test Helpers
|--------------------------------------------------------------------------
*/

const createSizeGuideRequest = (agent, sizeGuideData) => {
  return agent.post(adminSizeGuideUrl).send(sizeGuideData);
};

const createCategoryRequest = (agent, categoryData) => {
  return agent.post(adminCategoryUrl).send(categoryData);
};

/*
|--------------------------------------------------------------------------
| SizeGuide API Integration
|--------------------------------------------------------------------------
*/

describe("SizeGuide API integration", () => {
  /*
    |--------------------------------------------------------------------------
    | Admin Authentication
    |--------------------------------------------------------------------------
    */

  it("rejects an unauthenticated admin size guide request", async () => {
    const response = await request(app)
      .post(adminSizeGuideUrl)
      .send({
        name: "Men's T-Shirt Size Guide",

        slug: "mens-tshirt-size-guide",
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

  it("rejects a customer accessing admin size guide routes", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await createSizeGuideRequest(agent, {
      name: "Men's T-Shirt Size Guide",

      slug: "mens-tshirt-size-guide",
    }).expect(403);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");
  });

  /*
    |--------------------------------------------------------------------------
    | Create Generic SizeGuide
    |--------------------------------------------------------------------------
    */

  it("creates a generic size guide with measurements and audit information", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const response = await createSizeGuideRequest(agent, {
      name: "Men's Standard Tops",

      slug: "mens-standard-tops",

      description: "General size guide for men's tops",

      category: null,

      unit: "cm",

      columns: [
        {
          key: "chest",

          label: "Chest",

          sortOrder: 1,
        },

        {
          key: "length",

          label: "Length",

          sortOrder: 2,
        },
      ],

      rows: [
        {
          size: "S",

          measurements: [
            {
              key: "chest",

              value: "91-96",
            },

            {
              key: "length",

              value: "68",
            },
          ],

          sortOrder: 1,
        },

        {
          size: "M",

          measurements: [
            {
              key: "chest",

              value: "97-102",
            },

            {
              key: "length",

              value: "70",
            },
          ],

          sortOrder: 2,
        },
      ],

      howToMeasure: "Measure around the fullest part of your chest.",

      fitNote: "Choose one size larger for a relaxed fit.",

      status: "active",

      sortOrder: 1,
    }).expect(201);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Size guide created successfully");

    const sizeGuide = response.body.data.sizeGuide;

    expect(sizeGuide.id).toBeDefined();

    expect(sizeGuide.name).toBe("Men's Standard Tops");

    expect(sizeGuide.slug).toBe("mens-standard-tops");

    expect(sizeGuide.category).toBeNull();

    expect(sizeGuide.unit).toBe("cm");

    expect(sizeGuide.columns).toEqual([
      {
        key: "chest",

        label: "Chest",

        sortOrder: 1,
      },

      {
        key: "length",

        label: "Length",

        sortOrder: 2,
      },
    ]);

    expect(sizeGuide.rows).toHaveLength(2);

    expect(sizeGuide.rows[0]).toEqual({
      size: "S",

      measurements: [
        {
          key: "chest",

          value: "91-96",
        },

        {
          key: "length",

          value: "68",
        },
      ],

      sortOrder: 1,
    });

    expect(sizeGuide.status).toBe("active");

    expect(sizeGuide.isDeleted).toBe(false);

    expect(sizeGuide.createdBy).toBe(String(user._id));

    expect(sizeGuide.updatedBy).toBe(String(user._id));

    expect(sizeGuide.deletedBy).toBeNull();

    expect(sizeGuide.deletedAt).toBeNull();

    expect(sizeGuide.createdAt).toBeDefined();

    expect(sizeGuide.updatedAt).toBeDefined();
  });

  /*
    |--------------------------------------------------------------------------
    | Create Category-Based SizeGuide
    |--------------------------------------------------------------------------
    */

  it("creates a size guide linked to an active category", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",

      slug: "size-guide-tshirts",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const response = await createSizeGuideRequest(agent, {
      name: "T-Shirt Size Guide",

      slug: "tshirt-size-guide",

      category: category.id,

      unit: "cm",

      columns: [
        {
          key: "chest",

          label: "Chest",
        },
      ],

      rows: [
        {
          size: "M",

          measurements: [
            {
              key: "chest",

              value: "100",
            },
          ],
        },
      ],
    }).expect(201);

    expect(response.body.data.sizeGuide.category).toBe(category.id);
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Category
    |--------------------------------------------------------------------------
    */

  it("rejects a size guide referencing a nonexistent category", async () => {
    const { agent } = await createAuthenticatedAgent();

    const missingCategoryId = "507f1f77bcf86cd799439011";

    const response = await createSizeGuideRequest(agent, {
      name: "Missing Category Guide",

      slug: "missing-category-guide",

      category: missingCategoryId,
    }).expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("SIZE_GUIDE_CATEGORY_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Slug
    |--------------------------------------------------------------------------
    */

  it("rejects a duplicate size guide slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createSizeGuideRequest(agent, {
      name: "Men's Standard Guide",

      slug: "mens-standard-guide",
    }).expect(201);

    const response = await createSizeGuideRequest(agent, {
      name: "Another Men's Guide",

      slug: "mens-standard-guide",
    }).expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("SIZE_GUIDE_SLUG_ALREADY_EXISTS");
  });

  /*
    |--------------------------------------------------------------------------
    | Measurement Validation
    |--------------------------------------------------------------------------
    */

  it("rejects unknown measurement keys during creation", async () => {
    const { agent } = await createAuthenticatedAgent();

    const response = await createSizeGuideRequest(agent, {
      name: "Invalid Measurement Guide",

      slug: "invalid-measurement-guide",

      columns: [
        {
          key: "chest",

          label: "Chest",
        },
      ],

      rows: [
        {
          size: "M",

          measurements: [
            {
              key: "shoulder",

              value: "18",
            },
          ],
        },
      ],
    }).expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Backend-Controlled Fields
    |--------------------------------------------------------------------------
    */

  it("rejects admin-controlled size guide fields in the request body", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const response = await createSizeGuideRequest(agent, {
      name: "Protected Fields Guide",

      slug: "protected-fields-guide",

      createdBy: String(user._id),
    }).expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Partial Row Update
    |--------------------------------------------------------------------------
    */

  it("updates rows without requiring columns to be resent", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createSizeGuideRequest(agent, {
      name: "T-Shirt Size Guide",

      slug: "partial-row-update-guide",

      columns: [
        {
          key: "chest",

          label: "Chest",

          sortOrder: 1,
        },

        {
          key: "length",

          label: "Length",

          sortOrder: 2,
        },
      ],

      rows: [
        {
          size: "M",

          measurements: [
            {
              key: "chest",

              value: "98",
            },

            {
              key: "length",

              value: "70",
            },
          ],
        },
      ],
    }).expect(201);

    const sizeGuide = createResponse.body.data.sizeGuide;

    const updateResponse = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .send({
        rows: [
          {
            size: "M",

            measurements: [
              {
                key: "chest",

                value: "100",
              },

              {
                key: "length",

                value: "72",
              },
            ],

            sortOrder: 1,
          },
        ],
      })
      .expect(200);

    const updatedSizeGuide = updateResponse.body.data.sizeGuide;

    expect(updatedSizeGuide.columns).toEqual(sizeGuide.columns);

    expect(updatedSizeGuide.rows[0].measurements).toEqual([
      {
        key: "chest",

        value: "100",
      },

      {
        key: "length",

        value: "72",
      },
    ]);
  });

  /*
    |--------------------------------------------------------------------------
    | Public Visibility
    |--------------------------------------------------------------------------
    */

  it("returns only active size guides publicly and hides admin fields", async () => {
    const { agent } = await createAuthenticatedAgent();

    const activeResponse = await createSizeGuideRequest(agent, {
      name: "Active Size Guide",

      slug: "active-size-guide",

      status: "active",

      unit: "cm",

      sortOrder: 1,
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Inactive Size Guide",

      slug: "inactive-size-guide",

      status: "inactive",

      unit: "in",

      sortOrder: 2,
    }).expect(201);

    /*
        |--------------------------------------------------------------------------
        | Public List
        |--------------------------------------------------------------------------
        */

    const publicResponse = await request(app)
      .get(publicSizeGuideUrl)
      .expect(200);

    const publicSizeGuides = publicResponse.body.data.sizeGuides;

    expect(publicSizeGuides).toHaveLength(1);

    expect(publicSizeGuides[0].id).toBe(activeResponse.body.data.sizeGuide.id);

    expect(publicSizeGuides[0].slug).toBe("active-size-guide");

    /*
     * Public response must not expose
     * admin-only fields.
     */
    expect(publicSizeGuides[0]).not.toHaveProperty("status");

    expect(publicSizeGuides[0]).not.toHaveProperty("createdBy");

    expect(publicSizeGuides[0]).not.toHaveProperty("updatedBy");

    expect(publicSizeGuides[0]).not.toHaveProperty("deletedBy");

    expect(publicSizeGuides[0]).not.toHaveProperty("deletedAt");

    /*
        |--------------------------------------------------------------------------
        | Inactive Detail Is Hidden
        |--------------------------------------------------------------------------
        */

    const inactiveResponse = await request(app)
      .get(`${publicSizeGuideUrl}/inactive-size-guide`)
      .expect(404);

    expect(inactiveResponse.body.errorCode).toBe("SIZE_GUIDE_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Soft Delete + Restore
    |--------------------------------------------------------------------------
    */

  it("soft deletes and restores a size guide while controlling public visibility", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createSizeGuideRequest(agent, {
      name: "Restorable Size Guide",

      slug: "restorable-size-guide",

      status: "active",
    }).expect(201);

    const sizeGuide = createResponse.body.data.sizeGuide;

    /*
     * Initially public.
     */
    await request(app)
      .get(`${publicSizeGuideUrl}/restorable-size-guide`)
      .expect(200);

    /*
        |--------------------------------------------------------------------------
        | Delete
        |--------------------------------------------------------------------------
        */

    const deleteResponse = await agent
      .delete(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .expect(200);

    const deletedSizeGuide = deleteResponse.body.data.sizeGuide;

    expect(deletedSizeGuide.isDeleted).toBe(true);

    expect(deletedSizeGuide.deletedAt).not.toBeNull();

    expect(deletedSizeGuide.deletedBy).not.toBeNull();

    /*
     * No longer publicly visible.
     */
    await request(app)
      .get(`${publicSizeGuideUrl}/restorable-size-guide`)
      .expect(404);

    /*
     * Default admin detail hides it.
     */
    await agent.get(`${adminSizeGuideUrl}/${sizeGuide.id}`).expect(404);

    /*
     * Explicit deleted lookup works.
     */
    const deletedAdminResponse = await agent
      .get(`${adminSizeGuideUrl}/${sizeGuide.id}?includeDeleted=true`)
      .expect(200);

    expect(deletedAdminResponse.body.data.sizeGuide.isDeleted).toBe(true);

    /*
        |--------------------------------------------------------------------------
        | Restore
        |--------------------------------------------------------------------------
        */

    const restoreResponse = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}/restore`)
      .send({})
      .expect(200);

    const restoredSizeGuide = restoreResponse.body.data.sizeGuide;

    expect(restoredSizeGuide.isDeleted).toBe(false);

    expect(restoredSizeGuide.deletedAt).toBeNull();

    expect(restoredSizeGuide.deletedBy).toBeNull();

    /*
     * Public again.
     */
    await request(app)
      .get(`${publicSizeGuideUrl}/restorable-size-guide`)
      .expect(200);
  });

  /*
    |--------------------------------------------------------------------------
    | Unknown SizeGuide
    |--------------------------------------------------------------------------
    */

  it("returns SIZE_GUIDE_NOT_FOUND for unknown size guides", async () => {
    const { agent } = await createAuthenticatedAgent();

    const unknownId = "507f1f77bcf86cd799439011";

    const adminResponse = await agent
      .get(`${adminSizeGuideUrl}/${unknownId}`)
      .expect(404);

    expect(adminResponse.body.errorCode).toBe("SIZE_GUIDE_NOT_FOUND");

    const publicResponse = await request(app)
      .get(`${publicSizeGuideUrl}/unknown-size-guide`)
      .expect(404);

    expect(publicResponse.body.errorCode).toBe("SIZE_GUIDE_NOT_FOUND");
  });

  /*
|--------------------------------------------------------------------------
| Inactive Category Rules
|--------------------------------------------------------------------------
*/

  it("allows an inactive size guide to use an inactive category but blocks an active size guide", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Draft T-Shirts",
      slug: "draft-tshirts",
      status: "inactive",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
     * Inactive SizeGuide may reference
     * an inactive Category.
     */
    const inactiveGuideResponse = await createSizeGuideRequest(agent, {
      name: "Draft T-Shirt Guide",
      slug: "draft-tshirt-guide",
      category: category.id,
      status: "inactive",
    }).expect(201);

    expect(inactiveGuideResponse.body.data.sizeGuide.category).toBe(
      category.id,
    );

    expect(inactiveGuideResponse.body.data.sizeGuide.status).toBe("inactive");

    /*
     * Active SizeGuide may not use the
     * same inactive Category.
     */
    const activeResponse = await createSizeGuideRequest(agent, {
      name: "Active T-Shirt Guide",
      slug: "active-tshirt-guide",
      category: category.id,
      status: "active",
    }).expect(409);

    expect(activeResponse.body.errorCode).toBe("SIZE_GUIDE_CATEGORY_INACTIVE");
  });

  /*
|--------------------------------------------------------------------------
| Category Ancestor Availability
|--------------------------------------------------------------------------
*/

  it("rejects an active size guide when a category ancestor is unavailable", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Men
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "size-guide-men",
      status: "active",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Men → T-Shirts
    |--------------------------------------------------------------------------
    */

    const tshirtResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "size-guide-men-tshirts",
      parent: menCategory.id,
      status: "active",
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Simulate Legacy / Inconsistent Data
    |--------------------------------------------------------------------------
    |
    | The Category API itself protects hierarchy consistency.
    |
    | Therefore, deliberately bypass the service and make the
    | ancestor inactive directly in MongoDB.
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: menCategory.id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    /*
     * Child remains active but its ancestor
     * is now unavailable.
     */
    const response = await createSizeGuideRequest(agent, {
      name: "Men's T-Shirt Size Guide",

      slug: "mens-tshirt-ancestor-test",

      category: tshirtCategory.id,

      status: "active",
    }).expect(409);

    expect(response.body.errorCode).toBe(
      "SIZE_GUIDE_CATEGORY_ANCESTOR_UNAVAILABLE",
    );

    expect(response.body.details?.categoryId).toBe(menCategory.id);
  });

  /*
|--------------------------------------------------------------------------
| SizeGuide Activation
|--------------------------------------------------------------------------
*/

  it("revalidates the existing category when activating a size guide", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Draft Shirts",
      slug: "draft-shirts",
      status: "inactive",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const guideResponse = await createSizeGuideRequest(agent, {
      name: "Draft Shirt Guide",
      slug: "draft-shirt-guide",
      category: category.id,
      status: "inactive",
    }).expect(201);

    const sizeGuide = guideResponse.body.data.sizeGuide;

    /*
     * Existing Category is inactive,
     * therefore publishing must fail.
     */
    const rejectedResponse = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .send({
        status: "active",
      })
      .expect(409);

    expect(rejectedResponse.body.errorCode).toBe(
      "SIZE_GUIDE_CATEGORY_INACTIVE",
    );

    /*
     * Activate Category.
     */
    await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({
        status: "active",
      })
      .expect(200);

    /*
     * Now publishing the SizeGuide succeeds.
     */
    const activatedResponse = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .send({
        status: "active",
      })
      .expect(200);

    expect(activatedResponse.body.data.sizeGuide.status).toBe("active");
  });

  /*
|--------------------------------------------------------------------------
| Restore Category Revalidation
|--------------------------------------------------------------------------
*/

  it("revalidates the category before restoring an active size guide", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Restore Shirts",
      slug: "restore-shirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const guideResponse = await createSizeGuideRequest(agent, {
      name: "Restore Shirt Guide",
      slug: "restore-shirt-guide",
      category: category.id,
      status: "active",
    }).expect(201);

    const sizeGuide = guideResponse.body.data.sizeGuide;

    await agent.delete(`${adminSizeGuideUrl}/${sizeGuide.id}`).expect(200);

    /*
     * Category becomes unavailable while
     * SizeGuide is deleted.
     */
    await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    /*
     * Restoring would make the active guide
     * public again, so it must fail.
     */
    const response = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}/restore`)
      .send({})
      .expect(409);

    expect(response.body.errorCode).toBe("SIZE_GUIDE_CATEGORY_INACTIVE");
  });

  /*
|--------------------------------------------------------------------------
| Pagination, Search and Sorting
|--------------------------------------------------------------------------
*/

  it("lists size guides with pagination, search and sorting", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createSizeGuideRequest(agent, {
      name: "Men Tops",
      slug: "men-tops-guide",
      description: "Size information for shirts and tops",
      sortOrder: 3,
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Kids Wear",
      slug: "kids-wear-guide",
      description: "Sizing for children's clothing",
      sortOrder: 1,
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Women Tops",
      slug: "women-tops-guide",
      description: "Size information for women tops",
      sortOrder: 4,
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Denim Guide",
      slug: "denim-guide",
      description: "Sizing information for denim",
      sortOrder: 2,
    }).expect(201);

    /*
    |--------------------------------------------------------------------------
    | Page 1
    |--------------------------------------------------------------------------
    */

    const firstPageResponse = await agent
      .get(`${adminSizeGuideUrl}?page=1&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(
      firstPageResponse.body.data.sizeGuides.map((guide) => guide.name),
    ).toEqual(["Denim Guide", "Kids Wear"]);

    expect(firstPageResponse.body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      totalItems: 4,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    /*
    |--------------------------------------------------------------------------
    | Page 2
    |--------------------------------------------------------------------------
    */

    const secondPageResponse = await agent
      .get(`${adminSizeGuideUrl}?page=2&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(
      secondPageResponse.body.data.sizeGuides.map((guide) => guide.name),
    ).toEqual(["Men Tops", "Women Tops"]);

    /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

    const searchResponse = await agent
      .get(`${adminSizeGuideUrl}?search=tops&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(
      searchResponse.body.data.sizeGuides.map((guide) => guide.slug),
    ).toEqual(["men-tops-guide", "women-tops-guide"]);

    /*
     * Regex characters must be treated
     * as ordinary search text.
     */
    const safeSearchResponse = await agent
      .get(`${adminSizeGuideUrl}?search=Men.*`)
      .expect(200);

    expect(safeSearchResponse.body.data.sizeGuides).toHaveLength(0);
  });

  /*
|--------------------------------------------------------------------------
| Unit and Category Filters
|--------------------------------------------------------------------------
*/

  it("filters size guides by unit, category and generic category", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Filter T-Shirts",
      slug: "filter-tshirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    await createSizeGuideRequest(agent, {
      name: "Metric T-Shirt Guide",
      slug: "metric-tshirt-guide",
      category: category.id,
      unit: "cm",
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Imperial T-Shirt Guide",
      slug: "imperial-tshirt-guide",
      category: category.id,
      unit: "in",
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Generic Metric Guide",
      slug: "generic-metric-guide",
      category: null,
      unit: "cm",
    }).expect(201);

    /*
    |--------------------------------------------------------------------------
    | Unit
    |--------------------------------------------------------------------------
    */

    const unitResponse = await agent
      .get(`${adminSizeGuideUrl}?unit=in`)
      .expect(200);

    expect(unitResponse.body.data.sizeGuides).toHaveLength(1);

    expect(unitResponse.body.data.sizeGuides[0].slug).toBe(
      "imperial-tshirt-guide",
    );

    /*
    |--------------------------------------------------------------------------
    | Category
    |--------------------------------------------------------------------------
    */

    const categoryFilterResponse = await agent
      .get(`${adminSizeGuideUrl}?category=${category.id}`)
      .expect(200);

    expect(categoryFilterResponse.body.data.sizeGuides).toHaveLength(2);

    /*
    |--------------------------------------------------------------------------
    | Generic / category=null
    |--------------------------------------------------------------------------
    */

    const genericResponse = await agent
      .get(`${adminSizeGuideUrl}?category=none`)
      .expect(200);

    expect(genericResponse.body.data.sizeGuides).toHaveLength(1);

    expect(genericResponse.body.data.sizeGuides[0].slug).toBe(
      "generic-metric-guide",
    );

    /*
    |--------------------------------------------------------------------------
    | Public Combined Filter
    |--------------------------------------------------------------------------
    */

    const publicResponse = await request(app)
      .get(`${publicSizeGuideUrl}?category=${category.id}&unit=cm`)
      .expect(200);

    expect(publicResponse.body.data.sizeGuides).toHaveLength(1);

    expect(publicResponse.body.data.sizeGuides[0].slug).toBe(
      "metric-tshirt-guide",
    );

    const publicGenericResponse = await request(app)
      .get(`${publicSizeGuideUrl}?category=none`)
      .expect(200);

    expect(
      publicGenericResponse.body.data.sizeGuides.map((guide) => guide.slug),
    ).toEqual(["generic-metric-guide"]);
  });

  /*
|--------------------------------------------------------------------------
| Deleted Filters + Slug Reservation
|--------------------------------------------------------------------------
*/

  it("supports deleted filters and keeps a deleted size guide slug reserved", async () => {
    const { agent } = await createAuthenticatedAgent();

    const firstResponse = await createSizeGuideRequest(agent, {
      name: "First Guide",
      slug: "first-guide",
    }).expect(201);

    const secondResponse = await createSizeGuideRequest(agent, {
      name: "Second Guide",
      slug: "second-guide",
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Third Guide",
      slug: "third-guide",
    }).expect(201);

    const first = firstResponse.body.data.sizeGuide;

    const second = secondResponse.body.data.sizeGuide;

    await agent.delete(`${adminSizeGuideUrl}/${first.id}`).expect(200);

    await agent.delete(`${adminSizeGuideUrl}/${second.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Default = exclude
    |--------------------------------------------------------------------------
    */

    const defaultResponse = await agent.get(adminSizeGuideUrl).expect(200);

    expect(defaultResponse.body.data.filters.deleted).toBe("exclude");

    expect(defaultResponse.body.data.sizeGuides).toHaveLength(1);

    /*
    |--------------------------------------------------------------------------
    | only
    |--------------------------------------------------------------------------
    */

    const onlyResponse = await agent
      .get(`${adminSizeGuideUrl}?deleted=only`)
      .expect(200);

    expect(onlyResponse.body.data.sizeGuides).toHaveLength(2);

    expect(
      onlyResponse.body.data.sizeGuides.every(
        (guide) => guide.isDeleted === true,
      ),
    ).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | include
    |--------------------------------------------------------------------------
    */

    const includeResponse = await agent
      .get(`${adminSizeGuideUrl}?deleted=include`)
      .expect(200);

    expect(includeResponse.body.data.sizeGuides).toHaveLength(3);

    /*
    |--------------------------------------------------------------------------
    | Deleted Slug Remains Reserved
    |--------------------------------------------------------------------------
    */

    const duplicateResponse = await createSizeGuideRequest(agent, {
      name: "Replacement First Guide",
      slug: "first-guide",
    }).expect(409);

    expect(duplicateResponse.body.errorCode).toBe(
      "SIZE_GUIDE_SLUG_ALREADY_EXISTS",
    );
  });

  /*
|--------------------------------------------------------------------------
| Slug Update Collision
|--------------------------------------------------------------------------
*/

  it("rejects changing a size guide slug to another existing slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    const firstResponse = await createSizeGuideRequest(agent, {
      name: "Alpha Guide",
      slug: "alpha-guide",
    }).expect(201);

    await createSizeGuideRequest(agent, {
      name: "Beta Guide",
      slug: "beta-guide",
    }).expect(201);

    const first = firstResponse.body.data.sizeGuide;

    const response = await agent
      .patch(`${adminSizeGuideUrl}/${first.id}`)
      .send({
        slug: "beta-guide",
      })
      .expect(409);

    expect(response.body.errorCode).toBe("SIZE_GUIDE_SLUG_ALREADY_EXISTS");
  });

  /*
|--------------------------------------------------------------------------
| Idempotent Delete + Restore
|--------------------------------------------------------------------------
*/

  it("allows size guide delete and restore operations to be repeated safely", async () => {
    const { agent } = await createAuthenticatedAgent();

    const createResponse = await createSizeGuideRequest(agent, {
      name: "Idempotent Guide",
      slug: "idempotent-guide",
    }).expect(201);

    const sizeGuide = createResponse.body.data.sizeGuide;

    /*
    |--------------------------------------------------------------------------
    | First Delete
    |--------------------------------------------------------------------------
    */

    const firstDelete = await agent
      .delete(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .expect(200);

    const firstDeleted = firstDelete.body.data.sizeGuide;

    expect(firstDeleted.isDeleted).toBe(true);

    const deletedAt = firstDeleted.deletedAt;

    const deletedBy = firstDeleted.deletedBy;

    /*
    |--------------------------------------------------------------------------
    | Second Delete
    |--------------------------------------------------------------------------
    */

    const secondDelete = await agent
      .delete(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .expect(200);

    expect(secondDelete.body.data.sizeGuide.deletedAt).toBe(deletedAt);

    expect(secondDelete.body.data.sizeGuide.deletedBy).toBe(deletedBy);

    /*
    |--------------------------------------------------------------------------
    | First Restore
    |--------------------------------------------------------------------------
    */

    const firstRestore = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}/restore`)
      .send({})
      .expect(200);

    expect(firstRestore.body.data.sizeGuide.isDeleted).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Second Restore
    |--------------------------------------------------------------------------
    */

    const secondRestore = await agent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}/restore`)
      .send({})
      .expect(200);

    expect(secondRestore.body.data.sizeGuide.isDeleted).toBe(false);

    expect(secondRestore.body.data.sizeGuide.deletedAt).toBeNull();

    expect(secondRestore.body.data.sizeGuide.deletedBy).toBeNull();
  });

  /*
|--------------------------------------------------------------------------
| Query Validation
|--------------------------------------------------------------------------
*/

  it("rejects invalid admin and public size guide query parameters", async () => {
    const { agent } = await createAuthenticatedAgent();

    const invalidAdminQueries = [
      "page=0",
      "limit=101",
      "status=archived",
      "unit=mm",
      "category=invalid-id",
      "deleted=true",
      "sortBy=random",
      "sortDirection=up",
      "unknown=value",
    ];

    for (const query of invalidAdminQueries) {
      const response = await agent
        .get(`${adminSizeGuideUrl}?${query}`)
        .expect(400);

      expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
    }

    /*
    |--------------------------------------------------------------------------
    | Public Invalid Unit
    |--------------------------------------------------------------------------
    */

    const invalidUnitResponse = await request(app)
      .get(`${publicSizeGuideUrl}?unit=mm`)
      .expect(400);

    expect(invalidUnitResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
    |--------------------------------------------------------------------------
    | Public Unknown Field
    |--------------------------------------------------------------------------
    */

    const unknownPublicResponse = await request(app)
      .get(`${publicSizeGuideUrl}?status=active`)
      .expect(400);

    expect(unknownPublicResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );
  });
});
