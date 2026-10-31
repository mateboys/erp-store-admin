<template>
  <div class="page fill sales-page">
    <!-- 断点交给 CSS（lg=≥1200px 两列，以下堆叠），窗口缩放自动跟随 -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <div class="page-card">
          <div class="flex-between" style="flex-wrap: wrap">
            <div>
              <h3 class="page-title">销售记账</h3>
              <div class="page-sub">输入货号或品名搜索，加入购物车后可统一结算入账</div>
            </div>
            <div v-if="auth.isAdmin" class="flex">
              <span class="muted" style="font-size: 13px">记账门店</span>
              <el-select
                v-model="targetStore"
                style="width: 200px"
                :placeholder="auth.storeId === 'all' ? '请选择记账门店' : ''"
              >
                <el-option v-for="s in auth.stores" :key="s.id" :label="s.name" :value="String(s.id)" />
              </el-select>
            </div>
          </div>

          <!-- 扫码枪：收银主入口，放在最上面，整行加大 + 默认自动聚焦，枪一响就能连扫 -->
          <div class="gun-box" :class="{ active: gunFocused }" @click="focusGun" @mouseenter="focusGun">
            <el-input
              ref="gunRef"
              v-model="gunCode"
              class="gun-input"
              :prefix-icon="Aim"
              placeholder="扫码枪扫码加入（也可手输货号后回车）"
              @keyup.enter="addBySku(gunCode)"
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

          <!-- 搜索：给店员手动挑商品用，不是主操作，放在扫码框下面、保持常规尺寸 -->
          <div class="flex" style="margin-top: 12px; flex-wrap: wrap">
            <el-select
              v-model="pickSku"
              filterable
              remote
              clearable
              reserve-keyword
              placeholder="手动搜索：输入货号或商品名，如 DY001 / 牛仔裤"
              :remote-method="search"
              :loading="searching"
              style="flex: 1; min-width: 260px"
              @change="addBySku"
            >
              <el-option v-for="o in options" :key="o.sku" :value="o.sku" :label="`${o.sku} · ${o.name}`">
                <div class="flex" style="justify-content: space-between; width: 100%">
                  <span>{{ o.sku }} · {{ o.name }}</span>
                  <span class="muted" style="font-size: 12px">
                    库存 {{ o.stock ?? 0 }} · ¥{{ (o.salePrice || 0).toFixed(2) }}
                  </span>
                </div>
              </el-option>
            </el-select>
          </div>

          <div class="table-fill">
                <el-table :data="cart" height="100%">
                <el-table-column label="图片" width="62">
                  <template #default="{ row }">
                    <el-image :src="img(row.image)" fit="cover" class="product-thumb" />
                  </template>
                </el-table-column>
                <el-table-column prop="sku" label="货号" width="110" />
                <el-table-column prop="name" label="品名" min-width="140" show-overflow-tooltip />
                <el-table-column label="可用库存" width="90" align="right">
                  <template #default="{ row }">{{ row.stock }}</template>
                </el-table-column>
                <el-table-column label="件数" width="150">
                  <template #default="{ row }">
                    <el-input-number
                      v-model="row.quantity"
                      :min="1"
                      :max="row.stock"
                      size="small"
                      @change="calcTotal"
                    />
                  </template>
                </el-table-column>
                <el-table-column label="单价" width="150">
                  <template #default="{ row }">
                    <el-input-number
                      v-model="row.unitPrice"
                      :min="0"
                      :precision="2"
                      size="small"
                      @change="calcTotal"
                    />
                  </template>
                </el-table-column>
                <el-table-column label="小计" width="110" align="right">
                  <template #default="{ row }">
                    <b class="money">¥{{ (row.quantity * row.unitPrice).toFixed(2) }}</b>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="80" class-name="col-ops" align="center">
                  <template #default="{ $index }">
                    <el-button link type="danger" :icon="Delete" @click="removeItem($index)" />
                  </template>
                </el-table-column>
                <template #empty>
                  <el-empty description="购物车还是空的，先搜索商品加入吧" />
                </template>
                </el-table>
          </div>
        </div>
      </el-col>

      <el-col :xs="24" :lg="8">
        <div class="cart-panel">
          <div class="flex-between" style="margin-bottom: 10px">
            <b>结算台</b>
            <el-tag type="primary" effect="light">{{ cart.length }} 种商品</el-tag>
          </div>

          <div class="sum-row">
            <span>总件数</span><b>{{ totalQty }} 件</b>
          </div>
          <div class="sum-row">
            <span>应收金额</span>
            <b class="money" style="font-size: 24px; color: var(--brand)">¥ {{ totalAmount.toFixed(2) }}</b>
          </div>

          <!-- 改价差额：优惠直接给顾客看；加价是店里的额外收益，默认遮住 -->
          <div v-if="priceDiff !== 0" class="sum-row">
            <span>{{ priceDiff < 0 ? '优惠' : '加价' }}</span>
            <span class="secret-val">
              <b
                :class="[priceDiff < 0 ? 'diff-down' : 'diff-up', { masked: priceDiff > 0 && !secretOn }]"
              >
                {{ diffText }}
              </b>
              <el-icon
                v-if="priceDiff > 0"
                class="eye"
                :title="secretOn ? '点击隐藏' : '点击显示'"
                @click="secretOn = !secretOn"
              >
                <View v-if="!secretOn" />
                <Hide v-else />
              </el-icon>
            </span>
          </div>
          <!-- 成本 / 毛利：默认遮罩，点小眼睛才显形，防止顾客结账时看到 -->
          <template v-if="auth.canSeeCost">
            <div class="sum-row">
              <span>成本合计</span>
              <span class="secret-val">
                <b :class="{ masked: !secretOn }">{{ secretText(totalCost) }}</b>
                <el-icon
                  class="eye"
                  :title="secretOn ? '点击隐藏' : '点击显示'"
                  @click="secretOn = !secretOn"
                >
                  <View v-if="!secretOn" />
                  <Hide v-else />
                </el-icon>
              </span>
            </div>
            <div class="sum-row">
              <span>毛利</span>
              <span class="secret-val">
                <b class="trend-up" :class="{ masked: !secretOn }">{{ secretText(totalProfit) }}</b>
                <el-icon
                  class="eye"
                  :title="secretOn ? '点击隐藏' : '点击显示'"
                  @click="secretOn = !secretOn"
                >
                  <View v-if="!secretOn" />
                  <Hide v-else />
                </el-icon>
              </span>
            </div>
          </template>

          <el-input
            v-model="remark"
            placeholder="备注（选填）"
            style="margin: 12px 0"
            :prefix-icon="EditPen"
          />

          <el-button
            type="primary"
            size="large"
            style="width: 100%"
            :disabled="!cart.length"
            :loading="submitting"
            @click="checkout"
          >
            确认入账（¥{{ totalAmount.toFixed(2) }}）
          </el-button>
          <el-button style="width: 100%; margin: 10px 0 0" :disabled="!cart.length" @click="clearCart">
            清空购物车
          </el-button>

          <el-alert
            v-if="!cart.length"
            type="info"
            :closable="false"
            show-icon
            style="margin-top: 12px"
            title="提示：单价默认取库存销售价，可临时改价"
          />
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Aim, Delete, EditPen, Hide, View } from '@element-plus/icons-vue'
import { productApi, saleApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()

/** 扫码枪输入框：收银默认焦点就在这，枪一响直接进单，不用先点一下 */
const gunRef = ref()
const gunFocused = ref(false)
function focusGun() {
  gunFocused.value = true
  gunRef.value?.focus()
}

/** 成本 / 毛利默认遮住，点小眼睛才显示；每次进单后自动收回，避免下一位顾客看到 */
const secretOn = ref(false)
function secretText(v) {
  return secretOn.value ? `¥ ${v.toFixed(2)}` : '¥ ****'
}

const options = ref([])
const searching = ref(false)
const pickSku = ref('')
const gunCode = ref('')
const cart = ref([])
const remark = ref('')
const submitting = ref(false)
/** 值统一用字符串，与 el-option 的 value 一致，避免数字/字符串不匹配显示成裸 id */
const targetStore = ref(auth.storeId && auth.storeId !== 'all' ? String(auth.storeId) : '')

/** 当前记账门店：管理员在公司总览下必须显式选择，不允许记到「公司」 */
function currentStoreId() {
  if (!auth.isAdmin) return auth.user?.storeId
  return targetStore.value ? Number(targetStore.value) : null
}

function img(u) {
  return u || 'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
    )
}

const totalQty = computed(() => cart.value.reduce((s, i) => s + i.quantity, 0))
const totalAmount = computed(() => cart.value.reduce((s, i) => s + i.quantity * i.unitPrice, 0))
const totalCost = computed(() => cart.value.reduce((s, i) => s + i.quantity * (i.unitCost || 0), 0))
const totalProfit = computed(() => totalAmount.value - totalCost.value)
/** 按档案销售价算的原价合计，用来对比改价后的差额 */
const listTotal = computed(() =>
  cart.value.reduce((s, i) => s + i.quantity * (i.listPrice ?? i.unitPrice), 0)
)
/** 改价差额：负数=优惠给顾客，正数=加价 */
const priceDiff = computed(() => Math.round((totalAmount.value - listTotal.value) * 100) / 100)
const diffText = computed(() => {
  const d = priceDiff.value
  if (d < 0) return `-¥ ${Math.abs(d).toFixed(2)}`
  // 加价的金额属于店里收益，遮住，点眼睛才看
  return secretOn.value ? `+¥ ${d.toFixed(2)}` : '+¥ ****'
})

function calcTotal() {
  /* computed 自动更新 */
}

async function search(kw) {
  if (!kw) {
    options.value = []
    return
  }
  searching.value = true
  try {
    const sid = currentStoreId()
    const res = await productApi.list({ keyword: kw, storeId: sid, pageSize: 20 })
    options.value = (res.rows || []).slice(0, 20)
  } finally {
    searching.value = false
  }
}

/** 无论成功失败，扫完都把焦点还给扫码框，保证下一枪还能直接进 */
async function addBySku(sku) {
  try {
    return await doAdd(sku)
  } finally {
    nextTick(focusGun)
  }
}

async function doAdd(sku) {
  const key = (sku || '').trim()
  if (!key) return
  const sid = currentStoreId()
  if (!sid) return ElMessage.warning('请先选择门店')
  const found = options.value.find((o) => o.sku === key)
  let item = found
  if (!item) {
    item = await productApi.bySku(key, sid)
    if (!item) return ElMessage.error(`未找到货号「${key}」`)
  }
  if (!item.stock || item.stock <= 0) return ElMessage.warning(`「${item.name}」库存为 0`)

  const exist = cart.value.find((c) => c.sku === item.sku)
  if (exist) {
    if (exist.quantity + 1 > item.stock) return ElMessage.warning('超出可用库存')
    exist.quantity += 1
  } else {
    cart.value.push({
      sku: item.sku,
      name: item.name,
      image: item.image,
      stock: item.stock,
      quantity: 1,
      unitPrice: item.salePrice || 0,
      // 记下档案价，改价后用来算优惠 / 加价了多少
      listPrice: item.salePrice || 0,
      unitCost: auth.canSeeCost ? item.avgCost || 0 : 0
    })
  }
  pickSku.value = ''
  gunCode.value = ''
  ElMessage.success(`已加入：${item.name}`)
}

function removeItem(idx) {
  cart.value.splice(idx, 1)
}

function clearCart() {
  cart.value = []
  remark.value = ''
  // 换顾客了，成本/毛利重新收起来
  secretOn.value = false
  nextTick(focusGun)
}

async function checkout() {
  if (!cart.value.length) return
  const sid = currentStoreId()
  if (!sid) return ElMessage.warning('请先选择门店')
  await ElMessageBox.confirm(
    `共 ${totalQty.value} 件，应收 ¥${totalAmount.value.toFixed(2)}，确认入账？`,
    '结算确认',
    { type: 'warning' }
  )
  submitting.value = true
  try {
    const order = await saleApi.create({
      storeId: sid,
      remark: remark.value,
      items: cart.value.map((i) => ({ sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice }))
    })
    ElMessageBox.alert(
      `订单号：${order.orderNo}<br/>门店：${order.storeName}<br/>件数：${order.itemCount} 件<br/>营业额：<b>¥${order.totalAmount.toFixed(2)}</b>`,
      '入账成功',
      { dangerouslyUseHTMLString: true, confirmButtonText: '完成' }
    )
    clearCart()
  } finally {
    submitting.value = false
  }
}

// 顶部切换门店后，记账门店同步跟随
watch(
  () => auth.storeId,
  (v) => {
    targetStore.value = v && v !== 'all' ? String(v) : ''
    cart.value = []
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
  // 进页面就把光标放进扫码框
  nextTick(focusGun)
})
</script>

<style scoped lang="scss">
.sum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px dashed #eee;
  font-size: 14px;
}

/* 扫码枪输入区的样式在全局 index.scss（与货品入库共用） */

/* 改价差额：优惠用绿、加价用红；遮罩态颜色由 .masked 覆盖 */
.diff-down {
  color: #00b894;
  font-weight: 700;
}

.diff-up {
  color: #d63031;
  font-weight: 700;
}

/* 成本 / 毛利的显隐开关 */
.secret-val {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* 遮罩态：星号拉开字距 + 等宽数字，宽度稳定，切换时不会左右跳动 */
.secret-val .masked {
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
  color: #a8a8bd;
}

.eye {
  cursor: pointer;
  color: #a8a8bd;
  font-size: 16px;
  padding: 3px;
  border-radius: 5px;
  transition: color 0.15s, background 0.15s;

  &:hover {
    color: var(--brand);
    background: rgba(108, 92, 231, 0.1);
  }
}
</style>
