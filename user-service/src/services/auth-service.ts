import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/user';
import { RefreshToken, IRefreshToken } from '../models/refresh-token';
import { BlacklistedToken } from '../models/blacklisted-token';
import { RegisterInput, LoginInput } from '../validation';
import bcrypt from 'bcryptjs';

export class AuthService {
  async register(data: RegisterInput): Promise<{ accessToken: string; refreshToken: string }> {
    const { name, email, password, role } = data;

    let user = await User.findOne({ email });
    if (user) throw new Error('User already exists');

    user = new User({ name, email, password, role });
    await user.save();

    const payload = { 
      user: { 
        id: user.id, 
        role: user.role, 
        company_id: user.company_id || undefined,
        ...(user.role === 'customer' && { associate_company_ids: user.associate_company_ids || [] })
      } 
    };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' });

    await RefreshToken.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return { accessToken, refreshToken };
  }

  async login(data: LoginInput): Promise<{ accessToken: string; refreshToken: string }> {
    const { email, password } = data;

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      throw new Error('Invalid credentials');
    }

    const payload = { 
      user: { 
        id: user.id, 
        role: user.role, 
        company_id: user.company_id || undefined,
        ...(user.role === 'customer' && { associate_company_ids: user.associate_company_ids || [] })
      } 
    };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' });

    await RefreshToken.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string): Promise<string> {
    const storedToken = await RefreshToken.findOne({ token: refreshToken });
    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new Error('Invalid or expired refresh token');
    }

    const user = await User.findById(storedToken.userId);
    if (!user) {
      throw new Error('User not found');
    }

    const payload = { 
      user: { 
        id: user.id, 
        role: user.role, 
        company_id: user.company_id || undefined,
        ...(user.role === 'customer' && { associate_company_ids: user.associate_company_ids || [] })
      } 
    };
    return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
  }

  async logout(refreshToken: string, accessToken: string): Promise<void> {
    const storedToken = await RefreshToken.findOne({ token: refreshToken });
    if (!storedToken) throw new Error('Invalid refresh token');

    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { exp: number };
    await BlacklistedToken.create({
      token: accessToken,
      expiresAt: new Date(decoded.exp * 1000),
    });
    await RefreshToken.deleteOne({ token: refreshToken });
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}