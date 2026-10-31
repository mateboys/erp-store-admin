<template>
  <div v-if="!product" class="empty-hint">
    <el-empty :description="emptyText" />
  </div>
  <div v-else class="result-card">
    <div class="flex" style="align-items: flex-start; gap: 14px">
      <el-image :src="img(product.image)" fit="cover" class="big-thumb" />
      <div style="flex: 1">
        <div style="font-size: 17px; font-weight: 700">{{ product.name }}</div>
        <div class="muted" style="margin-top: 4px">
          货号：{{ product.sku }} · {{ product.categoryName || '未分类' }}
        </div>
        <div class="flex" style="margin-top: 8px; gap: 8px; flex-wrap: wrap">
          <el-tag type="info" effect="light">当前库存 {{ product.stock }} 件</el-tag>
          <el-tag v-if="product.salePrice" type="success" effect="light">
            销售价 ¥{{ Number(product.salePrice).toFixed(2) }}
          </el-tag>
        </div>
      </div>
    </div>

    <el-divider />

    <!-- 出库方式：丢失破损 / 退供应商 / 调拔门店 -->
    <el-form :model="form" label-width="90px">
      <el-form-item label="出库方式">
        <el-radio-group v-model="form.outType">
          <el-radio-button value="LOSS">丢失 / 破损</el-radio-button>
          <el-radio-button value="SUPPLIER">退供应商</el-radio-button>
          <el-radio-button value="TRANSFER">调拔门店</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <!-- 丢失/破损：按售价赔偿 + 填责任人，用于后续追偿 -->
      <template v-if="form.outType === 'LOSS'">
        <el-form-item label="责任人">
          <el-input
            v-model="form.liablePerson"
            placeholder="填写责任人，便于后续追偿"
            style="width: 260px"
          />
        </el-form-item>
        <el-alert type="warning" :closable="false" show-icon class="mb-alert">
          <div style="line-height: 1.7">
            本次出库按<strong>售价 ¥{{ salePrice.toFixed(2) }}</strong> 计赔，
            {{ form.quantity || 0 }} 件合计应赔
            <b>¥{{ (salePrice * (form.quantity || 0)).toFixed(2) }}</b>，
            库存正常减少。赔偿金额按售价计算，<strong>不体现进货成本</strong>。
          </div>
        </el-alert>
      </template>

      <!-- 退供应商：不记成本，无经济损失 -->
      <template v-else-if="form.outType === 'SUPPLIER'">
        <el-alert type="info" :closable="false" show-icon class="mb-alert">
          <div style="line-height: 1.7">
            退供应商的商品没有产生经济损失，系统<strong>不记录这笔入库成本</strong>，库存正常减少。
          </div>
        </el-alert>
      </template>

      <!-- 调拔门店：选目标门店 -->
      <template v-else>
        <el-form-item label="调入门店">
          <el-select
            v-model="form.targetStoreId"
            placeholder="选择要调入的门店"
            style="width: 260px"
          >
            <el-option
              v-for="s in targetStores"
              :key="s.id"
              :label="s.name"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon class="mb-alert">
          <div style="line-height: 1.7">
            商品会从当前门店调出，并在<strong>目标门店的入库记录</strong>中新增一条「调拔」记录（来源：当前门店调入）。
          </div>
        </el-alert>
      </template>

      <el-form-item label="出库件数">
        <el-input-number
          v-model="form.quantity"
          :min="1"
          :max="product.stock"
          :step="1"
        />
        <span class="muted" style="font-size: 12px; margin-left: 8px">
          最多可出 {{ product.stock }} 件
        </span>
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          placeholder="选填，如破损原因、供应商名称等"
          style="width: 320px"
        />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="loading" :icon="Check" @click="submit">
          确认出库
        </el-button>
        <el-button @click="emit('reset')">清除</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Check } from '@element-plus/icons-vue'

const props = defineProps({
  product: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  /** 可调入的门店列表（已排除当前门店） */
  targetStores: { type: Array, default: () => [] },
  /** 是否有成本查看权限 */
  canSeeCost: { type: Boolean, default: false },
  emptyText: { type: String, default: '扫描或输入编码后，这里会显示商品信息' }
})
const emit = defineEmits(['submit', 'reset'])

const form = ref({ outType: 'LOSS', quantity: 1, liablePerson: '', targetStoreId: null, remark: '' })

/** 结转单价：出库按该店当前移动加权均价 */
const unitCost = computed(() => Number(props.product?.lastCost ?? 0))
/** 售价：丢失/破损按售价计赔（不暴露成本） */
const salePrice = computed(() => Number(props.product?.salePrice ?? 0))

/** 换商品就重置表单（出库方式保留用户已选的偏好） */
watch(
  () => props.product,
  (p) => {
    form.value = {
      ...form.value,
      quantity: 1,
      liablePerson: '',
      targetStoreId: null,
      remark: '',
    }
  },
  { immediate: true }
)

function submit() {
  emit('submit', { ...form.value })
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

.mb-alert {
  margin-bottom: 18px;
}
</style>
