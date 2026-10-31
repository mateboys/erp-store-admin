<template>
  <div class="login-bg">
    <div class="login-panel">
      <div class="login-left">
        <div style="font-size: 30px; font-weight: 800; letter-spacing: 1px">
          衣栈 · 服装店多店管理系统
        </div>
        <p style="opacity: 0.85; margin-top: 14px; line-height: 1.9; font-size: 14px">
          一套系统管多家门店：扫码入库、手动入库、销售记账、<br />
          营业额与毛利趋势实时可视，权限分级到人。
        </p>
        <div style="margin-top: 34px; display: grid; gap: 14px">
          <div class="feat">
            <el-icon><Shop /></el-icon>
            <span>多店管理 · 总览 / 分店自由切换</span>
          </div>
          <div class="feat">
            <el-icon><Box /></el-icon>
            <span>二维码 + 条码扫码入库，也支持手动入库</span>
          </div>
          <div class="feat">
            <el-icon><ShoppingCart /></el-icon>
            <span>购物车式销售记账，一键统一入账</span>
          </div>
          <div class="feat">
            <el-icon><DataLine /></el-icon>
            <span>营业额 / 毛利趋势、环比自动计算</span>
          </div>
        </div>
      </div>

      <div class="login-right">
        <h2 style="margin: 0 0 6px; font-size: 22px">欢迎回来</h2>
        <p class="muted" style="margin: 0 0 26px; font-size: 13px">请使用您的账号登录后台</p>
        <el-form size="large" @keyup.enter="submit">
          <el-form-item>
            <el-input v-model="form.username" placeholder="账号" :prefix-icon="User" />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="密码"
              :prefix-icon="Lock"
            />
          </el-form-item>
          <el-button
            type="primary"
            size="large"
            style="width: 100%; margin-top: 6px"
            :loading="loading"
            @click="submit"
          >
            登 录
          </el-button>
        </el-form>

        <el-divider style="margin: 24px 0 14px">演示账号</el-divider>
        <div class="demo-accounts">
          <div v-for="a in demoAccounts" :key="a.u" class="demo-row" @click="fill(a)">
            <el-tag size="small" effect="plain">{{ a.label }}</el-tag>
            <span class="muted" style="font-size: 12px">{{ a.u }} / {{ a.p }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const auth = useUserStore()
const loading = ref(false)
const form = ref({ username: 'admin', password: '123456' })

const demoAccounts = [
  { u: 'admin', p: '123456', label: '管理员' },
  { u: 'manager1', p: '123456', label: '店长(总店)' },
  { u: 'manager2', p: '123456', label: '店长(银泰店)' },
  { u: 'clerk1', p: '123456', label: '营业员(总店)' }
]

function fill(a) {
  form.value = { username: a.u, password: a.p }
}

async function submit() {
  if (!form.value.username || !form.value.password) {
    return ElMessage.warning('请输入账号和密码')
  }
  loading.value = true
  try {
    await auth.login(form.value.username, form.value.password)
    ElMessage.success(`欢迎回来，${auth.user.name}`)
    router.push('/dashboard')
  } catch (e) {
    /* 错误已在拦截器提示 */
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.feat {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  opacity: 0.95;
  background: rgba(255, 255, 255, 0.08);
  padding: 10px 14px;
  border-radius: 10px;
}

.demo-accounts {
  display: grid;
  gap: 8px;
}

.demo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 8px;
  background: #f7f7fc;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: #eeecff;
  }
}
</style>
