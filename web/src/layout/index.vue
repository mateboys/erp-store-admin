<template>
  <div class="layout">
    <aside class="sider" :class="{ collapsed }">
      <div class="sidebar-logo">
        <span class="dot">衣</span>
        <span v-show="!collapsed">衣栈 · 多店管理</span>
      </div>
      <el-scrollbar>
        <el-menu
          :default-active="activePath"
          :collapse="collapsed"
          :collapse-transition="false"
          background-color="#2d2a5e"
          text-color="#b9b6dd"
          active-text-color="#ffffff"
          router
        >
          <el-menu-item
            v-for="item in menus"
            :key="item.path"
            :index="item.path"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.title }}</template>
          </el-menu-item>
        </el-menu>
      </el-scrollbar>
    </aside>

    <section class="main">
      <header class="app-header">
        <div class="flex">
          <el-icon class="fold-btn" @click="collapsed = !collapsed">
            <Expand v-if="collapsed" /><Fold v-else />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>门店</el-breadcrumb-item>
            <el-breadcrumb-item>
              <b>{{ auth.storeName }}</b>
            </el-breadcrumb-item>
            <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="flex">
          <!-- 门店切换：仅管理员可见，可切到「公司总览」或任意分店 -->
          <template v-if="auth.isAdmin">
            <span class="muted" style="font-size: 13px">数据范围</span>
            <el-select
              v-model="currentStore"
              size="default"
              style="width: 190px"
              @change="onStoreChange"
            >
              <el-option label="公司总览（全部店）" value="all" />
              <el-option
                v-for="s in auth.stores"
                :key="s.id"
                :label="s.name"
                :value="String(s.id)"
              />
            </el-select>
          </template>
          <el-tag v-else type="info" effect="dark" round>{{ auth.storeName }}</el-tag>

          <el-dropdown @command="onCommand">
            <span class="user-chip">
              <el-avatar :size="30" class="avatar">{{ auth.user?.name?.[0] || 'U' }}</el-avatar>
              <span>{{ auth.user?.name }}</span>
              <el-tag size="small" effect="plain" round>{{ roleLabel }}</el-tag>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="pwd">
                  <el-icon><Lock /></el-icon>修改密码
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <el-scrollbar class="content">
        <router-view :key="`${route.path}-${auth.storeId}`" />
      </el-scrollbar>
    </section>

    <el-dialog v-model="pwdVisible" title="修改密码" width="380px">
      <el-form :model="pwdForm" label-width="80px">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="submitPwd">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api'
import { routes } from '@/router'

const route = useRoute()
const router = useRouter()
const auth = useUserStore()

const collapsed = ref(false)
const currentStore = ref(auth.storeId != null ? String(auth.storeId) : 'all')

const roleLabel = computed(
  () => ({ ADMIN: '管理员', MANAGER: '店长', CLERK: '营业员' })[auth.user?.role] || ''
)

const menus = computed(() => {
  const list = routes.find((r) => r.path === '/')?.children || []
  return list
    // 纯跳转路由（如旧地址 /stock）不进菜单
    .filter((r) => r.component)
    .filter(
      (r) =>
        (!r.meta?.perm || auth.has(r.meta.perm)) &&
        (!r.meta?.anyPerm || r.meta.anyPerm.some((p) => auth.has(p)))
    )
    .map((r) => ({
      path: `/${r.path}`,
      // 没有操作权限（如只能看入库记录）时显示只读标题
      title: r.meta.opPerm && !auth.has(r.meta.opPerm) ? r.meta.readonlyTitle || r.meta.title : r.meta.title,
      icon: r.meta.icon
    }))
})

const activePath = computed(() => '/' + (route.path.split('/')[1] || ''))

watch(
  () => auth.storeId,
  (v) => {
    currentStore.value = v != null ? String(v) : 'all'
  }
)

function onStoreChange(v) {
  auth.setStore(v)
}

onMounted(async () => {
  if (!auth.token) return
  // 每次进主界面都同步一次账号资料：权限可能刚被管理员改过，
  // 只认登录时的快照会导致新授权要重新登录才生效
  try {
    await auth.loadProfile()
  } catch (e) {
    /* ignore */
  }
  if (!auth.stores.length) {
    try {
      await auth.loadStores()
    } catch (e) {
      /* ignore */
    }
  }
})

const pwdVisible = ref(false)
const pwdLoading = ref(false)
const pwdForm = ref({ oldPassword: '', newPassword: '' })

function onCommand(cmd) {
  if (cmd === 'pwd') {
    pwdForm.value = { oldPassword: '', newPassword: '' }
    pwdVisible.value = true
  } else if (cmd === 'logout') {
    ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' }).then(() => {
      auth.logout()
      router.push('/login')
    })
  }
}

async function submitPwd() {
  if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) {
    return ElMessage.warning('请填写完整')
  }
  pwdLoading.value = true
  try {
    await authApi.changePassword(pwdForm.value)
    ElMessage.success('密码已修改')
    pwdVisible.value = false
  } finally {
    pwdLoading.value = false
  }
}
</script>

<style scoped lang="scss">
.layout {
  display: flex;
  height: 100%;
  background: var(--bg);
}

.sider {
  width: 220px;
  background: linear-gradient(180deg, #332f6b 0%, #2d2a5e 60%, #262350 100%);
  transition: width 0.2s;
  display: flex;
  flex-direction: column;

  &.collapsed {
    width: 64px;
  }
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.content {
  flex: 1;
  padding: 16px;
  overflow: hidden;
}

/* 内容区内层容器撑满高度，列表页才能把「100% 高度」一路传到表格上 */
.content :deep(.el-scrollbar__view) {
  height: 100%;
}

.fold-btn {
  font-size: 20px;
  cursor: pointer;
  color: #6a6a85;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
  font-size: 14px;
}

.avatar {
  background: linear-gradient(135deg, #6c5ce7, #a29bfe);
  font-weight: 700;
}
</style>
