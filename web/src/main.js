import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import './styles/index.scss'

import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from '@/utils/request'
import { useUserStore } from '@/stores/user'

const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}
app.use(createPinia())
app.use(router)

// 登录态失效时统一清理本地状态并回到登录页
setUnauthorizedHandler(() => {
  useUserStore().logout()
  if (location.hash !== '#/login') location.hash = '#/login'
})
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
