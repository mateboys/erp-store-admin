<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">账号权限</h3>
          <div class="page-sub">管理员可新增账号、调整角色与所属门店，并为店长 / 营业员追加授权</div>
        </div>
        <div class="flex">
          <el-input
            v-model="keyword"
            placeholder="账号 / 姓名"
            clearable
            style="width: 190px"
            :prefix-icon="Search"
            @keyup.enter="search"
            @clear="search"
          />
          <el-button type="primary" :icon="Plus" @click="openCreate">新增账号</el-button>
        </div>
      </div>

      <div class="table-fill">
        <el-table :data="list" v-loading="loading" height="100%">
        <el-table-column prop="username" label="账号" width="120" />
        <el-table-column prop="name" label="姓名" width="110" />
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag
              :type="row.role === 'ADMIN' ? 'danger' : row.role === 'MANAGER' ? 'warning' : 'info'"
              effect="dark"
            >
              {{ row.roleLabel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属门店" min-width="160">
          <template #default="{ row }">
            <span v-if="row.role === 'ADMIN'">
              <el-tag type="danger" effect="light">全部门店（总部）</el-tag>
            </span>
            <span v-else>{{ row.storeName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="追加授权" min-width="220">
          <template #default="{ row }">
            <el-tag
              v-for="p in row.permissions"
              :key="p"
              size="small"
              effect="plain"
              style="margin-right: 4px"
            >
              {{ permLabel(p) }}
            </el-tag>
            <span v-if="!row.permissions?.length" class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" effect="light">
              {{ row.status === 'ACTIVE' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="160">
          <template #default="{ row }">
            {{ row.lastLoginAt ? fmt(row.lastLoginAt) : '未登录' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" class-name="col-ops" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" @click="openReset(row)">重置密码</el-button>
            <el-button link :type="row.status === 'ACTIVE' ? 'info' : 'success'" @click="toggle(row)">
              {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" :icon="Delete" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        </el-table>
      </div>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          background
          small
        />
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 14px"
        title="权限说明"
        description="管理员拥有全部权限（含成本/毛利查看、货品入库、门店与账号管理、修改任意销售单）；店长、营业员默认可看总览（不含成本/毛利）、商品查看与新增、库存查看、销售记账，并且只能修改自己开的销售单；如需让店长也能「货品入库」「查看成本」或「修改他人销售单」，在编辑中追加授权即可。"
      />
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑账号' : '新增账号'" width="560px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="账号" required>
          <el-input v-model="form.username" :disabled="!!form.id" placeholder="登录账号" />
        </el-form-item>
        <el-form-item :label="form.id ? '重设密码' : '密码'" :required="!form.id">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="form.id ? '留空则不修改' : '初始密码'"
          />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-radio-group v-model="form.role" @change="onRoleChange">
            <el-radio value="ADMIN">管理员</el-radio>
            <el-radio value="MANAGER">店长</el-radio>
            <el-radio value="CLERK">营业员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.role !== 'ADMIN'" label="所属门店" required>
          <el-select v-model="form.storeId" placeholder="选择门店" style="width: 100%">
            <el-option v-for="s in stores" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="数据范围">
          <el-tag type="danger" effect="light">全部门店 + 公司总览</el-tag>
        </el-form-item>
        <el-form-item v-if="form.role !== 'ADMIN'" label="追加授权">
          <el-checkbox-group v-model="form.permissions">
            <el-checkbox v-for="p in grantable" :key="p" :value="p" :label="p">
              {{ permLabel(p) }}
            </el-checkbox>
          </el-checkbox-group>
          <div class="muted" style="font-size: 12px; width: 100%">
            勾选后该账号将在角色默认权限之上获得对应能力
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ACTIVE">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Edit, Delete } from '@element-plus/icons-vue'
import { userApi, storeApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const list = ref([])
const stores = ref([])
const meta = ref({ grantable: { ADMIN: [], MANAGER: [], CLERK: [] } })
const loading = ref(false)
const keyword = ref('')
/* 分页 */
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const visible = ref(false)
const submitting = ref(false)
const form = ref({
  id: null,
  username: '',
  password: '',
  name: '',
  role: 'CLERK',
  storeId: null,
  permissions: [],
  status: 'ACTIVE'
})

const grantable = computed(() => meta.value.grantable?.[form.value.role] || [])

const PERM_LABEL = {
  'dashboard:view': '查看经营总览',
  'finance:cost': '查看成本与毛利',
  'product:view': '查看商品',
  'product:create': '新增/编辑商品',
  'stock:view': '查看库存',
  'inventory:in': '货品入库',
  'inventory:view': '查看入库记录',
  'sale:create': '销售记账',
  'sale:view': '查看销售记录',
  'sale:edit': '修改自己的销售单',
  'sale:edit:all': '修改他人销售单（全店）',
  'return:handle': '退货处理',
  'return:view': '查看退货记录',
  'store:manage': '门店管理',
  'user:manage': '账号与权限管理'
}
const permLabel = (p) => PERM_LABEL[p] || p
const fmt = (d) => dayjs(d).format('YYYY-MM-DD HH:mm')

async function load() {
  loading.value = true
  try {
    const res = await userApi.list(keyword.value, { page: page.value, pageSize: pageSize.value })
    list.value = res.rows
    total.value = res.total
  } finally {
    loading.value = false
  }
}

/** 搜索 / 清空条件：回到第一页再查 */
function search() {
  page.value = 1
  load()
}

watch([page, pageSize], () => load())

async function loadMeta() {
  meta.value = await userApi.meta()
  stores.value = await storeApi.list()
}

function onRoleChange(role) {
  if (role === 'ADMIN') {
    form.value.storeId = null
    form.value.permissions = []
  } else if (!form.value.storeId && stores.value.length) {
    form.value.storeId = stores.value[0].id
  }
  // 过滤掉新角色下不可追加的权限
  const allow = meta.value.grantable?.[role] || []
  form.value.permissions = form.value.permissions.filter((p) => allow.includes(p))
}

function openCreate() {
  form.value = {
    id: null,
    username: '',
    password: '123456',
    name: '',
    role: 'CLERK',
    storeId: stores.value[0]?.id ?? null,
    permissions: [],
    status: 'ACTIVE'
  }
  visible.value = true
}

function openEdit(row) {
  form.value = {
    id: row.id,
    username: row.username,
    password: '',
    name: row.name,
    role: row.role,
    storeId: row.storeId,
    permissions: [...(row.permissions || [])],
    status: row.status
  }
  visible.value = true
}

async function submit() {
  if (!form.value.username) return ElMessage.warning('请填写账号')
  if (!form.value.id && !form.value.password) return ElMessage.warning('请填写初始密码')
  if (form.value.role !== 'ADMIN' && !form.value.storeId)
    return ElMessage.warning('请选择所属门店')
  submitting.value = true
  try {
    const payload = { ...form.value }
    if (form.value.id) {
      if (!payload.password) delete payload.password
      await userApi.update(payload.id, payload)
    } else {
      await userApi.create(payload)
    }
    ElMessage.success('保存成功')
    visible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function toggle(row) {
  const status = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  await userApi.update(row.id, { status })
  ElMessage.success(status === 'ACTIVE' ? '已启用' : '已停用')
  load()
}

async function openReset(row) {
  const { value } = await ElMessageBox.prompt(`为「${row.name}」设置新密码`, '重置密码', {
    inputPattern: /.{4,}/,
    inputErrorMessage: '密码至少 4 位'
  })
  await userApi.update(row.id, { password: value })
  ElMessage.success('密码已重置')
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除账号「${row.username}」？`, '危险操作', { type: 'warning' })
  await userApi.remove(row.id)
  ElMessage.success('已删除')
  // 删掉的是当前页最后一条时往前退一页，避免停在空白页
  if (list.value.length === 1 && page.value > 1) page.value -= 1
  else load()
}

onMounted(async () => {
  await loadMeta()
  load()
})
</script>
