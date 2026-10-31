import axios from 'axios'
import { ElMessage } from 'element-plus'

const service = axios.create({
  baseURL: '/api',
  timeout: 20000
})

/** 不需要登录态的接口（登录接口本身） */
const PUBLIC_URLS = ['/auth/login']

/**
 * 401 处理回调，由 main.js 注入（避免 request.js -> router -> store -> api 的循环依赖）
 */
let unauthorizedHandler = null
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

// 401 只提示一次，避免并发请求弹一堆红条
let unauthorizedNotified = false

service.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    return config
  }
  // 已退出登录 / 无登录态：直接短路，根本不发网络请求（避免 401 噪音）
  if (PUBLIC_URLS.some((u) => (config.url || '').includes(u))) return config
  const err = new Error('NO_TOKEN')
  err.__silent = true
  return Promise.reject(err)
})

service.interceptors.response.use(
  (res) => res.data,
  (err) => {
    // 被主动短路 / 取消的请求：静默失败，不提示
    if (err?.__silent || err?.code === 'ERR_CANCELED' || axios.isCancel(err)) {
      return Promise.reject(err)
    }

    const status = err?.response?.status
    const msg =
      err?.response?.data?.message || err?.response?.data?.error || err.message || '请求失败'

    if (status === 401) {
      if (!unauthorizedNotified) {
        unauthorizedNotified = true
        ElMessage.error('登录已失效，请重新登录')
        setTimeout(() => (unauthorizedNotified = false), 1500)
      }
      if (unauthorizedHandler) unauthorizedHandler()
      return Promise.reject(err)
    }

    // 业务层错误（如库存不足）由页面自行处理，这里默认提示
    ElMessage.error(Array.isArray(msg) ? msg.join('；') : msg)
    return Promise.reject(err)
  }
)

export default service
