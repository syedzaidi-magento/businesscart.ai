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
import jwt from 'jsonwebtoken';
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
const generateAccessToken = (userId: string, role: string) =>
  jwt.sign({ user: { id: userId, role } }, process.env.JWT_SECRET!, { expiresIn: '15m' });

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
        res.status(result.statusCode).set(result.headers || {}).send(result.body);
      })
      .catch((err) => {
        console.error('Handler error:', err);
        res.status(500).send({ message: 'Test error', error: err.message });
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
        expect.objectContaining({ message: 'Role must be customer or company', path: ['role'] }),
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
});