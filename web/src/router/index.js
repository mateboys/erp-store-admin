import { createRouter, createWebHashHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('@/layout/index.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '经营总览', icon: 'DataLine', perm: 'dashboard:view' }
      },
      {
        path: 'inventory',
        name: 'inventory',
        component: () => import('@/views/Inventory.vue'),
        // 库存列表 + 入库作业合并进同一页（第 1 个 tab 是库存列表）：
        // stock:view 与 inventory:view 有任意一个就能进来，页面再按权限决定显示哪些 tab；
        // opPerm=inventory:in：有它才能扫码/手动入库，否则页面只剩库存列表和入库记录
        meta: {
          title: '库存管理',
          icon: 'Goods',
          anyPerm: ['inventory:view', 'stock:view'],
          opPerm: 'inventory:in'
        }
      },
      // 旧地址保留跳转，避免收藏夹/钉钉链接失效（不进菜单）
      { path: 'stock', redirect: 'inventory', meta: { silent: true } },
      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/views/Sales.vue'),
        meta: { title: '销售记账', icon: 'ShoppingCart', perm: 'sale:create' }
      },
      {
        path: 'orders',
        name: 'orders',
        component: () => import('@/views/Orders.vue'),
        meta: { title: '销售记录', icon: 'Tickets', perm: 'sale:view' }
      },
      {
        path: 'returns',
        name: 'returns',
        component: () => import('@/views/Returns.vue'),
        // 照搬货品入库：有查看权限即可进入，没有退货操作权限时只保留「退货记录」
        meta: {
          title: '退货处理',
          icon: 'RefreshLeft',
          perm: 'return:view',
          opPerm: 'return:handle',
          readonlyTitle: '退货记录'
        }
      },
      {
        path: 'products',
        name: 'products',
        component: () => import('@/views/Products.vue'),
        meta: { title: '商品管理', icon: 'Handbag', perm: 'product:view' }
      },
      {
        path: 'stores',
        name: 'stores',
        component: () => import('@/views/Stores.vue'),
        meta: { title: '门店管理', icon: 'Shop', perm: 'store:manage' }
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/Users.vue'),
        meta: { title: '账号权限', icon: 'UserFilled', perm: 'user:manage' }
      }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach(async (to) => {
  const store = useUserStore()
  if (to.meta.public) return true
  if (!store.token) return { name: 'login' }
  if (!store.user) {
    try {
      await store.loadProfile()
    } catch {
      store.logout()
      return { name: 'login' }
    }
  }
  // 功能权限不足则跳转到总览
  if (to.meta.perm && !store.has(to.meta.perm)) {
    return { name: 'dashboard' }
  }
  // anyPerm：命中任意一个权限点即可进入（一页承载多个功能时用）
  if (to.meta.anyPerm && !to.meta.anyPerm.some((p) => store.has(p))) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
export { routes }
