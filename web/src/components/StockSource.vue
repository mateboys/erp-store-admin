<template>
  <div class="source-card">
    <!-- ========== 扫码枪 ========== -->
    <template v-if="mode === 'gun'">
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
            <div class="muted">枪响即{{ actionName }}，光标一直留在框里，可连续扫</div>
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
            <b>确认{{ actionName }}</b>
            <div class="muted">{{ confirmTip }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- ========== 拍照扫码 ========== -->
    <template v-else-if="mode === 'video'">
      <div class="source-title">
        <el-icon><Camera /></el-icon>
        摄像头扫码
      </div>
      <BarcodeScanner ref="scanner" @result="onVideoResult" />
    </template>

    <!-- ========== 手动选择 ========== -->
    <template v-else>
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
            <b>确认{{ actionName }}</b>
            <div class="muted">{{ confirmTip }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- 两种扫码方式的公共提示 -->
    <el-alert
      v-if="mode !== 'manual'"
      type="info"
      :closable="false"
      show-icon
      class="tip-alert"
    >
      <div style="line-height: 1.7">
        商品还没有条码？到
        <router-link to="/products" class="link">商品管理</router-link>
        勾选商品后点「打印标签」，即可生成条形码（标签上的条码就是货号）
      </div>
    </el-alert>
    <el-alert
      v-else
      type="info"
      :closable="false"
      show-icon
      class="tip-alert"
    >
      <div class="flex" style="align-items: center; gap: 4px; flex-wrap: wrap; line-height: 1.7">
        <span>若货号不存在，请先到「商品管理」中新增商品</span>
        <el-button link type="primary" :icon="Plus" @click="emit('go-products')">
          {{ canCreateProduct ? '去新增商品' : '去商品管理' }}
        </el-button>
      </div>
    </el-alert>
  </div>
</template>

<script setup>
import { computed, h, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Aim, Camera, Plus, Search } from '@element-plus/icons-vue'
import BarcodeScanner from '@/components/BarcodeScanner.vue'
import { inventoryApi, productApi } from '@/api'

const props = defineProps({
  /** 当前方式：gun=扫码枪 video=拍照扫码 manual=手动选择 */
  mode: { type: String, default: 'gun' },
  /** 当前 tab 是否可见：不可见时不启摄像头（隐藏的 tab 也在 DOM 里） */
  active: { type: Boolean, default: false },
  /** 出入库门店 id；为空表示还没选门店 */
  storeId: { type: [Number, String], default: null },
  /** 业务动作：in=入库 out=出库，只影响文案 */
  action: { type: String, default: 'in' },
  /** 能否在商品管理里新增商品（决定跳转按钮文案） */
  canCreateProduct: { type: Boolean, default: false }
})

const emit = defineEmits(['picked', 'reset', 'go-products'])

/** 入库叫「入库」，出库叫「出库」 */
const actionName = computed(() => (props.action === 'out' ? '出库' : '入库'))
/** 第三步的说明文案随动作变化 */
const confirmTip = computed(() =>
  props.action === 'out'
    ? '选好出库方式与件数，库存自动减少'
    : '填实际进价与件数，成本自动移动加权'
)

const gunCode = ref('')
const gunFocused = ref(false)
/** 扫码枪输入框实例（模板 ref="gunInput"） */
const gunInput = ref(null)
/** 摄像头扫码组件实例（模板 ref="scanner"） */
const scanner = ref(null)
/** 手动入库的搜索框实例（模板 ref="manualSelect"） */
const manualSelect = ref(null)
const manualSku = ref('')
const options = ref([])
const searching = ref(false)

/**
 * 让扫码输入框获得焦点。
 * 延迟一拍再 focus：切方式 / 首屏渲染时内容可能还没挂载完，直接 focus 会拿到 undefined。
 */
function focusGun() {
  if (props.mode !== 'gun') return
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

/** 手动方式就把光标放进搜索框 */
function focusManual() {
  if (props.mode !== 'manual') return
  nextTick(() => {
    setTimeout(() => manualSelect.value?.focus?.(), 50)
  })
}

/** 扫码 / 拍照扫码解析出商品后抛给父级 */
async function handleCode(code) {
  if (!code) return
  if (!props.storeId) return ElMessage.warning(`请先选择${actionName.value}门店`)
  try {
    const res = await inventoryApi.scan(code, props.storeId, props.action)
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
              onClick: () => emit('go-products'),
              style: 'color:#6c5ce7;cursor:pointer;text-decoration:underline;margin-left:4px',
            },
            props.canCreateProduct ? '去新增商品' : '去商品管理',
          ),
        ]),
      })
      emit('reset')
      return
    }
    emit('picked', { product: res.product, type: 'SCAN' })
  } catch (e) {
    /* handled */
  } finally {
    // 焦点还给扫码枪输入框，并选中已有内容：下一枪会整体覆盖，不会拼成 "DY001DY002"
    if (props.mode === 'gun') nextTick(() => gunInput.value?.select?.())
  }
}

/** 摄像头扫码识别到的编码：填进 input（方便看清扫到了什么）并直接解析 */
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
  if (!sku) {
    emit('reset')
    return
  }
  if (!props.storeId) {
    manualSku.value = ''
    return ElMessage.warning(`请先选择${actionName.value}门店`)
  }
  try {
    // 走和扫码同一条接口，拿到的商品信息（库存、档案价、上次进价）完全一致
    const res = await inventoryApi.scan(sku, props.storeId, props.action)
    if (!res?.found) {
      ElMessage.error(`未找到货号「${sku}」对应的商品`)
      manualSku.value = ''
      return
    }
    emit('picked', { product: res.product, type: 'MANUAL' })
  } catch (e) {
    /* handled */
  }
}

/**
 * 清空当前方式的已选商品（只清组件内部状态）。
 * 注意：这里**不能**再 emit('reset')——父组件收到 reset 后会反过来调 clear()，
 * 两者来回就变成无限递归（Maximum call stack size exceeded）。
 * 父组件自己在 resetScan/resetStockOut 里把已选商品置空即可。
 */
function clear() {
  manualSku.value = ''
  gunCode.value = ''
}

/**
 * 摄像头生命周期：
 * - 切到拍照扫码且该 tab 可见 → 开摄像头
 * - 切走方式 / tab 不可见 / 组件卸载 → 关摄像头（否则摄像头的指示灯一直亮着）
 */
watch(
  () => [props.mode, props.active],
  () => {
    if (props.mode === 'video' && props.active) {
      nextTick(() => scanner.value?.start?.())
    } else {
      scanner.value?.stop?.()
    }
    if (props.mode === 'gun') focusGun()
    else if (props.mode === 'manual') focusManual()
  },
  { immediate: true }
)

onBeforeUnmount(() => scanner.value?.stop?.())

defineExpose({ clear, focusGun, focusManual })
</script>

<style scoped lang="scss">
/* 左栏「来源」卡片：把扫码/搜索区、操作步骤和提示收在一张卡里，避免大片空白 */
.source-card {
  height: 100%;
  overflow-y: auto;
  border: 1px solid #ececf6;
  border-radius: 12px;
  padding: 16px;
  background: #fcfcff;
}

/* 卡片内部滚动条收细，避免压住内容 */
.source-card::-webkit-scrollbar {
  width: 6px;
}
.source-card::-webkit-scrollbar-thumb {
  background: rgba(35, 35, 58, 0.16);
  border-radius: 3px;
}
.source-card::-webkit-scrollbar-track {
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
  gap: 10px;
  margin-top: 14px;
}

.tip-alert {
  margin-top: 14px;
}

.tip-alert .link {
  color: var(--brand);
  text-decoration: none;
  margin: 0 4px;
}
</style>
