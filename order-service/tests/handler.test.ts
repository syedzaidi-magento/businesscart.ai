import { APIGatewayProxyEvent } from 'aws-lambda';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import { handler } from '../src/handler';
import { Order } from '../src/models/order';

// Interface for type safety
interface OrderResponse {
  _id: string;
  base_grand_total: number;
  grand_total: number;
  customer_email: string;
  customer_id?: string;
  user_id: string;
  company_id: string;
  [key: string]: any; // For additional fields
}

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
  const mongooseOptions = {
    serverSelectionTimeoutMS: 5000,
    heartbeatFrequencyMS: 10000,
  };
  await mongoose.connect(process.env.MONGO_URI, mongooseOptions);

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
      // Extract orderId from path if applicable
      let orderId: string | undefined;
      if (req.path.startsWith('/orders/') && req.path.split('/').length === 3) {
        orderId = req.path.split('/')[2];
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
          },
        } as any,
        pathParameters: orderId ? { orderId } : null,
        queryStringParameters: null,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        stageVariables: null,
        isBase64Encoded: false,
        resource: '',
      };

      // Call Lambda handler
      handler(event)
        .then((result) => {
          const headers = result.headers || {};
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }
          res.status(result.statusCode).set(headers).send(result.body);
        })
        .catch((err) => {
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
  await Order.deleteMany({});
}, 10000);

describe('Order Service API', () => {
  const userId1 = 'user123';
  const userId2 = 'user456';
  const customerId = 'customer789';
  const companyId = 'company123';
  const adminId = 'admin123';

  const validOrderData = {
    entity: {
      base_grand_total: 199.97,
      grand_total: 199.97,
      customer_email: 'test@example.com',
      customer_id: customerId,
      billing_address: {
        address_type: 'billing',
        city: 'New York',
        country_id: 'US',
        firstname: 'John',
        lastname: 'Doe',
        postcode: '10001',
        telephone: '1234567890',
        street: ['123 Main St'],
      },
      payment: {
        account_status: 'active',
        additional_information: ['Transaction ID: 12345'],
        cc_last4: '1234',
        method: 'credit_card',
      },
      items: [
        {
          sku: 'item1',
          name: 'Test Item 1',
          qty_ordered: 2,
          price: 99.99,
          row_total: 199.98,
        },
      ],
      status_histories: [
        {
          comment: 'Order placed',
          is_customer_notified: 1,
          is_visible_on_front: 1,
          parent_id: 1,
        },
      ],
      company_id: companyId,
      user_id: userId1,
    },
  };

  test('should create an order with valid input', async () => {
    const response = await request
      .post('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send(validOrderData);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      base_grand_total: 199.97,
      grand_total: 199.97,
      customer_email: 'test@example.com',
      user_id: userId1,
      company_id: companyId,
    });

    const order = await Order.findOne({ user_id: userId1 });
    expect(order).toBeTruthy();
    expect(order?.grand_total).toBe(199.97);
  }, 10000);

  test('should create an order as customer with valid input', async () => {
    const customerOrderData = {
      entity: {
        ...validOrderData.entity,
        user_id: customerId,
      },
    };

    const response = await request
      .post('/orders')
      .set('x-user-id', customerId)
      .set('x-user-role', 'customer')
      .send(customerOrderData);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      base_grand_total: 199.97,
      grand_total: 199.97,
      customer_email: 'test@example.com',
      user_id: customerId,
      customer_id: customerId,
    });

    const order = await Order.findOne({ user_id: customerId });
    expect(order).toBeTruthy();
    expect(order?.customer_id).toBe(customerId);
  }, 10000);

  test('should reject create order without user ID', async () => {
    const response = await request
      .post('/orders')
      .send(validOrderData);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: User ID required' });
  }, 10000);

  test('should reject create order with invalid role', async () => {
    const response = await request
      .post('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'admin')
      .send(validOrderData);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company or Customer role required' });
  }, 10000);

  test('should reject create order with user ID mismatch', async () => {
    const invalidData = {
      entity: { ...validOrderData.entity, user_id: userId2 },
    };
    const response = await request
      .post('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send(invalidData);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: User ID mismatch' });
  }, 10000);

  test('should reject create order with invalid input', async () => {
    const invalidData = {
      entity: {
        ...validOrderData.entity,
        grand_total: -10,
        customer_email: 'invalid',
        items: [],
      },
    };
    const response = await request
      .post('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send(invalidData);

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('errors');
  }, 10000);

  test('should handle invalid JSON body for create order', async () => {
    const response = await request
      .post('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('Content-Type', 'application/json')
      .send('{invalid}');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid JSON body' });
  }, 10000);

  test('should get all orders for authorized company user', async () => {
    await Order.create([
      { ...validOrderData.entity, user_id: userId1, customer_email: 'test1@example.com' },
      { ...validOrderData.entity, user_id: userId1, grand_total: 299.99, customer_email: 'test2@example.com' },
      { ...validOrderData.entity, user_id: userId2, customer_email: 'test3@example.com' },
    ]);

    const response = await request
      .get('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((o: OrderResponse) => o.grand_total).sort()).toEqual([199.97, 299.99]);
  }, 10000);

  test('should get all orders for authorized customer user', async () => {
    await Order.create([
      { ...validOrderData.entity, customer_id: customerId, user_id: userId1, customer_email: 'test1@example.com' },
      { ...validOrderData.entity, customer_id: customerId, user_id: userId1, grand_total: 299.99, customer_email: 'test2@example.com' },
      { ...validOrderData.entity, customer_id: userId2, user_id: userId1, customer_email: 'test3@example.com' },
    ]);

    const response = await request
      .get('/orders')
      .set('x-user-id', customerId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((o: OrderResponse) => o.grand_total).sort()).toEqual([199.97, 299.99]);
  }, 10000);

  test('should get all orders for admin user', async () => {
    await Order.create([
      { ...validOrderData.entity, user_id: userId1, customer_email: 'test1@example.com' },
      { ...validOrderData.entity, user_id: userId2, customer_email: 'test2@example.com' },
    ]);

    const response = await request
      .get('/orders')
      .set('x-user-id', adminId)
      .set('x-user-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(2);
  }, 10000);

  test('should reject get orders with invalid role', async () => {
    const response = await request
      .get('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'invalid');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Invalid role' });
  }, 10000);

  test('should get a specific order by ID for company user', async () => {
    const order = await Order.create(validOrderData.entity);

    const response = await request
      .get(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      grand_total: 199.97,
      user_id: userId1,
      customer_id: customerId,
    });
  }, 10000);

  test('should get a specific order by ID for customer user', async () => {
    const order = await Order.create(validOrderData.entity);

    const response = await request
      .get(`/orders/${order._id}`)
      .set('x-user-id', customerId)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      grand_total: 199.97,
      customer_id: customerId,
    });
  }, 10000);

  test('should reject get order with invalid ID', async () => {
    const response = await request
      .get('/orders/invalidId')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Order not found' });
  }, 10000);

  test('should reject get order for unauthorized company user', async () => {
    const order = await Order.create({ ...validOrderData.entity, user_id: userId2 });

    const response = await request
      .get(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to order' });
  }, 10000);

  test('should reject get order for unauthorized customer user', async () => {
    const order = await Order.create({ ...validOrderData.entity, customer_id: userId2 });

    const response = await request
      .get(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to order' });
  }, 10000);



  test('should update an order with valid input', async () => {
    const order = await Order.create(validOrderData.entity);

    const updateData = {
      entity: {
        grand_total: 249.99,
        status_histories: [
          {
            comment: 'Order updated',
            is_customer_notified: 1,
            is_visible_on_front: 1,
            parent_id: 2,
          },
        ],
      },
    };

    const response = await request
      .put(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send(updateData);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      grand_total: 249.99,
      user_id: userId1,
    });

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.grand_total).toBe(249.99);
  }, 10000);

  test('should reject update order with non-company role', async () => {
    const order = await Order.create(validOrderData.entity);

    const response = await request
      .put(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .send({ entity: { grand_total: 249.99 } });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  }, 10000);

  test('should reject update order with invalid ID', async () => {
    const response = await request
      .put('/orders/invalidId')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({ entity: { grand_total: 249.99 } });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Order not found' });
  }, 10000);

  test('should reject update order for unauthorized user', async () => {
    const order = await Order.create({ ...validOrderData.entity, user_id: userId2 });

    const response = await request
      .put(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({ entity: { grand_total: 249.99 } });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to order' });
  }, 10000);

  test('should delete an order', async () => {
    const order = await Order.create(validOrderData.entity);

    const response = await request
      .delete(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const deletedOrder = await Order.findById(order._id);
    expect(deletedOrder).toBeNull();
  }, 10000);

  test('should reject delete order with non-company role', async () => {
    const order = await Order.create(validOrderData.entity);

    const response = await request
      .delete(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  }, 10000);

  test('should reject delete order with invalid ID', async () => {
    const response = await request
      .delete('/orders/invalidId')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Order not found' });
  }, 10000);

  test('should reject delete order for unauthorized user', async () => {
    const order = await Order.create({ ...validOrderData.entity, user_id: userId2 });

    const response = await request
      .delete(`/orders/${order._id}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to order' });
  }, 10000);

  test('should handle unexpected server error', async () => {
    jest.spyOn(Order, 'create').mockImplementationOnce(() => {
      throw new Error('Database failure');
    });

    const response = await request
      .post('/orders')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send(validOrderData);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Database failure' });

    jest.restoreAllMocks();
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