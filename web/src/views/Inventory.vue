<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">库存管理</h3>
          <div class="page-sub">
            {{
              canStockIn
                ? '盘点库存、扫码枪/拍照/手动出入库一站式处理'
                : '当前角色没有出入库操作权限，仅可查看库存与出入库记录（不展示进货价）'
            }}
          </div>
        </div>
        <div class="flex" style="gap: 8px">
          <span class="muted" style="font-size: 13px">{{ storeLabel }}</span>
          <el-select
            v-model="targetStore"
            style="width: 200px"
            :disabled="storeLocked"
            :placeholder="storeLocked ? '' : isOperateTab ? `请选择要${tab === 'stockout' ? '出库' : '入库'}的门店` : '公司总览（全部门店）'"
            @change="onStoreChange"
          >
            <!-- 库存列表/记录允许「公司总览」跨店查看，所以给个显式的「全部」选项 -->
            <el-option v-if="!isOperateTab" label="公司总览" value="" />
            <el-option
              v-for="s in storeOptions"
              :key="s.id"
              :label="s.name"
              :value="String(s.id)"
            />
          </el-select>
        </div>
      </div>

      <!-- 入库/出库类 tab 必须落到具体门店；库存列表本身支持「公司总览」跨店查看 -->
      <el-alert
        v-if="canStockIn && isOperateTab && !targetStore"
        type="warning"
        :closable="false"
        show-icon
        :title="`当前处于「公司总览」，货品必须${tab === 'stockout' ? '出' : '入'}到具体门店，请先选择右上角${storeLabel}；不选无法提交`"
        style="margin-top: 12px"
      />

      <el-tabs v-model="tab" style="margin-top: 8px">
        <!-- ========== 库存列表（需要 stock:view） ========== -->
        <el-tab-pane v-if="canSeeStock" label="库存列表" name="stock">
          <div class="pane-fill">
            <div class="flex-between" style="margin-bottom: 12px; flex-wrap: wrap">
              <div class="page-sub">
                {{ stkStoreName }} · 共 {{ stkTotal }} 个 SKU，合计 {{ stkTotalQty }} 件
                <template v-if="auth.canSeeCost">，库存成本 ¥{{ stkTotalValue.toFixed(2) }}</template>
              </div>
              <div class="flex" style="flex-wrap: wrap">
                <el-input
                  v-model="stkKeyword"
                  placeholder="货号 / 品名"
                  clearable
                  style="width: 200px"
                  :prefix-icon="Search"
                  @keyup.enter="searchStock"
                  @clear="searchStock"
                />
                <el-checkbox v-model="stkLowOnly" @change="searchStock">只看低库存(≤5)</el-checkbox>
                <el-button :icon="Refresh" @click="loadStock">刷新</el-button>
              </div>
            </div>

            <div class="table-fill">
              <el-table :data="stkList" v-loading="stkLoading" height="100%">
                <el-table-column label="图片" width="62">
                  <template #default="{ row }">
                    <el-image :src="img(row.image)" fit="cover" class="product-thumb" />
                  </template>
                </el-table-column>
                <el-table-column prop="sku" label="货号" width="110" />
                <el-table-column prop="name" label="品名" min-width="140" show-overflow-tooltip />
                <el-table-column prop="categoryName" label="类型" width="100" />
                <el-table-column v-if="stkIsAll" prop="storeName" label="门店" width="130" />
                <el-table-column
                  label="库存"
                  width="100"
                  align="right"
                  sortable
                  :sort-by="(r) => r.quantity"
                >
                  <template #default="{ row }">
                    <el-tag
                      :type="row.quantity <= 0 ? 'danger' : row.quantity <= 5 ? 'warning' : 'success'"
                      effect="light"
                    >
                      {{ row.quantity <= 0 ? '缺货' : row.quantity + ' 件' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="销售价" width="100" align="right">
                  <template #default="{ row }">¥{{ row.salePrice?.toFixed(2) }}</template>
                </el-table-column>
                <!-- 三个成本口径并列，便于对照历史进货有没有偏离常规 -->
                <el-table-column v-if="auth.canSeeCost" label="标准成本价" width="110" align="right">
                  <template #default="{ row }">
                    <span v-if="row.stdCost != null">¥{{ row.stdCost.toFixed(2) }}</span>
                    <span v-else class="muted">-</span>
                  </template>
                </el-table-column>
                <el-table-column v-if="auth.canSeeCost" label="进价" width="100" align="right">
                  <template #default="{ row }">
                    <span v-if="row.lastInCost != null">¥{{ row.lastInCost.toFixed(2) }}</span>
                    <span v-else class="muted">-</span>
                  </template>
                </el-table-column>
                <el-table-column v-if="auth.canSeeCost" label="均价成本" width="100" align="right">
                  <template #default="{ row }">¥{{ row.avgCost?.toFixed(2) }}</template>
                </el-table-column>
                <el-table-column v-if="auth.canSeeCost" label="库存成本" width="110" align="right">
                  <template #default="{ row }">¥{{ row.stockValue?.toFixed(2) }}</template>
                </el-table-column>
                <el-table-column label="更新时间" width="150">
                  <template #default="{ row }">{{ fmt(row.updatedAt) }}</template>
                </el-table-column>
                <template #empty><el-empty description="暂无库存数据" /></template>
              </el-table>
            </div>

            <div class="pager">
              <el-pagination
                v-model:current-page="stkPage"
                v-model:page-size="stkPageSize"
                :page-sizes="[10, 20, 50, 100]"
                :total="stkTotal"
                layout="total, sizes, prev, pager, next, jumper"
                background
                small
              />
            </div>
          </div>
        </el-tab-pane>

        <!-- ========== 商品入库：三种方式合一，进入后再选具体方式 ========== -->
        <el-tab-pane v-if="canStockIn" label="商品入库" name="stockin">
          <div class="pane-fill">
            <!-- 方式选择：扫码枪 / 拍照扫码 / 手动选择 -->
            <div class="mode-picker">
              <button
                v-for="m in stockinModes"
                :key="m.key"
                type="button"
                class="mode-card"
                :class="{ active: stockinMode === m.key }"
                @click="setStockinMode(m.key)"
              >
                <el-icon class="mode-icon"><component :is="m.icon" /></el-icon>
                <span class="mode-name">{{ m.label }}</span>
                <span class="mode-desc">{{ m.desc }}</span>
              </button>
            </div>

            <!-- 三种方式共用同一套「来源」组件，右侧结果卡按方式区分 -->
            <div class="mode-body">
              <el-row :gutter="16" class="scan-row">
                <el-col :xs="24" :lg="10">
                  <StockSource
                    ref="inSource"
                    v-model:mode="stockinMode"
                    :active="tab === 'stockin'"
                    :store-id="storeId()"
                    action="in"
                    :can-create-product="canCreateProduct"
                    @picked="onInPicked"
                    @reset="resetScan"
                    @go-products="goProducts"
                  />
                </el-col>

                <el-col :xs="24" :lg="14">
                  <StockInResult
                    class="result-fill"
                    :product="stockinProduct"
                    :loading="submitting"
                    empty-text="扫描或搜索并选中商品后，这里会显示商品信息"
                    @submit="submitStockIn"
                    @reset="resetScan"
                    @go-products="goProducts"
                  />
                </el-col>
              </el-row>
            </div>
          </div>
        </el-tab-pane>

        <!-- ========== 商品出库：三种录入方式 + 三种出库方式（需要 inventory:in，与入库同一权限） ========== -->
        <el-tab-pane v-if="canStockIn" label="商品出库" name="stockout">
          <div class="pane-fill">
            <!-- 方式选择：扫码枪 / 拍照扫码 / 手动选择 -->
            <div class="mode-picker">
              <button
                v-for="m in stockoutModes"
                :key="m.key"
                type="button"
                class="mode-card"
                :class="{ active: stockoutMode === m.key }"
                @click="setStockoutMode(m.key)"
              >
                <el-icon class="mode-icon"><component :is="m.icon" /></el-icon>
                <span class="mode-name">{{ m.label }}</span>
                <span class="mode-desc">{{ m.desc }}</span>
              </button>
            </div>

            <div class="mode-body">
              <el-row :gutter="16" class="scan-row">
                <el-col :xs="24" :lg="10">
                  <StockSource
                    ref="outSource"
                    v-model:mode="stockoutMode"
                    :active="tab === 'stockout'"
                    :store-id="storeId()"
                    action="out"
                    :can-create-product="canCreateProduct"
                    @picked="onOutPicked"
                    @reset="resetStockOut"
                    @go-products="goProducts"
                  />
                </el-col>

                <el-col :xs="24" :lg="14">
                  <StockOutResult
                    class="result-fill"
                    :product="stockoutProduct"
                    :loading="submitting"
                    :target-stores="transferStores"
                    :can-see-cost="auth.canSeeCost"
                    empty-text="扫描或搜索并选中商品后，这里会显示商品信息"
                    @submit="submitStockOut"
                    @reset="resetStockOut"
                  />
                </el-col>
              </el-row>
            </div>
          </div>
        </el-tab-pane>

        <!-- ========== 出入库记录 ========== -->
        <el-tab-pane label="出入库记录" name="records">
          <div class="pane-fill">
          <div class="flex" style="margin-bottom: 12px; flex-wrap: wrap; gap: 10px">
            <!-- 方向过滤：默认出入库都有，可切到只看入库 / 只看出库 -->
            <el-radio-group v-model="recDirection" size="default" @change="searchRecords">
              <el-radio-button value="all">出入库全部</el-radio-button>
              <el-radio-button value="IN">只看入库</el-radio-button>
              <el-radio-button value="OUT">只看出库</el-radio-button>
            </el-radio-group>
            <el-input
              v-model="recKeyword"
              placeholder="货号 / 品名"
              clearable
              style="width: 200px"
              :prefix-icon="Search"
              @keyup.enter="searchRecords"
              @clear="searchRecords"
            />
            <el-date-picker
              v-model="recRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始"
              end-placeholder="结束"
              style="width: 250px"
              @change="searchRecords"
            />
            <el-button :icon="Search" @click="searchRecords">查询</el-button>
          </div>
          <div class="table-fill">
            <el-table :data="records" v-loading="recLoading" height="100%">
            <el-table-column label="图片" width="62">
              <template #default="{ row }">
                <el-image :src="img(row.image)" fit="cover" class="product-thumb" />
              </template>
            </el-table-column>
            <el-table-column prop="sku" label="货号" width="110" />
            <el-table-column prop="name" label="品名" min-width="140" show-overflow-tooltip />
            <el-table-column label="方向" width="70" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.direction === 'OUT' ? 'danger' : 'success'" effect="light">
                  {{ row.direction === 'OUT' ? '出库' : '入库' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="方式" width="100">
              <template #default="{ row }">
                <!-- tag 只放方式短名，门店名/责任人放到「来源 / 责任人」列，避免长文本撑爆这一列 -->
                <el-tag
                  size="small"
                  :type="recordTypeTag(row.type).type"
                  effect="light"
                  class="nowrap-tag"
                >
                  {{ recordTypeLabel(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="件数" width="80" align="right">
              <template #default="{ row }">
                <span :style="row.direction === 'OUT' ? 'color:#d63031;font-weight:600' : ''">
                  {{ row.direction === 'OUT' ? '-' : '+' }}{{ row.quantity }}
                </span>
              </template>
            </el-table-column>
            <el-table-column v-if="auth.canSeeCost" label="进货价" width="100" align="right">
              <template #default="{ row }">
                <!-- 丢失/破损与退供应商不结转成本，这里不显示 0 以免误解 -->
                <span v-if="row.direction === 'OUT' && row.type !== 'TRANSFER'">-</span>
                <span v-else>¥{{ row.costPrice?.toFixed(2) }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="auth.canSeeCost" label="成本合计" width="110" align="right">
              <template #default="{ row }">
                <span v-if="row.direction === 'OUT' && row.type !== 'TRANSFER'">-</span>
                <span v-else>¥{{ row.totalCost?.toFixed(2) }}</span>
              </template>
            </el-table-column>
            <!-- 赔偿金额：丢失/破损按售价计赔，人人可见（向责任人追偿用） -->
            <el-table-column label="赔偿金额" width="110" align="right">
              <template #default="{ row }">
                <span v-if="row.compensate > 0" style="color:#d63031;font-weight:600">
                  ¥{{ row.compensate.toFixed(2) }}
                </span>
                <span v-else class="muted">-</span>
              </template>
            </el-table-column>
            <el-table-column label="销售价" width="100" align="right">
              <template #default="{ row }">¥{{ row.salePrice?.toFixed(2) }}</template>
            </el-table-column>
            <!-- 调拔：显示对方门店（带「调出/调入」方向）；丢失破损：显示责任人 -->
            <el-table-column label="来源 / 责任人" min-width="170" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.relatedStoreName">
                  {{ row.direction === 'OUT' ? '调出至 ' + row.relatedStoreName : row.relatedStoreName + ' 调入' }}
                </span>
                <span v-else-if="row.liablePerson">{{ row.liablePerson }}</span>
                <span v-else class="muted">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="operator" label="操作人" width="100" />
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <template #empty><el-empty description="暂无出入库记录" /></template>
            </el-table>
          </div>

          <div class="pager">
            <el-pagination
              v-model:current-page="recPage"
              v-model:page-size="recPageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="recTotal"
              layout="total, sizes, prev, pager, next, jumper"
              background
              small
            />
          </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { Aim, Camera, Refresh, Search } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import StockInResult from '@/components/StockInResult.vue'
import StockOutResult from '@/components/StockOutResult.vue'
import StockSource from '@/components/StockSource.vue'
import { inventoryApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const router = useRouter()
const route = useRoute()

/** 是否能真正做入库操作（inventory:in）；没有就只剩库存列表和出入库记录 */
const canStockIn = computed(() => auth.has('inventory:in'))
/** 库存列表单独一个权限点（stock:view），没有就不显示该 tab */
const canSeeStock = computed(() => auth.has('stock:view'))
/** 能否在商品管理里新增商品（决定跳转按钮文案） */
const canCreateProduct = computed(() => auth.has('product:create'))

/** 一键跳到商品管理去新增货号 */
function goProducts() {
  router.push('/products')
}

/**
 * 默认落在第 1 个可见 tab：有库存查看权限就先给库存列表，
 * 否则退到商品入库（有操作权限）/ 出入库记录（只读）
 */
const tab = ref(canSeeStock.value ? 'stock' : canStockIn.value ? 'stockin' : 'records')
// /inventory?tab=stock 这样的深链直接定位到对应 tab（首页「去库存管理」用）
if (route.query.tab === 'stock' && canSeeStock.value) tab.value = 'stock'
const submitting = ref(false)

/* ---------- 商品入库 / 商品出库：三种录入方式的切换 ---------- */
/** 入库方式：gun=扫码枪 video=拍照扫码 manual=手动选择 */
const stockinMode = ref('gun')
/** 出库方式（录入侧）：同样是三种 */
const stockoutMode = ref('gun')
/** 三种录入方式的展示信息（图标组件直接引用，无需再注册） */
const stockinModes = [
  { key: 'gun', label: '扫码枪入库', desc: '枪响即入，可连续扫', icon: Aim },
  { key: 'video', label: '拍照扫码入库', desc: '摄像头对准条码', icon: Camera },
  { key: 'manual', label: '手动入库', desc: '按货号 / 品名搜索', icon: Search }
]
const stockoutModes = [
  { key: 'gun', label: '扫码枪出库', desc: '枪响即出，可连续扫', icon: Aim },
  { key: 'video', label: '拍照扫码出库', desc: '摄像头对准条码', icon: Camera },
  { key: 'manual', label: '手动出库', desc: '按货号 / 品名搜索', icon: Search }
]

/** 店长/营业员只能看本店，门店选择器锁死；管理员在页面内可自由切换 */
const storeLocked = computed(() => !auth.isAdmin)
const storeOptions = computed(() =>
  auth.isAdmin ? auth.stores : [{ id: auth.user?.storeId, name: auth.storeName }]
)
/**
 * 空串＝公司总览（跨店），否则为具体门店 id。
 * 值统一用字符串，与 el-option 的 value 保持一致，避免数字/字符串不匹配显示成裸 id。
 * 初值跟随顶部门店范围，进来不需要再选一次。
 */
const targetStore = ref(auth.storeId && auth.storeId !== 'all' ? String(auth.storeId) : '')
/** 标题：入库/出库 tab 各自叫「入库门店」「出库门店」，库存列表/记录统称「门店」 */
const storeLabel = computed(() => {
  if (tab.value === 'stockin') return '入库门店'
  if (tab.value === 'stockout') return '出库门店'
  return '门店'
})
/** 是否处于作业类 tab（入库/出库必须落到具体门店） */
const isOperateTab = computed(() => tab.value === 'stockin' || tab.value === 'stockout')

/** 入库已选中的商品（右侧结果卡用） */
const stockinProduct = ref(null)
/** 入库时是扫码选中还是手动选中（决定记录里的「方式」） */
const stockinPickType = ref('SCAN')
/** 出库已选中的商品 */
const stockoutProduct = ref(null)

/** 调拔时可调入的门店列表（排除当前门店自己） */
const transferStores = computed(() => {
  const cur = Number(targetStore.value) || 0
  return storeOptions.value.filter((s) => Number(s.id) !== cur)
})

/** 切换录入方式：只清掉「另一种方式」挑中的商品，扫码枪和拍照扫码共用扫码结果要保留 */
function setStockinMode(key) {
  if (stockinMode.value === key) return
  stockinMode.value = key
  if (key === 'manual') resetScan()
  else stockinProduct.value = null
}

function setStockoutMode(key) {
  if (stockoutMode.value === key) return
  stockoutMode.value = key
  if (key === 'manual') resetStockOut()
  else stockoutProduct.value = null
}

/** 来源组件选中商品 */
function onInPicked({ product, type }) {
  stockinProduct.value = product
  stockinPickType.value = type
}

function onOutPicked({ product }) {
  stockoutProduct.value = product
}

/** 清空已选商品 */
function resetScan() {
  stockinProduct.value = null
  inSource.value?.clear?.()
}

function resetStockOut() {
  stockoutProduct.value = null
  outSource.value?.clear?.()
}

/** 来源组件实例 */
const inSource = ref(null)
const outSource = ref(null)


const records = ref([])
const recLoading = ref(false)
const recKeyword = ref('')
const recRange = ref(null)
/** 方向过滤：all=出入库都有（默认）IN=只看入库 OUT=只看出库 */
const recDirection = ref('all')
/* 出入库记录分页 */
const recPage = ref(1)
const recPageSize = ref(20)
const recTotal = ref(0)

function img(u) {
  return u || 'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
    )
}

const fmt = (d) => dayjs(d).format('YYYY-MM-DD HH:mm')

/* ---------- 库存列表（原「库存管理」独立页面） ---------- */
const stkList = ref([])
const stkLoading = ref(false)
const stkKeyword = ref('')
const stkLowOnly = ref(false)
const stkPage = ref(1)
const stkPageSize = ref(20)
const stkTotal = ref(0)
/** 合计走后端 summary，不随翻页变化 */
const stkSummary = ref({ skuCount: 0, quantity: 0, stockValue: 0 })
const stkTotalQty = computed(() => stkSummary.value.quantity || 0)
const stkTotalValue = computed(() => stkSummary.value.stockValue || 0)
/** 库存列表实际查询的门店范围就跟着右上角选择器走：空=公司总览，否则具体门店 */
const stkStoreId = computed(() => targetStore.value || 'all')
/** 跨店查看时才补「门店」列 */
const stkIsAll = computed(() => !targetStore.value)
/** 列表标题里的范围名：选中具体门店显示店名，否则「公司总览」 */
const stkStoreName = computed(() => {
  const hit = storeOptions.value.find((s) => String(s.id) === targetStore.value)
  return hit?.name || (auth.isAdmin ? '公司总览' : auth.storeName)
})

async function loadStock() {
  if (!auth.token || !canSeeStock.value) return
  stkLoading.value = true
  try {
    const res = await inventoryApi.stock({
      storeId: stkStoreId.value,
      keyword: stkKeyword.value,
      lowOnly: stkLowOnly.value ? 'true' : '',
      page: stkPage.value,
      pageSize: stkPageSize.value
    })
    stkList.value = res.rows
    stkTotal.value = res.total
    stkSummary.value = res.summary || stkSummary.value
  } finally {
    stkLoading.value = false
  }
}

function searchStock() {
  stkPage.value = 1
  loadStock()
}

function storeId() {
  if (!auth.isAdmin) return auth.user?.storeId
  return targetStore.value ? Number(targetStore.value) : null
}

/**
 * 按当前 tab 重新拉数据表。
 * 库存列表和出入库记录都按右上角门店过滤，所以换店必须重查（并回到第 1 页，
 * 否则在原来的第 3 页上看新店数据会直接空白）。
 */
function reloadCurrentTab() {
  if (tab.value === 'stock') {
    stkPage.value = 1
    loadStock()
  } else if (tab.value === 'records') {
    recPage.value = 1
    loadRecords()
  }
}

/** 切换门店：换店后待入库/待出库的单据作废，清掉已扫码/已选中的商品 */
function onStoreChange() {
  resetScan()
  resetStockOut()
  reloadCurrentTab()
}

/** 入库提交：表单数值由 StockInResult 抛上来 */
function submitStockIn(form) {
  doStockIn(stockinPickType.value === 'MANUAL' ? 'manual' : 'scan', form)
}

async function doStockIn(type, form) {
  const payload = {
    ...(form || {}),
    sku: stockinProduct.value?.sku,
    type: type === 'scan' ? 'SCAN' : 'MANUAL',
    storeId: storeId(),
  }
  if (!payload.sku) return ElMessage.warning('请先选择商品')
  if (!payload.storeId) return ElMessage.warning('请先选择入库门店')
  // 销售价不再由入库页填写，统一取商品档案价（后端校验，缺价会直接报错）
  submitting.value = true
  try {
    const res = await inventoryApi.stockIn(payload)
    ElMessage.success(`${res.product.name} 入库 ${payload.quantity} 件成功，现有库存 ${res.stock.quantity} 件`)
    resetScan()
    // 新记录排在最前，回到第一页才看得到
    recPage.value = 1
    loadRecords()
    // 入库会抬高库存，列表同步刷新一次，免得切回「库存列表」看到的还是旧数字
    if (canSeeStock.value) loadStock()
  } finally {
    submitting.value = false
  }
}

/** 出库提交：出库方式（丢失破损/退供应商/调拔）由 StockOutResult 抛上来 */
async function submitStockOut(form) {
  const product = stockoutProduct.value
  if (!product) return ElMessage.warning('请先选择商品')
  const sid = storeId()
  if (!sid) return ElMessage.warning('请先选择出库门店')
  if (form.outType === 'LOSS' && !form.liablePerson?.trim()) {
    return ElMessage.warning('丢失/破损出库请填写责任人，便于后续追偿')
  }
  if (form.outType === 'TRANSFER' && !form.targetStoreId) {
    return ElMessage.warning('请选择要调入的门店')
  }
  submitting.value = true
  try {
    const res = await inventoryApi.stockOut({
      sku: product.sku,
      quantity: form.quantity,
      outType: form.outType,
      targetStoreId: form.targetStoreId,
      liablePerson: form.liablePerson,
      remark: form.remark,
      storeId: sid,
    })
    const tail =
      form.outType === 'TRANSFER'
        ? `，已调拨至「${res.targetStoreName}」`
        : form.outType === 'LOSS'
          ? `，应赔金额 ¥${Number(res.compensate).toFixed(2)}`
          : '，成本已清除'
    ElMessage.success(`${res.product.name} 出库 ${form.quantity} 件成功，现有库存 ${res.stock.quantity} 件${tail}`)
    resetStockOut()
    recPage.value = 1
    loadRecords()
    if (canSeeStock.value) loadStock()
  } finally {
    submitting.value = false
  }
}

/** 记录里的方式标签：入库的扫码/手动/调拔，出库的丢失破损/退供应商/调拔 */
function recordTypeTag(type) {
  if (type === 'LOSS') return { type: 'danger' }
  if (type === 'SUPPLIER') return { type: 'warning' }
  if (type === 'TRANSFER') return { type: 'info' }
  if (type === 'SCAN') return { type: 'success' }
  return { type: 'primary' }
}

/**
 * 方式标签文案：只放「方式」本身，门店名/责任人由「来源 / 责任人」列承载。
 * 之前调拨把「调拨至XX店」整个塞进 tag，列宽不够就被截断。
 */
function recordTypeLabel(type) {
  if (type === 'LOSS') return '丢失/破损'
  if (type === 'SUPPLIER') return '退供应商'
  if (type === 'TRANSFER') return '调拨'
  return type === 'SCAN' ? '扫码' : '手动'
}


async function loadRecords() {
  recLoading.value = true
  try {
    const res = await inventoryApi.records({
      storeId: stkStoreId.value,
      direction: recDirection.value,
      keyword: recKeyword.value,
      from: recRange.value?.[0],
      to: recRange.value?.[1],
      page: recPage.value,
      pageSize: recPageSize.value
    })
    records.value = res.rows
    recTotal.value = res.total
  } finally {
    recLoading.value = false
  }
}

/** 改查询条件：回到第一页再查 */
function searchRecords() {
  recPage.value = 1
  loadRecords()
}

watch([recPage, recPageSize], () => {
  if (tab.value === 'records') loadRecords()
})

watch([stkPage, stkPageSize], () => {
  if (tab.value === 'stock') loadStock()
})

watch(tab, (v) => {
  if (v === 'stock') loadStock()
  if (v === 'records') loadRecords()
  // 摄像头的开关交给 StockSource 组件按 active 自行处理，这里不用管
})

// 顶部切换门店范围后，右上角选择器同步跟随，并按当前 tab 重查
watch(
  () => auth.storeId,
  (v) => {
    targetStore.value = v && v !== 'all' ? String(v) : ''
    reloadCurrentTab()
  }
)

onMounted(async () => {
  // 刷新后 stores 可能还没加载，先补一次，避免门店下拉只有裸 id
  if (auth.isAdmin && !auth.stores.length) {
    try {
      await auth.loadStores()
    } catch (e) {
      /* ignore */
    }
  }
  // 默认停在第一个 tab：有库存权限先加载库存列表，否则走原来的入库/记录逻辑
  if (tab.value === 'stock') loadStock()
  else if (tab.value === 'records') loadRecords()
})
</script>

<style scoped lang="scss">
/* 标签页也要把高度一路传下去：el-tabs → el-tabs__content → el-tab-pane → .pane-fill → 表格 */
/* 标签页内部的高度链路（.el-tabs 本身的伸缩在全局样式里） */
.el-tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
}

.el-tabs :deep(.el-tabs__content) {
  flex: 1 1 0;
  min-height: 0;
  /* 库存列表列宽加起来会比较宽，不置 0 会把整张卡片撑破、横向溢出页面 */
  min-width: 0;
}

/* 面板本身不滚，滚动交给里面的卡片（避免双层滚动条） */
.el-tabs :deep(.el-tab-pane) {
  height: 100%;
  overflow: hidden;
  min-width: 0;
}

/* 三个入库方式：左右两栏都撑满面板高度，卡片内部各自滚动 */
.scan-row,
.scan-row > .el-col {
  height: 100%;
}

/* 方式选择器：三个并列的小卡片，点一下切换下面展示哪种入库方式 */
.mode-picker {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.mode-card {
  flex: 1 1 0;
  min-width: 160px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid #e6e6f2;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  color: #4a4a63;
  text-align: left;
  transition: all 0.18s;
}

/* 方式标签不换行：列宽不够时宁可挤一点，也不要把「丢失/破损」断成两行 */
.nowrap-tag {
  white-space: nowrap;
}

.mode-card:hover {
  border-color: #c9c5ef;
  background: #fbfaff;
}

.mode-card.active {
  border-color: var(--brand);
  background: #f6f4ff;
  color: #23233a;
  box-shadow: 0 1px 6px rgba(108, 92, 231, 0.12);
}

.mode-icon {
  font-size: 17px;
  color: var(--brand);
}

.mode-name {
  font-weight: 600;
  white-space: nowrap;
}

.mode-desc {
  margin-left: auto;
  font-size: 12px;
  color: #9a9ab2;
  white-space: nowrap;
}

.pane-fill {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pane-fill > * {
  flex: 0 0 auto;
}

.pane-fill > .table-fill {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  margin-top: 0;
}

/* 方式内容区：吃掉选择器以外的全部高度，左右两栏再撑满它 */
.pane-fill > .mode-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mode-body > .scan-row {
  flex: 1 1 0;
  min-height: 0;
}

/* 右栏结果卡（StockInResult / StockOutResult 的根节点）：同样撑满、超出自滚 */
.result-fill {
  height: 100%;
  overflow-y: auto;
}

/* 卡片内部滚动条收细，避免压住内容 */
.result-fill::-webkit-scrollbar {
  width: 6px;
}

.result-fill::-webkit-scrollbar-thumb {
  background: rgba(35, 35, 58, 0.16);
  border-radius: 3px;
}

.result-fill::-webkit-scrollbar-track {
  background: transparent;
}


/* 窄屏：两栏上下堆叠，高度交回内容，超出时整块面板滚动 */
@media (max-width: 1199.98px) {
  .el-tabs :deep(.el-tab-pane) {
    overflow-y: auto;
  }

  .scan-row,
  .scan-row > .el-col,
  .result-fill {
    height: auto;
  }

  /* 来源卡片在子组件里，scoped 样式要用 :deep() 才能命中 */
  .scan-row > .el-col:first-child :deep(.source-card) {
    height: auto;
  }

  .scan-row > .el-col:first-child {
    margin-bottom: 16px;
  }
}
</style>
