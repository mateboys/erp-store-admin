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
            销售价 ¥{{ Number(product.salePrice).toFixed(2) }}（取自商品档案）
          </el-tag>
        </div>
      </div>
    </div>
    <el-divider />
    <el-form :model="form" label-width="90px">
      <el-form-item label="进货价">
        <el-input-number v-model="form.costPrice" :min="0" :precision="2" :step="1" />
        <span class="muted" style="font-size: 12px; margin-left: 8px">
          默认取商品档案成本价，可按实际进价改
        </span>
      </el-form-item>
      <el-form-item v-if="!product.salePrice" label="销售价">
        <el-alert type="warning" :closable="false" show-icon>
          <div class="flex" style="align-items: center; gap: 4px; flex-wrap: wrap">
            <span>该商品还没有销售价，请先到「商品管理」设置，否则无法入库</span>
            <el-button link type="primary" @click="emit('go-products')">去设置</el-button>
          </div>
        </el-alert>
      </el-form-item>
      <el-form-item label="入库件数">
        <el-input-number v-model="form.quantity" :min="1" :step="1" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" :icon="Check" @click="submit">确认入库</el-button>
        <el-button @click="emit('reset')">清除</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Check } from '@element-plus/icons-vue'

const props = defineProps({
  product: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  emptyText: { type: String, default: '扫描或输入编码后，这里会显示商品信息' }
})
const emit = defineEmits(['submit', 'reset', 'go-products'])

const form = ref({ costPrice: 0, quantity: 1 })

/** 换商品就重置表单，进货价默认取档案成本价，档案没设退回该店上次入库均价 */
watch(
  () => props.product,
  (p) => {
    form.value = { costPrice: p ? p.costPrice ?? p.lastCost ?? 0 : 0, quantity: 1 }
  },
  { immediate: true }
)

function submit() {
  emit('submit', { costPrice: form.value.costPrice, quantity: form.value.quantity })
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
</style>
