import { APIGatewayProxyEvent } from 'aws-lambda';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import { handler } from '../src/handler';
import { Company } from '../src/models/company';
import { connectDB } from '../src/services/db-service';
import jwt from 'jsonwebtoken';

let mongoServer: MongoMemoryServer;
let app: express.Application;
let request: supertest.SuperTest<supertest.Test>;

// Mock environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.MONGO_URI = ''; // Will be set by MongoMemoryServer
process.env.NODE_ENV = 'test';

// Generate JWT
const generateToken = (userId: string, role: string) =>
  jwt.sign({ user: { id: userId, role } }, process.env.JWT_SECRET!, { expiresIn: '1h' });

beforeAll(async () => {
  // Start MongoDB Memory Server
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectDB();

  // Setup Express app to wrap Lambda handler
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    // Extract companyId from path if applicable
    let companyId: string | undefined;
    if (req.path.startsWith('/companies/') && req.path.split('/').length === 3) {
      companyId = req.path.split('/')[2];
    }

    // Mock APIGatewayProxyEvent
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
      pathParameters: companyId ? { companyId } : null,
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
  await Company.deleteMany({});
});

describe('Company Service API', () => {
  const userId1 = '683a1c42b4bb94b3f2cde96a';
  const userId2 = '683a1c42b4bb94b3f2cde96b';
  const companyToken = generateToken(userId1, 'company');
  const customerToken = generateToken(userId1, 'customer');

  test('should create a company for a user with company role', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'TestCompany',
        companyCode: 'TEST123',
        paymentMethods: ['cash'],
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          zip: '12345',
          coordinates: { lat: 37.7749, lng: -122.4194 },
        },
        sellingArea: {
          radius: 10,
          center: { lat: 37.7749, lng: -122.4194 },
        },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
      paymentMethods: ['cash'],
    });

    const company = await Company.findOne({ userId: userId1 });
    expect(company).toBeTruthy();
  });

  test('should prevent creating a second company for the same user', async () => {
    // Create first company
    const company = await Company.create({
      name: 'FirstCompany',
      companyCode: 'FIRST123',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });
    console.log('Created company:', company);

    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: 'SecondCompany',
        companyCode: 'SECOND123',
        paymentMethods: ['cash'],
        sellingArea: {
          radius: 10,
          center: { lat: 37.7749, lng: -122.4194 },
        },
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'User can only create one company' });
  });

  test('should allow access to own company', async () => {
    const company = await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });
    console.log('Created company ID:', company._id.toString());

    // Verify company exists
    const savedCompany = await Company.findById(company._id);
    expect(savedCompany).toBeTruthy();

    const response = await request
      .get(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
    });
  });

  test('should prevent access to another user’s company', async () => {
    const company = await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });
    console.log('Created company ID:', company._id.toString());

    // Verify company exists
    const savedCompany = await Company.findById(company._id);
    expect(savedCompany).toBeTruthy();

    const response = await request
      .get(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${generateToken(userId2, 'company')}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to company' });
  });

  test('should deny access for non-company role', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .send({
        name: 'TestCompany',
        companyCode: 'TEST123',
        paymentMethods: ['cash'],
        sellingArea: {
          radius: 10,
          center: { lat: 37.7749, lng: -122.4194 },
        },
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  });

  test('should validate company creation input', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .send({
        name: '',
        companyCode: 'TEST123',
        paymentMethods: ['cash'],
        sellingArea: {
          radius: 10,
          center: { lat: 37.7749, lng: -122.4194 },
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ message: 'Name is required' })
    );
  });
});