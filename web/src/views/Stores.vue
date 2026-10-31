<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between">
        <div>
          <h3 class="page-title">门店管理</h3>
          <div class="page-sub">总部可新增 / 停用分店，查看各店人员、库存与营业额</div>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增门店</el-button>
      </div>

      <div class="table-fill">
        <el-table :data="list" v-loading="loading" height="100%">
        <el-table-column prop="name" label="门店名称" min-width="180" />
        <el-table-column prop="address" label="地址" min-width="200" show-overflow-tooltip />
        <el-table-column prop="phone" label="联系电话" width="150" />
        <el-table-column label="人员" width="80" align="right">
          <template #default="{ row }">{{ row.userCount }}</template>
        </el-table-column>
        <el-table-column label="库存件数" width="100" align="right">
          <template #default="{ row }">{{ row.stockCount }}</template>
        </el-table-column>
        <el-table-column label="累计营业额" width="130" align="right">
          <template #default="{ row }">
            <b class="money">¥{{ row.totalAmount.toFixed(2) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" effect="light">
              {{ row.status === 'ACTIVE' ? '营业中' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" class-name="col-ops" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button
              link
              :type="row.status === 'ACTIVE' ? 'warning' : 'success'"
              @click="toggle(row)"
            >
              {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" :icon="Delete" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无门店" /></template>
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
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑门店' : '新增门店'" width="480px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="门店名称" required>
          <el-input v-model="form.name" placeholder="如：城西银泰店" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ACTIVE">营业中</el-radio>
            <el-radio value="DISABLED">已停用</el-radio>
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
import { onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete } from '@element-plus/icons-vue'
import { storeApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const list = ref([])
const loading = ref(false)
const visible = ref(false)
const submitting = ref(false)
const form = ref({ id: null, name: '', address: '', phone: '', status: 'ACTIVE' })
/* 分页 */
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)

async function load() {
  loading.value = true
  try {
    const res = await storeApi.stats({ page: page.value, pageSize: pageSize.value })
    list.value = res.rows
    total.value = res.total
  } finally {
    loading.value = false
  }
}

watch([page, pageSize], () => load())

function openCreate() {
  form.value = { id: null, name: '', address: '', phone: '', status: 'ACTIVE' }
  visible.value = true
}

function openEdit(row) {
  // 行数据来自 stats 接口，含 userCount/stockCount/totalAmount 等统计字段，
  // 这些不属于 Store 表，必须只取可编辑字段，否则会整行回传给后端导致 500
  form.value = {
    id: row.id,
    name: row.name,
    address: row.address || '',
    phone: row.phone || '',
    status: row.status || 'ACTIVE'
  }
  visible.value = true
}

async function submit() {
  const name = (form.value.name || '').trim()
  if (!name) return ElMessage.warning('请填写门店名称')
  submitting.value = true
  try {
    const payload = {
      name,
      address: form.value.address || '',
      phone: form.value.phone || '',
      status: form.value.status || 'ACTIVE'
    }
    if (form.value.id) await storeApi.update(form.value.id, payload)
    else await storeApi.create(payload)
    ElMessage.success('保存成功')
    visible.value = false
    load()
    auth.loadStores()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function toggle(row) {
  const status = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  await storeApi.update(row.id, { status })
  ElMessage.success(status === 'ACTIVE' ? '已启用' : '已停用')
  load()
  auth.loadStores()
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除门店「${row.name}」？`, '危险操作', { type: 'warning' })
  await storeApi.remove(row.id)
  ElMessage.success('已删除')
  // 删掉的是当前页最后一条时往前退一页，避免停在空白页
  if (list.value.length === 1 && page.value > 1) page.value -= 1
  else load()
  auth.loadStores()
}

onMounted(load)
</script>
