import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState >= 1) return;

  try {
    await mongoose.connect(process.env.MONGO_URI!, {
      dbName: process.env.DB_NAME || 'company-service',
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw new Error('Failed to connect to MongoDB');
  }
}