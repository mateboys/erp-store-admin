import request from '@/utils/request'

export const authApi = {
  login: (data) => request.post('/auth/login', data),
  profile: () => request.get('/auth/profile'),
  changePassword: (data) => request.post('/auth/password', data)
}

export const storeApi = {
  list: () => request.get('/stores'),
  stats: (params) => request.get('/stores/stats', { params }),
  create: (data) => request.post('/stores', data),
  update: (id, data) => request.put(`/stores/${id}`, data),
  remove: (id) => request.delete(`/stores/${id}`)
}

export const userApi = {
  list: (keyword, params) => request.get('/users', { params: { keyword, ...params } }),
  meta: () => request.get('/users/meta'),
  create: (data) => request.post('/users', data),
  update: (id, data) => request.put(`/users/${id}`, data),
  remove: (id) => request.delete(`/users/${id}`)
}

export const categoryApi = {
  list: (keyword) => request.get('/categories', { params: { keyword } }),
  grouped: () => request.get('/categories/grouped')
}

export const productApi = {
  list: (params) => request.get('/products', { params }),
  checkSku: (sku, excludeId) =>
    request.get('/products/check-sku', { params: { sku, excludeId } }),
  /** 取一个库内未占用的 EAN-13 条码（新增商品时预填） */
  nextBarcode: () => request.get('/products/next-barcode'),
  checkBarcode: (barcode, excludeId) =>
    request.get('/products/check-barcode', { params: { barcode, excludeId } }),
  bySku: (sku, storeId) => request.get(`/products/by-sku/${sku}`, { params: { storeId } }),
  create: (data) => request.post('/products', data),
  update: (id, data) => request.put(`/products/${id}`, data),
  remove: (id) => request.delete(`/products/${id}`),
  upload: (formData) =>
    request.post('/products/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
}

export const inventoryApi = {
  scan: (code, storeId, action) => request.get('/inventory/scan', { params: { code, storeId, action } }),
  stockIn: (data) => request.post('/inventory/in', data),
  stockOut: (data) => request.post('/inventory/out', data),
  records: (params) => request.get('/inventory/records', { params }),
  stock: (params) => request.get('/inventory/stock', { params })
}

export const saleApi = {
  create: (data) => request.post('/sales', data),
  orders: (params) => request.get('/sales/orders', { params }),
  detail: (id) => request.get(`/sales/orders/${id}`),
  updateOrder: (id, data) => request.put(`/sales/orders/${id}`, data)
}

export const dashboardApi = {
  overview: (storeId) => request.get('/dashboard/overview', { params: { storeId } }),
  trend: (params) => request.get('/dashboard/trend', { params }),
  byStore: (range) => request.get('/dashboard/by-store', { params: { range } }),
  lowStock: (storeId, limit) =>
    request.get('/dashboard/low-stock', { params: { storeId, limit } }),
  /** 个人总览：只统计当前登录用户经手的数据 */
  personal: (storeId) => request.get('/dashboard/personal', { params: { storeId } }),
  personalTrend: (params) => request.get('/dashboard/personal-trend', { params })
}

export const returnApi = {
  scan: (code, storeId) => request.get('/returns/scan', { params: { code, storeId } }),
  findOrders: (params) => request.get('/returns/orders', { params }),
  create: (data) => request.post('/returns', data),
  records: (params) => request.get('/returns/records', { params }),
  revoke: (id) => request.delete(`/returns/${id}`)
}
