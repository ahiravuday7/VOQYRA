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

const adminCategoryUrl = "/api/v1/admin/categories";

const publicCategoryUrl = "/api/v1/categories";

const createCategoryRequest = (agent, categoryData) => {
  return agent.post(adminCategoryUrl).send(categoryData);
};

/*
|--------------------------------------------------------------------------
| Category API Integration Tests
|--------------------------------------------------------------------------
*/

describe("Category API integration", () => {
  /*
    |--------------------------------------------------------------------------
    | Admin Authentication
    |--------------------------------------------------------------------------
    */

  it("rejects an unauthenticated admin request", async () => {
    const response = await request(app)
      .post(adminCategoryUrl)
      .send({
        name: "Men",
        slug: "men",
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects a customer accessing admin category routes", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
    }).expect(403);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");
  });

  /*
    |--------------------------------------------------------------------------
    | Category Hierarchy
    |--------------------------------------------------------------------------
    */

  it("creates root, child and nested categories with the correct hierarchy", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
     * Create Men.
     */
    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      sortOrder: 1,
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    expect(menCategory.parent).toBeNull();

    expect(menCategory.ancestors).toEqual([]);

    expect(menCategory.level).toBe(0);

    /*
     * Create Topwear under Men.
     */
    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
      sortOrder: 1,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    expect(topwearCategory.parent).toBe(menCategory.id);

    expect(topwearCategory.ancestors).toEqual([menCategory.id]);

    expect(topwearCategory.level).toBe(1);

    /*
     * Create T-Shirts under Topwear.
     */
    const tshirtResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "men-tshirts",
      parent: topwearCategory.id,
      sortOrder: 1,
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    expect(tshirtCategory.parent).toBe(topwearCategory.id);

    expect(tshirtCategory.ancestors).toEqual([
      menCategory.id,
      topwearCategory.id,
    ]);

    expect(tshirtCategory.level).toBe(2);
  });

  /*
    |--------------------------------------------------------------------------
    | Move Category Hierarchy
    |--------------------------------------------------------------------------
    */

  it("updates every descendant when a category branch is moved", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
        |--------------------------------------------------------------------------
        | Create Root Categories
        |--------------------------------------------------------------------------
        */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      sortOrder: 1,
    }).expect(201);

    const womenResponse = await createCategoryRequest(agent, {
      name: "Women",
      slug: "women",
      sortOrder: 2,
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    const womenCategory = womenResponse.body.data.category;

    /*
        |--------------------------------------------------------------------------
        | Create Men → Topwear
        |--------------------------------------------------------------------------
        */

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
        |--------------------------------------------------------------------------
        | Create Topwear → T-Shirts
        |--------------------------------------------------------------------------
        */

    const tshirtResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "men-tshirts",
      parent: topwearCategory.id,
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    /*
        |--------------------------------------------------------------------------
        | Create T-Shirts → Oversized T-Shirts
        |--------------------------------------------------------------------------
        */

    const oversizedResponse = await createCategoryRequest(agent, {
      name: "Oversized T-Shirts",

      slug: "men-oversized-tshirts",

      parent: tshirtCategory.id,
    }).expect(201);

    const oversizedCategory = oversizedResponse.body.data.category;

    /*
        |--------------------------------------------------------------------------
        | Confirm Original Hierarchy
        |--------------------------------------------------------------------------
        */

    expect(topwearCategory.ancestors).toEqual([menCategory.id]);

    expect(topwearCategory.level).toBe(1);

    expect(tshirtCategory.ancestors).toEqual([
      menCategory.id,
      topwearCategory.id,
    ]);

    expect(tshirtCategory.level).toBe(2);

    expect(oversizedCategory.ancestors).toEqual([
      menCategory.id,
      topwearCategory.id,
      tshirtCategory.id,
    ]);

    expect(oversizedCategory.level).toBe(3);

    /*
        |--------------------------------------------------------------------------
        | Move Topwear from Men to Women
        |--------------------------------------------------------------------------
        */

    const moveResponse = await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}`)
      .send({
        parent: womenCategory.id,
      })
      .expect(200);

    const movedTopwear = moveResponse.body.data.category;

    expect(movedTopwear.parent).toBe(womenCategory.id);

    expect(movedTopwear.ancestors).toEqual([womenCategory.id]);

    expect(movedTopwear.level).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | Verify T-Shirts Was Updated
        |--------------------------------------------------------------------------
        */

    const updatedTshirtResponse = await agent
      .get(`${adminCategoryUrl}/${tshirtCategory.id}`)
      .expect(200);

    const updatedTshirt = updatedTshirtResponse.body.data.category;

    /*
     * Its immediate parent does not change.
     */
    expect(updatedTshirt.parent).toBe(topwearCategory.id);

    /*
     * Men is replaced by Women
     * in the ancestor path.
     */
    expect(updatedTshirt.ancestors).toEqual([
      womenCategory.id,
      topwearCategory.id,
    ]);

    expect(updatedTshirt.level).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Verify Oversized T-Shirts Was Updated
        |--------------------------------------------------------------------------
        */

    const updatedOversizedResponse = await agent
      .get(`${adminCategoryUrl}/${oversizedCategory.id}`)
      .expect(200);

    const updatedOversized = updatedOversizedResponse.body.data.category;

    expect(updatedOversized.parent).toBe(tshirtCategory.id);

    expect(updatedOversized.ancestors).toEqual([
      womenCategory.id,
      topwearCategory.id,
      tshirtCategory.id,
    ]);

    expect(updatedOversized.level).toBe(3);

    /*
        |--------------------------------------------------------------------------
        | Verify Public Tree
        |--------------------------------------------------------------------------
        */

    const treeResponse = await request(app)
      .get(`${publicCategoryUrl}/tree`)
      .expect(200);

    const rootCategories = treeResponse.body.data.categories;

    const publicMen = rootCategories.find(
      (category) => category.slug === "men",
    );

    const publicWomen = rootCategories.find(
      (category) => category.slug === "women",
    );

    expect(publicMen).toBeDefined();

    expect(publicWomen).toBeDefined();

    /*
     * Men no longer contains Topwear.
     */
    expect(
      publicMen.children.some((category) => category.id === topwearCategory.id),
    ).toBe(false);

    /*
     * Women now contains the complete
     * moved branch.
     */
    const publicTopwear = publicWomen.children.find(
      (category) => category.id === topwearCategory.id,
    );

    expect(publicTopwear).toBeDefined();

    expect(publicTopwear.parent).toBe(womenCategory.id);

    const publicTshirt = publicTopwear.children.find(
      (category) => category.id === tshirtCategory.id,
    );

    expect(publicTshirt).toBeDefined();

    const publicOversized = publicTshirt.children.find(
      (category) => category.id === oversizedCategory.id,
    );

    expect(publicOversized).toBeDefined();
  });

  /*
    |--------------------------------------------------------------------------
    | Move Nested Category to Root
    |--------------------------------------------------------------------------
    */

  it("moves a nested category to root and recalculates its descendants", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Men
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Topwear
    |--------------------------------------------------------------------------
    */

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create T-Shirts
    |--------------------------------------------------------------------------
    */

    const tshirtResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "men-tshirts",
      parent: topwearCategory.id,
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Oversized T-Shirts
    |--------------------------------------------------------------------------
    */

    const oversizedResponse = await createCategoryRequest(agent, {
      name: "Oversized T-Shirts",

      slug: "men-oversized-tshirts",

      parent: tshirtCategory.id,
    }).expect(201);

    const oversizedCategory = oversizedResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Confirm Original Hierarchy
    |--------------------------------------------------------------------------
    */

    expect(tshirtCategory.parent).toBe(topwearCategory.id);

    expect(tshirtCategory.ancestors).toEqual([
      menCategory.id,
      topwearCategory.id,
    ]);

    expect(tshirtCategory.level).toBe(2);

    expect(oversizedCategory.ancestors).toEqual([
      menCategory.id,
      topwearCategory.id,
      tshirtCategory.id,
    ]);

    expect(oversizedCategory.level).toBe(3);

    /*
    |--------------------------------------------------------------------------
    | Move T-Shirts to Root
    |--------------------------------------------------------------------------
    */

    const moveResponse = await agent
      .patch(`${adminCategoryUrl}/${tshirtCategory.id}`)
      .send({
        parent: null,
      })
      .expect(200);

    const movedTshirt = moveResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Verify T-Shirts Became Root
    |--------------------------------------------------------------------------
    */

    expect(movedTshirt.parent).toBeNull();

    expect(movedTshirt.ancestors).toEqual([]);

    expect(movedTshirt.level).toBe(0);

    expect(movedTshirt.isRoot).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Verify Descendant Was Recalculated
    |--------------------------------------------------------------------------
    */

    const updatedOversizedResponse = await agent
      .get(`${adminCategoryUrl}/${oversizedCategory.id}`)
      .expect(200);

    const updatedOversized = updatedOversizedResponse.body.data.category;

    /*
     * Immediate parent remains T-Shirts.
     */
    expect(updatedOversized.parent).toBe(tshirtCategory.id);

    /*
     * Previous ancestors:
     *
     * [Men, Topwear, T-Shirts]
     *
     * New ancestors:
     *
     * [T-Shirts]
     */
    expect(updatedOversized.ancestors).toEqual([tshirtCategory.id]);

    expect(updatedOversized.level).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Verify Original Parent Remains Unchanged
    |--------------------------------------------------------------------------
    */

    const updatedTopwearResponse = await agent
      .get(`${adminCategoryUrl}/${topwearCategory.id}`)
      .expect(200);

    const updatedTopwear = updatedTopwearResponse.body.data.category;

    expect(updatedTopwear.parent).toBe(menCategory.id);

    expect(updatedTopwear.ancestors).toEqual([menCategory.id]);

    expect(updatedTopwear.level).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Verify Public Tree
    |--------------------------------------------------------------------------
    */

    const treeResponse = await request(app)
      .get(`${publicCategoryUrl}/tree`)
      .expect(200);

    const rootCategories = treeResponse.body.data.categories;

    const publicMen = rootCategories.find(
      (category) => category.id === menCategory.id,
    );

    const publicTshirt = rootCategories.find(
      (category) => category.id === tshirtCategory.id,
    );

    expect(publicMen).toBeDefined();

    expect(publicTshirt).toBeDefined();

    /*
     * T-Shirts is no longer under Topwear.
     */
    const publicTopwear = publicMen.children.find(
      (category) => category.id === topwearCategory.id,
    );

    expect(publicTopwear).toBeDefined();

    expect(
      publicTopwear.children.some(
        (category) => category.id === tshirtCategory.id,
      ),
    ).toBe(false);

    /*
     * T-Shirts is now a root category.
     */
    expect(publicTshirt.parent).toBeNull();

    expect(publicTshirt.ancestors).toEqual([]);

    expect(publicTshirt.level).toBe(0);

    expect(publicTshirt.isRoot).toBe(true);

    /*
     * Oversized T-Shirts remains below T-Shirts.
     */
    expect(publicTshirt.children).toHaveLength(1);

    expect(publicTshirt.children[0].id).toBe(oversizedCategory.id);

    expect(publicTshirt.children[0].ancestors).toEqual([tshirtCategory.id]);

    expect(publicTshirt.children[0].level).toBe(1);
  });
  /*
    |--------------------------------------------------------------------------
    | Duplicate Slug
    |--------------------------------------------------------------------------
    */

  it("rejects a duplicate category slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
    }).expect(201);

    const response = await createCategoryRequest(agent, {
      name: "Duplicate Men",
      slug: "men",
    }).expect(409);

    expect(response.body.errorCode).toBe("CATEGORY_SLUG_ALREADY_EXISTS");
  });

  /*
    |--------------------------------------------------------------------------
    | Ancestor Status
    |--------------------------------------------------------------------------
    */

  it("rejects an active category under an inactive parent", async () => {
    const { agent } = await createAuthenticatedAgent();

    const parentResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      status: "inactive",
    }).expect(201);

    const parentCategory = parentResponse.body.data.category;

    const response = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: parentCategory.id,
      status: "active",
    }).expect(409);

    expect(response.body.errorCode).toBe("CATEGORY_ANCESTOR_INACTIVE");
  });

  /*
    |--------------------------------------------------------------------------
    | Circular Hierarchy
    |--------------------------------------------------------------------------
    */

  it("rejects moving a category under its descendant", async () => {
    const { agent } = await createAuthenticatedAgent();

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    const response = await agent
      .patch(`${adminCategoryUrl}/${menCategory.id}`)
      .send({
        parent: topwearCategory.id,
      })
      .expect(400);

    expect(response.body.errorCode).toBe("CIRCULAR_CATEGORY_HIERARCHY");
  });

  /*
    |--------------------------------------------------------------------------
    | Admin List Filters
    |--------------------------------------------------------------------------
    */

  it("lists categories using parent, featured and level filters", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      isFeatured: true,
      sortOrder: 2,
    }).expect(201);

    await createCategoryRequest(agent, {
      name: "Women",
      slug: "women",
      isFeatured: false,
      sortOrder: 1,
    }).expect(201);

    const response = await agent
      .get(`${adminCategoryUrl}?parent=root&isFeatured=true&level=0`)
      .expect(200);

    expect(response.body.data.categories).toHaveLength(1);

    expect(response.body.data.categories[0].slug).toBe("men");

    expect(response.body.data.filters.parent).toBe("root");

    expect(response.body.data.filters.isFeatured).toBe(true);

    expect(response.body.data.filters.level).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Soft Delete and Restore
    |--------------------------------------------------------------------------
    */

  it("protects category hierarchy during delete and restore", async () => {
    const { agent } = await createAuthenticatedAgent();

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
     * Parent cannot be deleted
     * while a child exists.
     */
    const protectedDeleteResponse = await agent
      .delete(`${adminCategoryUrl}/${menCategory.id}`)
      .expect(409);

    expect(protectedDeleteResponse.body.errorCode).toBe(
      "CATEGORY_HAS_CHILDREN",
    );

    /*
     * Delete child first.
     */
    const childDeleteResponse = await agent
      .delete(`${adminCategoryUrl}/${topwearCategory.id}`)
      .expect(200);

    expect(childDeleteResponse.body.data.category.isDeleted).toBe(true);

    /*
     * Parent can now be deleted.
     */
    await agent.delete(`${adminCategoryUrl}/${menCategory.id}`).expect(200);

    /*
     * Child cannot be restored before
     * its parent.
     */
    const protectedRestoreResponse = await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}/restore`)
      .send({})
      .expect(409);

    expect(protectedRestoreResponse.body.errorCode).toBe(
      "CATEGORY_PARENT_UNAVAILABLE",
    );

    /*
     * Restore parent first.
     */
    await agent
      .patch(`${adminCategoryUrl}/${menCategory.id}/restore`)
      .send({})
      .expect(200);

    /*
     * Restore child afterward.
     */
    const childRestoreResponse = await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}/restore`)
      .send({})
      .expect(200);

    expect(childRestoreResponse.body.data.category.isDeleted).toBe(false);
  });

  /*
    |--------------------------------------------------------------------------
    | Public Category APIs
    |--------------------------------------------------------------------------
    */

  it("returns active categories publicly without login", async () => {
    const { agent } = await createAuthenticatedAgent();

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      isFeatured: true,
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
     * Public tree requires no cookie.
     */
    const treeResponse = await request(app)
      .get(`${publicCategoryUrl}/tree`)
      .expect(200);

    expect(treeResponse.body.data.categories).toHaveLength(1);

    const publicMen = treeResponse.body.data.categories[0];

    expect(publicMen.slug).toBe("men");

    expect(publicMen.children).toHaveLength(1);

    expect(publicMen.children[0].slug).toBe("men-topwear");

    /*
     * Public response must not expose
     * admin audit fields.
     */
    expect(publicMen).not.toHaveProperty("createdBy");

    expect(publicMen).not.toHaveProperty("updatedBy");

    expect(publicMen).not.toHaveProperty("deletedAt");

    /*
     * Make Topwear inactive.
     */
    await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    /*
     * Inactive category is unavailable
     * through the public slug endpoint.
     */
    const hiddenResponse = await request(app)
      .get(`${publicCategoryUrl}/men-topwear`)
      .expect(404);

    expect(hiddenResponse.body.errorCode).toBe("CATEGORY_NOT_FOUND");

    /*
     * Public tree now contains Men
     * without the inactive Topwear child.
     */
    const updatedTreeResponse = await request(app)
      .get(`${publicCategoryUrl}/tree`)
      .expect(200);

    expect(updatedTreeResponse.body.data.categories[0].children).toEqual([]);
  });
});
