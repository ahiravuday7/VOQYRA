import { describe, expect, it, vi } from "vitest";

import Cart from "../../src/modules/cart/cart.model.js";

import Order from "../../src/modules/orders/order.model.js";

import Product from "../../src/modules/products/product.model.js";

import ProductInventoryLedger from "../../src/modules/products/product-inventory-ledger.model.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import {
  createActiveBrandFixture,
  resolveProductBrandRequestValue,
} from "../helpers/product-brand-test.helper.js";

/*
|--------------------------------------------------------------------------
| Product Fixture
|--------------------------------------------------------------------------
*/

let fixtureSequence = 0;

const createCheckoutProductFixture = async (options = {}) => {
  const {
    stock = 10,
    reservedStock = 2,
    sellingPrice = 799,
    discountPrice = 699,
  } = options;

  const { agent } = await createAuthenticatedAgent({
    role: USER_ROLES.ADMIN,
  });

  fixtureSequence += 1;

  const suffix = fixtureSequence;
  const name = `Cart Checkout Product ${suffix}`;
  const slug = `cart-checkout-product-${suffix}`;

  const categoryResponse = await agent
    .post("/api/v1/admin/categories")
    .send({
      name: `Cart Checkout Category ${suffix}`,
      slug: `cart-checkout-category-${suffix}`,
      description: "Category used by Cart checkout tests.",
      status: "active",
    })
    .expect(201);

  const brand = await createActiveBrandFixture();

  const response = await agent
    .post("/api/v1/admin/products")
    .send({
      name,
      slug,

      shortDescription: "Cart checkout integration test Product.",
      description: "An active Product used by Cart checkout tests.",

      category: categoryResponse.body.data.category.id,
      brand: resolveProductBrandRequestValue(brand),

      materials: ["100% Cotton"],
      careInstructions: ["Machine wash cold"],
      countryOfOrigin: "India",
      tags: ["cart-checkout-test"],

      images: [
        {
          url: `https://example.com/${slug}.jpg`,
          altText: name,
          sortOrder: 1,
          isPrimary: true,
        },
      ],

      variants: [
        {
          sku: `CART-CHECKOUT-${suffix}`,
          size: "M",

          color: {
            name: "Black",
            code: "#000000",
          },

          pricing: {
            buyingPrice: 300,
            sellingPrice,
            discountPrice,
            currency: "INR",
          },

          inventory: {
            stock,
            reservedStock,
            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],

      status: "active",
    })
    .expect(201);

  return Product.findById(response.body.data.product.id).lean();
};

/*
|--------------------------------------------------------------------------
| Cart and Checkout Helpers
|--------------------------------------------------------------------------
*/

const addCheckoutProductToCart = ({ agent, product, quantity = 2 }) => {
  return agent
    .post("/api/v1/cart/items")
    .send({
      productId: String(product._id),
      variantId: String(product.variants[0]._id),
      quantity,
    })
    .expect(201);
};

const getCheckoutCart = async (agent) => {
  const response = await agent.get("/api/v1/cart").expect(200);

  return response.body.data.cart;
};

const findStoredCart = (user) => {
  return Cart.findOne({
    user: user._id,
  }).lean();
};

const createCartCheckoutFixture = async (options = {}) => {
  const { quantity = 2, ...productOptions } = options;

  const { agent, user } = await createAuthenticatedAgent({
    role: USER_ROLES.CUSTOMER,
  });

  const product = await createCheckoutProductFixture(productOptions);

  await addCheckoutProductToCart({
    agent,
    product,
    quantity,
  });

  const cart = await getCheckoutCart(agent);
  const storedCart = await findStoredCart(user);

  return {
    agent,
    user,
    product,
    quantity,
    cart,
    storedCart,
  };
};

const createOrderBodyFromCart = (cart) => {
  return {
    // Forward references and quantities, never Cart pricing.
    items: cart.items.map((item) => ({
      productId: item.product.id,
      variantId: item.variant.id,
      quantity: item.quantity,
    })),

    shippingAddress: {
      fullName: "Checkout Test Customer",
      phone: "+91 98765-43210",
      email: "checkout@example.com",
      addressLine1: "Flat 101, Example Residency",
      addressLine2: "Baner Road",
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411045",
      country: "India",
    },

    paymentMethod: "cash-on-delivery",

    customerNote: "Cart checkout integration test",
  };
};

const submitCartCheckout = (agent, cart, expectedStatus = 201) => {
  return agent
    .post("/api/v1/orders")
    .send(createOrderBodyFromCart(cart))
    .expect(expectedStatus);
};

/*
|--------------------------------------------------------------------------
| Cart to Order Checkout Integration
|--------------------------------------------------------------------------
*/

describe("Cart to Order checkout integration", () => {
  it("creates an Order using Product and variant references from the Cart response", async () => {
    const { agent, user, product, quantity, cart } =
      await createCartCheckoutFixture();

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].availability.isAvailable).toBe(true);

    const response = await submitCartCheckout(agent, cart);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Order created successfully");

    const order = response.body.data.order;

    expect(order.id).toBeTruthy();
    expect(order.status).toBe("pending");
    expect(order.inventoryStatus).toBe("reserved");
    expect(order.payment.method).toBe("cash-on-delivery");
    expect(order.items).toHaveLength(1);

    expect(order.items[0]).toMatchObject({
      productId: String(product._id),
      variantId: String(product.variants[0]._id),
      quantity,
      productName: product.name,
      productSlug: product.slug,
      sku: product.variants[0].sku,
    });

    expect(order.items[0].pricing.unitFinalPrice).toBe(699);
    expect(order.items[0].pricing.lineSubtotal).toBe(699 * quantity);
    expect(order.totals.grandTotal).toBe(699 * quantity);

    const storedOrder = await Order.findById(order.id).lean();

    expect(storedOrder).not.toBeNull();
    expect(String(storedOrder.customer)).toBe(String(user._id));
    expect(String(storedOrder.items[0].product)).toBe(String(product._id));

    expect(await Order.countDocuments()).toBe(1);
  });

  it("uses current Product pricing even when the customer's Cart response is older", async () => {
    const { agent, user, product, quantity, cart, storedCart } =
      await createCartCheckoutFixture();

    expect(cart.items[0].pricing.unitPrice).toBe(699);

    const priceUpdate = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": product.variants[0]._id,
      },
      {
        $set: {
          "variants.$.pricing.sellingPrice": 1299,
          "variants.$.pricing.discountPrice": 999,
        },
      },
    );

    expect(priceUpdate.modifiedCount).toBe(1);

    // Submit references from the earlier Cart response.
    const response = await submitCartCheckout(agent, cart);

    const order = response.body.data.order;

    expect(order.items[0].pricing).toMatchObject({
      unitSellingPrice: 1299,
      unitDiscountPrice: 999,
      unitFinalPrice: 999,
      lineSubtotal: 999 * quantity,
    });

    expect(order.totals.grandTotal).toBe(999 * quantity);

    expect(await findStoredCart(user)).toEqual(storedCart);

    // Later Product price changes must not rewrite the Order snapshot.
    await Product.updateOne(
      {
        _id: product._id,
        "variants._id": product.variants[0]._id,
      },
      {
        $set: {
          "variants.$.pricing.sellingPrice": 1499,
          "variants.$.pricing.discountPrice": 1399,
        },
      },
    );

    const storedOrder = await Order.findById(order.id).lean();

    expect(storedOrder.items[0].pricing.unitFinalPrice).toBe(999);
    expect(storedOrder.totals.grandTotal).toBe(999 * quantity);
  });

  it("reserves inventory through Order while preserving the stored Cart", async () => {
    const { agent, user, product, quantity, cart, storedCart } =
      await createCartCheckoutFixture({
        stock: 10,
        reservedStock: 2,
        quantity: 3,
      });

    const beforeCheckout = await Product.findById(product._id).lean();

    // Adding to Cart did not reserve inventory.
    expect(beforeCheckout.variants[0].inventory.stock).toBe(10);
    expect(beforeCheckout.variants[0].inventory.reservedStock).toBe(2);

    const response = await submitCartCheckout(agent, cart);

    const order = response.body.data.order;

    const afterCheckout = await Product.findById(product._id).lean();

    expect(afterCheckout.variants[0].inventory.stock).toBe(10);
    expect(afterCheckout.variants[0].inventory.reservedStock).toBe(5);

    expect(order.items[0].inventory).toMatchObject({
      status: "reserved",
      reservedQuantity: quantity,
    });

    const reservationEntries = await ProductInventoryLedger.find({
      product: product._id,
      variantId: product.variants[0]._id,
      operation: "reserve",
      referenceId: order.orderNumber,
    }).lean();

    expect(reservationEntries).toHaveLength(1);

    expect(reservationEntries[0]).toMatchObject({
      quantity,
      stockDelta: 0,
      reservedStockDelta: quantity,
    });

    expect(await findStoredCart(user)).toEqual(storedCart);

    // Cart still exists, but its dynamic stock reflects Order's reservation.
    const refreshedCart = await getCheckoutCart(agent);

    expect(refreshedCart.id).toBe(cart.id);
    expect(refreshedCart.items).toHaveLength(1);
    expect(refreshedCart.items[0].quantity).toBe(quantity);
    expect(refreshedCart.items[0].inventory.availableStock).toBe(5);

    expect(await findStoredCart(user)).toEqual(storedCart);
  });

  it("preserves Cart and creates no Order when stock becomes insufficient before checkout", async () => {
    const { agent, user, product, cart, storedCart } =
      await createCartCheckoutFixture({
        stock: 10,
        reservedStock: 2,
        quantity: 2,
      });

    // Simulate another checkout consuming available inventory.
    const stockUpdate = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": product.variants[0]._id,
      },
      {
        $set: {
          "variants.$.inventory.reservedStock": 9,
        },
      },
    );

    expect(stockUpdate.modifiedCount).toBe(1);

    const productBeforeCheckout = await Product.findById(product._id).lean();

    const ledgerCountBefore = await ProductInventoryLedger.countDocuments();

    const response = await submitCartCheckout(agent, cart, 409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("ORDER_INSUFFICIENT_AVAILABLE_STOCK");

    expect(await Order.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(
      ledgerCountBefore,
    );

    expect(await Product.findById(product._id).lean()).toEqual(
      productBeforeCheckout,
    );

    expect(await findStoredCart(user)).toEqual(storedCart);
  });

  it("rolls back real multi-item reservations and ledger writes when Order saving fails", async () => {
    const {
      agent,
      user,
      product: firstProduct,
      quantity: firstQuantity,
    } = await createCartCheckoutFixture({
      stock: 10,
      reservedStock: 1,
      quantity: 2,
    });

    const secondProduct = await createCheckoutProductFixture({
      stock: 8,
      reservedStock: 2,
    });

    const secondQuantity = 3;

    await addCheckoutProductToCart({
      agent,
      product: secondProduct,
      quantity: secondQuantity,
    });

    const cart = await getCheckoutCart(agent);
    const originalCart = await findStoredCart(user);

    expect(cart.items).toHaveLength(2);

    const firstBefore = await Product.findById(firstProduct._id).lean();
    const secondBefore = await Product.findById(secondProduct._id).lean();

    const ledgerCountBefore = await ProductInventoryLedger.countDocuments();

    const productIds = [firstProduct._id, secondProduct._id];

    let observedInsideTransaction = null;

    // Intercept only the final Order save.
    // Product reservations and ledger writes still execute normally.
    const saveSpy = vi
      .spyOn(Order.prototype, "save")
      .mockImplementation(async function (options = {}) {
        const session = options.session;

        if (!session?.inTransaction()) {
          throw new Error("Expected Order save inside an active transaction");
        }

        // Read sequentially through the same transaction session.
        const products = await Product.find({
          _id: { $in: productIds },
        })
          .session(session)
          .lean();

        const ledgerEntries = await ProductInventoryLedger.find({
          product: { $in: productIds },
          referenceId: this.orderNumber,
          operation: "reserve",
        })
          .session(session)
          .lean();

        observedInsideTransaction = {
          products,
          ledgerEntries,
        };

        throw new Error("Simulated Order save failure after reservations");
      });

    try {
      const response = await submitCartCheckout(agent, cart, 500);

      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe("INTERNAL_SERVER_ERROR");

      expect(saveSpy).toHaveBeenCalled();
      expect(observedInsideTransaction).not.toBeNull();

      // Prove reservations actually happened before the injected failure.
      const observedFirst = observedInsideTransaction.products.find(
        (product) => String(product._id) === String(firstProduct._id),
      );

      const observedSecond = observedInsideTransaction.products.find(
        (product) => String(product._id) === String(secondProduct._id),
      );

      expect(observedFirst.variants[0].inventory.reservedStock).toBe(
        firstBefore.variants[0].inventory.reservedStock + firstQuantity,
      );

      expect(observedSecond.variants[0].inventory.reservedStock).toBe(
        secondBefore.variants[0].inventory.reservedStock + secondQuantity,
      );

      expect(observedInsideTransaction.ledgerEntries).toHaveLength(2);

      expect(
        observedInsideTransaction.ledgerEntries
          .map((entry) => String(entry.product))
          .sort(),
      ).toEqual(productIds.map(String).sort());

      // After rollback, neither Product retains the new reservation.
      expect(await Product.findById(firstProduct._id).lean()).toEqual(
        firstBefore,
      );

      expect(await Product.findById(secondProduct._id).lean()).toEqual(
        secondBefore,
      );

      expect(await ProductInventoryLedger.countDocuments()).toBe(
        ledgerCountBefore,
      );

      expect(await Order.countDocuments()).toBe(0);

      expect(await findStoredCart(user)).toEqual(originalCart);
    } finally {
      saveSpy.mockRestore();
    }
  });
});
