<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">库存管理</h3>
          <div class="page-sub">
            {{
              canStockIn
                ? '盘点库存、扫码枪/拍照/手动入库一站式处理'
                : '当前角色没有入库操作权限，仅可查看库存与入库记录（不展示进货价）'
            }}
          </div>
        </div>
        <div class="flex">
          <span class="muted" style="font-size: 13px">{{ canStockIn ? '入库门店' : '门店' }}</span>
          <el-select
            v-model="targetStore"
            style="width: 200px"
            :disabled="storeLocked"
            :placeholder="storeLocked ? '' : '请选择要入库的门店'"
            @change="resetBoth"
          >
            <el-option
              v-for="s in storeOptions"
              :key="s.id"
              :label="s.name"
              :value="String(s.id)"
            />
          </el-select>
        </div>
      </div>

      <!-- 只有入库类 tab 才必须要落到具体门店；库存列表本身支持「公司总览」跨店查看 -->
      <el-alert
        v-if="canStockIn && tab !== 'stock' && !targetStore"
        type="warning"
        :closable="false"
        show-icon
        title="当前处于「公司总览」，货品必须入到具体门店，请先选择右上角入库门店；不选无法提交"
        style="margin-top: 12px"
      />

      <el-tabs v-model="tab" style="margin-top: 8px">
        <!-- ========== 库存列表（需要 stock:view） ========== -->
        <el-tab-pane v-if="canSeeStock" label="库存列表" name="stock">
          <div class="pane-fill">
            <div class="flex-between" style="margin-bottom: 12px; flex-wrap: wrap">
              <div class="page-sub">
                {{ auth.storeName }} · 共 {{ stkTotal }} 个 SKU，合计 {{ stkTotalQty }} 件
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

        <!-- ========== 扫码枪入库（需要 inventory:in） ========== -->
        <el-tab-pane v-if="canStockIn" label="扫码枪入库" name="gun">
          <el-row :gutter="16" class="scan-row">
            <el-col :xs="24" :lg="10">
              <div class="source-card">
                <div class="source-title">
                  <el-icon><Aim /></el-icon>
                  扫码枪输入
                </div>

                <div
                  class="gun-box"
                  :class="{ active: gunFocused }"
                  @click="focusGun"
                  @mouseenter="focusGun"
                >
                  <el-input
                    ref="gunInput"
                    v-model="gunCode"
                    :prefix-icon="Aim"
                    placeholder="扫码枪直接扫，或粘贴编码后回车"
                    @keyup.enter="handleCode(gunCode)"
                    @focus="gunFocused = true"
                    @blur="gunFocused = false"
                  >
                    <template #append>
                      <span class="gun-state">
                        <i class="dot" />
                        {{ gunFocused ? '扫码就绪' : '点击激活' }}
                      </span>
                    </template>
                  </el-input>
                </div>

                <div class="step-list">
                  <div class="step">
                    <span class="n">1</span>
                    <div>
                      <b>扫描条码</b>
                      <div class="muted">枪响即入，光标一直留在框里，可连续扫</div>
                    </div>
                  </div>
                  <div class="step">
                    <span class="n">2</span>
                    <div>
                      <b>核对商品</b>
                      <div class="muted">右侧显示品名、当前库存与档案价</div>
                    </div>
                  </div>
                  <div class="step">
                    <span class="n">3</span>
                    <div>
                      <b>确认入库</b>
                      <div class="muted">填实际进价与件数，成本自动移动加权</div>
                    </div>
                  </div>
                </div>

                <el-alert type="info" :closable="false" show-icon class="tip-alert">
                  <div style="line-height: 1.7">
                    商品还没有条码？到
                    <router-link to="/products" class="link">商品管理</router-link>
                    勾选商品后点「打印标签」，即可生成条形码（标签上的条码就是货号）
                  </div>
                </el-alert>
              </div>
            </el-col>

            <el-col :xs="24" :lg="14">
              <StockInResult
                class="result-fill"
                :product="scanned"
                :loading="submitting"
                @submit="submitScan"
                @reset="resetScan"
                @go-products="goProducts"
              />
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- ========== 拍照扫码入库（进 tab 自动开摄像头，需要 inventory:in） ========== -->
        <el-tab-pane v-if="canStockIn" label="拍照扫码入库" name="video">
          <el-row :gutter="16" class="scan-row">
            <el-col :xs="24" :lg="10">
              <div class="source-card">
                <div class="source-title">
                  <el-icon><Camera /></el-icon>
                  摄像头扫码
                </div>
                <BarcodeScanner ref="scanner" @result="onVideoResult" />

                <el-alert type="info" :closable="false" show-icon class="tip-alert">
                  <div style="line-height: 1.7">
                    商品还没有条码？到
                    <router-link to="/products" class="link">商品管理</router-link>
                    勾选商品后点「打印标签」，即可生成条形码（标签上的条码就是货号）
                  </div>
                </el-alert>
              </div>
            </el-col>

            <el-col :xs="24" :lg="14">
              <StockInResult
                class="result-fill"
                :product="scanned"
                :loading="submitting"
                @submit="submitScan"
                @reset="resetScan"
                @go-products="goProducts"
              />
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- ========== 手动入库（需要 inventory:in） ========== -->
        <el-tab-pane v-if="canStockIn" label="手动入库" name="manual">
          <el-row :gutter="16" class="scan-row">
            <el-col :xs="24" :lg="10">
              <div class="source-card">
                <div class="source-title">
                  <el-icon><Search /></el-icon>
                  选择商品
                </div>
                <el-select
                  ref="manualSelect"
                  v-model="manualSku"
                  filterable
                  remote
                  clearable
                  reserve-keyword
                  size="large"
                  placeholder="输入货号或品名搜索"
                  :remote-method="searchProduct"
                  :loading="searching"
                  style="width: 100%; margin-top: 12px"
                  @change="onPickProduct"
                >
                  <el-option v-for="o in options" :key="o.sku" :label="`${o.sku} · ${o.name}`" :value="o.sku" />
                </el-select>

                <div class="step-list">
                  <div class="step">
                    <span class="n">1</span>
                    <div>
                      <b>搜索商品</b>
                      <div class="muted">按货号或品名模糊搜索，选中即带出商品信息</div>
                    </div>
                  </div>
                  <div class="step">
                    <span class="n">2</span>
                    <div>
                      <b>核对商品</b>
                      <div class="muted">右侧显示品名、当前库存与档案价</div>
                    </div>
                  </div>
                  <div class="step">
                    <span class="n">3</span>
                    <div>
                      <b>确认入库</b>
                      <div class="muted">填实际进价与件数，成本自动移动加权</div>
                    </div>
                  </div>
                </div>

                <el-alert type="info" :closable="false" show-icon class="tip-alert">
                  <div class="flex" style="align-items: center; gap: 4px; flex-wrap: wrap; line-height: 1.7">
                    <span>若货号不存在，请先到「商品管理」中新增商品</span>
                    <el-button link type="primary" :icon="Plus" @click="goProducts">
                      {{ canCreateProduct ? '去新增商品' : '去商品管理' }}
                    </el-button>
                  </div>
                </el-alert>
              </div>
            </el-col>

            <el-col :xs="24" :lg="14">
              <StockInResult
                class="result-fill"
                :product="manualProduct"
                :loading="submitting"
                empty-text="搜索并选中商品后，这里会显示商品信息"
                @submit="submitManual"
                @reset="resetManual"
                @go-products="goProducts"
              />
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- ========== 入库记录 ========== -->
        <el-tab-pane label="入库记录" name="records">
          <div class="pane-fill">
          <div class="flex" style="margin-bottom: 12px; flex-wrap: wrap">
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
            <el-table-column label="方式" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.type === 'SCAN' ? 'success' : 'primary'" effect="light">
                  {{ row.type === 'SCAN' ? '扫码' : '手动' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="quantity" label="件数" width="80" align="right" />
            <el-table-column v-if="auth.canSeeCost" label="进货价" width="100" align="right">
              <template #default="{ row }">¥{{ row.costPrice?.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="销售价" width="100" align="right">
              <template #default="{ row }">¥{{ row.salePrice?.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column prop="operator" label="操作人" width="100" />
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <template #empty><el-empty description="暂无入库记录" /></template>
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
import { computed, h, nextTick, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { Aim, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import BarcodeScanner from '@/components/BarcodeScanner.vue'
import StockInResult from '@/components/StockInResult.vue'
import { inventoryApi, productApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const router = useRouter()
const route = useRoute()

/** 是否能真正做入库操作（inventory:in）；没有就只剩库存列表和入库记录 */
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
 * 否则退到扫码入库（有操作权限）/ 入库记录（只读）
 */
const tab = ref(canSeeStock.value ? 'stock' : canStockIn.value ? 'gun' : 'records')
// /inventory?tab=stock 这样的深链直接定位到对应 tab（首页「去库存管理」用）
if (route.query.tab === 'stock' && canSeeStock.value) tab.value = 'stock'
const submitting = ref(false)

/** 已锁定到某家店（管理员在分店页 / 店长营业员）：选择器不可改 */
const storeLocked = computed(() => auth.storeId !== 'all')
const storeOptions = computed(() =>
  auth.isAdmin ? auth.stores : [{ id: auth.user?.storeId, name: auth.storeName }]
)
/** 值统一用字符串，与 el-option 的 value 保持一致，避免数字/字符串不匹配显示成裸 id */
const targetStore = ref(storeLocked.value ? String(auth.storeId ?? '') : '')

const scanned = ref(null)
const gunCode = ref('')
/** 扫码枪输入框实例（模板 ref="gunInput"） */
const gunInput = ref(null)
/** 摄像头扫码组件实例（模板 ref="scanner"） */
const scanner = ref(null)
/** 光标是否在扫码框里（决定状态灯亮不亮） */
const gunFocused = ref(false)

/**
 * 让扫码输入框获得焦点。
 * 延迟一拍再 focus：切 tab / 首屏渲染时 el-tab-pane 内容可能还没挂载完，
 * 直接 focus 会拿到 undefined。
 */
function focusGun() {
  if (tab.value !== 'gun') return
  gunFocused.value = true
  nextTick(() => {
    setTimeout(() => {
      const el = gunInput.value
      if (!el) return
      el.focus?.()
      el.select?.()
    }, 50)
  })
}

/** 手动入库：只存选中的货号，进价/件数交给 StockInResult 管（和另外两个 tab 同一套表单） */
const manualSku = ref('')
/** 手动入库的搜索框实例（模板 ref="manualSelect"） */
const manualSelect = ref(null)
/** 手动入库选中的商品（查询到完整信息后给结果卡用） */
const manualProduct = ref(null)
const options = ref([])
const searching = ref(false)

/** 进「手动入库」就把光标放进搜索框，跟另外两个 tab 的体验保持一致 */
function focusManual() {
  nextTick(() => {
    setTimeout(() => manualSelect.value?.focus?.(), 50)
  })
}

const records = ref([])
const recLoading = ref(false)
const recKeyword = ref('')
const recRange = ref(null)
/* 入库记录分页 */
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
/** 库存列表跟随顶部的门店范围（公司总览时展示门店列），不受右边「入库门店」影响 */
const stkIsAll = computed(() => auth.isAdmin && auth.storeId === 'all')

async function loadStock() {
  if (!auth.token || !canSeeStock.value) return
  stkLoading.value = true
  try {
    const res = await inventoryApi.stock({
      storeId: auth.storeId,
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

async function handleCode(code) {
  if (!code) return
  if (!storeId()) return ElMessage.warning('请先选择入库门店')
  try {
    const res = await inventoryApi.scan(code, storeId())
    if (!res?.found) {
      // 提示里带一个可点击入口，直接去商品管理新增
      ElMessage({
        type: 'error',
        duration: 6000,
        message: h('span', null, [
          `未找到编码「${code}」对应的商品，请先新增：`,
          h(
            'a',
            {
              onClick: goProducts,
              style: 'color:#6c5ce7;cursor:pointer;text-decoration:underline;margin-left:4px',
            },
            canCreateProduct.value ? '去新增商品' : '去商品管理'
          ),
        ]),
      })
      scanned.value = null
      return
    }
    scanned.value = res.product
    ElMessage.success(`已识别：${res.product.name}`)
  } catch (e) {
    /* handled */
  } finally {
    // 焦点还给扫码枪输入框，并选中已有内容：下一枪会整体覆盖，不会拼成 "DY001DY002"
    if (tab.value === 'gun') nextTick(() => gunInput.value?.select?.())
  }
}

/** 摄像头扫码识别到的编码：填进 input（方便看清扫到了什么）并直接解析 */
function onVideoResult(code) {
  gunCode.value = code
  handleCode(code)
}

function resetScan() {
  scanned.value = null
  gunCode.value = ''
  // 清除 / 入库成功 / 换门店后都把焦点还给扫码框，连续扫码不用手动点
  focusGun()
}

async function searchProduct(kw) {
  if (!kw) return
  searching.value = true
  try {
    const res = await productApi.list({ keyword: kw, pageSize: 20 })
    options.value = (res.rows || []).slice(0, 20)
  } finally {
    searching.value = false
  }
}

async function onPickProduct(sku) {
  manualProduct.value = null
  if (!sku) return
  const sid = storeId()
  if (!sid) {
    manualSku.value = ''
    return ElMessage.warning('请先选择入库门店')
  }
  try {
    // 走和扫码同一条接口，拿到的商品信息（库存、档案价、上次进价）完全一致
    const res = await inventoryApi.scan(sku, sid)
    if (!res?.found) {
      ElMessage.error(`未找到货号「${sku}」对应的商品`)
      manualSku.value = ''
      return
    }
    manualProduct.value = res.product
  } catch (e) {
    /* handled */
  }
}

function resetManual() {
  manualSku.value = ''
  manualProduct.value = null
}

/** 换门店：两个扫码入口 + 手动入库的选中商品全部清掉，避免把 A 店商品记到 B 店 */
function resetBoth() {
  resetManual()
  resetScan()
}

/** 扫码枪 / 拍照扫码共用：表单数值由 StockInResult 抛上来 */
function submitScan(form) {
  doStockIn('scan', form)
}

/** 手动入库同样用 StockInResult 的表单，只是商品来自搜索 */
function submitManual(form) {
  doStockIn('manual', form)
}

async function doStockIn(type, form) {
  const payload =
    type === 'scan'
      ? { ...(form || {}), sku: scanned.value?.sku, type: 'SCAN', storeId: storeId() }
      : { ...(form || {}), sku: manualSku.value, type: 'MANUAL', storeId: storeId() }
  if (!payload.sku) return ElMessage.warning('请先选择商品')
  if (!payload.storeId) return ElMessage.warning('请先选择入库门店')
  // 销售价不再由入库页填写，统一取商品档案价（后端校验，缺价会直接报错）
  submitting.value = true
  try {
    const res = await inventoryApi.stockIn(payload)
    ElMessage.success(`${res.product.name} 入库 ${payload.quantity} 件成功，现有库存 ${res.stock.quantity} 件`)
    if (type === 'scan') resetScan()
    else resetManual()
    // 新记录排在最前，回到第一页才看得到
    recPage.value = 1
    loadRecords()
    // 入库会抬高库存，列表同步刷新一次，免得切回「库存列表」看到的还是旧数字
    if (canSeeStock.value) loadStock()
  } finally {
    submitting.value = false
  }
}

async function loadRecords() {
  recLoading.value = true
  try {
    const res = await inventoryApi.records({
      storeId: storeId(),
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
  if (v === 'gun') focusGun()
  if (v === 'manual') focusManual()
  // 进「拍照扫码入库」直接把摄像头打开，不用人再点一下；离开就关掉释放摄像头
  if (v === 'video') nextTick(() => scanner.value?.start?.())
  else scanner.value?.stop?.()
})

// 顶部切换门店后，入库门店同步跟随
watch(
  () => auth.storeId,
  (v) => {
    targetStore.value = v && v !== 'all' ? String(v) : ''
    // 库存列表按顶部门店范围统计，切换后要跟着重算
    if (canSeeStock.value) {
      stkPage.value = 1
      loadStock()
    }
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
  else focusGun()
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

/* 左栏「来源」卡片：把扫码/搜索区、操作步骤和提示收在一张卡里，避免大片空白 */
.source-card {
  height: 100%;
  overflow-y: auto;
  border: 1px solid #ececf6;
  border-radius: 12px;
  padding: 16px;
  background: #fcfcff;
}

/* 右栏结果卡（StockInResult 的根节点）：同样撑满、超出自滚 */
.result-fill {
  height: 100%;
  overflow-y: auto;
}

/* 卡片内部滚动条收细，避免压住内容 */
.source-card::-webkit-scrollbar,
.result-fill::-webkit-scrollbar {
  width: 6px;
}

.source-card::-webkit-scrollbar-thumb,
.result-fill::-webkit-scrollbar-thumb {
  background: rgba(35, 35, 58, 0.16);
  border-radius: 3px;
}

.source-card::-webkit-scrollbar-track,
.result-fill::-webkit-scrollbar-track {
  background: transparent;
}

.source-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #23233a;
}

.source-title .el-icon {
  font-size: 18px;
  color: var(--brand);
}

/* 三步指引：图标圆圈 + 说明 */
.step-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed #ececf6;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.step .n {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  background: rgba(108, 92, 231, 0.12);
  color: var(--brand);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step b {
  font-size: 13px;
  color: #2c2c3a;
}

.step .muted {
  font-size: 12px;
  margin-top: 2px;
  line-height: 1.6;
}

.tip-alert {
  margin-top: 14px;
}

.tip-alert .link {
  color: var(--brand);
  text-decoration: none;
}

/* 窄屏：两栏上下堆叠，高度交回内容，超出时整块面板滚动 */
@media (max-width: 1199.98px) {
  .el-tabs :deep(.el-tab-pane) {
    overflow-y: auto;
  }

  .scan-row,
  .scan-row > .el-col,
  .source-card,
  .result-fill {
    height: auto;
  }

  .scan-row > .el-col:first-child {
    margin-bottom: 16px;
  }
}
</style>
