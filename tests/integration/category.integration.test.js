import request from "supertest";

import Category from "../../src/modules/categories/category.model.js";

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
| Category Not-Found Handling
|--------------------------------------------------------------------------
*/

  it("returns correct errors for missing categories and parent categories", async () => {
    const { agent } = await createAuthenticatedAgent();

    const unknownCategoryId = "507f1f77bcf86cd799439011";

    /*
    |--------------------------------------------------------------------------
    | Unknown Admin Category ID
    |--------------------------------------------------------------------------
    */

    const unknownCategoryResponse = await agent
      .get(`${adminCategoryUrl}/${unknownCategoryId}`)
      .expect(404);

    expect(unknownCategoryResponse.body.success).toBe(false);

    expect(unknownCategoryResponse.body.errorCode).toBe("CATEGORY_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Missing Parent Category
    |--------------------------------------------------------------------------
    |
    | The parent value is a valid ObjectId, but no
    | matching Category document exists.
    |--------------------------------------------------------------------------
    */

    const missingParentResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: unknownCategoryId,
    }).expect(400);

    expect(missingParentResponse.body.success).toBe(false);

    expect(missingParentResponse.body.errorCode).toBe(
      "PARENT_CATEGORY_NOT_FOUND",
    );

    /*
    |--------------------------------------------------------------------------
    | Unknown Public Category Slug
    |--------------------------------------------------------------------------
    |
    | Public APIs return the same 404 for unavailable,
    | inactive, deleted, or nonexistent categories.
    |--------------------------------------------------------------------------
    */

    const unknownPublicCategoryResponse = await request(app)
      .get(`${publicCategoryUrl}/unknown-category`)
      .expect(404);

    expect(unknownPublicCategoryResponse.body.success).toBe(false);

    expect(unknownPublicCategoryResponse.body.errorCode).toBe(
      "CATEGORY_NOT_FOUND",
    );
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
| Prevent Inactive Parent with Active Descendants
|--------------------------------------------------------------------------
*/

  it("rejects making a category inactive while active descendants exist", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Men
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      status: "active",
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
      status: "active",
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
      status: "active",
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Attempt to Make Men Inactive
    |--------------------------------------------------------------------------
    */

    const response = await agent
      .patch(`${adminCategoryUrl}/${menCategory.id}`)
      .send({
        status: "inactive",
      })
      .expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("CATEGORY_HAS_ACTIVE_DESCENDANTS");

    expect(response.body.details.activeDescendantCount).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Deactivate Categories Bottom-Up
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(`${adminCategoryUrl}/${tshirtCategory.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    const menInactiveResponse = await agent
      .patch(`${adminCategoryUrl}/${menCategory.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    expect(menInactiveResponse.body.data.category.status).toBe("inactive");
  });

  /*
|--------------------------------------------------------------------------
| Prevent Active Child under Inactive Parent
|--------------------------------------------------------------------------
*/

  it("rejects activating a child while its parent is inactive", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Inactive Parent
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      status: "inactive",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    /*
     * An inactive child is allowed under
     * an inactive parent.
     */
    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
      status: "inactive",
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Attempt to Activate Child
    |--------------------------------------------------------------------------
    */

    const blockedResponse = await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}`)
      .send({
        status: "active",
      })
      .expect(409);

    expect(blockedResponse.body.success).toBe(false);

    expect(blockedResponse.body.errorCode).toBe("CATEGORY_ANCESTOR_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Activate Parent First
    |--------------------------------------------------------------------------
    */

    const parentResponse = await agent
      .patch(`${adminCategoryUrl}/${menCategory.id}`)
      .send({
        status: "active",
      })
      .expect(200);

    expect(parentResponse.body.data.category.status).toBe("active");

    /*
    |--------------------------------------------------------------------------
    | Child Can Now Be Activated
    |--------------------------------------------------------------------------
    */

    const childResponse = await agent
      .patch(`${adminCategoryUrl}/${topwearCategory.id}`)
      .send({
        status: "active",
      })
      .expect(200);

    expect(childResponse.body.data.category.status).toBe("active");
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
| Create Category Validation
|--------------------------------------------------------------------------
*/

  it("rejects invalid and protected category creation fields", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Protected Backend-Controlled Fields
    |--------------------------------------------------------------------------
    */

    const protectedFieldsResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",

      ancestors: ["507f1f77bcf86cd799439011"],

      level: 5,

      createdBy: String(user._id),
    }).expect(400);

    expect(protectedFieldsResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Parent ObjectId
    |--------------------------------------------------------------------------
    */

    const invalidParentResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: "invalid-id",
    }).expect(400);

    expect(invalidParentResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Slug
    |--------------------------------------------------------------------------
    */

    const invalidSlugResponse = await createCategoryRequest(agent, {
      name: "Men T-Shirts",
      slug: "Men T Shirts",
    }).expect(400);

    expect(invalidSlugResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Image URL
    |--------------------------------------------------------------------------
    */

    const invalidImageResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",

      image: {
        url: "javascript:alert(1)",
      },
    }).expect(400);

    expect(invalidImageResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Negative Sort Order
    |--------------------------------------------------------------------------
    */

    const invalidSortOrderResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      sortOrder: -1,
    }).expect(400);

    expect(invalidSortOrderResponse.body.success).toBe(false);
  });

  /*
|--------------------------------------------------------------------------
| Update Category Validation
|--------------------------------------------------------------------------
*/

  it("rejects empty and invalid category update payloads", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Empty Update Body
    |--------------------------------------------------------------------------
    */

    const emptyUpdateResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({})
      .expect(400);

    expect(emptyUpdateResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Unknown Field
    |--------------------------------------------------------------------------
    */

    const unknownFieldResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({
        productCount: 100,
      })
      .expect(400);

    expect(unknownFieldResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Protected Hierarchy Fields
    |--------------------------------------------------------------------------
    */

    const protectedFieldResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({
        ancestors: ["507f1f77bcf86cd799439011"],

        level: 10,
      })
      .expect(400);

    expect(protectedFieldResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Category ID Parameter
    |--------------------------------------------------------------------------
    */

    const invalidIdResponse = await agent
      .patch(`${adminCategoryUrl}/invalid-id`)
      .send({
        name: "Updated Category",
      })
      .expect(400);

    expect(invalidIdResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Status
    |--------------------------------------------------------------------------
    */

    const invalidStatusResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({
        status: "published",
      })
      .expect(400);

    expect(invalidStatusResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Featured Value
    |--------------------------------------------------------------------------
    */

    const invalidFeaturedResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}`)
      .send({
        isFeatured: "true",
      })
      .expect(400);

    expect(invalidFeaturedResponse.body.success).toBe(false);
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
| Category List Pagination and Search
|--------------------------------------------------------------------------
*/

  it("lists categories with pagination, search and sorting", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Categories
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      sortOrder: 3,
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    await createCategoryRequest(agent, {
      name: "Women",
      slug: "women",
      sortOrder: 1,
    }).expect(201);

    await createCategoryRequest(agent, {
      name: "Kids",
      slug: "kids",
      sortOrder: 2,
    }).expect(201);

    await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "men-tshirts",
      description: "Casual cotton T-shirts",
      parent: menCategory.id,
      sortOrder: 1,
    }).expect(201);

    /*
    |--------------------------------------------------------------------------
    | First Page — Alphabetical Order
    |--------------------------------------------------------------------------
    */

    const firstPageResponse = await agent
      .get(`${adminCategoryUrl}?page=1&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    const firstPageData = firstPageResponse.body.data;

    expect(firstPageData.categories).toHaveLength(2);

    expect(firstPageData.categories.map((category) => category.name)).toEqual([
      "Kids",
      "Men",
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
      .get(`${adminCategoryUrl}?page=2&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    const secondPageData = secondPageResponse.body.data;

    expect(secondPageData.categories.map((category) => category.name)).toEqual([
      "T-Shirts",
      "Women",
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
    | Search Category
    |--------------------------------------------------------------------------
    */

    const searchResponse = await agent
      .get(`${adminCategoryUrl}?search=shirt&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(searchResponse.body.data.categories).toHaveLength(1);

    expect(searchResponse.body.data.categories[0].slug).toBe("men-tshirts");

    expect(searchResponse.body.data.pagination.totalItems).toBe(1);

    expect(searchResponse.body.data.filters.search).toBe("shirt");
  });

  /*
|--------------------------------------------------------------------------
| Category List Query Validation
|--------------------------------------------------------------------------
*/

  it("rejects invalid category list query values", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Invalid Page
    |--------------------------------------------------------------------------
    */

    const invalidPageResponse = await agent
      .get(`${adminCategoryUrl}?page=0`)
      .expect(400);

    expect(invalidPageResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Limit Exceeds Maximum
    |--------------------------------------------------------------------------
    */

    const invalidLimitResponse = await agent
      .get(`${adminCategoryUrl}?limit=101`)
      .expect(400);

    expect(invalidLimitResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Boolean
    |--------------------------------------------------------------------------
    */

    const invalidFeaturedResponse = await agent
      .get(`${adminCategoryUrl}?isFeatured=yes`)
      .expect(400);

    expect(invalidFeaturedResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Negative Category Level
    |--------------------------------------------------------------------------
    */

    const invalidLevelResponse = await agent
      .get(`${adminCategoryUrl}?level=-1`)
      .expect(400);

    expect(invalidLevelResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Sorting Field
    |--------------------------------------------------------------------------
    */

    const invalidSortingResponse = await agent
      .get(`${adminCategoryUrl}?sortBy=password`)
      .expect(400);

    expect(invalidSortingResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Unknown Query Property
    |--------------------------------------------------------------------------
    |
    | categoryListQuerySchema uses strictObject(),
    | so unexpected query fields are rejected.
    |--------------------------------------------------------------------------
    */

    const unknownQueryResponse = await agent
      .get(`${adminCategoryUrl}?unknown=value`)
      .expect(400);

    expect(unknownQueryResponse.body.success).toBe(false);
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
| Idempotent Category Delete and Restore
|--------------------------------------------------------------------------
*/

  it("allows category delete and restore operations to be repeated safely", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Category
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Accessories",
      slug: "accessories",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | First Delete
    |--------------------------------------------------------------------------
    */

    const firstDeleteResponse = await agent
      .delete(`${adminCategoryUrl}/${category.id}`)
      .expect(200);

    const firstDeletedCategory = firstDeleteResponse.body.data.category;

    expect(firstDeletedCategory.isDeleted).toBe(true);

    expect(firstDeletedCategory.deletedAt).not.toBeNull();

    expect(firstDeletedCategory.deletedBy).toBeDefined();

    const firstDeletedAt = firstDeletedCategory.deletedAt;

    const firstDeletedBy = firstDeletedCategory.deletedBy;

    /*
    |--------------------------------------------------------------------------
    | Repeated Delete
    |--------------------------------------------------------------------------
    |
    | The category is already deleted, but the endpoint
    | should still return a successful response.
    |--------------------------------------------------------------------------
    */

    const secondDeleteResponse = await agent
      .delete(`${adminCategoryUrl}/${category.id}`)
      .expect(200);

    const secondDeletedCategory = secondDeleteResponse.body.data.category;

    expect(secondDeletedCategory.isDeleted).toBe(true);

    expect(secondDeletedCategory.deletedAt).toBe(firstDeletedAt);

    expect(secondDeletedCategory.deletedBy).toBe(firstDeletedBy);

    /*
    |--------------------------------------------------------------------------
    | First Restore
    |--------------------------------------------------------------------------
    */

    const firstRestoreResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}/restore`)
      .send({})
      .expect(200);

    const firstRestoredCategory = firstRestoreResponse.body.data.category;

    expect(firstRestoredCategory.isDeleted).toBe(false);

    expect(firstRestoredCategory.deletedAt).toBeNull();

    expect(firstRestoredCategory.deletedBy).toBeNull();

    const firstRestoredUpdatedAt = firstRestoredCategory.updatedAt;

    /*
    |--------------------------------------------------------------------------
    | Repeated Restore
    |--------------------------------------------------------------------------
    |
    | The category is already restored, but the endpoint
    | should remain successful.
    |--------------------------------------------------------------------------
    */

    const secondRestoreResponse = await agent
      .patch(`${adminCategoryUrl}/${category.id}/restore`)
      .send({})
      .expect(200);

    const secondRestoredCategory = secondRestoreResponse.body.data.category;

    expect(secondRestoredCategory.isDeleted).toBe(false);

    expect(secondRestoredCategory.deletedAt).toBeNull();

    expect(secondRestoredCategory.deletedBy).toBeNull();

    expect(secondRestoredCategory.updatedAt).toBe(firstRestoredUpdatedAt);

    /*
    |--------------------------------------------------------------------------
    | Confirm Category Is Publicly Available Again
    |--------------------------------------------------------------------------
    */

    const publicResponse = await request(app)
      .get(`${publicCategoryUrl}/${category.slug}`)
      .expect(200);

    expect(publicResponse.body.data.category.id).toBe(category.id);
  });

  /*
|--------------------------------------------------------------------------
| Deleted Category Admin Views
|--------------------------------------------------------------------------
*/

  it("lists and retrieves deleted categories using admin filters", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Men
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      sortOrder: 1,
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Topwear under Men
    |--------------------------------------------------------------------------
    */

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
      sortOrder: 1,
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Women as a Non-Deleted Category
    |--------------------------------------------------------------------------
    */

    const womenResponse = await createCategoryRequest(agent, {
      name: "Women",
      slug: "women",
      sortOrder: 2,
    }).expect(201);

    const womenCategory = womenResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Delete Child Before Parent
    |--------------------------------------------------------------------------
    */

    await agent.delete(`${adminCategoryUrl}/${topwearCategory.id}`).expect(200);

    await agent.delete(`${adminCategoryUrl}/${menCategory.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Default List Excludes Deleted Categories
    |--------------------------------------------------------------------------
    */

    const defaultListResponse = await agent.get(adminCategoryUrl).expect(200);

    expect(defaultListResponse.body.data.filters.deleted).toBe("exclude");

    expect(defaultListResponse.body.data.categories).toHaveLength(1);

    expect(defaultListResponse.body.data.categories[0].id).toBe(
      womenCategory.id,
    );

    expect(defaultListResponse.body.data.categories[0].isDeleted).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | List Only Deleted Categories
    |--------------------------------------------------------------------------
    */

    const deletedOnlyResponse = await agent
      .get(`${adminCategoryUrl}?deleted=only`)
      .expect(200);

    expect(deletedOnlyResponse.body.data.filters.deleted).toBe("only");

    const deletedCategories = deletedOnlyResponse.body.data.categories;

    expect(deletedCategories).toHaveLength(2);

    expect(
      deletedCategories.every((category) => category.isDeleted === true),
    ).toBe(true);

    expect(deletedCategories.map((category) => category.slug)).toEqual(
      expect.arrayContaining(["men", "men-topwear"]),
    );

    /*
    |--------------------------------------------------------------------------
    | Include Deleted and Non-Deleted Categories
    |--------------------------------------------------------------------------
    */

    const includeDeletedResponse = await agent
      .get(`${adminCategoryUrl}?deleted=include`)
      .expect(200);

    expect(includeDeletedResponse.body.data.filters.deleted).toBe("include");

    expect(includeDeletedResponse.body.data.categories).toHaveLength(3);

    expect(
      includeDeletedResponse.body.data.categories.map(
        (category) => category.slug,
      ),
    ).toEqual(expect.arrayContaining(["men", "men-topwear", "women"]));

    /*
    |--------------------------------------------------------------------------
    | Deleted Category Is Hidden by Default
    |--------------------------------------------------------------------------
    */

    const hiddenCategoryResponse = await agent
      .get(`${adminCategoryUrl}/${menCategory.id}`)
      .expect(404);

    expect(hiddenCategoryResponse.body.errorCode).toBe("CATEGORY_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Retrieve Deleted Category Explicitly
    |--------------------------------------------------------------------------
    */

    const deletedCategoryResponse = await agent
      .get(`${adminCategoryUrl}/${menCategory.id}?includeDeleted=true`)
      .expect(200);

    const deletedMen = deletedCategoryResponse.body.data.category;

    expect(deletedMen.id).toBe(menCategory.id);

    expect(deletedMen.slug).toBe("men");

    expect(deletedMen.isDeleted).toBe(true);

    expect(deletedMen.deletedAt).not.toBeNull();

    expect(deletedMen.deletedBy).toBeDefined();

    /*
    |--------------------------------------------------------------------------
    | Default Admin Tree Excludes Deleted Categories
    |--------------------------------------------------------------------------
    */

    const defaultTreeResponse = await agent
      .get(`${adminCategoryUrl}/tree`)
      .expect(200);

    expect(defaultTreeResponse.body.data.filters.deleted).toBe("exclude");

    expect(defaultTreeResponse.body.data.categories).toHaveLength(1);

    expect(defaultTreeResponse.body.data.categories[0].id).toBe(
      womenCategory.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Deleted-Only Tree Preserves Hierarchy
    |--------------------------------------------------------------------------
    */

    const deletedTreeResponse = await agent
      .get(`${adminCategoryUrl}/tree?deleted=only`)
      .expect(200);

    expect(deletedTreeResponse.body.data.filters.deleted).toBe("only");

    const deletedTreeRoots = deletedTreeResponse.body.data.categories;

    expect(deletedTreeRoots).toHaveLength(1);

    const deletedMenTree = deletedTreeRoots.find(
      (category) => category.id === menCategory.id,
    );

    expect(deletedMenTree).toBeDefined();

    expect(deletedMenTree.isDeleted).toBe(true);

    expect(deletedMenTree.isOrphaned).toBe(false);

    expect(deletedMenTree.children).toHaveLength(1);

    expect(deletedMenTree.children[0].id).toBe(topwearCategory.id);

    expect(deletedMenTree.children[0].isDeleted).toBe(true);

    expect(deletedMenTree.children[0].isOrphaned).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Included Tree Contains Every Category
    |--------------------------------------------------------------------------
    */

    const includedTreeResponse = await agent
      .get(`${adminCategoryUrl}/tree?deleted=include`)
      .expect(200);

    expect(includedTreeResponse.body.data.filters.deleted).toBe("include");

    const includedTreeRoots = includedTreeResponse.body.data.categories;

    expect(includedTreeRoots).toHaveLength(2);

    const includedMen = includedTreeRoots.find(
      (category) => category.id === menCategory.id,
    );

    const includedWomen = includedTreeRoots.find(
      (category) => category.id === womenCategory.id,
    );

    expect(includedMen).toBeDefined();

    expect(includedWomen).toBeDefined();

    expect(includedMen.children).toHaveLength(1);

    expect(includedMen.children[0].id).toBe(topwearCategory.id);
  });

  /*
|--------------------------------------------------------------------------
| Admin Tree Orphan Detection
|--------------------------------------------------------------------------
*/

  it("marks a category as orphaned when its parent is excluded from the admin tree", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Active Parent
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      status: "active",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Child
    |--------------------------------------------------------------------------
    */

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
      status: "active",
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Delete Only the Child
    |--------------------------------------------------------------------------
    |
    | The parent remains active and non-deleted.
    |--------------------------------------------------------------------------
    */

    await agent.delete(`${adminCategoryUrl}/${topwearCategory.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Deleted-Only Tree
    |--------------------------------------------------------------------------
    |
    | Men is excluded because it is not deleted.
    | Topwear must still appear for administrators.
    |--------------------------------------------------------------------------
    */

    const deletedOnlyTreeResponse = await agent
      .get(`${adminCategoryUrl}/tree?deleted=only`)
      .expect(200);

    expect(deletedOnlyTreeResponse.body.data.filters.deleted).toBe("only");

    const deletedTreeRoots = deletedOnlyTreeResponse.body.data.categories;

    expect(deletedTreeRoots).toHaveLength(1);

    const orphanedTopwear = deletedTreeRoots[0];

    expect(orphanedTopwear.id).toBe(topwearCategory.id);

    expect(orphanedTopwear.slug).toBe("men-topwear");

    /*
     * The original parent reference remains stored.
     */
    expect(orphanedTopwear.parent).toBe(menCategory.id);

    expect(orphanedTopwear.isDeleted).toBe(true);

    expect(orphanedTopwear.isOrphaned).toBe(true);

    expect(orphanedTopwear.children).toEqual([]);

    /*
    |--------------------------------------------------------------------------
    | Included Tree Restores Normal Hierarchy
    |--------------------------------------------------------------------------
    |
    | With deleted=include, both parent and child
    | are present, so Topwear is no longer orphaned.
    |--------------------------------------------------------------------------
    */

    const includedTreeResponse = await agent
      .get(`${adminCategoryUrl}/tree?deleted=include`)
      .expect(200);

    const includedRoots = includedTreeResponse.body.data.categories;

    const includedMen = includedRoots.find(
      (category) => category.id === menCategory.id,
    );

    expect(includedMen).toBeDefined();

    expect(includedMen.isOrphaned).toBe(false);

    const includedTopwear = includedMen.children.find(
      (category) => category.id === topwearCategory.id,
    );

    expect(includedTopwear).toBeDefined();

    expect(includedTopwear.isDeleted).toBe(true);

    expect(includedTopwear.isOrphaned).toBe(false);
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

  /*
|--------------------------------------------------------------------------
| Public Visibility with Unavailable Ancestors
|--------------------------------------------------------------------------
*/

  it("hides active categories publicly when an ancestor is inactive or deleted", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Active Hierarchy
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      status: "active",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    const topwearResponse = await createCategoryRequest(agent, {
      name: "Topwear",
      slug: "men-topwear",
      parent: menCategory.id,
      status: "active",
    }).expect(201);

    const topwearCategory = topwearResponse.body.data.category;

    const tshirtResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "men-tshirts",
      parent: topwearCategory.id,
      status: "active",
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Simulate Legacy Inconsistent Data
    |--------------------------------------------------------------------------
    |
    | We bypass the service and directly make Men inactive.
    | Topwear and T-Shirts remain active in MongoDB.
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
    |--------------------------------------------------------------------------
    | Flat Public List
    |--------------------------------------------------------------------------
    */

    const inactiveAncestorListResponse = await request(app)
      .get(publicCategoryUrl)
      .expect(200);

    const visibleSlugs = inactiveAncestorListResponse.body.data.categories.map(
      (category) => category.slug,
    );

    expect(visibleSlugs).not.toContain("men");

    expect(visibleSlugs).not.toContain("men-topwear");

    expect(visibleSlugs).not.toContain("men-tshirts");

    /*
    |--------------------------------------------------------------------------
    | Public Detail API
    |--------------------------------------------------------------------------
    */

    const inactiveAncestorDetailResponse = await request(app)
      .get(`${publicCategoryUrl}/${tshirtCategory.slug}`)
      .expect(404);

    expect(inactiveAncestorDetailResponse.body.errorCode).toBe(
      "CATEGORY_NOT_FOUND",
    );

    /*
    |--------------------------------------------------------------------------
    | Public Tree
    |--------------------------------------------------------------------------
    */

    const inactiveAncestorTreeResponse = await request(app)
      .get(`${publicCategoryUrl}/tree`)
      .expect(200);

    expect(inactiveAncestorTreeResponse.body.data.categories).toEqual([]);

    /*
    |--------------------------------------------------------------------------
    | Restore Men and Soft-Delete Topwear Directly
    |--------------------------------------------------------------------------
    |
    | This again simulates inconsistent legacy data:
    |
    | Men       → active
    | Topwear   → deleted
    | T-Shirts  → active
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: menCategory.id,
      },
      {
        $set: {
          status: "active",
        },
      },
    );

    await Category.updateOne(
      {
        _id: topwearCategory.id,
      },
      {
        $set: {
          deletedAt: new Date(),
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Flat List Hides Descendant of Deleted Parent
    |--------------------------------------------------------------------------
    */

    const deletedAncestorListResponse = await request(app)
      .get(publicCategoryUrl)
      .expect(200);

    const categoriesAfterParentDeletion =
      deletedAncestorListResponse.body.data.categories;

    expect(
      categoriesAfterParentDeletion.map((category) => category.slug),
    ).toContain("men");

    expect(
      categoriesAfterParentDeletion.map((category) => category.slug),
    ).not.toContain("men-topwear");

    expect(
      categoriesAfterParentDeletion.map((category) => category.slug),
    ).not.toContain("men-tshirts");

    /*
    |--------------------------------------------------------------------------
    | Detail API Hides Descendant
    |--------------------------------------------------------------------------
    */

    const deletedAncestorDetailResponse = await request(app)
      .get(`${publicCategoryUrl}/${tshirtCategory.slug}`)
      .expect(404);

    expect(deletedAncestorDetailResponse.body.errorCode).toBe(
      "CATEGORY_NOT_FOUND",
    );

    /*
    |--------------------------------------------------------------------------
    | Tree Shows Men without Hidden Children
    |--------------------------------------------------------------------------
    */

    const deletedAncestorTreeResponse = await request(app)
      .get(`${publicCategoryUrl}/tree`)
      .expect(200);

    const publicMen = deletedAncestorTreeResponse.body.data.categories.find(
      (category) => category.id === menCategory.id,
    );

    expect(publicMen).toBeDefined();

    expect(publicMen.children).toEqual([]);
  });
});
