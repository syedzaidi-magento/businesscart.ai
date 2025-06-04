import { Order, IOrder } from '../models/order';
import { CreateOrderInput, UpdateOrderInput } from '../validation';

export class OrderService {
  async createOrder(data: CreateOrderInput['entity'], userId: string): Promise<IOrder> {
    if (data.user_id !== userId) {
      throw new Error('Unauthorized: User ID mismatch');
    }
    const order = new Order(data);
    await order.save();
    return order;
  }

  async getOrders(userId: string, userRole: string): Promise<IOrder[]> {
    if (userRole !== 'company') {
      throw new Error('Unauthorized: Company role required');
    }
    return await Order.find({ user_id: userId });
  }

  async getOrderById(orderId: string, userId: string, userRole: string): Promise<IOrder> {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    if (userRole === 'company' && order.user_id !== userId) {
      throw new Error('Unauthorized access to order');
    }
    if (userRole === 'customer' && order.customer_id !== userId) {
      throw new Error('Unauthorized access to order');
    }
    return order;
  }

  async updateOrder(orderId: string, data: UpdateOrderInput['entity'], userId: string): Promise<IOrder> {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    if (order.user_id !== userId) {
      throw new Error('Unauthorized access to order');
    }
    Object.assign(order, data);
    await order.save();
    return order;
  }

  async deleteOrder(orderId: string, userId: string): Promise<void> {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    if (order.user_id !== userId) {
      throw new Error('Unauthorized access to order');
    }
    await order.deleteOne();
  }
}
