import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import { handler } from '../src/handler';
import { Product } from '../src/models/product';
import { connectDB } from '../src/services/db-service';
import { json } from 'stream/consumers';

let mongoServer: MongoMemoryServer;
let app: express.Application;
let request: supertest.SuperTest<supertest.Test>;

// Mock environment variables
process.env.MONGO_URI = '';
process.env.NODE_ENV = 'test';

// Mock console.log and console.error to suppress logs
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  // Start MongoDB Memory Server
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectDB();

  // Setup Express app to wrap Lambda handler
  app = express();

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Capture raw body
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      // Extract productId from path if applicable
      let productId: string | undefined;
      if (req.path.startsWith('/products/') && req.path.split('/').length === 3) {
        productId = req.path.split('/')[2];
      }

      // Mock APIGatewayProxyEvent
      const event: APIGatewayProxyEvent = {
        httpMethod: req.method,
        path: req.path,
        body: rawBody || null,
        headers: req.headers as any,
        requestContext: {
          authorizer: {
            userId: req.headers['x-user-id'],
            userRole: req.headers['x-user-role'],
            associateCompanyIds: req.headers['x-associate-company-ids'] || '[]',
          },
        } as any,
        pathParameters: productId ? { productId } : null,
        queryStringParameters: null,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        stageVariables: null,
        isBase64Encoded: false,
        resource: '',
      };

      // Call Lambda handler
      handler(event)
        .then((result: APIGatewayProxyResult) => {
          const headers = result.headers || {};
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }
          res.status(result.statusCode).set(headers).send(result.body);
        })
        .catch((err: Error) => {
          res.status(500).send({ message: 'Test error', error: err.message });
        });
    });
  });

  request = supertest(app);
}, 30000);

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
}, 30000);

afterEach(async () => {
  await Product.deleteMany({});
}, 10000);

describe('Product Service API', () => {
  const userId1 = 'user123';
  const userId2 = 'user456';
  const companyId1 = 'company123';
  const companyId2 = 'company456';

  test('should create a product with valid input', async () => {
    const response = await request
      .post('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'Test Product',
        price: 99.99,
        companyId: companyId1,
        description: 'A sample product',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId1,
      description: 'A sample product',
    });

    const product = await Product.findOne({ name: 'Test Product' });
    expect(product).toBeTruthy();
    expect(product?.userId).toBe(userId1);
  }, 10000);

  test('should reject create product without user context', async () => {
    const response = await request
      .post('/products')
      .send({
        name: 'Test Product',
        price: 99.99,
        companyId: companyId1,
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized: Missing user context' });
  }, 10000);

  test('should reject create product with non-company role', async () => {
    const response = await request
      .post('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .send({
        name: 'Test Product',
        price: 99.99,
        companyId: companyId1,
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  }, 10000);

  test('should reject create product with invalid input', async () => {
    const response = await request
      .post('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: '',
        price: -10,
        companyId: '',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Validation failed',
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Name is required' }),
        expect.objectContaining({ message: 'Company ID is required' }),
      ]),
    });
  }, 10000);

  test('should handle invalid JSON body for create product', async () => {
    const response = await request
      .post('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('Content-Type', 'application/json')
      .send('{invalid}');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid JSON body' });
  }, 10000);

  test('should get all products for admin', async () => {
    await Product.create([
      { name: 'Product 1', price: 50, companyId: companyId1, userId: userId1 },
      { name: 'Product 2', price: 75, companyId: companyId1, userId: userId1 },
      { name: 'Product 3', price: 100, companyId: companyId2, userId: userId2 },
    ]);

    const response = await request
      .get('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(3);
    expect(response.body.map((p: any) => p.name)).toEqual(['Product 1', 'Product 2', 'Product 3']);
  }, 10000);

  test('should get all products for company user', async () => {
    await Product.create([
      { name: 'Product 1', price: 50, companyId: companyId1, userId: userId1 },
      { name: 'Product 2', price: 75, companyId: companyId1, userId: userId1 },
      { name: 'Product 3', price: 100, companyId: companyId2, userId: userId2 },
    ]);

    const response = await request
      .get('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((p: any) => p.name)).toEqual(['Product 1', 'Product 2']);
  }, 10000);

  test('should get products for customer with associated companies', async () => {
    await Product.create([
      { name: 'Product 1', price: 50, companyId: companyId1, userId: userId1 },
      { name: 'Product 2', price: 75, companyId: companyId1, userId: userId1 },
      { name: 'Product 3', price: 100, companyId: companyId2, userId: userId2 },
    ]);

    const response = await request
      .get('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([companyId1]));

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((p: any) => p.name)).toEqual(['Product 1', 'Product 2']);
  }, 10000);

  test('should return empty array for customer with no associated companies', async () => {
    await Product.create([
      { name: 'Product 1', price: 50, companyId: companyId1, userId: userId1 },
      { name: 'Product 2', price: 75, companyId: companyId1, userId: userId1 },
    ]);

    const response = await request
      .get('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', '[]');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  }, 10000);

  test('should reject get products for invalid role', async () => {
    const response = await request
      .get('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'invalid');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Invalid role' });
  }, 10000);

  test('should handle invalid associateCompanyIds for customer', async () => {
    const response = await request
      .get('/products')
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', 'invalid-json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid associate company IDs' });
  }, 10000);

  test('should get a specific product by ID', async () => {
    const product = await Product.create({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId1,
    });

    const response = await request
      .get(`/products/${product._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId1,
    });
  }, 10000);

  test('should reject get product with invalid ID', async () => {
    const response = await request
      .get('/products/invalidId')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  }, 10000);

  test('should reject get product for unauthorized user', async () => {
    const product = await Product.create({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId2,
    });

    const response = await request
      .get(`/products/${product._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to product' });
  }, 10000);

  test('should update a product with valid input', async () => {
    const product = await Product.create({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId1,
    });

    const response = await request
      .put(`/products/${product._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'Updated Product',
        price: 149.99,
        description: 'Updated description',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Updated Product',
      price: 149.99,
      companyId: companyId1,
      userId: userId1,
      description: 'Updated description',
    });

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct?.name).toBe('Updated Product');
  }, 10000);

  test('should reject update product with invalid ID', async () => {
    const response = await request
      .put('/products/invalidId')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({ name: 'Updated Product' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  }, 10000);

  test('should reject update product for unauthorized user', async () => {
    const product = await Product.create({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId2,
    });

    const response = await request
      .put(`/products/${product._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({ name: 'Updated Product' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to product' });
  }, 10000);

  test('should delete a product', async () => {
    const product = await Product.create({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId1,
    });

    const response = await request
      .delete(`/products/${product._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const deletedProduct = await Product.findById(product._id);
    expect(deletedProduct).toBeNull();
  }, 10000);

  test('should reject delete product with invalid ID', async () => {
    const response = await request
      .delete('/products/invalidId')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  }, 10000);

  test('should reject delete product for unauthorized user', async () => {
    const product = await Product.create({
      name: 'Test Product',
      price: 99.99,
      companyId: companyId1,
      userId: userId2,
    });

    const response = await request
      .delete(`/products/${product._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to product' });
  }, 10000);

  test('should return 404 for unknown route', async () => {
    const response = await request
      .post('/unknown')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Route not found' });
  }, 10000);
});