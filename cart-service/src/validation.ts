import { z } from 'zod';

export const createCartItemSchema = z.object({
  entity: z.object({
    productId: z.string().min(1, 'Product ID is required'),
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  }),
});

export const updateCartItemSchema = z.object({
  entity: z.object({
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  }),
});

export type CreateCartItemInput = z.infer<typeof createCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;