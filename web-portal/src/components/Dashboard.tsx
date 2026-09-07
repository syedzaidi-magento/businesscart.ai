import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import Navbar from './Navbar';
import { useAuth } from '../hooks/useAuth';
import { getProducts, getOrders, getAccounts } from '../api';
import { Account, Order } from '../types';
import { computeTier, TierInfo, bandRate } from '../tier';
import { Band, Tile, Pill, STATUS_TONE } from './ui';

interface User {
  id: string;
  name?: string;
  role: 'customer' | 'company' | 'admin' | 'partner';
  email: string;
}

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return Promise.resolve(data as T);
      }
    } catch { /* corrupted cache — refetch */ }
  }
  return fetcher().then(data => {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    return data;
  });
}

// Pin position on the tier rail. Three equal visual segments (Starter / Growth /
// Enterprise) with the real thresholds labeled — a linear 0–1000 scale would
// squash Starter into 10% of the bar.
const TIER_STOPS: { name: TierInfo['tier']; at: number }[] = [
  { name: 'Starter', at: 0 },
  { name: 'Growth', at: 100 },
  { name: 'Enterprise', at: 1000 },
];
function tierPinPct(count: number): number {
  if (count <= 100) return (count / 100) * (100 / 3);
  if (count <= 1000) return 100 / 3 + ((count - 100) / 900) * (100 / 3);
  return 200 / 3 + Math.min(1, (count - 1000) / 1000) * (100 / 3);
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ products: 0, orders: 0, revenue: 0, customers: 0 });
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<{ month: string; revenue: number; orders: number }[]>([]);
  const [lowStock, setLowStock] = useState<{ name: string; stock: number; id: string }[]>([]);
  const [companyStats, setCompanyStats] = useState<{ name: string; products: number; orders: number; revenue: number; customers: number }[]>([]);
  const [adminStats, setAdminStats] = useState({ companies: 0, newSignups: 0 });
  const [tier, setTier] = useState<TierInfo | null>(null);

  useEffect(() => {
    if (!isAuthenticated) { setUser(null); return; }
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.user) setUser(payload.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load user';
      toast.error(msg);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!user || !['company', 'admin'].includes(user.role)) return;

    const load = async () => {
      setLoading(true);
      try {
        const [products, orders, accounts] = await Promise.all([
          cached('dash_products', getProducts),
          cached('dash_orders', () => getOrders()),
          cached('dash_accounts', getAccounts),
        ]);

        const revenue = ((orders as Order[]) || []).reduce((sum: number, o: Order) => sum + (o.grandTotal || 0), 0);
        const customerCount = user.role === 'admin'
          ? ((accounts as Account[]) || []).filter((a: Account) => ['customer', 'b2c'].includes(a.role)).length
          : ((accounts as Account[]) || []).filter((a: Account) => a.role === 'customer').length;

        const orderList = ((orders as Order[]) || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRecentOrders(orderList.slice(0, 5));

        // Compute current pricing tier from this month's non-cancelled orders.
        // Tier is derived, never stored on the company — see exclude/APPLICATION.md.
        if (user.role === 'company') {
          setTier(computeTier(orderList));
        }

        // Monthly revenue (last 6 months)
        const months: Record<string, { revenue: number; orders: number }> = {};
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const key = `${d.getFullYear()}-${d.getMonth()}`;
          months[key] = { revenue: 0, orders: 0 };
        }
        orderList.forEach(o => {
          const d = new Date(o.createdAt);
          const key = `${d.getFullYear()}-${d.getMonth()}`;
          if (months[key]) {
            months[key].revenue += o.grandTotal || 0;
            months[key].orders += 1;
          }
        });
        setMonthlyRevenue(Object.entries(months).map(([key, val]) => {
          const [, m] = key.split('-');
          return { month: monthNames[parseInt(m)], ...val };
        }));

        // Low stock products (stock <= 5, non-zero)
        const productList = (products as { name: string; stock: number; _id: string }[]) || [];
        setLowStock(productList.filter(p => p.stock > 0 && p.stock <= 5).map(p => ({ name: p.name, stock: p.stock, id: p._id })));

        setStats({
          products: productList.length,
          orders: orderList.length,
          revenue,
          customers: customerCount,
        });

        // Admin-only: company performance breakdown
        if (user.role === 'admin') {
          const accountList = accounts as Account[];
          const companies = accountList.filter(a => a.role === 'company');

          // Count signups this month
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const newSignups = accountList.filter(a => {
            const created = (a as unknown as { createdAt: string }).createdAt;
            return created && new Date(created) >= monthStart;
          }).length;

          setAdminStats({ companies: companies.length, newSignups });

          // Per-company breakdown
          const companyMap: Record<string, { name: string; products: number; orders: number; revenue: number; customers: number }> = {};
          companies.forEach(c => {
            companyMap[c._id] = { name: c.company?.name || c.name, products: 0, orders: 0, revenue: 0, customers: 0 };
          });

          productList.forEach(p => {
            const sid = (p as unknown as { sellerID: string }).sellerID;
            if (companyMap[sid]) companyMap[sid].products++;
          });

          orderList.forEach(o => {
            if (companyMap[o.sellerId]) {
              companyMap[o.sellerId].orders++;
              companyMap[o.sellerId].revenue += o.grandTotal || 0;
            }
          });

          // Count customers per company (from attachedCompanies)
          accountList.filter(a => a.role === 'customer').forEach(cust => {
            const attached = (cust as unknown as { attachedCompanies?: { companyId: string }[] }).attachedCompanies;
            if (attached) {
              attached.forEach(ac => {
                if (companyMap[ac.companyId]) companyMap[ac.companyId].customers++;
              });
            }
          });

          setCompanyStats(Object.values(companyMap).sort((a, b) => b.revenue - a.revenue));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  // Month-over-month revenue momentum, from the last two months in the trend.
  const revMoM = (() => {
    if (monthlyRevenue.length < 2) return null;
    const cur = monthlyRevenue[monthlyRevenue.length - 1].revenue;
    const prev = monthlyRevenue[monthlyRevenue.length - 2].revenue;
    if (prev <= 0) return null;
    return Math.round(((cur - prev) / prev) * 100);
  })();

  if (user?.role === 'partner') {
    return (
      <div className="flex h-screen bg-gray-100">
        <Toaster position="top-right" />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Navbar />
          <main className="flex-1 overflow-x-hidden overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto">
              <div className="bg-white rounded-lg shadow p-8 mt-8">
                <h1 className="text-2xl font-semibold text-gray-800 mb-2">
                  Welcome{user.name ? `, ${user.name}` : ''}
                </h1>
                <p className="text-gray-600">
                  Your partner account is set up. Product management, orders, and payouts will appear here as features come online.
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const maxRev = Math.max(...monthlyRevenue.map(m => m.revenue), 1);

  return (
    <div className="flex h-screen bg-gray-100">
      <Toaster position="top-right" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">

            {/* Header */}
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-800">
                  {user ? `Welcome, ${user.name || user.role.charAt(0).toUpperCase() + user.role.slice(1)}` : 'Welcome'}
                </h1>
                <p className="text-gray-500 text-sm mt-1">Here's what's moving this month.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {user?.role === 'company' && (
                  <>
                    <button onClick={() => navigate('/products')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">Add product</button>
                    <button onClick={() => navigate('/orders')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">View orders</button>
                    <button onClick={() => navigate('/companies')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">Storefront settings</button>
                  </>
                )}
                {user?.role === 'admin' && (
                  <>
                    <button onClick={() => navigate('/codes')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">Manage codes</button>
                    <button onClick={() => navigate('/orders')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">View orders</button>
                    <button onClick={() => navigate('/analytics')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">Analytics</button>
                  </>
                )}
              </div>
            </header>

            {/* Hero: billing meter — company only. Its own signature element (no band
                label). Auto-derived from this month's non-cancelled orders. */}
            {user?.role === 'company' && tier && (() => {
              const pin = tierPinPct(tier.monthOrderCount);
              return (
                <section className="relative overflow-hidden bg-white rounded-xl border border-gray-200 shadow-md p-5 sm:p-6 mt-6" aria-label="Pricing tier this month">
                  <span className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-teal-600 to-emerald-500" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <div>
                      <div className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-gray-400">Your plan scales with volume</div>
                      <div className="flex items-baseline gap-2.5 mt-1">
                        <span className="text-3xl font-extrabold tracking-tight text-teal-700">{tier.tier}</span>
                        <span className="text-sm text-gray-500 tabular-nums">
                          {(bandRate(tier.monthOrderCount + 1) * 100).toFixed(0)}% on your next order
                          {tier.perOrderCap !== null ? `, capped at $${tier.perOrderCap}/order` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Estimated bill</div>
                      <div className="text-2xl font-extrabold tracking-tight text-gray-800 tabular-nums">${tier.estimatedBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="relative h-2.5 rounded-md bg-gray-100">
                      <span className="absolute top-0 bottom-0 w-px bg-white" style={{ left: `${100 / 3}%` }} aria-hidden="true" />
                      <span className="absolute top-0 bottom-0 w-px bg-white" style={{ left: `${200 / 3}%` }} aria-hidden="true" />
                      <span className="absolute left-0 top-0 bottom-0 rounded-md bg-gradient-to-r from-teal-600 to-emerald-500" style={{ width: `${pin}%` }} aria-hidden="true" />
                      <span className="absolute top-1/2 w-4 h-4 rounded-full bg-white border-[3px] border-emerald-500 shadow -translate-x-1/2 -translate-y-1/2" style={{ left: `${pin}%` }} aria-hidden="true" />
                    </div>
                    <div className="flex justify-between mt-2.5">
                      {TIER_STOPS.map(s => (
                        <span key={s.name} className={`text-[10px] font-extrabold uppercase tracking-wide ${s.name === tier.tier ? 'text-teal-700' : 'text-gray-400'}`}>
                          {s.name} <span className="tabular-nums font-semibold">{s.at}</span>
                        </span>
                      ))}
                    </div>
                    <p className="mt-3.5 text-[13px] text-gray-600 tabular-nums">
                      <b className="text-teal-700 font-bold">{tier.monthOrderCount} order{tier.monthOrderCount !== 1 ? 's' : ''}</b> this month
                      {tier.nextTierThreshold !== null
                        ? <> · <b className="text-teal-700 font-bold">{tier.ordersToNextTier} more</b> → rate drops to {(bandRate(tier.nextTierThreshold + 1) * 100).toFixed(0)}%</>
                        : <> · top tier</>}
                    </p>
                  </div>
                </section>
              );
            })()}

            {/* Overview tiles */}
            <Band>Overview</Band>
            <div className={`grid grid-cols-2 ${user?.role === 'admin' ? 'lg:grid-cols-6' : 'lg:grid-cols-4'} gap-4`}>
              <Tile loading={loading} label="Total revenue" value={`$${Math.round(stats.revenue).toLocaleString('en-US')}`}
                sub={revMoM !== null ? <span className={revMoM >= 0 ? 'text-emerald-600' : 'text-red-600'}>{revMoM >= 0 ? '▲' : '▼'} {Math.abs(revMoM)}% vs last month</span> : null} />
              <Tile loading={loading} label="Total orders" value={stats.orders.toLocaleString('en-US')}
                sub={user?.role === 'company' && tier ? <span className="text-gray-500">{tier.monthOrderCount} this month</span> : null} />
              <Tile loading={loading} label="Products" value={stats.products.toLocaleString('en-US')}
                sub={lowStock.length > 0 ? <span className="text-amber-700">{lowStock.length} low on stock</span> : null} />
              <Tile loading={loading} label="Customers" value={stats.customers.toLocaleString('en-US')}
                sub={user?.role === 'admin' && adminStats.newSignups > 0 ? <span className="text-emerald-600">▲ {adminStats.newSignups} new this month</span> : null} />
              {user?.role === 'admin' && (
                <>
                  <Tile loading={loading} label="Companies" value={adminStats.companies.toLocaleString('en-US')} />
                  <Tile loading={loading} label="New signups" value={adminStats.newSignups.toLocaleString('en-US')} sub={<span className="text-gray-500">this month</span>} />
                </>
              )}
            </div>

            {/* Revenue trend + low stock */}
            {!loading && (
              <>
                <Band>Revenue trend</Band>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                    <h3 className="text-[13px] font-bold text-gray-600 mb-4">Last 6 months</h3>
                    {monthlyRevenue.length > 0 && (
                      <div className="flex items-end gap-3 h-44">
                        {monthlyRevenue.map((m, i) => {
                          const isCur = i === monthlyRevenue.length - 1;
                          return (
                            <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                              <span className="text-[11px] font-bold text-gray-600 tabular-nums">${m.revenue >= 1000 ? `${(m.revenue / 1000).toFixed(1)}k` : m.revenue.toFixed(0)}</span>
                              <div className={`w-full rounded-t-md transition-all ${isCur ? 'bg-gradient-to-t from-teal-600 to-emerald-500' : 'bg-gradient-to-t from-teal-700 to-teal-600'}`} style={{ height: `${Math.max((m.revenue / maxRev) * 100, 2)}%`, minHeight: '4px' }} />
                              <span className={`text-[11px] font-semibold ${isCur ? 'text-teal-700' : 'text-gray-400'}`}>{m.month}</span>
                              <span className="text-[10px] text-gray-400 tabular-nums">{m.orders} order{m.orders !== 1 ? 's' : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                    <h3 className="text-[13px] font-bold text-gray-600 mb-3">Low on stock</h3>
                    {lowStock.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-1.5 text-center">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <p className="text-sm font-semibold text-emerald-600">All stocked up</p>
                        <p className="text-xs">Nothing below 5 units</p>
                      </div>
                    ) : (
                      <div className="max-h-44 overflow-y-auto">
                        {lowStock.map((p) => (
                          <div key={p.id} className="flex items-center justify-between gap-2 py-2 border-t border-gray-100 first:border-t-0">
                            <span className="text-[13px] text-gray-700 truncate">{p.name}</span>
                            <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full shrink-0 tabular-nums ${p.stock <= 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{p.stock} left</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Recent orders */}
            <Band>Recent orders</Band>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {loading ? (
                <div className="p-8 flex justify-center">
                  <div className="animate-spin h-6 w-6 border-2 border-teal-700 border-t-transparent rounded-full" />
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No orders yet. Your first sale will show up here.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200">Order</th>
                        <th className="text-left text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200 hidden sm:table-cell">Items</th>
                        <th className="text-left text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200">Status</th>
                        <th className="text-left text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200 hidden md:table-cell">Date</th>
                        <th className="text-right text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-teal-50/40">
                          <td className="px-4 py-3 border-b border-gray-100 font-mono text-xs font-semibold text-gray-800">#{order.id.slice(-6).toUpperCase()}</td>
                          <td className="px-4 py-3 border-b border-gray-100 text-gray-600 hidden sm:table-cell tabular-nums">{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}</td>
                          <td className="px-4 py-3 border-b border-gray-100">
                            <Pill tone={STATUS_TONE[order.status || 'pending'] || 'gray'}>{order.status || 'pending'}</Pill>
                          </td>
                          <td className="px-4 py-3 border-b border-gray-100 text-gray-500 whitespace-nowrap hidden md:table-cell tabular-nums">{new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                          <td className="px-4 py-3 border-b border-gray-100 text-right font-bold text-gray-800 tabular-nums">${order.grandTotal?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Admin: company performance */}
            {user?.role === 'admin' && !loading && companyStats.length > 0 && (
              <>
                <Band>Company performance</Band>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200">Company</th>
                          <th className="text-center text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200 hidden sm:table-cell">Products</th>
                          <th className="text-center text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200 hidden sm:table-cell">Customers</th>
                          <th className="text-center text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200">Orders</th>
                          <th className="text-right text-[11px] font-extrabold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-3 border-b border-gray-200">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyStats.map((c) => (
                          <tr key={c.name} className="hover:bg-teal-50/40">
                            <td className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">{c.name}</td>
                            <td className="px-4 py-3 border-b border-gray-100 text-center text-gray-600 hidden sm:table-cell tabular-nums">{c.products}</td>
                            <td className="px-4 py-3 border-b border-gray-100 text-center text-gray-600 hidden sm:table-cell tabular-nums">{c.customers}</td>
                            <td className="px-4 py-3 border-b border-gray-100 text-center text-gray-600 tabular-nums">{c.orders}</td>
                            <td className="px-4 py-3 border-b border-gray-100 text-right font-bold text-gray-800 tabular-nums">${Math.round(c.revenue).toLocaleString('en-US')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
