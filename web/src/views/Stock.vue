<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">库存管理</h3>
          <div class="page-sub">
            {{ auth.storeName }} · 共 {{ total }} 个 SKU，合计
            {{ totalQty }} 件
            <template v-if="auth.canSeeCost">，库存成本 ¥{{ totalValue.toFixed(2) }}</template>
          </div>
        </div>
        <div class="flex" style="flex-wrap: wrap">
          <el-input
            v-model="keyword"
            placeholder="货号 / 品名"
            clearable
            style="width: 200px"
            :prefix-icon="Search"
            @keyup.enter="search"
            @clear="search"
          />
          <el-checkbox v-model="lowOnly" @change="search">只看低库存(≤5)</el-checkbox>
          <el-button :icon="Refresh" @click="load">刷新</el-button>
        </div>
      </div>

      <div class="table-fill">
        <el-table :data="list" v-loading="loading" height="100%">
        <el-table-column label="图片" width="62">
          <template #default="{ row }">
            <el-image :src="img(row.image)" fit="cover" class="product-thumb" />
          </template>
        </el-table-column>
        <el-table-column prop="sku" label="货号" width="120" />
        <el-table-column prop="name" label="品名" min-width="150" show-overflow-tooltip />
        <el-table-column prop="categoryName" label="类型" width="110" />
        <el-table-column v-if="isAll" prop="storeName" label="门店" width="150" />
        <el-table-column label="库存" width="100" align="right" sortable :sort-by="(r) => r.quantity">
          <template #default="{ row }">
            <el-tag
              :type="row.quantity <= 0 ? 'danger' : row.quantity <= 5 ? 'warning' : 'success'"
              effect="light"
            >
              {{ row.quantity <= 0 ? '缺货' : row.quantity + ' 件' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="销售价" width="110" align="right">
          <template #default="{ row }">¥{{ row.salePrice?.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column v-if="auth.canSeeCost" label="均价成本" width="110" align="right">
          <template #default="{ row }">¥{{ row.avgCost?.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column v-if="auth.canSeeCost" label="库存成本" width="120" align="right">
          <template #default="{ row }">¥{{ row.stockValue?.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="160">
          <template #default="{ row }">{{ fmt(row.updatedAt) }}</template>
        </el-table-column>
        <template #empty><el-empty description="暂无库存数据" /></template>
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
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { Search, Refresh } from '@element-plus/icons-vue'
import { inventoryApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const list = ref([])
const loading = ref(false)
const keyword = ref('')
const lowOnly = ref(false)
/* 分页 */
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)

const isAll = computed(() => auth.isAdmin && auth.storeId === 'all')
/* 合计取筛选结果的全量（后端 summary），不随翻页变化 */
const summary = ref({ skuCount: 0, quantity: 0, stockValue: 0 })
const totalQty = computed(() => summary.value.quantity || 0)
const totalValue = computed(() => summary.value.stockValue || 0)

function img(u) {
  return u || 'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
    )
}
const fmt = (d) => dayjs(d).format('YYYY-MM-DD HH:mm')

async function load() {
  if (!auth.token) return
  loading.value = true
  try {
    const res = await inventoryApi.stock({
      storeId: auth.storeId,
      keyword: keyword.value,
      lowOnly: lowOnly.value ? 'true' : '',
      page: page.value,
      pageSize: pageSize.value
    })
    list.value = res.rows
    total.value = res.total
    summary.value = res.summary || summary.value
  } finally {
    loading.value = false
  }
}

/** 改查询条件：回到第一页再查 */
function search() {
  page.value = 1
  load()
}

watch([page, pageSize], () => load())

watch(
  () => auth.storeId,
  () => {
    page.value = 1
    load()
  }
)
onMounted(load)
</script>
