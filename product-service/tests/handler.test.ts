import { APIGatewayProxyEvent } from 'aws-lambda';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import { handler } from '../src/handler';
import { Product } from '../src/models/product';
import { connectDB } from '../src/services/db-service';
import jwt from 'jsonwebtoken';

let mongoServer: MongoMemoryServer;
let app: express.Application;
let request: supertest.SuperTest<supertest.Test>;

// Mock environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.MONGO_URI = '';
process.env.NODE_ENV = 'test';

// Generate JWT
const generateToken = (userId: string, role: string) =>
  jwt.sign({ user: { id: userId, role } }, process.env.JWT_SECRET!, { expiresIn: '1h' });

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectDB();

  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    let productId: string | undefined;
    if (req.path.startsWith('/products/') && req.path.split('/').length === 3) {
      productId = req.path.split('/')[2];
    }

    const event: APIGatewayProxyEvent = {
      httpMethod: req.method,
      path: req.path,
      body: JSON.stringify(req.body),
      headers: req.headers as any,
      requestContext: {
        authorizer: {
          userId: req.headers['x-user-id'],
          userRole: req.headers['x-user-role'],
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

    handler(event)
      .then((result) => {
        res.status(result.statusCode).set(result.headers || {}).send(result.body);
      })
      .catch((err) => {
        res.status(500).send({ message: 'Test error', error: err.message });
      });
  });

  request = supertest(app);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
});

afterEach(async () => {
  await Product.deleteMany({});
});

describe('Product Service API', () => {
  const userId1 = '683a1c42b4bb94b3f2cde96a';
  const userId2 = '683a1c42b4bb94b3f2cde96b';
  const companyId = '683a1c42b4bb94b3f2cde96c';
  const companyToken = generateToken(userId1, 'company');
  const customerToken = generateToken(userId1, 'customer');

  test('should create a product for a user with company role', async () => {
    const response = await request
      .post('/products')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'TestProduct',
        price: 99.99,
        companyId,
        description: 'A test product',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'TestProduct',
      price: 99.99,
      companyId,
      userId: userId1,
    });

    const product = await Product.findOne({ userId: userId1 });
    expect(product).toBeTruthy();
  });

  test('should allow creating multiple products for the same company', async () => {
    await Product.create({
      name: 'Product1',
      price: 49.99,
      companyId,
      userId: userId1,
    });

    const response = await request
      .post('/products')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'Product2',
        price: 29.99,
        companyId,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Product2',
      price: 29.99,
      companyId,
      userId: userId1,
    });

    const products = await Product.find({ userId: userId1 });
    expect(products.length).toBe(2);
  });

  test('should list all products for the company user', async () => {
    await Product.create([
      { name: 'Product1', price: 49.99, companyId, userId: userId1 },
      { name: 'Product2', price: 29.99, companyId, userId: userId1 },
    ]);

    const response = await request
      .get('/products')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(2);
    expect(response.body[0]).toMatchObject({ name: 'Product1', price: 49.99 });
  });

  test('should allow access to own product', async () => {
    const product = await Product.create({
      name: 'TestProduct',
      price: 99.99,
      companyId,
      userId: userId1,
    });
    console.log('Created product ID:', product._id.toString());

    const savedProduct = await Product.findById(product._id);
    expect(savedProduct).toBeTruthy();

    const response = await request
      .get(`/products/${product._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'TestProduct',
      price: 99.99,
      companyId,
      userId: userId1,
    });
  });

  test('should prevent access to another user’s product', async () => {
    const product = await Product.create({
      name: 'TestProduct',
      price: 99.99,
      companyId,
      userId: userId1,
    });
    console.log('Created product ID:', product._id.toString());

    const savedProduct = await Product.findById(product._id);
    expect(savedProduct).toBeTruthy();

    const response = await request
      .get(`/products/${product._id.toString()}`)
      .set('Authorization', `Bearer ${generateToken(userId2, 'company')}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to product' });
  });

  test('should update own product', async () => {
    const product = await Product.create({
      name: 'TestProduct',
      price: 99.99,
      companyId,
      userId: userId1,
    });

    const response = await request
      .put(`/products/${product._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'UpdatedProduct',
        price: 149.99,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'UpdatedProduct',
      price: 149.99,
      companyId,
      userId: userId1,
    });
  });

  test('should delete own product', async () => {
    const product = await Product.create({
      name: 'TestProduct',
      price: 99.99,
      companyId,
      userId: userId1,
    });

    const response = await request
      .delete(`/products/${product._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(204);
    const deletedProduct = await Product.findById(product._id);
    expect(deletedProduct).toBeNull();
  });

  test('should deny access for non-company role', async () => {
    const response = await request
      .post('/products')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .send({
        name: 'TestProduct',
        price: 99.99,
        companyId,
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  });

  test('should validate product creation input', async () => {
    const response = await request
      .post('/products')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: '',
        price: 99.99,
        companyId,
      });

    expect(response.status).toBe(400);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ message: 'Name is required' })
    );
  });
});