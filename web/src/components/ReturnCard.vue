<template>
  <div v-if="!product" class="empty-hint">
    <el-empty :description="emptyText" />
  </div>
  <div v-else class="result-card">
    <div class="flex" style="align-items: flex-start; gap: 14px">
      <el-image :src="img(product.image)" fit="cover" class="big-thumb" />
      <div style="flex: 1">
        <div style="font-size: 17px; font-weight: 700">{{ product.name }}</div>
        <div class="muted" style="margin-top: 4px">货号：{{ product.sku }}</div>
        <div class="flex" style="margin-top: 8px; gap: 8px; flex-wrap: wrap">
          <el-tag type="info" effect="light">当前库存 {{ product.stock }} 件</el-tag>
          <el-tag type="success" effect="light">
            档案销售价 ¥{{ Number(product.salePrice || 0).toFixed(2) }}
          </el-tag>
        </div>
      </div>
    </div>

    <!-- 关联原销售单 -->
    <div class="link-box">
      <div class="link-head">
        <span class="link-title">
          <el-icon><Link /></el-icon>
          关联原销售单
        </span>
        <el-tag v-if="linked" type="success" effect="light" size="small">
          已关联 {{ linked.orderNo }}
        </el-tag>
        <el-tag v-else type="info" effect="plain" size="small">未关联</el-tag>
      </div>

      <template v-if="!linked">
        <div class="flex" style="margin-top: 10px; flex-wrap: wrap">
          <el-input
            v-model="orderNoInput"
            placeholder="输入订单号"
            size="small"
            style="width: 190px"
            clearable
            @keyup.enter="findByOrderNo"
          />
          <el-button size="small" :loading="searchingOrder" @click="findByOrderNo">
            查找订单
          </el-button>
          <el-button size="small" text type="primary" :loading="searchingOrder" @click="findBySku">
            按货号找最近订单
          </el-button>
        </div>

        <div v-if="candidates.length" class="cand-list">
          <div v-for="c in candidates" :key="c.itemId" class="cand-item" @click="pickCandidate(c)">
            <div class="cand-main">
              <b>{{ c.orderNo }}</b>
              <span class="muted">
                {{ fmt(c.createdAt) }} · 成交价 ¥{{ c.unitPrice.toFixed(2) }} · 可退 {{ c.returnable }} 件
              </span>
            </div>
            <el-button size="small" type="primary" link>关联</el-button>
          </div>
        </div>
        <div v-else-if="searched" class="muted" style="font-size: 12px; margin-top: 8px">
          没有找到可关联的订单，可直接退货（抵减今日营业额）
        </div>
      </template>

      <div v-else class="linked-info">
        <div class="muted" style="font-size: 12px">
          原单成交价 <b class="money">¥{{ linked.unitPrice.toFixed(2) }}</b>
          · 最多可退 {{ linked.returnable }} 件 · 下单 {{ fmt(linked.createdAt) }}
        </div>
        <el-button size="small" link type="danger" @click="cancelLink">取消关联</el-button>
      </div>
    </div>

    <el-divider />

    <el-form :model="form" label-width="90px">
      <el-form-item label="退货单价">
        <el-input-number
          v-model="form.unitPrice"
          :min="0"
          :precision="2"
          :step="1"
          :disabled="!!linked"
        />
        <span class="muted" style="font-size: 12px; margin-left: 8px">
          {{ linked ? '已按关联订单成交价锁定，取消关联可改' : '默认取档案销售价，可改' }}
        </span>
      </el-form-item>
      <el-form-item label="退货件数">
        <el-input-number
          v-model="form.quantity"
          :min="1"
          :max="linked ? linked.returnable : undefined"
          :step="1"
        />
        <span v-if="linked" class="muted" style="font-size: 12px; margin-left: 8px">
          这张单最多可退 {{ linked.returnable }} 件
        </span>
      </el-form-item>
      <el-form-item label="退款合计">
        <b class="money" style="font-size: 20px; color: #d63031">¥{{ total.toFixed(2) }}</b>
        <span class="muted" style="font-size: 12px; margin-left: 10px">
          {{ linked ? '将从原订单那一天的营业额里扣' : '将抵减今日营业额与毛利' }}
        </span>
      </el-form-item>
      <el-form-item>
        <el-button type="danger" :loading="submitting" :icon="RefreshLeft" @click="submit">
          确认退货
        </el-button>
        <el-button @click="emit('reset')">清除</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { Link, RefreshLeft } from '@element-plus/icons-vue'
import { returnApi } from '@/api'

const props = defineProps({
  product: { type: Object, default: null },
  storeId: { type: [Number, String], default: null },
  submitting: { type: Boolean, default: false },
  emptyText: { type: String, default: '扫描或输入编码后，这里会显示退货信息' }
})
const emit = defineEmits(['submit', 'reset'])

const form = ref({ unitPrice: 0, quantity: 1 })
const linked = ref(null)
const candidates = ref([])
const orderNoInput = ref('')
const searchingOrder = ref(false)
const searched = ref(false)

const fmt = (d) => dayjs(d).format('YYYY-MM-DD HH:mm')
const total = computed(() => +(form.value.unitPrice * form.value.quantity).toFixed(2))

watch(
  () => props.product,
  (p) => {
    linked.value = null
    candidates.value = []
    orderNoInput.value = ''
    searched.value = false
    form.value = { unitPrice: p?.salePrice ?? 0, quantity: 1 }
  },
  { immediate: true }
)

function applyLink(item, orderInfo) {
  linked.value = {
    orderId: orderInfo.id,
    orderNo: orderInfo.orderNo,
    createdAt: orderInfo.createdAt,
    unitPrice: item.unitPrice,
    returnable: item.returnable
  }
  form.value.unitPrice = item.unitPrice
  if (form.value.quantity > item.returnable) form.value.quantity = item.returnable
  candidates.value = []
  orderNoInput.value = ''
  ElMessage.success(`已关联订单 ${orderInfo.orderNo}，单价取该单成交价`)
}

async function findByOrderNo() {
  const no = (orderNoInput.value || '').trim()
  if (!no) return ElMessage.warning('请输入订单号')
  if (!props.storeId) return ElMessage.warning('请先选择退货门店')
  searchingOrder.value = true
  try {
    const res = await returnApi.findOrders({
      sku: props.product.sku,
      orderNo: no,
      storeId: props.storeId
    })
    const item = (res.items || [])[0]
    if (!item) return ElMessage.warning('这张单里没有该商品')
    if (!item.returnable) return ElMessage.warning('这张单里的该商品已经退完了')
    applyLink(item, res.order)
  } catch (e) {
    /* handled */
  } finally {
    searchingOrder.value = false
    searched.value = true
  }
}

async function findBySku() {
  if (!props.storeId) return ElMessage.warning('请先选择退货门店')
  searchingOrder.value = true
  try {
    const res = await returnApi.findOrders({ sku: props.product.sku, storeId: props.storeId })
    candidates.value = res.items || []
    searched.value = true
    if (!candidates.value.length) ElMessage.info('没有找到这件商品的历史销售单')
  } catch (e) {
    /* handled */
  } finally {
    searchingOrder.value = false
  }
}

function pickCandidate(c) {
  applyLink(c, {
    id: c.orderId,
    orderNo: c.orderNo,
    createdAt: c.createdAt
  })
}

function cancelLink() {
  linked.value = null
  form.value.unitPrice = props.product?.salePrice ?? 0
}

function submit() {
  emit('submit', {
    sku: props.product.sku,
    quantity: form.value.quantity,
    unitPrice: form.value.unitPrice,
    orderId: linked.value?.orderId
  })
}

function img(u) {
  return (
    u ||
    'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
      )
  )
}
</script>

<style scoped lang="scss">
.empty-hint {
  border: 1px dashed #dcdce8;
  border-radius: 12px;
  padding: 30px 0;
}

.result-card {
  border: 1px solid #ececf6;
  border-radius: 12px;
  padding: 16px;
  background: #fcfcff;
}

.big-thumb {
  width: 96px;
  height: 96px;
  border-radius: 10px;
  object-fit: cover;
  background: #f0f0f7;
}

/* 关联原单区 */
.link-box {
  margin-top: 14px;
  padding: 12px;
  border: 1px dashed #dfdef0;
  border-radius: 10px;
  background: #faf9ff;
}

.link-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.link-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: #2c2c3a;
}

.link-title .el-icon {
  color: var(--brand);
}

.cand-list {
  margin-top: 8px;
  max-height: 168px;
  overflow-y: auto;
  border-top: 1px dashed #e8e6f5;
}

.cand-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 4px;
  cursor: pointer;
  border-bottom: 1px dashed #efedf8;
  transition: background 0.15s;
}

.cand-item:hover {
  background: rgba(108, 92, 231, 0.06);
}

.cand-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.cand-main .muted {
  font-size: 12px;
}

.linked-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
</style>
