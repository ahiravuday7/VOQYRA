import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

/*
|--------------------------------------------------------------------------
| URLs
|--------------------------------------------------------------------------
*/

const adminCategoryUrl = "/api/v1/admin/categories";

const adminBrandUrl = "/api/v1/admin/brands";

const adminSizeGuideUrl = "/api/v1/admin/size-guides";

const adminCollectionUrl = "/api/v1/admin/collections";

const publicCategoryUrl = "/api/v1/categories";

const publicBrandUrl = "/api/v1/brands";

const publicSizeGuideUrl = "/api/v1/size-guides";

const publicCollectionUrl = "/api/v1/collections";

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const createCategory = (agent, data) => {
  return agent.post(adminCategoryUrl).send(data);
};

const createBrand = (agent, data) => {
  return agent.post(adminBrandUrl).send(data);
};

const createSizeGuide = (agent, data) => {
  return agent.post(adminSizeGuideUrl).send(data);
};

const createCollection = (agent, data) => {
  return agent.post(adminCollectionUrl).send(data);
};

/*
|--------------------------------------------------------------------------
| Master Data Cross-Module Regression
|--------------------------------------------------------------------------
*/

describe("Master data cross-module regression", () => {
  /*
    |--------------------------------------------------------------------------
    | Create All Master Data
    |--------------------------------------------------------------------------
    */

  it("creates Category, Brand, SizeGuide and Collection using the same admin session", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
     * Category
     */
    const categoryResponse = await createCategory(agent, {
      name: "Men",
      slug: "men",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
     * Brand
     */
    const brandResponse = await createBrand(agent, {
      name: "Urban Thread",
      slug: "urban-thread",
      status: "active",
    }).expect(201);

    const brand = brandResponse.body.data.brand;

    /*
     * SizeGuide
     */
    const sizeGuideResponse = await createSizeGuide(agent, {
      name: "Men T-Shirt Size Guide",

      slug: "men-tshirt-size-guide",

      category: category.id,

      unit: "cm",

      columns: [
        {
          key: "chest",
          label: "Chest",
          sortOrder: 1,
        },
      ],

      rows: [
        {
          size: "M",

          measurements: [
            {
              key: "chest",
              value: "38",
            },
          ],

          sortOrder: 1,
        },
      ],

      status: "active",
    }).expect(201);

    const sizeGuide = sizeGuideResponse.body.data.sizeGuide;

    /*
     * Collection
     */
    const collectionResponse = await createCollection(agent, {
      name: "New Arrivals",
      slug: "new-arrivals",
      status: "active",
      isFeatured: true,
    }).expect(201);

    const collection = collectionResponse.body.data.collection;

    expect(category.id).toBeDefined();

    expect(brand.id).toBeDefined();

    expect(sizeGuide.id).toBeDefined();

    expect(collection.id).toBeDefined();

    /*
     * SizeGuide → Category relationship
     */
    expect(sizeGuide.category).toBe(category.id);

    /*
     * Same authenticated admin owns audit fields.
     */
    expect(brand.createdBy).toBe(String(user._id));

    expect(sizeGuide.createdBy).toBe(String(user._id));

    expect(collection.createdBy).toBe(String(user._id));
  });

  /*
    |--------------------------------------------------------------------------
    | Public Visibility
    |--------------------------------------------------------------------------
    */

  it("exposes active Category, Brand, SizeGuide and Collection through their public APIs", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategory(agent, {
      name: "Women",
      slug: "women",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    await createBrand(agent, {
      name: "Aura",
      slug: "aura",
      status: "active",
    }).expect(201);

    await createSizeGuide(agent, {
      name: "Women Size Guide",

      slug: "women-size-guide",

      category: category.id,

      unit: "cm",

      status: "active",
    }).expect(201);

    await createCollection(agent, {
      name: "Festive Collection",

      slug: "festive-collection",

      status: "active",
    }).expect(201);

    await request(app).get(`${publicCategoryUrl}/women`).expect(200);

    await request(app).get(`${publicBrandUrl}/aura`).expect(200);

    await request(app)
      .get(`${publicSizeGuideUrl}/women-size-guide`)
      .expect(200);

    await request(app)
      .get(`${publicCollectionUrl}/festive-collection`)
      .expect(200);
  });

  /*
    |--------------------------------------------------------------------------
    | Inactive Public Visibility
    |--------------------------------------------------------------------------
    */

  it("hides inactive master data consistently from public APIs", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCategory(agent, {
      name: "Hidden Category",

      slug: "hidden-category",

      status: "inactive",
    }).expect(201);

    await createBrand(agent, {
      name: "Hidden Brand",

      slug: "hidden-brand",

      status: "inactive",
    }).expect(201);

    /*
     * Generic SizeGuide:
     * no Category dependency required.
     */
    await createSizeGuide(agent, {
      name: "Hidden Size Guide",

      slug: "hidden-size-guide",

      unit: "cm",

      status: "inactive",
    }).expect(201);

    await createCollection(agent, {
      name: "Hidden Collection",

      slug: "hidden-collection",

      status: "inactive",
    }).expect(201);

    await request(app).get(`${publicCategoryUrl}/hidden-category`).expect(404);

    await request(app).get(`${publicBrandUrl}/hidden-brand`).expect(404);

    await request(app)
      .get(`${publicSizeGuideUrl}/hidden-size-guide`)
      .expect(404);

    await request(app)
      .get(`${publicCollectionUrl}/hidden-collection`)
      .expect(404);
  });

  /*
    |--------------------------------------------------------------------------
    | SizeGuide → Category Relationship
    |--------------------------------------------------------------------------
    */

  it("links a SizeGuide to Category without changing the Category hierarchy", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategory(agent, {
      name: "T-Shirts",

      slug: "t-shirts",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    expect(category.parent).toBeNull();

    expect(category.level).toBe(0);

    expect(category.ancestors).toEqual([]);

    const sizeGuideResponse = await createSizeGuide(agent, {
      name: "T-Shirt Guide",

      slug: "t-shirt-guide",

      category: category.id,

      unit: "cm",

      status: "active",
    }).expect(201);

    expect(sizeGuideResponse.body.data.sizeGuide.category).toBe(category.id);

    /*
     * Re-read Category.
     */
    const categoryDetail = await agent
      .get(`${adminCategoryUrl}/${category.id}`)
      .expect(200);

    const reloadedCategory = categoryDetail.body.data.category;

    expect(reloadedCategory.parent).toBeNull();

    expect(reloadedCategory.level).toBe(0);

    expect(reloadedCategory.ancestors).toEqual([]);
  });

  /*
    |--------------------------------------------------------------------------
    | Independent Slug Namespaces
    |--------------------------------------------------------------------------
    */

  it("allows the same slug across different master-data modules", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
     * Slug uniqueness belongs to each MongoDB collection,
     * not globally across the whole application.
     */

    const sharedSlug = "essentials";

    await createCategory(agent, {
      name: "Essentials Category",

      slug: sharedSlug,
    }).expect(201);

    await createBrand(agent, {
      name: "Essentials Brand",

      slug: sharedSlug,
    }).expect(201);

    await createSizeGuide(agent, {
      name: "Essentials Size Guide",

      slug: sharedSlug,

      unit: "cm",
    }).expect(201);

    await createCollection(agent, {
      name: "Essentials Collection",

      slug: sharedSlug,
    }).expect(201);

    await request(app).get(`${publicCategoryUrl}/${sharedSlug}`).expect(200);

    await request(app).get(`${publicBrandUrl}/${sharedSlug}`).expect(200);

    await request(app).get(`${publicSizeGuideUrl}/${sharedSlug}`).expect(200);

    await request(app).get(`${publicCollectionUrl}/${sharedSlug}`).expect(200);
  });

  /*
    |--------------------------------------------------------------------------
    | Module Isolation
    |--------------------------------------------------------------------------
    */

  it("keeps unrelated master-data modules available when one module is soft deleted", async () => {
    const { agent } = await createAuthenticatedAgent();

    await createCategory(agent, {
      name: "Men",
      slug: "men",
    }).expect(201);

    const brandResponse = await createBrand(agent, {
      name: "Urban Thread",

      slug: "urban-thread",
    }).expect(201);

    await createSizeGuide(agent, {
      name: "Generic Size Guide",

      slug: "generic-size-guide",

      unit: "cm",
    }).expect(201);

    await createCollection(agent, {
      name: "New Arrivals",

      slug: "new-arrivals",
    }).expect(201);

    const brand = brandResponse.body.data.brand;

    /*
     * Delete only Brand.
     */
    await agent.delete(`${adminBrandUrl}/${brand.id}`).expect(200);

    /*
     * Brand is hidden.
     */
    await request(app).get(`${publicBrandUrl}/urban-thread`).expect(404);

    /*
     * Other master-data modules remain unaffected.
     */
    await request(app).get(`${publicCategoryUrl}/men`).expect(200);

    await request(app)
      .get(`${publicSizeGuideUrl}/generic-size-guide`)
      .expect(200);

    await request(app).get(`${publicCollectionUrl}/new-arrivals`).expect(200);
  });
});
