import { defineStore } from 'pinia'
import { authApi, storeApi } from '@/api'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    stores: [],
    currentStoreId: localStorage.getItem('storeId') || 'all'
  }),
  getters: {
    isAdmin: (s) => s.user?.role === 'ADMIN',
    permissions: (s) => s.user?.permissions || [],
    /** 当前生效门店 id：'all' 表示公司总览（仅管理员） */
    storeId: (s) => {
      if (s.user?.role !== 'ADMIN') return s.user?.storeId ?? null
      return s.currentStoreId
    },
    storeName: (s) => {
      if (s.user?.role !== 'ADMIN') return s.user?.storeName || '我的门店'
      if (s.currentStoreId === 'all') return '公司总览'
      return s.stores.find((x) => String(x.id) === String(s.currentStoreId))?.name || '公司总览'
    },
    canSeeCost: (s) => (s.user?.permissions || []).includes('finance:cost')
  },
  actions: {
    has(perm) {
      return (this.user?.permissions || []).includes(perm)
    },
    async login(username, password) {
      const data = await authApi.login({ username, password })
      this.token = data.token
      this.user = data.user
      this.stores = data.stores
      this.currentStoreId =
        data.user.role === 'ADMIN' ? 'all' : String(data.user.storeId ?? '')
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      localStorage.setItem('storeId', this.currentStoreId)
      return data
    },
    async loadProfile() {
      const data = await authApi.profile()
      // stores 单独存，不要混进 user（否则会重复写进 localStorage）
      const { stores, ...profile } = data
      this.user = profile
      this.stores = stores || []
      localStorage.setItem('user', JSON.stringify(profile))
      if (data.role !== 'ADMIN') this.currentStoreId = String(data.storeId ?? '')
    },
    async loadStores() {
      this.stores = await storeApi.list()
      // 管理员当前选中的门店若已停用（列表里没有了），回退到公司总览，
      // 否则 el-select 匹配不到会直接把 id 显示成裸数字
      if (
        this.isAdmin &&
        this.currentStoreId !== 'all' &&
        !this.stores.some((x) => String(x.id) === String(this.currentStoreId))
      ) {
        this.setStore('all')
      }
    },
    setStore(id) {
      this.currentStoreId = String(id)
      localStorage.setItem('storeId', this.currentStoreId)
    },
    logout() {
      this.token = ''
      this.user = null
      this.stores = []
      this.currentStoreId = 'all'
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('storeId')
    }
  }
})
