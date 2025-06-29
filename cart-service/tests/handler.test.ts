import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import { handler } from '../src/handler';
import { Cart } from '../src/models/cart';
import { connectDB } from '../src/services/db-service';
import jwt from 'jsonwebtoken';

let mongoServer: MongoMemoryServer;
let app: express.Application;
let request: supertest.SuperTest<supertest.Test>;

// Mock environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.MONGO_URI = ''; // Will be set by MongoMemoryServer
process.env.NODE_ENV = 'test';

// Mock console.log and console.error to suppress logs
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Generate JWT
const generateToken = (
  userId: string,
  role: string,
  company_id?: string,
  associate_company_ids: string[] = []
) =>
  jwt.sign(
    { user: { id: userId, role, company_id, associate_company_ids } },
    process.env.JWT_SECRET! as string,
    { expiresIn: '1h' }
  );

beforeAll(async () => {
  // Start MongoDB Memory Server
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectDB();

  // Setup Express app to wrap Lambda handler
  app = express();
  app.use((req, res, next) => {
    // Extract path parameters
    let pathParameters: { [key: string]: string } | null = null;
    const pathParts = req.path.split('/').filter(Boolean);

    if (pathParts[0] === 'cart') {
      if (pathParts.length === 2) { // e.g., /cart/{itemId}
        pathParameters = { itemId: pathParts[1] };
      } else if (pathParts.length === 1) {
        // This handles DELETE /cart for clearing the cart
        pathParameters = null;
      }
    }

    // Collect raw request body
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let eventBody: string | null = null;
      if (body) {
        try {
          // Attempt to parse as JSON, then stringify for the Lambda event
          eventBody = JSON.stringify(JSON.parse(body));
        } catch (e) {
          // If not valid JSON, pass raw body or null
          eventBody = body;
        }
      }

            // Mock APIGatewayProxyEvent
      const event: APIGatewayProxyEvent = {
        httpMethod: req.method,
        path: req.path,
        body: eventBody,
        headers: req.headers as any,
        requestContext: {
          authorizer: {},
        } as any,
        pathParameters,
        queryStringParameters: null,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        stageVariables: null,
        isBase64Encoded: false,
        resource: '',
      };

      // Simulate API Gateway Authorizer by decoding token
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
          event.requestContext.authorizer = {
            userId: decoded.user.id,
            userRole: decoded.user.role,
            companyId: decoded.user.company_id,
            associateCompanyIds: JSON.stringify(decoded.user.associate_company_ids || []),
          };
        } catch (e) {
          // Invalid token, do nothing
        }
      }

      // Call Lambda handler
      handler(event)
        .then((result: APIGatewayProxyResult) => {
          res.status(result.statusCode).set(result.headers || {}).send(result.body);
        })
        .catch((err: Error) => {
          res.status(500).send({ message: 'Test error', error: err.message });
        });
    });
  });

  request = supertest(app);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

afterEach(async () => {
  await Cart.deleteMany({});
});

describe('Cart Service API', () => {
  const customerUserId = new mongoose.Types.ObjectId().toString();
  const customerToken = generateToken(customerUserId, 'customer');
  const adminUserId = new mongoose.Types.ObjectId().toString();
  const adminToken = generateToken(adminUserId, 'admin');
  const companyUserId = new mongoose.Types.ObjectId().toString();
  const companyToken = generateToken(companyUserId, 'company');

  // Helper to create a product for testing
  const createTestProduct = (userId: string, companyId: string) => ({
    productId: new mongoose.Types.ObjectId().toString(),
    name: 'Test Product',
    price: 10.00,
    quantity: 1,
    userId: userId,
    companyId: companyId,
  });

  // POST /cart
  test('should add a new item to an empty cart', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const response = await request
      .post('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { productId: product.productId, quantity: 1 } });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: product.productId,
      quantity: 1,
    });
  });

  test('should increase quantity of an existing item in the cart', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    await Cart.create({
      userId: customerUserId,
      items: [{ ...product, quantity: 1 }],
    });

    const response = await request
      .post('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { productId: product.productId, quantity: 2 } });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: product.productId,
      quantity: 3, // 1 (initial) + 2 (added)
    });
  });

  test('should add a new item to an existing cart with other items', async () => {
    const product1 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const product2 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    product2.productId = new mongoose.Types.ObjectId().toString(); // Ensure unique product ID

    await Cart.create({
      userId: customerUserId,
      items: [{ ...product1, quantity: 1 }],
    });

    const response = await request
      .post('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { productId: product2.productId, quantity: 1 } });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: product1.productId, quantity: 1 }),
        expect.objectContaining({ productId: product2.productId, quantity: 1 }),
      ])
    );
  });

  test('should return 400 for invalid product data when adding to cart', async () => {
    const response = await request
      .post('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { productId: '', quantity: 0 } });

    expect(response.status).toBe(400);
    const body = JSON.parse(response.text);
    expect(body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Product ID is required', path: ['entity', 'productId'] }),
        expect.objectContaining({ message: 'Quantity must be at least 1', path: ['entity', 'quantity'] }),
      ]),
    });
  });

  test('should return 401 if no token is provided', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const response = await request
      .post('/cart')
      .send({ entity: { productId: product.productId, quantity: 1 } });

    expect(response.status).toBe(401);
    const body = JSON.parse(response.text);
    expect(body).toEqual({ message: 'No token provided' });
  });

  test('should return 403 if user role is not customer', async () => {
    const product = createTestProduct(companyUserId, new mongoose.Types.ObjectId().toString());
    const response = await request
      .post('/cart')
      .set('Authorization', `Bearer ${companyToken}`)
      .send({ entity: { productId: product.productId, quantity: 1 } });

    expect(response.status).toBe(403);
    const body = JSON.parse(response.text);
    expect(body).toEqual({ message: 'Unauthorized: Only customers can add items to the cart' });
  });

  // GET /cart
  test('should retrieve an existing cart', async () => {
    const product1 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const product2 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    product2.productId = new mongoose.Types.ObjectId().toString();

    await Cart.create({
      userId: customerUserId,
      items: [{ ...product1, quantity: 1 }, { ...product2, quantity: 2 }],
    });

    const response = await request
      .get('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: product1.productId, quantity: 1 }),
        expect.objectContaining({ productId: product2.productId, quantity: 2 }),
      ])
    );
  });

  test('should return an empty cart if no cart exists for the user', async () => {
    const response = await request
      .get('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body).toMatchObject({ userId: customerUserId, items: [] });
  });

  // PUT /cart/{itemId}
  test('should update quantity of an item in the cart', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const cart = await Cart.create({
      userId: customerUserId,
      items: [{ ...product, quantity: 1 }],
    });
    const itemId = (cart.items[0] as any)._id.toString();

    const response = await request
      .put(`/cart/${itemId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { quantity: 5 } });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: product.productId,
      quantity: 5,
    });
  });

  test('should return 404 if product to update does not exist in cart', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    await Cart.create({
      userId: customerUserId,
      items: [{ ...product, quantity: 1 }],
    });

    const nonExistentItemId = new mongoose.Types.ObjectId().toString();
    const response = await request
      .put(`/cart/${nonExistentItemId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { quantity: 5 } });

    expect(response.status).toBe(404);
    const body = JSON.parse(response.text);
    expect(body).toEqual({ message: 'Cart item not found' });
  });

  test('should return 400 for invalid quantity when updating cart item', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const cart = await Cart.create({
      userId: customerUserId,
      items: [{ ...product, quantity: 1 }],
    });
    const itemId = (cart.items[0] as any)._id.toString();

    const response = await request
      .put(`/cart/${itemId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .send({ entity: { quantity: 0 } });

    expect(response.status).toBe(400);
    const body = JSON.parse(response.text);
    expect(body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Quantity must be at least 1', path: ['entity', 'quantity'] }),
      ]),
    });
  });

  // DELETE /cart/{itemId}
  test('should remove an item from the cart', async () => {
    const product1 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const product2 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    product2.productId = new mongoose.Types.ObjectId().toString();

    const cart = await Cart.create({
      userId: customerUserId,
      items: [{ ...product1, quantity: 1 }, { ...product2, quantity: 2 }],
    });
    const itemIdToRemove = (cart.items[0] as any)._id.toString();

    const response = await request
      .delete(`/cart/${itemIdToRemove}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ productId: product2.productId });
  });

  test('should return 404 if product to remove does not exist in cart', async () => {
    const product = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    await Cart.create({
      userId: customerUserId,
      items: [{ ...product, quantity: 1 }],
    });

    const nonExistentItemId = new mongoose.Types.ObjectId().toString();
    const response = await request
      .delete(`/cart/${nonExistentItemId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(404);
    const body = JSON.parse(response.text);
    expect(body).toEqual({ message: 'Cart item not found' });
  });

  // DELETE /cart
  test('should clear all items from a cart', async () => {
    const product1 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    const product2 = createTestProduct(customerUserId, new mongoose.Types.ObjectId().toString());
    product2.productId = new mongoose.Types.ObjectId().toString();

    await Cart.create({
      userId: customerUserId,
      items: [{ ...product1, quantity: 1 }, { ...product2, quantity: 2 }],
    });

    const response = await request
      .delete('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body.userId).toBe(customerUserId);
    expect(body.items).toHaveLength(0);

    const cartInDb = await Cart.findOne({ userId: customerUserId });
    expect(cartInDb?.items).toHaveLength(0);
  });

  test('should return 200 when clearing an already empty cart', async () => {
    const response = await request
      .delete('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.text);
    expect(body).toMatchObject({ userId: customerUserId, items: [] });
  });

  // General Tests
  test('should return 405 for unknown route', async () => {
    const response = await request
      .get('/unknown')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(405);
    const body = JSON.parse(response.text);
    expect(body).toEqual({ message: 'Method not allowed' });
  });

  test('should handle invalid JSON body', async () => {
    const response = await request
      .post('/cart')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', customerUserId)
      .set('x-user-role', 'customer')
      .set('Content-Type', 'application/json')
      .send('{ "invalid": '); // Explicitly malformed JSON

    expect(response.status).toBe(400);
    const body = JSON.parse(response.text);
    expect(body).toEqual({ message: 'Invalid JSON body' });
  });
});
