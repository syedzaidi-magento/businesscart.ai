import { APIGatewayProxyEvent } from 'aws-lambda';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import { handler } from '../src/handler';
import { User } from '../src/models/user';
import { RefreshToken } from '../src/models/refresh-token';
import { BlacklistedToken } from '../src/models/blacklisted-token';
import { connectDB } from '../src/services/db-service';
import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

let mongoServer: MongoMemoryServer;
let app: express.Application;
let request: any;

let consoleLogSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

// Mock environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.MONGO_URI = ''; // Will be set by MongoMemoryServer
process.env.NODE_ENV = 'test';

// Generate JWT for testing
const generateAccessToken = (
  userId: string,
  role: string,
  company_id?: string,
  associate_company_ids: string[] = [],
  options: SignOptions = { expiresIn: '15m' }
) =>
  jwt.sign(
    { user: { id: userId, role, company_id, associate_company_ids } },
    process.env.JWT_SECRET as string,
    options
  );

const generateRefreshToken = (userId: string, role: string) =>
  jwt.sign({ user: { id: userId, role } }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' });

beforeAll(async () => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
    if (args[0].startsWith('DEBUG:')) {
      console.info(...args);
    }
  });
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    console.info('DEBUG: console.error:', ...args);
  });

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await connectDB();

  app = express();
  // Custom middleware to capture raw body
  app.use((req, res, next) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      (req as any).rawBody = body; // Type assertion to avoid TS error
      if (body) {
        try {
          JSON.parse(body); // Validate JSON
          req.body = JSON.parse(body);
        } catch (err) {
          req.body = null; // Mark invalid JSON
        }
      } else {
        req.body = {};
      }
      next();
    });
  });
  app.use((req, res, next) => {
    const event: APIGatewayProxyEvent = {
      httpMethod: req.method,
      path: req.path,
      body: (req as any).rawBody && req.body === null ? (req as any).rawBody : JSON.stringify(req.body || {}),
      headers: {
        ...req.headers,
        Cookie: req.headers.cookie || (req.headers.authorization ? `token=${req.headers.authorization.replace('Bearer ', '')}` : undefined),
      } as any,
      requestContext: {} as any,
      pathParameters: null,
      queryStringParameters: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      stageVariables: null,
      isBase64Encoded: false,
      resource: '',
    };

    handler(event)
      .then((result) => {
        res.status(result.statusCode)
          .set({ 'Content-Type': 'application/json', ...result.headers }) // Ensure Content-Type
          .send(result.body);
      })
      .catch((err) => {
        console.error('Handler error:', err);
        res.status(500)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ message: 'Test error', error: err.message }));
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
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
  await BlacklistedToken.deleteMany({});
});

beforeEach(() => {
  // Ensure JWT_SECRET is set before each test
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
});

describe('User Service API', () => {
  test('should register a new user with customer role', async () => {
    const response = await request
      .post('/users/register')
      .send({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
        role: 'customer',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining(`token=${response.body.accessToken}`)
    );

    const user = await User.findOne({ email: 'john@example.com' });
    expect(user).toBeTruthy();
    expect(user?.name).toBe('John Doe');
    expect(user?.role).toBe('customer');

    const refreshToken = await RefreshToken.findOne({ userId: user?._id });
    expect(refreshToken).toBeTruthy();
    expect(refreshToken?.token).toBe(response.body.refreshToken);
  });

  test('should prevent registering a user with existing email', async () => {
    await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });

    const response = await request
      .post('/users/register')
      .send({
        name: 'Jane Doe',
        email: 'john@example.com',
        password: 'password123',
        role: 'customer',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'User already exists' });
  });

  test('should validate register input', async () => {
    const response = await request
      .post('/users/register')
      .send({
        name: '',
        email: 'invalid',
        password: 'short',
        role: 'invalid',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        expect.objectContaining({ message: 'Name is required', path: ['name'] }),
        expect.objectContaining({ message: 'Please include a valid email', path: ['email'] }),
        expect.objectContaining({ message: 'Password must be 6 or more characters', path: ['password'] }),
        expect.objectContaining({ message: 'Role must be customer, company, or admin', path: ['role'] }),
      ],
    });
  });

  test('should login a user with valid credentials', async () => {
    const password = 'password123';
    const user = new User({
      name: 'John Doe',
      email: 'john@example.com',
      password,
      role: 'customer',
    });
    await user.save();

    const response = await request
      .post('/users/login')
      .send({
        email: 'john@example.com',
        password,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining(`token=${response.body.accessToken}`)
    );

    const savedUser = await User.findOne({ email: 'john@example.com' });
    const refreshToken = await RefreshToken.findOne({ userId: savedUser?._id });
    expect(refreshToken).toBeTruthy();
    expect(refreshToken?.token).toBe(response.body.refreshToken);
  });

  test('should reject login with invalid credentials', async () => {
    await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });

    const response = await request
      .post('/users/login')
      .send({
        email: 'john@example.com',
        password: 'wrongpassword',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid credentials' });
  });

  test('should validate login input', async () => {
    const response = await request
      .post('/users/login')
      .send({
        email: 'invalid',
        password: '',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        expect.objectContaining({ message: 'Please include a valid email', path: ['email'] }),
        expect.objectContaining({ message: 'Password is required', path: ['password'] }),
      ],
    });
  });

  test('should refresh access token with valid refresh token', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const refreshToken = generateRefreshToken(user._id.toString(), 'customer');
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await request
      .post('/users/refresh')
      .send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
    });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining(`token=${response.body.accessToken}`)
    );
  });

  test('should reject refresh with invalid refresh token', async () => {
    const response = await request
      .post('/users/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid or expired refresh token' });
  });

  test('should validate refresh input', async () => {
    const response = await request
      .post('/users/refresh')
      .send({ refreshToken: '' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        expect.objectContaining({
          message: 'Refresh token is required',
          path: ['refreshToken'],
        }),
      ],
    });
  });

  test('should logout a user with cookie token', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');
    const refreshToken = generateRefreshToken(user._id.toString(), 'customer');
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await request
      .post('/users/logout')
      .set('Cookie', `token=${accessToken}`)
      .send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Logged out successfully' });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining('token=;')
    );

    const refreshTokenDoc = await RefreshToken.findOne({ token: refreshToken });
    expect(refreshTokenDoc).toBeNull();

    const blacklistedToken = await BlacklistedToken.findOne({ token: accessToken });
    expect(blacklistedToken).toBeTruthy();
  });

  test('should logout a user with authorization header', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');
    const refreshToken = generateRefreshToken(user._id.toString(), 'customer');
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await request
      .post('/users/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Logged out successfully' });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining('token=;')
    );

    const refreshTokenDoc = await RefreshToken.findOne({ token: refreshToken });
    expect(refreshTokenDoc).toBeNull();

    const blacklistedToken = await BlacklistedToken.findOne({ token: accessToken });
    expect(blacklistedToken).toBeTruthy();
  });

  test('should reject logout with invalid refresh token', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');

    const response = await request
      .post('/users/logout')
      .set('Cookie', `token=${accessToken}`)
      .send({ refreshToken: 'invalid-token' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid refresh token' });
  });

  test('should validate logout input', async () => {
    const response = await request
      .post('/users/logout')
      .send({ refreshToken: '', accessToken: '' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        expect.objectContaining({
          message: 'Refresh token is required',
          path: ['refreshToken'],
        }),
        expect.objectContaining({
          message: 'Access token is required',
          path: ['accessToken'],
        }),
      ],
    });
  });

  test('should return 404 for unknown route', async () => {
    const response = await request
      .post('/users/unknown')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Route not found' });
  });

  test('should handle invalid JSON body', async () => {
    const response = await request
      .post('/users/register')
      .set('Content-Type', 'application/json')
      .send('{invalid}');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid JSON body' });
  });

  test('should update user company_id with valid company role and token', async () => {
    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'company');

    const response = await request
      .patch(`/users/${user._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user: {
        _id: user._id.toString(),
        company_id: 'COMP123',
        role: 'company',
      },
      accessToken: expect.any(String),
    });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining(`token=${response.body.accessToken}`)
    );

    const updatedUser = await User.findById(user._id);
    expect(updatedUser?.company_id).toBe('COMP123');
  });

  test('should reject update for non-company role', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');

    const response = await request
      .patch(`/users/${user._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  test('should reject update with missing token', async () => {
    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });

    const response = await request
      .patch(`/users/${user._id}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'No token provided' });
  });

  test('should reject update for non-existent user', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const accessToken = generateAccessToken(nonExistentId, 'company');

    const response = await request
      .patch(`/users/${nonExistentId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'User not found' });
  });

  test('should reject update with tampered token', async () => {
    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });
    const tamperedToken = generateAccessToken(user._id.toString(), 'company') + 'tampered';

    const response = await request
      .patch(`/users/${user._id}`)
      .set('Authorization', `Bearer ${tamperedToken}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to update user' });
  });

  test('should associate customer with company using valid token', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');

    const response = await request
      .post('/users/associate-company')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ companyId: '68508d3792d2eaab46947af4' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
    });
    expect(response.headers['set-cookie']).toContainEqual(
      expect.stringContaining(`token=${response.body.accessToken}`)
    );

    const updatedUser = await User.findById(user._id);
    expect(updatedUser?.associate_company_ids).toContain('68508d3792d2eaab46947af4');

    const decoded = jwt.verify(response.body.accessToken, process.env.JWT_SECRET!) as any;
    expect(decoded.user.associate_company_ids).toContain('68508d3792d2eaab46947af4');
  });

  test('should reject associate company for non-customer role', async () => {
    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'company');

    const response = await request
      .post('/users/associate-company')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ companyId: '68508d3792d2eaab46947af4' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Unauthorized: Customer role required' });
  });

  test('should reject associate company with missing token', async () => {
    const response = await request
      .post('/users/associate-company')
      .send({ companyId: '68508d3792d2eaab46947af4' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'No token provided' });
  });

  test('should reject associate company for non-existent user', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const accessToken = generateAccessToken(nonExistentId, 'customer');

    const response = await request
      .post('/users/associate-company')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ companyId: '68508d3792d2eaab46947af4' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'User not found' });
  });

  test('should reject associate company with invalid companyId', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');

    const response = await request
      .post('/users/associate-company')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ companyId: '' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: 'Company ID is required',
          path: ['companyId'],
        }),
      ]),
    });
  });

  test('should reject refresh access token for non-existent user', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const refreshToken = generateRefreshToken(nonExistentId, 'customer');
    await RefreshToken.create({
      userId: nonExistentId,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await request
      .post('/users/refresh')
      .send({ refreshToken });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'User not found' });
  });

  test('should reject logout with expired access token', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const expiredAccessToken = jwt.sign(
      { user: { id: user._id.toString(), role: 'customer' } },
      process.env.JWT_SECRET!,
      { expiresIn: '-1s' } // Expired
    );
    const refreshToken = generateRefreshToken(user._id.toString(), 'customer');
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await request
      .post('/users/logout')
      .set('Authorization', `Bearer ${expiredAccessToken}`)
      .send({ refreshToken });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Server error' });
  });

  test('should handle case-insensitive email registration', async () => {
    await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });

    const response = await request
      .post('/users/register')
      .send({
        name: 'Jane Doe',
        email: 'John@example.com',
        password: 'password123',
        role: 'customer',
      });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'User already exists' });
  });

  test('should handle missing JWT_SECRET', async () => {
    const originalJwtSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });
    const accessToken = jwt.sign(
      { user: { id: user._id.toString(), role: 'company' } },
      originalJwtSecret!,
      { expiresIn: '15m' }
    );

    const response = await request
      .patch(`/users/${user._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to update user' });

    process.env.JWT_SECRET = originalJwtSecret;
  });

  test('should reject update with invalid company_id', async () => {
    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'company');

    const response = await request
      .patch(`/users/${user._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_id: '' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: 'Company ID is required',
          path: ['company_id'],
        }),
      ]),
    });
  });

  test('should handle case-insensitive email login', async () => {
    await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });

    const response = await request
      .post('/users/login')
      .send({
        email: 'John@example.com',
        password: 'password123',
      });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid credentials' });
  });

  test('should reject update with expired access token', async () => {
    const user = await User.create({
      name: 'Company Inc',
      email: 'company@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'company',
    });
    const expiredAccessToken = generateAccessToken(user._id.toString(), 'company', undefined, [], { expiresIn: '-1s' });

    const response = await request
      .patch(`/users/${user._id}`)
      .set('Authorization', `Bearer ${expiredAccessToken}`)
      .send({ company_id: 'COMP123' });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to update user' });
  });

  test('should reject logout with blacklisted access token', async () => {
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('password123', 10),
      role: 'customer',
    });
    const accessToken = generateAccessToken(user._id.toString(), 'customer');
    const refreshToken = generateRefreshToken(user._id.toString(), 'customer');
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await BlacklistedToken.create({
      token: accessToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const response = await request
      .post('/users/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    console.log('Raw response text:', response.text); // Debug

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Server error' });
  });
});