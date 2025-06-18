import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
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
    process.env.JWT_SECRET!,
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

    if (pathParts[0] === 'companies') {
      if (pathParts.length === 2 && pathParts[1] !== 'code' && pathParts[1] !== 'customers') {
        pathParameters = { companyId: pathParts[1] };
      } else if (pathParts.length === 3 && pathParts[1] === 'code' && pathParts[2] !== 'customers') {
        pathParameters = { code: pathParts[2] };
      } else if (pathParts.length === 3 && pathParts[1] === 'customers') {
        pathParameters = { customerId: pathParts[2] };
      } else if (pathParts.length === 3 && pathParts[2] === 'customers') {
        pathParameters = { companyId: pathParts[1] };
      } else if (pathParts.length === 4 && pathParts[1] === 'code' && pathParts[3] === 'customers') {
        pathParameters = { code: pathParts[2] };
      }
    }

    // Collect raw request body
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // Mock APIGatewayProxyEvent
      const event: APIGatewayProxyEvent = {
        httpMethod: req.method,
        path: req.path,
        body: body || null,
        headers: req.headers as any,
        requestContext: {
          authorizer: {
            userId: req.headers['x-user-id'] || undefined,
            userRole: req.headers['x-user-role'] || undefined,
            company_id: req.headers['x-company-id'] || null,
            associateCompanyIds: req.headers['x-associate-company-ids'] || '[]',
          },
        } as any,
        pathParameters,
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
  await Company.deleteMany({});
});

describe('Company Service API', () => {
  const userId1 = new mongoose.Types.ObjectId().toString();
  const userId2 = new mongoose.Types.ObjectId().toString();
  const companyId1 = new mongoose.Types.ObjectId().toString();
  const companyToken = generateToken(userId1, 'company', companyId1);
  const customerToken = generateToken(userId1, 'customer', undefined, [companyId1]);
  const adminToken = generateToken(userId1, 'admin');
  const invalidToken = generateToken(userId2, 'invalid');

  // POST /companies
  test('should create a company for a user with company role', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1)
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
    await Company.create({
      name: 'FirstCompany',
      companyCode: 'FIRST123',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });

    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1)
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

  test('should deny access for non-company role creating company', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([companyId1]))
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
      .set('x-company-id', companyId1)
      .send({
        name: '',
        companyCode: '',
        paymentMethods: [],
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Name is required', path: ['name'] }),
        expect.objectContaining({ message: 'Company code is required', path: ['companyCode'] }),
        expect.objectContaining({ message: 'At least one payment method is required', path: ['paymentMethods'] }),
      ]),
    });
  });

  test('should handle missing userId for company creation', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1)
      .send({
        name: 'TestCompany',
        companyCode: 'TEST123',
        paymentMethods: ['cash'],
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: User ID required' });
  });

  // GET /companies
  test('should allow admin to view all companies', async () => {
    await Company.create({
      name: 'Company1',
      companyCode: 'COMP1',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });
    await Company.create({
      name: 'Company2',
      companyCode: 'COMP2',
      userId: userId2,
      paymentMethods: ['credit_card'],
      sellingArea: {
        radius: 15,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });

    const response = await request
      .get('/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Company1', companyCode: 'COMP1', userId: userId1 }),
        expect.objectContaining({ name: 'Company2', companyCode: 'COMP2', userId: userId2 }),
      ])
    );
  });

  test('should allow company to view own companies', async () => {
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

    const response = await request
      .get('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
    });
  });

  test('should allow customer to view associated companies', async () => {
    const company = await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId2,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
      customers: [userId1],
    });

    const response = await request
      .get('/companies')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId2,
    });
  });

  test('should return empty array for customer with no associated companies', async () => {
    await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId2,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });

    const response = await request
      .get('/companies')
      .set('Authorization', `Bearer ${generateToken(userId1, 'customer', undefined, [])}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', '[]');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test('should reject GET /companies for invalid role', async () => {
    const response = await request
      .get('/companies')
      .set('Authorization', `Bearer ${invalidToken}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'invalid');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Invalid role' });
  });

  test('should handle invalid associateCompanyIds for customer', async () => {
    const response = await request
      .get('/companies')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', 'invalid-json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid associate company IDs' });
  });

  // GET /companies/{companyId}
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

    const response = await request
      .get(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString());

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

    const response = await request
      .get(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${generateToken(userId2, 'company')}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to company' });
  });

  test('should return 404 for non-existent company', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request
      .get(`/companies/${nonExistentId}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Company not found' });
  });

  // PUT /companies/{companyId}
  test('should update own company', async () => {
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

    const response = await request
      .put(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString())
      .send({
        name: 'UpdatedCompany',
        paymentMethods: ['credit_card'],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'UpdatedCompany',
      companyCode: 'TEST123',
      paymentMethods: ['credit_card'],
    });

    const updatedCompany = await Company.findById(company._id);
    expect(updatedCompany?.name).toBe('UpdatedCompany');
    expect(updatedCompany?.paymentMethods).toEqual(['credit_card']);
  });

  test('should prevent updating another user’s company', async () => {
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

    const response = await request
      .put(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${generateToken(userId2, 'company')}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'company')
      .send({
        name: 'UpdatedCompany',
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to company' });
  });

  test('should validate update company input', async () => {
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

    const response = await request
      .put(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString())
      .send({
        name: '',
        paymentMethods: [],
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Name is required', path: ['name'] }),
        expect.objectContaining({ message: 'At least one payment method is required', path: ['paymentMethods'] }),
      ]),
    });
  });

  test('should return 404 for updating non-existent company', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request
      .put(`/companies/${nonExistentId}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1)
      .send({
        name: 'UpdatedCompany',
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Company not found' });
  });

  test('should deny non-company role updating company', async () => {
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

    const response = await request
      .put(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]))
      .send({
        name: 'UpdatedCompany',
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  });

  // DELETE /companies/{companyId}
  test('should delete own company', async () => {
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

    const response = await request
      .delete(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString());

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const deletedCompany = await Company.findById(company._id);
    expect(deletedCompany).toBeNull();
  });

  test('should prevent deleting another user’s company', async () => {
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

    const response = await request
      .delete(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${generateToken(userId2, 'company')}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'company');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to company' });
  });

  test('should return 404 for deleting non-existent company', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request
      .delete(`/companies/${nonExistentId}`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Company not found' });
  });

  test('should deny non-company role deleting company', async () => {
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

    const response = await request
      .delete(`/companies/${company._id.toString()}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized: Company role required' });
  });

  // POST /companies/{companyId}/customers
  test('should allow company to add a customer', async () => {
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

    const response = await request
      .post(`/companies/${company._id.toString()}/customers`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString())
      .send({ customerId: userId2 });

    expect(response.status).toBe(200);
    expect(response.body.customers).toContain(userId2);

    const updatedCompany = await Company.findById(company._id);
    expect(updatedCompany?.customers).toContain(userId2);
  });

  test('should prevent adding customer to another user’s company', async () => {
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

    const response = await request
      .post(`/companies/${company._id.toString()}/customers`)
      .set('Authorization', `Bearer ${generateToken(userId2, 'company')}`)
      .set('x-user-id', userId2)
      .set('x-user-role', 'company')
      .send({ customerId: userId2 });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Unauthorized access to company' });
  });

  test('should return 404 for adding customer to non-existent company', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request
      .post(`/companies/${nonExistentId}/customers`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1)
      .send({ customerId: userId2 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Company not found' });
  });

  test('should validate add customer input', async () => {
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

    const response = await request
      .post(`/companies/${company._id.toString()}/customers`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString())
      .send({ customerId: '' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Customer ID is required', path: ['customerId'] }),
      ]),
    });
  });

  test('should not duplicate customer in company', async () => {
    const company = await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
      customers: [userId2],
    });

    const response = await request
      .post(`/companies/${company._id.toString()}/customers`)
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', company._id.toString())
      .send({ customerId: userId2 });

    expect(response.status).toBe(200);
    expect(response.body.customers).toEqual([userId2]);

    const updatedCompany = await Company.findById(company._id);
    expect(updatedCompany?.customers).toEqual([userId2]);
  });

  // GET /companies/customers/{customerId}
  test('should get companies associated with a customer', async () => {
    const company1 = await Company.create({
      name: 'Company1',
      companyCode: 'COMP1',
      userId: userId1,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
      customers: [userId1],
    });
    await Company.create({
      name: 'Company2',
      companyCode: 'COMP2',
      userId: userId2,
      paymentMethods: ['credit_card'],
      sellingArea: {
        radius: 15,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });

    const response = await request
      .get(`/companies/customers/${userId1}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company1._id.toString()]));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      name: 'Company1',
      companyCode: 'COMP1',
      customers: [userId1],
    });
  });

  test('should return empty array for customer with no companies', async () => {
    await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId2,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });

    const response = await request
      .get(`/companies/customers/${userId1}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', '[]');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  // POST /companies/code
  test('should fetch company by code via POST', async () => {
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

    const response = await request
      .post('/companies/code')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]))
      .send({ code: 'TEST123' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
    });
  });

  test('should return 404 for invalid company code via POST', async () => {
    const response = await request
      .post('/companies/code')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([companyId1]))
      .send({ code: 'INVALID' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Invalid company code' });
  });

  test('should validate input for POST /companies/code', async () => {
    const response = await request
      .post('/companies/code')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([companyId1]))
      .send({ code: '' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'Code is required', path: ['code'] }),
      ]),
    });
  });

  // GET /companies/code/{code}
  test('should fetch company by code via GET', async () => {
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

    const response = await request
      .get(`/companies/code/TEST123`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId1,
    });
  });

  test('should return 404 for invalid company code via GET', async () => {
    const response = await request
      .get(`/companies/code/INVALID`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([companyId1]));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Invalid company code' });
  });

  // POST /companies/code/{code}/customers
  test('should add customer to company by code', async () => {
    const company = await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId2,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
    });

    const response = await request
      .post(`/companies/code/TEST123/customers`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]));

    expect(response.status).toBe(200);
    expect(response.body.customers).toContain(userId1);

    const updatedCompany = await Company.findById(company._id);
    expect(updatedCompany?.customers).toContain(userId1);
  });

  test('should not duplicate customer when adding by code', async () => {
    const company = await Company.create({
      name: 'TestCompany',
      companyCode: 'TEST123',
      userId: userId2,
      paymentMethods: ['cash'],
      sellingArea: {
        radius: 10,
        center: { lat: 37.7749, lng: -122.4194 },
      },
      customers: [userId1],
    });

    const response = await request
      .post(`/companies/code/TEST123/customers`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([company._id.toString()]));

    expect(response.status).toBe(200);
    expect(response.body.customers).toEqual([userId1]);

    const updatedCompany = await Company.findById(company._id);
    expect(updatedCompany?.customers).toEqual([userId1]);
  });

  test('should return 404 for adding customer to invalid company code', async () => {
    const response = await request
      .post(`/companies/code/INVALID/customers`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'customer')
      .set('x-associate-company-ids', JSON.stringify([companyId1]));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Invalid company code' });
  });

  // General Tests
  test('should return 404 for unknown route', async () => {
    const response = await request
      .get('/unknown')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('x-user-id', userId1)
      .set('x-user-role', 'company');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Route not found' });
  });

  test('should handle invalid JSON body', async () => {
    const response = await request
      .post('/companies')
      .set('Authorization', `Bearer ${companyToken}`)
      .set('Content-Type', 'application/json')
      .set('x-user-id', userId1)
      .set('x-user-role', 'company')
      .set('x-company-id', companyId1)
      .send('{ "invalid": '); // Explicitly malformed JSON

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid JSON body' });
  });
});