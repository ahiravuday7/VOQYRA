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
});
