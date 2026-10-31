<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">退货处理</h3>
          <div class="page-sub">
            {{
              canHandle
                ? '扫码或搜索商品即可退货；可按订单号 / 货号关联原销售单，关联后价格自动取该单成交价'
                : '仅可查看退货记录'
            }}
          </div>
        </div>
        <div class="flex">
          <span class="muted" style="font-size: 13px">退货门店</span>
          <el-select
            v-model="targetStore"
            :disabled="storeLocked"
            placeholder="请选择门店"
            style="width: 180px"
            @change="resetAll"
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

      <el-alert
        v-if="!targetStore"
        type="warning"
        :closable="false"
        show-icon
        title="当前处于「公司总览」，退货必须选到具体门店，请先选择右上角退货门店"
        style="margin-top: 12px"
      />

      <el-tabs v-model="tab" style="margin-top: 8px">
        <!-- ========== 扫码枪退货 ========== -->
        <el-tab-pane v-if="canHandle" label="扫码枪退货" name="gun">
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
                    placeholder="扫顾客小票/吊牌条码，或粘贴编码回车"
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
                      <b>扫描商品</b>
                      <div class="muted">扫货号条码，自动带出档案销售价与库存</div>
                    </div>
                  </div>
                  <div class="step">
                    <span class="n">2</span>
                    <div>
                      <b>关联原单（可选）</b>
                      <div class="muted">按订单号或货号找到原销售单，价格自动换成成交价</div>
                    </div>
                  </div>
                  <div class="step">
                    <span class="n">3</span>
                    <div>
                      <b>确认退货</b>
                      <div class="muted">库存回补，营业额 / 毛利按归口日期冲减</div>
                    </div>
                  </div>
                </div>

                <el-alert type="info" :closable="false" show-icon class="tip-alert">
                  <div style="line-height: 1.7">
                    未关联订单的退货会生成一张负数冲减单，抵减<strong>今天</strong>的营业额与毛利；关联成功后则回算到<strong>原订单那一天</strong>。
                  </div>
                </el-alert>
              </div>
            </el-col>

            <el-col :xs="24" :lg="14">
              <div class="source-card result-fill">
                <ReturnCard
                  :product="scanned"
                  :store-id="storeId()"
                  :submitting="submitting"
                  @submit="doReturn"
                  @reset="resetScan"
                  @go-products="goProducts"
                />
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- ========== 拍照扫码退货 ========== -->
        <el-tab-pane v-if="canHandle" label="拍照扫码退货" name="video">
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
                    条形码请横放、占画面宽度一半以上；扫到后右侧可选择关联原销售单再确认退货
                  </div>
                </el-alert>
              </div>
            </el-col>
            <el-col :xs="24" :lg="14">
              <div class="source-card result-fill">
                <ReturnCard
                  :product="scanned"
                  :store-id="storeId()"
                  :submitting="submitting"
                  @submit="doReturn"
                  @reset="resetScan"
                  @go-products="goProducts"
                />
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- ========== 手动退货 ========== -->
        <el-tab-pane v-if="canHandle" label="手动退货" name="manual">
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
                  <el-option
                    v-for="o in options"
                    :key="o.sku"
                    :label="`${o.sku} · ${o.name}`"
                    :value="o.sku"
                  />
                </el-select>

                <el-alert type="info" :closable="false" show-icon class="tip-alert">
                  <div style="line-height: 1.7">
                    没有条码的商品可在这里按货号/品名找；选中后右侧同样支持关联原销售单
                  </div>
                </el-alert>
              </div>
            </el-col>
            <el-col :xs="24" :lg="14">
              <div class="source-card result-fill">
                <ReturnCard
                  :product="scanned"
                  :store-id="storeId()"
                  :submitting="submitting"
                  empty-text="搜索并选中商品后，这里会显示退货信息"
                  @submit="doReturn"
                  @reset="resetScan"
                  @go-products="goProducts"
                />
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- ========== 退货记录 ========== -->
        <el-tab-pane label="退货记录" name="records">
          <div class="pane-fill">
            <div class="flex" style="margin-bottom: 12px; flex-wrap: wrap">
              <el-input
                v-model="recKeyword"
                placeholder="退货单号 / 货号 / 品名 / 订单号"
                clearable
                style="width: 240px"
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
              <el-select
                v-model="recLinked"
                placeholder="全部退货"
                clearable
                style="width: 140px"
                @change="searchRecords"
              >
                <el-option label="已关联订单" value="1" />
                <el-option label="未关联订单" value="0" />
              </el-select>
              <el-button :icon="Search" @click="searchRecords">查询</el-button>
              <div style="flex: 1"></div>
              <span class="muted" style="font-size: 13px">
                退款合计 ¥{{ recSummary.refundAmount.toFixed(2) }}，冲减毛利 ¥{{ recSummary.refundProfit.toFixed(2) }}
              </span>
            </div>

            <div class="table-fill">
              <el-table :data="records" v-loading="recLoading" height="100%">
                <el-table-column label="图片" width="62">
                  <template #default="{ row }">
                    <el-image :src="img(row.image)" fit="cover" class="product-thumb" />
                  </template>
                </el-table-column>
                <el-table-column prop="returnNo" label="退货单号" width="180" />
                <el-table-column prop="sku" label="货号" width="110" />
                <el-table-column prop="name" label="品名" min-width="130" show-overflow-tooltip />
                <el-table-column label="件数" width="70" align="right">
                  <template #default="{ row }">{{ row.quantity }}</template>
                </el-table-column>
                <el-table-column label="退货价" width="100" align="right">
                  <template #default="{ row }">¥{{ row.unitPrice.toFixed(2) }}</template>
                </el-table-column>
                <el-table-column label="退款金额" width="110" align="right">
                  <template #default="{ row }">
                    <b class="trend-down">¥{{ row.refundAmount.toFixed(2) }}</b>
                  </template>
                </el-table-column>
                <el-table-column label="关联订单" width="180">
                  <template #default="{ row }">
                    <span v-if="row.linked" class="muted">{{ row.orderNo }}</span>
                    <el-tag v-else type="warning" effect="light" size="small">未关联</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="operator" label="操作人" width="100" />
                <el-table-column label="时间" width="150">
                  <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip />
                <el-table-column label="操作" width="80" fixed="right">
                  <template #default="{ row }">
                    <el-button
                      v-if="!row.linked && canRevoke(row)"
                      link
                      type="danger"
                      @click="revoke(row)"
                    >
                      撤销
                    </el-button>
                    <span v-else class="muted">-</span>
                  </template>
                </el-table-column>
                <template #empty><el-empty description="暂无退货记录" /></template>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Aim, Camera, Search } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import BarcodeScanner from '@/components/BarcodeScanner.vue'
import ReturnCard from '@/components/ReturnCard.vue'
import { productApi, returnApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const router = useRouter()

const canHandle = computed(() => auth.has('return:handle'))

const storeLocked = computed(() => auth.storeId !== 'all')
const storeOptions = computed(() =>
  auth.isAdmin ? auth.stores : [{ id: auth.user?.storeId, name: auth.storeName }]
)
const targetStore = ref(storeLocked.value ? String(auth.storeId ?? '') : '')

const tab = ref(canHandle.value ? 'gun' : 'records')
const submitting = ref(false)

const scanned = ref(null)
const gunCode = ref('')
const gunInput = ref(null)
const gunFocused = ref(false)
const scanner = ref(null)

const manualSku = ref('')
const manualSelect = ref(null)
const options = ref([])
const searching = ref(false)

const records = ref([])
const recLoading = ref(false)
const recKeyword = ref('')
const recRange = ref(null)
const recLinked = ref('')
const recPage = ref(1)
const recPageSize = ref(20)
const recTotal = ref(0)
const recSummary = ref({ refundAmount: 0, refundProfit: 0, quantity: 0 })

const fmt = (d) => dayjs(d).format('YYYY-MM-DD HH:mm')

function img(u) {
  return (
    u ||
    'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
      )
  )
}

function storeId() {
  if (!auth.isAdmin) return auth.user?.storeId
  return targetStore.value ? Number(targetStore.value) : null
}

function goProducts() {
  router.push('/products')
}

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

function focusManual() {
  nextTick(() => setTimeout(() => manualSelect.value?.focus?.(), 50))
}

async function handleCode(code) {
  const kw = (code || '').trim()
  if (!kw) return
  if (!storeId()) return ElMessage.warning('请先选择退货门店')
  try {
    const res = await returnApi.scan(kw, storeId())
    if (!res?.found) {
      ElMessage.error(`未找到编码「${kw}」对应的商品`)
      return
    }
    scanned.value = res.product
    ElMessage.success(`已识别：${res.product.name}`)
  } catch (e) {
    /* handled */
  } finally {
    if (tab.value === 'gun') nextTick(() => gunInput.value?.select?.())
  }
}

function onVideoResult(code) {
  gunCode.value = code
  handleCode(code)
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
  scanned.value = null
  if (!sku) return
  if (!storeId()) {
    manualSku.value = ''
    return ElMessage.warning('请先选择退货门店')
  }
  const res = await returnApi.scan(sku, storeId())
  if (!res?.found) {
    ElMessage.error(`未找到货号「${sku}」对应的商品`)
    manualSku.value = ''
    return
  }
  scanned.value = res.product
}

function resetScan() {
  scanned.value = null
  gunCode.value = ''
  manualSku.value = ''
  focusGun()
}

function resetAll() {
  resetScan()
}

async function doReturn(payload) {
  if (!storeId()) return ElMessage.warning('请先选择退货门店')
  submitting.value = true
  try {
    const res = await returnApi.create({ ...payload, storeId: storeId() })
    ElMessage.success(
      res.linked
        ? `退货成功，已回算到订单 ${res.ret.orderNo} 那一天的营业额`
        : `退货成功，已生成冲减单 ${res.offsetOrderNo}，抵减今日营业额`
    )
    resetScan()
    recPage.value = 1
    loadRecords()
  } finally {
    submitting.value = false
  }
}

async function loadRecords() {
  recLoading.value = true
  try {
    const res = await returnApi.records({
      storeId: storeId(),
      keyword: recKeyword.value,
      from: recRange.value?.[0],
      to: recRange.value?.[1],
      linked: recLinked.value || undefined,
      page: recPage.value,
      pageSize: recPageSize.value
    })
    records.value = res.rows
    recTotal.value = res.total
    recSummary.value = res.summary || recSummary.value
  } finally {
    recLoading.value = false
  }
}

function searchRecords() {
  recPage.value = 1
  loadRecords()
}

/** 未关联的退货可撤销：管理员全都能撤，其他人只能撤自己处理的（或被授权 sale:edit:all） */
function canRevoke(row) {
  if (auth.isAdmin || auth.has('sale:edit:all')) return true
  return row.operatorId != null && row.operatorId === auth.user?.id
}

async function revoke(row) {
  try {
    await ElMessageBox.confirm(
      `撤销后：库存扣回 ${row.quantity} 件，营业额恢复 ¥${row.refundAmount.toFixed(2)}，` +
        `这条退货记录和对应冲减单都会被删除。确认撤销「${row.returnNo}」？`,
      '撤销退货',
      { type: 'warning', confirmButtonText: '确认撤销', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    const res = await returnApi.revoke(row.id)
    ElMessage.success(`已撤销，库存已扣回至 ${res.stock} 件`)
    loadRecords()
  } catch (e) {
    /* handled */
  }
}

watch([recPage, recPageSize], () => {
  if (tab.value === 'records') loadRecords()
})

watch(tab, (v) => {
  if (v === 'records') loadRecords()
  if (v === 'gun') focusGun()
  if (v === 'manual') focusManual()
  if (v === 'video') nextTick(() => scanner.value?.start?.())
  else scanner.value?.stop?.()
})

watch(
  () => auth.storeId,
  (v) => {
    targetStore.value = v && v !== 'all' ? String(v) : ''
  }
)

onMounted(async () => {
  if (auth.isAdmin && !auth.stores.length) {
    try {
      await auth.loadStores()
    } catch (e) {
      /* ignore */
    }
  }
  if (tab.value === 'records') loadRecords()
  else focusGun()
})
</script>

<style scoped lang="scss">
/* 与货品入库保持同一套版式 */
.el-tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
}

.el-tabs :deep(.el-tabs__content) {
  flex: 1 1 0;
  min-height: 0;
}

.el-tabs :deep(.el-tab-pane) {
  height: 100%;
  overflow: hidden;
}

.scan-row,
.scan-row > .el-col {
  height: 100%;
}

.source-card {
  height: 100%;
  overflow-y: auto;
  border: 1px solid #ececf6;
  border-radius: 12px;
  padding: 16px;
  background: #fcfcff;
}

.result-fill {
  height: 100%;
  overflow-y: auto;
}

.source-card::-webkit-scrollbar,
.result-fill::-webkit-scrollbar {
  width: 6px;
}

.source-card::-webkit-scrollbar-thumb,
.result-fill::-webkit-scrollbar-thumb {
  background: rgba(35, 35, 58, 0.16);
  border-radius: 3px;
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

.pane-fill {
  height: 100%;
  display: flex;
  flex-direction: column;
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
