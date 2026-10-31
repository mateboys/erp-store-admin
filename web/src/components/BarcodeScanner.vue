<template>
  <div>
    <div class="scan-box">
      <video ref="video" playsinline muted autoplay></video>
      <div v-if="scanning" class="scan-line"></div>
      <div v-if="!scanning" class="scan-mask">
        <el-icon><VideoCamera /></el-icon>
        <div>{{ starting ? '正在打开摄像头…' : '摄像头未开启' }}</div>
      </div>
    </div>
    <div class="flex" style="margin-top: 12px; flex-wrap: wrap">
      <el-button v-if="!scanning" type="primary" :icon="VideoCamera" :loading="starting" @click="start">
        {{ starting ? '正在打开摄像头…' : '重试开启摄像头' }}
      </el-button>
      <el-button v-else type="danger" :icon="VideoPause" @click="stop">停止</el-button>
      <el-select
        v-if="cameras.length > 1"
        v-model="deviceId"
        size="small"
        style="width: 190px"
        placeholder="选择摄像头"
        @change="restart"
      >
        <el-option v-for="c in cameras" :key="c.deviceId" :label="c.label" :value="c.deviceId" />
      </el-select>
    </div>
    <div class="muted" style="font-size: 12px; margin-top: 8px; line-height: 1.7">
      支持一维条码（EAN-13 / UPC / Code128…）与二维码。<br />
      扫<b>条形码</b>时请把条码横放、占画面宽度一半以上，距离镜头 15~25cm；太远或竖着放都认不出。
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="warning"
      show-icon
      :closable="false"
      style="margin-top: 10px"
    />
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

const emit = defineEmits(['result'])

const video = ref(null)
const scanning = ref(false)
/** 正在打开摄像头的过渡态（自动开启时先给个反馈，免得以为没反应） */
const starting = ref(false)
const cameras = ref([])
const deviceId = ref('')
const error = ref('')

/** 店里用得到的都是一维码（EAN-13 标签）与二维码，限定格式能明显提升一维码识别率 */
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX
]

let reader = null
let controls = null
let lastCode = ''
let lastTime = 0

function buildReader() {
  const hints = new Map()
  // 一维码必须开 TRY_HARDER：默认模式对细条码几乎不识别
  hints.set(DecodeHintType.TRY_HARDER, true)
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS)
  // 标签印反色（白条黑底）也能认
  hints.set(DecodeHintType.ALSO_INVERTED, true)
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 120,
    delayBetweenScanSuccess: 800
  })
}

function ensureReader() {
  if (!reader) reader = buildReader()
  return reader
}

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameras.value = devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `摄像头 ${i + 1}` }))
    if (!deviceId.value && cameras.value.length) deviceId.value = cameras.value[0].deviceId
  } catch (e) {
    error.value = '无法枚举摄像头设备'
  }
}

/** 启动序号：切走 tab 时 +1，让还在打开过程中的 start 立刻作废（否则摄像头会在后台一直开着） */
let startSeq = 0

async function start() {
  // 防重入：自动开启 + 用户手点可能同时发生，重复启动会叠出多条流
  if (scanning.value || starting.value) return
  error.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = '当前环境不支持摄像头（需 HTTPS 或 localhost）'
    return
  }
  const seq = ++startSeq
  starting.value = true
  try {
    // 先拿权限，否则 enumerateDevices 拿不到设备名
    await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } }).then(
      (s) => s.getTracks().forEach((t) => t.stop())
    ).catch(() => {})
    if (seq !== startSeq) return
    await listCameras()
    if (seq !== startSeq) return
    const r = ensureReader()
    // 关键：显式要高清。默认只给 640×480，一维码的细条根本不够像素，永远认不出
    const c = await r.decodeFromConstraints(
      {
        audio: false,
        video: {
          ...(deviceId.value ? { deviceId: { ideal: deviceId.value } } : {}),
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      },
      video.value,
      (result) => {
        if (!result || seq !== startSeq) return
        const code = result.getText()
        const now = Date.now()
        if (code === lastCode && now - lastTime < 1500) return
        lastCode = code
        lastTime = now
        emit('result', code)
      }
    )
    // 打开期间已经切走：立刻释放，别让摄像头在后台继续扫
    if (seq !== startSeq) {
      try {
        c?.stop()
      } catch (e) {
        /* noop */
      }
      releaseStream()
      return
    }
    controls = c
    scanning.value = true
  } catch (e) {
    if (seq === startSeq) {
      error.value = `打开摄像头失败：${e?.message || e}`
      scanning.value = false
    }
  } finally {
    if (seq === startSeq) starting.value = false
  }
}

/** 兜底释放：个别浏览器 controls.stop() 不会关掉摄像头流，指示灯还亮着 */
function releaseStream() {
  const s = video.value?.srcObject
  if (s) {
    s.getTracks().forEach((t) => t.stop())
    video.value.srcObject = null
  }
}

function stop() {
  startSeq++ // 让进行中的 start 作废
  try {
    controls?.stop()
  } catch (e) {
    /* noop */
  }
  controls = null
  releaseStream()
  scanning.value = false
  starting.value = false
}

async function restart() {
  stop()
  await start()
}

onBeforeUnmount(stop)

defineExpose({ start, stop })
</script>

<style scoped>
video {
  background: #1e1e2d;
}

.scan-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: #8b8ba7;
  font-size: 13px;
  background: #1e1e2d;
}
</style>
