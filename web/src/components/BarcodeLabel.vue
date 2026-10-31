<template>
  <div class="label-card">
    <div class="lc-name">{{ name || '未命名商品' }}</div>
    <svg ref="barRef" class="lc-barcode" />
    <div class="lc-foot">
      <img v-if="qr" :src="qr" class="lc-qr" alt="二维码" />
      <div class="lc-meta">
        <div v-if="sku" class="lc-sku">货号 {{ sku }}</div>
        <div v-if="price" class="lc-price">¥{{ price }}</div>
        <div v-else class="lc-price lc-price--empty">未定价</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch, nextTick, computed } from 'vue'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { isValidEan13 } from '@/utils/ean13'

const props = defineProps({
  /** 机读条码：EAN-13，扫码枪扫的就是它 */
  barcode: { type: String, default: '' },
  /** 货号：给人看的业务编码，只在标签上做文字展示 */
  sku: { type: String, default: '' },
  name: { type: String, default: '' },
  price: { type: [Number, String], default: null }
})

const barRef = ref(null)
const qr = ref('')

/** 条码合法就用 EAN-13，否则退回按货号出 CODE128（兼容没有条码的老数据） */
const code = computed(() => (isValidEan13(props.barcode) ? props.barcode.trim() : ''))
const useEan = computed(() => !!code.value)
/** 真正编码进条码/二维码的内容：优先 EAN-13，其次货号 */
const payload = computed(() => code.value || props.sku || '')

async function render() {
  if (!payload.value) return
  await nextTick()
  if (!barRef.value) return
  try {
    if (useEan.value) {
      JsBarcode(barRef.value, code.value, {
        format: 'EAN13',
        width: 1.8,
        height: 30,
        displayValue: true,
        fontSize: 12,
        textMargin: 2,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000'
      })
    } else {
      JsBarcode(barRef.value, payload.value, {
        format: 'CODE128',
        width: payload.value.length > 12 ? 1 : 1.5,
        height: 34,
        displayValue: true,
        fontSize: 12,
        textMargin: 1,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000'
      })
    }
  } catch (e) {
    /* 编码失败时忽略 */
  }
  try {
    qr.value = await QRCode.toDataURL(payload.value, {
      margin: 0,
      width: 120,
      errorCorrectionLevel: 'M'
    })
  } catch (e) {
    qr.value = ''
  }
}

onMounted(render)
watch(() => [props.barcode, props.sku, props.name, props.price], render)
</script>

<style scoped lang="scss">
.label-card {
  width: 58mm;
  padding: 2.5mm;
  border: 1px dashed #c9c9d8;
  border-radius: 4px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 1.5mm;
  break-inside: avoid;

  @media print {
    border-color: #999;
  }
}

.lc-name {
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lc-barcode {
  width: 100%;
  height: 15mm;
}

.lc-foot {
  display: flex;
  align-items: center;
  gap: 2mm;
}

.lc-qr {
  width: 13mm;
  height: 13mm;
  flex: none;
}

.lc-meta {
  flex: 1;
  min-width: 0;
}

.lc-sku {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.lc-price {
  font-size: 13px;
  font-weight: 700;
  color: #d63031;

  &--empty {
    font-size: 10px;
    font-weight: 400;
    color: #999;
  }
}
</style>
